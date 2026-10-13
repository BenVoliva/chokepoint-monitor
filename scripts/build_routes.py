#!/usr/bin/env python3
"""Build data/routes.json from IMF PortWatch's global shipping-lane network.

The network is one multi-line of real shipping lanes.  This script turns it
into a graph, closes the small gaps the lanes leave at canals and straits, and
traces the routes the map animates (East Asia to Europe via Suez, Gulf to Asia
via Hormuz and Malacca, and so on) as shortest paths along those lanes.

One-off: rerun only when the route list below changes.  Standard library only.
"""
import collections
import heapq
import json
import math
import sys
import urllib.request
from pathlib import Path

LAYER = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
    "Global_Shipping_Routes/FeatureServer/15/query"
    "?where=1%3D1&outFields=FID&returnGeometry=true&outSR=4326&f=json"
)
OUT = Path(__file__).resolve().parent.parent / "data" / "routes.json"

SNAP = 0.02    # degrees; vertices closer than this are the same node
BRIDGE = 0.8   # degrees; a lane's loose end is joined to a lane this close...
BRIDGE_REACH_KM = 500  # ...unless the network already links them within this distance
MIN_PIECE = 300  # nodes; smaller pieces left over after bridging are dropped

# Lanes the network lacks, added by hand: [lon, lat] waypoints.
EXTRA_LANES = [
    # Inside the Persian Gulf, from the Strait of Hormuz up to Ras Tanura / Kuwait.
    [[56.69, 26.52], [56.2, 26.25], [55.1, 25.9], [53.6, 26.0], [52.4, 26.5],
     [51.3, 27.1], [50.5, 27.6], [49.6, 28.6]],
]

# Named points routes are pinned to.  Each snaps to the nearest network node.
PLACES = {
    "shanghai": (122.4, 31.1), "yokohama": (139.8, 35.0), "singapore": (103.82, 1.22),
    "malacca": (100.0, 3.3), "dondra": (80.6, 5.7), "mumbai": (72.75, 18.72),
    "bab": (43.4, 12.6), "suez": (32.6, 29.9), "port_said": (32.3, 31.5),
    "gibraltar": (-5.5, 36.0), "rotterdam": (3.3, 52.5), "cape": (18.2, -34.5),
    "hormuz": (56.69, 26.52), "gulf": (49.6, 28.6), "houston": (-94.4, 29.1),
    "new_york": (-73.4, 40.2), "colon": (-79.9, 9.5), "balboa": (-79.54, 8.9),
    "valparaiso": (-71.7, -32.9), "rio": (-43.14, -22.93),
}

# key, label, chokepoints passed (in order), places to route through.
ROUTES = [
    ("asia_europe_suez", "East Asia – Europe via Suez", ["malacca", "bab", "suez"],
     ["shanghai", "singapore", "malacca", "dondra", "bab", "suez", "port_said", "gibraltar", "rotterdam"]),
    ("asia_europe_cape", "East Asia – Europe via the Cape", ["malacca", "cape"],
     ["shanghai", "singapore", "malacca", "cape", "rotterdam"]),
    ("gulf_asia", "Gulf – East Asia", ["hormuz", "malacca"],
     ["gulf", "hormuz", "dondra", "malacca", "singapore", "yokohama"]),
    ("gulf_europe_suez", "Gulf – Europe via Suez", ["hormuz", "bab", "suez"],
     ["gulf", "hormuz", "bab", "suez", "port_said", "gibraltar", "rotterdam"]),
    ("gulf_atlantic_cape", "Gulf – Atlantic via the Cape", ["hormuz", "cape"],
     ["gulf", "hormuz", "cape", "rotterdam"]),
    ("asia_india", "East Asia – South Asia", ["malacca"],
     ["shanghai", "singapore", "malacca", "dondra", "mumbai"]),
    ("brazil_asia_cape", "Brazil – East Asia via the Cape", ["cape", "malacca"],
     ["rio", "cape", "malacca", "singapore", "shanghai"]),
    ("asia_useast_panama", "East Asia – US East Coast via Panama", ["panama"],
     ["shanghai", "balboa", "colon", "new_york"]),
    ("usgulf_asia_panama", "US Gulf – East Asia via Panama", ["panama"],
     ["houston", "colon", "balboa", "yokohama"]),
    ("andes_useast_panama", "South America west coast – US East Coast via Panama", ["panama"],
     ["valparaiso", "balboa", "colon", "new_york"]),
]


