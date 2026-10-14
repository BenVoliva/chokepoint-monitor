#!/usr/bin/env python3
"""Refresh the data files the page loads.

  data/transits.json  daily transits and trade-volume estimates per chokepoint
                      (IMF PortWatch)
  data/prices.json    Brent crude and a deep-sea freight price index (FRED)

Run every day by .github/workflows/update-data.yml; also fine to run by hand.
Each file is only replaced when the new pull looks complete, so a bad day at
either source leaves the published data as it was.  A file whose figures have
not changed is left alone, which is how the workflow knows whether there is
anything new to commit.  Standard library only.
"""
import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
START = date(2019, 1, 1)  # first day PortWatch publishes

PORTWATCH = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services"
PAGE = 1000  # PortWatch's maximum rows per request
# our key -> PortWatch portid.  The first four are the headline chokepoints;
# Bab el-Mandeb and the Cape show where Suez traffic went when it left.
CHOKEPOINTS = {
    "suez": "chokepoint1",
    "hormuz": "chokepoint6",
    "panama": "chokepoint2",
    "malacca": "chokepoint5",
    "bab": "chokepoint4",
    "cape": "chokepoint7",
}
SHIP_TYPES = ["container", "dry_bulk", "general_cargo", "roro", "tanker"]

FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
USER_AGENT = "chokepoint-monitor (+https://github.com/BenVoliva/chokepoint-monitor)"


