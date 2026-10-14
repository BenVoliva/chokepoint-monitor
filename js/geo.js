// Map projection and the land outlines.

/** East-west squeeze. Plain latitude/longitude stretches the mid-latitudes
 *  sideways; 0.8 is true to scale at about 37 degrees north and south. */
export const KX = 0.8;

/** Width of one copy of the world, in scene units (1 unit = 1 degree of latitude). */
export const WORLD_WIDTH = 360 * KX;

/** [lon, lat] -> scene x/z on the sea surface. North is -z. */
export function project(lon, lat) {
  return { x: lon * KX, z: -lat };
}

// Natural Earth outlines, as packaged by the world-atlas project (public domain).
// The coarse set gives clean outlines for the world view; the fine one takes
// over close in, where straits need their real shape. The fine file holds the
// countries as well as the land, so the borders come with it.
const LAND = {
  coarse: { url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json', minArea: 0 },
  fine: { url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json', minArea: 0.03 },
};
const ANTARCTIC_LIMIT = -60;    // land wholly south of this is left off the map
const SECOND_LABEL_SHARE = 0.15; // a separate piece of a country this large, against its biggest, gets the name too

/**
 * The map's outlines at one level of detail.
 *   land       polygons, each [outerRing, ...holes], rings of [lon, lat]
 *   borders    lines of [lon, lat] where two countries meet (fine detail only)
 *   countries  { name, lon, lat, size } for each country's name label (fine detail only)
 * @param {'coarse'|'fine'} detail
 */
export async function loadLand(detail) {
  const { url, minArea } = LAND[detail];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`land outlines: HTTP ${res.status}`);
  const topology = await res.json();
  const arcs = decodeArcs(topology);
  const land = polygons(arcs, topology.objects.land)
    .map(mend)
    .filter(([outer]) => {
      const { west, east, south, north } = bounds(outer);
      // minArea is in square degrees of bounding box; smaller specks are skipped
      return north > ANTARCTIC_LIMIT && (east - west) * (north - south) >= minArea;
    });
  const { countries } = topology.objects;
  return {
    land,
    borders: countries ? sharedArcs(countries).map((i) => arcs[i]) : [],
    countries: countries ? countryLabels(arcs, countries) : [],
  };
}

/**
 * Where to write each country's name: a point well inside its largest piece
 * (so France is labelled in France, not French Guiana), and inside any other
 * piece that is a fair share of that size, so both halves of Malaysia and the
 * big islands of Indonesia each carry the name. `size` is the side of a square
 * of the piece's area, in scene units, to judge when the name is worth showing.
 */
function countryLabels(arcs, countries) {
  const labels = [];
  for (const country of countries.geometries) {
    const pieces = polygons(arcs, country).map(mend)
      .map(([outer]) => ({ outer, area: ringArea(outer) }))
      .filter((piece) => bounds(piece.outer).north > ANTARCTIC_LIMIT);
    const largest = Math.max(0, ...pieces.map((piece) => piece.area));
    for (const piece of pieces) {
      if (piece.area < largest * SECOND_LABEL_SHARE) continue;
      const [lon, lat] = labelPoint(piece.outer);
      labels.push({ name: country.properties.name, lon, lat, size: Math.sqrt(piece.area) });
    }
  }
  return labels;
}

/** Area of a ring in scene units (the shoelace formula). */
function ringArea(ring) {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(twice) / 2 * KX;
}

/**
 * A point inside a ring that suits a line of text: the middle of the widest
 * stretch of the shape along a few lines of latitude around its centre. A plain
 * centroid can fall outside a bent shape such as Vietnam's.
 */
function labelPoint(ring) {
  const { west, east, south, north } = bounds(ring);
  let twice = 0, lat = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    twice += cross;
    lat += (ring[j][1] + ring[i][1]) * cross;
  }
  const centre = twice ? lat / (3 * twice) : (south + north) / 2;
  let best = null;
  for (const [at, weight] of [[centre, 1.15], [(south + north) / 2, 1], [centre + (north - south) * 0.15, 1], [centre - (north - south) * 0.15, 1]]) {
    const crossings = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if ((y1 > at) !== (y2 > at)) crossings.push(x1 + (at - y1) / (y2 - y1) * (x2 - x1));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const width = (crossings[k + 1] - crossings[k]) * weight;
      if (!best || width > best.width) best = { width, lon: (crossings[k] + crossings[k + 1]) / 2, lat: at };
    }
  }
  return best ? [best.lon, best.lat] : [(west + east) / 2, (south + north) / 2];
}

/**
 * The arcs that two countries have in common: their borders. Coastlines belong
 * to one country only, so they drop out.
 */
function sharedArcs(countries) {
  const users = new Map();   // arc index -> how many countries use it
  for (const country of countries.geometries) {
    const own = new Set();
    const visit = (part) => {
      if (typeof part === 'number') own.add(part < 0 ? ~part : part);
      else part.forEach(visit);
    };
    visit(country.arcs ?? []);
    for (const i of own) users.set(i, (users.get(i) ?? 0) + 1);
  }
  return [...users].filter(([, count]) => count > 1).map(([i]) => i);
}

function bounds(ring) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}

/**
 * Keep a polygon in one piece where it crosses the date line. Eurasia and
 * islands such as Fiji straddle 180 degrees; left alone, their outline would
 * jump from one edge of the map to the other and draw a sliver across the
 * world. Holes (the Caspian Sea) must move with their outline, or the land
 * fills in wrongly.
 */
function mend([outer, ...holes]) {
  const ring = recentre(unwrap(outer), 0);
  const { west, east } = bounds(ring);
  return [ring, ...holes.map((hole) => recentre(unwrap(hole), (west + east) / 2))];
}

/** Make a ring's longitudes continuous: no jump from +180 to -180 or back. */
function unwrap(ring) {
  let shift = 0;
  return ring.map(([lon, lat], i) => {
    if (i) {
      const jump = lon - ring[i - 1][0];
      if (jump > 180) shift -= 360;
      else if (jump < -180) shift += 360;
    }
    return [lon + shift, lat];
  });
}

/** Shift a ring by whole turns of the globe so its middle is within half a turn of `near`. */
function recentre(ring, near) {
  const { west, east } = bounds(ring);
  const shift = -360 * Math.round(((west + east) / 2 - near) / 360);
  return shift ? ring.map(([lon, lat]) => [lon + shift, lat]) : ring;
}

// --- A minimal TopoJSON reader: just enough for Polygon and MultiPolygon. ---

function polygons(arcs, object) {
  const out = [];
  const visit = (geom) => {
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(visit);
    else if (geom.type === 'Polygon') out.push(geom.arcs.map((r) => stitch(arcs, r)));
    else if (geom.type === 'MultiPolygon') geom.arcs.forEach((p) => out.push(p.map((r) => stitch(arcs, r))));
  };
  visit(object);
  return out;
}

/** Arcs are stored as integer deltas; undo that and apply the scale. */
function decodeArcs({ arcs, transform }) {
  const [sx, sy] = transform.scale, [tx, ty] = transform.translate;
  return arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
  });
}

/** Join a ring's arcs end to end. A negative index means that arc, reversed. */
function stitch(arcs, indexes) {
  const ring = [];
  for (const i of indexes) {
    const pts = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    for (let k = ring.length ? 1 : 0; k < pts.length; k++) ring.push(pts[k]);
  }
  return ring;
}
