#!/usr/bin/env python3
"""Collect recent headlines about the six chokepoints into data/news.json.

Reads the RSS feeds of a few shipping trade publications and keeps the stories
whose headline names a chokepoint. The matching is by name only; nobody checks
the results by hand. The file keeps the last 30 days, so stories build up from
one run to the next, and it is only rewritten when something changed.

Run every day by .github/workflows/update-data.yml; also fine to run by hand.
Standard library only.
"""
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "news.json"
KEEP_DAYS = 30
MAX_STORIES = 150
USER_AGENT = "Mozilla/5.0 (compatible; chokepoint-monitor; +https://github.com/BenVoliva/chokepoint-monitor)"

FEEDS = {
    "gCaptain": "https://gcaptain.com/feed/",
    "Splash247": "https://splash247.com/feed/",
    "The Maritime Executive": "https://maritime-executive.com/articles.rss",
    "Hellenic Shipping News": "https://www.hellenicshippingnews.com/feed/",
    "Seatrade Maritime": "https://www.seatrade-maritime.com/rss.xml",
    "The Loadstar": "https://theloadstar.com/feed/",
    "Container News": "https://container-news.com/feed/",
    "FreightWaves": "https://www.freightwaves.com/news/feed",
}

# A headline is about a chokepoint if it names it. "Panama" alone is not enough
# (Panama is also the largest flag registry), and "Suezmax", a tanker size, does
# not count as Suez. The Red Sea and the Houthis count for Bab el-Mandeb.
MATCH = {
    "suez": r"\bSuez\b",
    "hormuz": r"\bHormuz\b",
    "panama": r"\bPanama Canal\b",
    "malacca": r"\bMalacca\b|\bSingapore Strait\b|\bStraits? of Singapore\b",
    "bab": r"\bBab[ -]?el[ -]?Mandeb\b|\bBab al-Mandab\b|\bRed Sea\b|\bHouthis?\b",
    "cape": r"\bCape of Good Hope\b|\b(?:round|around) the Cape\b|\bCape route\b",
}
PATTERNS = {key: re.compile(rx, re.I) for key, rx in MATCH.items()}
ATOM = "{http://www.w3.org/2005/Atom}"
STAMP = "%Y-%m-%dT%H:%MZ"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse_time(text):
    """RSS dates ("Tue, 14 Oct 2026 11:48:00 +0000") or Atom ones (ISO 8601), in UTC."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            when = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc)


def clean_url(url):
    """The link without tracking parameters, or None if it is not an ordinary web address."""
    parts = urllib.parse.urlsplit((url or "").strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if not k.lower().startswith("utm_")]
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), ""))


def chokepoints_in(title):
    return [key for key, pattern in PATTERNS.items() if pattern.search(title)]


def stories_from(source, body, now):
    """The stories in one feed whose headline names a chokepoint."""
    root = ET.fromstring(body)
    entries = [(item.findtext("title"), item.findtext("link"), item.findtext("pubDate")) for item in root.iter("item")]
    for entry in root.iter(ATOM + "entry"):
        link = entry.find(ATOM + "link")
        entries.append((entry.findtext(ATOM + "title"), link.get("href") if link is not None else None,
                        entry.findtext(ATOM + "published") or entry.findtext(ATOM + "updated")))
    stories = []
    for title, link, when in entries:
        title = " ".join(re.sub(r"<[^>]+>", "", html.unescape(title or "")).split())
        url = clean_url(link)
        found = chokepoints_in(title)
        if not (title and url and found):
            continue
        time = min(parse_time(when) or now, now)
        stories.append({"title": title, "url": url, "source": source, "time": time.strftime(STAMP), "chokepoints": found})
    return stories


def main():
    now = datetime.now(timezone.utc)
    old = json.loads(PATH.read_text()) if PATH.exists() else {}
    fresh, read = [], 0
    for source, url in FEEDS.items():
        try:
            found = stories_from(source, fetch(url), now)
        except Exception as err:  # one feed being down should not stop the rest
            print(f"::warning::{source} feed not read: {type(err).__name__}: {err}")
            continue
        read += 1
        fresh += found
        print(f"{source}: {len(found)} headlines naming a chokepoint")
    if not read:
        print("::warning::no news feed could be read; news.json left as it was")
        return

    # Add to what earlier runs collected: newest first, one entry per link, and one
    # per headline (the same wire story often runs in more than one publication).
    cutoff = (now - timedelta(days=KEEP_DAYS)).strftime(STAMP)
    by_url = {}
    for story in fresh + old.get("stories", []):
        story["chokepoints"] = chokepoints_in(story["title"])   # in case the rules above changed
        if story["chokepoints"] and story["time"] >= cutoff:
            by_url.setdefault(story["url"], story)
    stories, headlines = [], set()
    for story in sorted(by_url.values(), key=lambda s: s["time"], reverse=True):
        headline = re.sub(r"\W+", " ", story["title"].lower()).strip()
        if headline not in headlines:
            headlines.add(headline)
            stories.append(story)
    stories = stories[:MAX_STORIES]

    if stories == old.get("stories"):
        print(f"news.json: nothing new ({len(stories)} stories)")
        return
    sources = [{"name": name, "url": "https://{}/".format(urllib.parse.urlsplit(url).netloc)} for name, url in FEEDS.items()]
    PATH.write_text(json.dumps({
        "fetched": now.strftime(STAMP),
        "keep_days": KEEP_DAYS,
        "sources": sources,
        "stories": stories,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"news.json: {len(stories)} stories from the last {KEEP_DAYS} days")


if __name__ == "__main__":
    main()
