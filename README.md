# Chokepoint Monitor

Daily ship transits through the Suez Canal, the Strait of Hormuz, the Panama
Canal and the Strait of Malacca since 2019, on a 3D map with a timeline of the
events that moved them and oil and freight prices alongside. Bab el-Mandeb and
the Cape of Good Hope are included to show where Suez traffic went.

**Work in progress.** The map, cards and timeline run; motion, analysis and
polish are still to come.

## Run it locally

The page loads its data with `fetch()`, so it needs a local web server:

```bash
python3 scripts/serve.py
```

Then open http://localhost:8765. No build step and nothing to install; the 3D
library (three.js) and the land outlines load from a CDN.

Links can open on a given day and chokepoint, for example
`?date=2021-03-25&focus=suez`.

## Data

| File | What | Source |
|---|---|---|
| `data/transits.json` | Daily transits and estimated cargo by ship type | [IMF PortWatch](https://portwatch.imf.org/) |
| `data/prices.json` | Brent crude (daily) and a deep-sea freight price index (monthly) | [FRED](https://fred.stlouisfed.org/) series `DCOILBRENTEU`, `PCU483111483111` |
| `data/routes.json` | Shipping lanes and the routes ships are drawn along | IMF PortWatch global shipping routes |
| `data/events.json` | Hand-curated events, each with a source link | See the file |

Refresh the first two with `python3 scripts/fetch_data.py`. `scripts/build_routes.py`
rebuilds the routes and only needs rerunning if the route list changes.

Things to know about the numbers:

- PortWatch counts are estimates from ship transponder (AIS) signals. Ships
  that switch their transponders off are missed, which matters at Hormuz.
- PortWatch publishes weekly, a few days in arrears.
- The ships on the map are illustrative. PortWatch counts transits at each
  chokepoint; it does not track vessels. Each ship drawn stands for about 80
  at sea, and the split of traffic between routes is an assumption.
- "Normal" is the average for the same calendar month in 2022, or in 2019 for
  dates before 2022.
