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

// Natural Earth land, as packaged by the world-atlas project (public domain).
// The coarse set gives clean outlines for the world view; the fine one takes
// over close in, where straits need their real shape.
const LAND = {
  coarse: { url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json', minArea: 0 },
  fine: { url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json', minArea: 0.03 },
};
const ANTARCTIC_LIMIT = -60;    // land wholly south of this is left off the map

/**
 * Land as a list of polygons, each [outerRing, ...holes], rings of [lon, lat].
 * @param {'coarse'|'fine'} detail
 */
export async function loadLand(detail) {
  const { url, minArea } = LAND[detail];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`land outlines: HTTP ${res.status}`);
  const topology = await res.json();
  return polygons(topology, topology.objects.land)
    .map((rings) => rings.map(unwrap))
    .filter(([outer]) => {
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
      for (const [lon, lat] of outer) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      // minArea is in square degrees of bounding box; smaller specks are skipped
      return north > ANTARCTIC_LIMIT && (east - west) * (north - south) >= minArea;
    });
}

/**
 * Keep a ring in one piece where it crosses the date line. Islands such as
 * Fiji straddle 180 degrees; left alone, their outline would jump from one
 * edge of the map to the other and draw a sliver across the whole world.
 */
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

// --- A minimal TopoJSON reader: just enough for Polygon and MultiPolygon. ---

function polygons(topology, object) {
  const arcs = decodeArcs(topology);
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