def get(url, params, tries=4):
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8")
        except Exception as err:  # network errors and HTTP errors alike
            if attempt == tries - 1:
                raise
            print(f"  retrying after {type(err).__name__}: {err}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))


def arcgis_rows(service, where, fields):
    """Every row matching `where`, paging past the per-request limit."""
    rows, offset = [], 0
    while True:
        body = json.loads(get(f"{PORTWATCH}/{service}/FeatureServer/0/query", {
            "where": where,
            "outFields": ",".join(fields),
            "orderByFields": "ObjectId",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
            "returnGeometry": "false",
            "f": "json",
        }))
        if "error" in body:
            raise RuntimeError(f"PortWatch error: {body['error']}")
        page = [f["attributes"] for f in body.get("features", [])]
        rows.extend(page)
        if not page or not (body.get("exceededTransferLimit") or len(page) == PAGE):
            return rows
        offset += len(page)


def as_date(value):
    """PortWatch dates arrive as 'YYYY-MM-DD' or as epoch milliseconds."""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date()
    return date.fromisoformat(str(value)[:10])


def build_transits():
    ids = ",".join(f"'{pid}'" for pid in CHOKEPOINTS.values())
    fields = ["date", "portid"]
    fields += [f"n_{t}" for t in SHIP_TYPES] + [f"capacity_{t}" for t in SHIP_TYPES]
    rows = arcgis_rows("Daily_Chokepoints_Data", f"portid IN ({ids})", fields)
    places = {r["portid"]: r for r in arcgis_rows(
        "PortWatch_chokepoints_database", f"portid IN ({ids})",
        ["portid", "portname", "lat", "lon", "industry_top1", "industry_top2", "industry_top3"])}

    days = [as_date(r["date"]) for r in rows]
    end = max(days)
    span = (end - START).days + 1
    out = {
        "source": "IMF PortWatch (portwatch.imf.org), Daily Chokepoint Transit Calls and Trade Volume Estimates",
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "start": START.isoformat(),
        "end": end.isoformat(),
        "ship_types": SHIP_TYPES,
        "units": {"n": "transits per day", "kt": "thousand metric tons per day (estimated cargo carried)"},
        "chokepoints": [],
    }
    by_port = {pid: {} for pid in CHOKEPOINTS.values()}
    for row, day in zip(rows, days):
        by_port[row["portid"]][day] = row
    for key, pid in CHOKEPOINTS.items():
        series = by_port[pid]
        if not series or max(series) < end - timedelta(days=3):
            raise RuntimeError(f"{key}: data stops at {max(series) if series else 'nothing'}, expected {end}")
        place = places[pid]
        entry = {
            "key": key,
            "id": pid,
            "name": place["portname"],
            "lat": round(float(place["lat"]), 3),
            "lon": round(float(place["lon"]), 3),
            "top_cargo": [place[f"industry_top{i}"] for i in (1, 2, 3) if place.get(f"industry_top{i}")],
            "n": {t: [None] * span for t in SHIP_TYPES},
            "kt": {t: [None] * span for t in SHIP_TYPES},
        }
        for day, row in series.items():
            i = (day - START).days
            if i < 0:
                continue
            for t in SHIP_TYPES:
                if row[f"n_{t}"] is not None:
                    entry["n"][t][i] = int(row[f"n_{t}"])
                if row[f"capacity_{t}"] is not None:
                    entry["kt"][t][i] = round(row[f"capacity_{t}"] / 1000)
        out["chokepoints"].append(entry)
    return out


def fred_series(series_id):
    """[(date, value)] for one FRED series, skipping days with no observation."""
    text = get(FRED, {"id": series_id, "cosd": START.isoformat()})
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    if len(header) != 2 or header[1] != series_id:
        raise RuntimeError(f"unexpected FRED response for {series_id}: {header}")
    points = []
    for day, value in reader:
        try:
            points.append((date.fromisoformat(day), float(value)))
        except ValueError:
            continue  # FRED marks missing observations with "." or leaves them blank
    if not points:
        raise RuntimeError(f"FRED returned no observations for {series_id}")
    return points


def build_prices():
    brent = fred_series("DCOILBRENTEU")
    freight = fred_series("PCU483111483111")
    daily = [None] * ((brent[-1][0] - START).days + 1)
    for day, value in brent:
        daily[(day - START).days] = value
    return {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "brent": {
            "label": "Brent crude oil",
            "unit": "US dollars per barrel",
            "source": "U.S. Energy Information Administration via FRED (DCOILBRENTEU)",
            "start": START.isoformat(),
            "end": brent[-1][0].isoformat(),
            "daily": daily,  # null on days with no quote (weekends, holidays)
        },
        "freight": {
            "label": "Deep sea freight price index",
            "unit": "index, June 1988 = 100",
            "source": "U.S. Bureau of Labor Statistics via FRED (PCU483111483111)",
            "monthly": [[day.strftime("%Y-%m"), value] for day, value in freight],
        },
    }


def filled(node):
    """How many real (non-null) numbers a data file holds."""
    if isinstance(node, dict):
        return sum(filled(v) for v in node.values())
    if isinstance(node, list):
        return sum(filled(v) for v in node)
    return 0 if node is None or isinstance(node, (str, bool)) else 1


def figures(data):
    """A data file without the time it was fetched: what has to differ for it to count as new."""
    return {key: value for key, value in data.items() if key != "fetched"}


def publish(name, build):
    """Build one data file and replace the published copy if it is new and no worse."""
    path = DATA / name
    try:
        new = build()
        if path.exists():
            old = json.loads(path.read_text())
            if filled(new) < filled(old) * 0.98:
                raise RuntimeError(f"new pull has {filled(new):,} values, published file has {filled(old):,}")
            if figures(new) == figures(old):
                print(f"{name}: nothing new")
                return True
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(new, separators=(",", ":")))
        tmp.replace(path)
        print(f"{name}: {filled(new):,} values, {path.stat().st_size / 1024:.0f} KB")
        return True
    except Exception as err:
        # ::warning:: surfaces the message on the GitHub Actions run page
        print(f"::warning::{name} not updated: {err}")
        return False


def main():
    DATA.mkdir(exist_ok=True)
    transits_ok = publish("transits.json", build_transits)
    publish("prices.json", build_prices)
    # Transits are the point of the site; prices failing alone is only a warning.
    sys.exit(0 if transits_ok else 1)


if __name__ == "__main__":
    main()