def haversine(a, b):
    lo1, la1, lo2, la2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def flat(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def key(pt):
    return (round(pt[0] / SNAP), round(pt[1] / SNAP))


class Network:
    def __init__(self, paths):
        self.pos = {}
        self.adj = collections.defaultdict(dict)
        for path in paths:
            self.add_lane(path)

    def add_lane(self, path):
        for a, b in zip(path, path[1:]):
            self.link(a, b)

    def link(self, a, b, km=None):
        ka, kb = key(a), key(b)
        self.pos.setdefault(ka, tuple(a))
        self.pos.setdefault(kb, tuple(b))
        if ka != kb:
            w = haversine(a, b) if km is None else km
            self.adj[ka][kb] = w
            self.adj[kb][ka] = w

    def join_antimeridian(self):
        """Lanes are cut at 180 degrees; stitch the two sides back together."""
        edge = [k for k in self.pos if abs(abs(self.pos[k][0]) - 180) < 1e-6]
        east = [k for k in edge if self.pos[k][0] > 0]
        joined = 0
        for w in (k for k in edge if self.pos[k][0] < 0):
            e = min(east, key=lambda k: abs(self.pos[k][1] - self.pos[w][1]))
            if abs(self.pos[e][1] - self.pos[w][1]) < 0.5:
                self.adj[w][e] = self.adj[e][w] = 0.001
                joined += 1
        return joined

    def pieces(self):
        label, groups = {}, []
        for start in self.pos:
            if start in label:
                continue
            label[start] = len(groups)
            stack, group = [start], []
            while stack:
                node = stack.pop()
                group.append(node)
                for nxt in self.adj[node]:
                    if nxt not in label:
                        label[nxt] = len(groups)
                        stack.append(nxt)
            groups.append(group)
        return label, groups

    def within(self, src, limit_km):
        """Nodes reachable from src along the network within limit_km."""
        dist, queue = {src: 0.0}, [(0.0, src)]
        while queue:
            d, node = heapq.heappop(queue)
            if d > dist.get(node, math.inf):
                continue
            for nxt, w in self.adj[node].items():
                nd = d + w
                if nd <= limit_km and nd < dist.get(nxt, math.inf):
                    dist[nxt] = nd
                    heapq.heappush(queue, (nd, nxt))
        return dist

    def bridge_gaps(self):
        """Join each loose lane end to the nearest node it cannot already reach.

        Lanes stop short at canals and narrow straits (Suez, Panama, Bab
        el-Mandeb), leaving loose ends a fraction of a degree apart.
        """
        loose = [k for k, links in self.adj.items()
                 if len(links) == 1 and abs(abs(self.pos[k][0]) - 180) > 1e-6]
        bridges = []
        for node in loose:
            close = self.within(node, BRIDGE_REACH_KM)
            gaps = [(flat(self.pos[node], self.pos[k]), k) for k in self.pos if k not in close]
            d, other = min(gaps)
            if d <= BRIDGE:
                self.link(self.pos[node], self.pos[other])
                bridges.append((self.pos[node], self.pos[other], d))
        return bridges

    def drop_small_pieces(self):
        _, groups = self.pieces()
        dropped = 0
        for group in groups:
            if len(group) < MIN_PIECE:
                dropped += len(group)
                for node in group:
                    for nxt in list(self.adj[node]):
                        self.adj[nxt].pop(node, None)
                    self.adj.pop(node, None)
                    self.pos.pop(node, None)
        return dropped

    def nearest(self, lon, lat):
        return min(self.pos, key=lambda k: flat(self.pos[k], (lon, lat)))

    def shortest(self, src, dst):
        dist, prev, queue = {src: 0.0}, {}, [(0.0, src)]
        while queue:
            d, node = heapq.heappop(queue)
            if node == dst:
                break
            if d > dist.get(node, math.inf):
                continue
            for nxt, w in self.adj[node].items():
                nd = d + w
                if nd < dist.get(nxt, math.inf):
                    dist[nxt], prev[nxt] = nd, node
                    heapq.heappush(queue, (nd, nxt))
        if dst not in dist:
            raise SystemExit(f"no lane between {self.pos[src]} and {self.pos[dst]}")
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return dist[dst], path[::-1]

    def lanes(self):
        """The whole network as a list of polylines, each edge drawn once."""
        seen, lines = set(), []
        for start in self.pos:
            if len(self.adj[start]) == 2:
                continue  # only start lines at junctions and loose ends
            for nxt in self.adj[start]:
                if (start, nxt) in seen:
                    continue
                line, prev, node = [start], start, nxt
                while True:
                    seen.add((prev, node))
                    seen.add((node, prev))
                    line.append(node)
                    if len(self.adj[node]) != 2:
                        break
                    prev, node = node, next(k for k in self.adj[node] if k != prev)
                    if (prev, node) in seen:
                        break
                lines.append([self.pos[k] for k in line])
        return lines


def unwrap(coords):
    """Make longitudes continuous so a route crossing 180 degrees does not jump."""
    out, shift = [], 0.0
    for i, (lon, lat) in enumerate(coords):
        if i and abs(lon - coords[i - 1][0]) > 180:
            shift += -360 if lon > coords[i - 1][0] else 360
        out.append([round(lon + shift, 3), round(lat, 3)])
    return out


def dedupe(coords):
    out = [coords[0]]
    for pt in coords[1:]:
        if pt != out[-1]:
            out.append(pt)
    return out


def recentre(coords):
    """Shift a route by whole turns so it sits around the standard -180..180 map.

    Routes across the Pacific unwrap to different ends of the number line
    depending on where they start; this puts them in one frame so the lanes
    they share line up exactly.
    """
    mean = sum(lon for lon, _ in coords) / len(coords)
    shift = -360 * round(mean / 360)
    return [[round(lon + shift, 3), lat] for lon, lat in coords]


def trunks(routes):
    """Split the routes' combined lanes into stretches used by one set of routes.

    Several routes share long stretches (four run through Malacca together).
    Drawing each stretch once, tagged with the routes on it, lets the map size
    a lane by the traffic it carries instead of overdrawing lines.
    """
    users = collections.defaultdict(set)   # undirected edge -> routes using it
    links = collections.defaultdict(set)   # node -> neighbouring nodes
    for route in routes:
        pts = [tuple(p) for p in route["path"]]
        for a, b in zip(pts, pts[1:]):
            users[frozenset((a, b))].add(route["key"])
            links[a].add(b)
            links[b].add(a)

    def is_break(node):
        """A stretch ends where lanes fork or the set of routes changes."""
        if len(links[node]) != 2:
            return True
        a, b = links[node]
        return users[frozenset((node, a))] != users[frozenset((node, b))]

    seen, out = set(), []
    for start in links:
        if not is_break(start):
            continue
        for nxt in links[start]:
            if frozenset((start, nxt)) in seen:
                continue
            path, prev, node = [start], start, nxt
            while True:
                seen.add(frozenset((prev, node)))
                path.append(node)
                if is_break(node):
                    break
                prev, node = node, next(k for k in links[node] if k != prev)
            out.append({"routes": sorted(users[frozenset((path[0], path[1]))]),
                        "path": [list(p) for p in path]})
    return out


def main():
    req = urllib.request.Request(LAYER, headers={"User-Agent": "chokepoint-monitor"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        paths = json.load(resp)["features"][0]["geometry"]["paths"]

    net = Network(paths)
    for lane in EXTRA_LANES:
        net.add_lane(lane)
    joined = net.join_antimeridian()
    bridges = net.bridge_gaps()
    dropped = net.drop_small_pieces()
    print(f"network: {len(net.pos)} nodes, {joined} antimeridian joins, {dropped} stray nodes dropped")
    for a, b, d in bridges:
        print(f"  bridged {d:.2f} deg: {a[0]:.2f},{a[1]:.2f} -> {b[0]:.2f},{b[1]:.2f}")

    nodes = {}
    for name, (lon, lat) in PLACES.items():
        nodes[name] = net.nearest(lon, lat)
        off = flat(net.pos[nodes[name]], (lon, lat))
        if off > 1.0:
            print(f"  warning: {name} snapped {off:.2f} deg away", file=sys.stderr)

    routes = []
    for route_key, label, chokepoints, stops in ROUTES:
        total, chain = 0.0, [nodes[stops[0]]]
        for a, b in zip(stops, stops[1:]):
            km, leg = net.shortest(nodes[a], nodes[b])
            total += km
            chain.extend(leg[1:])
        coords = recentre(dedupe(unwrap([net.pos[k] for k in chain])))
        routes.append({"key": route_key, "label": label, "chokepoints": chokepoints,
                       "km": round(total), "path": coords})
        print(f"route {route_key}: {total:,.0f} km, {len(coords)} points, "
              f"lon {min(p[0] for p in coords):.0f}..{max(p[0] for p in coords):.0f}")

    network = [[[round(lon, 2), round(lat, 2)] for lon, lat in line] for line in net.lanes()]
    shared = trunks(routes)
    OUT.write_text(json.dumps({
        "source": "IMF PortWatch, Global Shipping Routes (portwatch.imf.org); routes traced along it",
        "network": network,
        "routes": routes,
        "trunks": shared,
    }, separators=(",", ":")))
    print(f"wrote {OUT.name}: {len(network)} lanes, {len(routes)} routes, "
          f"{len(shared)} trunks, {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
