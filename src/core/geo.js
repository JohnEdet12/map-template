/** Geographic + formatting helpers. Turf does the real maths. */

import turfArea from '@turf/area';
import turfBbox from '@turf/bbox';
import turfCentroid from '@turf/centroid';
import turfBuffer from '@turf/buffer';
import turfUnion from '@turf/union';

const unwrap = (m) => (typeof m === 'function' ? m : m.default);
const area = unwrap(turfArea);
const bbox = unwrap(turfBbox);
const centroid = unwrap(turfCentroid);
const buffer = unwrap(turfBuffer);
const union = unwrap(turfUnion);

/** Area of any GeoJSON in km², using the geodesic (spherical) formula. */
export function areaKm2(geojson) {
  try { return area(geojson) / 1e6; } catch { return 0; }
}

/**
 * The area of several polygons *taken together*, in km².
 *
 * Not the sum of their areas. Turf's `area()` adds every feature up, which is
 * right for a collection of separate things and wrong for study areas, where
 * an LGA and the state around it are both reasonable to add and the ground
 * they share must not be counted twice. Dissolving them first is what makes
 * the printed figure the area of the map rather than an arithmetic total.
 *
 * Falls back to the plain sum if the boundaries defeat the union — OSM
 * outlines are occasionally self-intersecting, and an over-count is a much
 * smaller failure than a study area with no size at all.
 */
export function combinedAreaKm2(geojsons) {
  const polygons = [];
  for (const g of geojsons ?? []) {
    for (const f of g?.features ?? (g ? [g] : [])) {
      if (f?.geometry?.type === 'Polygon' || f?.geometry?.type === 'MultiPolygon') polygons.push(f);
    }
  }
  if (!polygons.length) return 0;
  if (polygons.length === 1) return areaKm2(polygons[0]);

  try {
    // @turf/union v7 takes a FeatureCollection and dissolves the whole thing.
    const dissolved = union({ type: 'FeatureCollection', features: polygons });
    if (dissolved) return areaKm2(dissolved);
  } catch { /* fall through to the sum */ }

  return polygons.reduce((sum, f) => sum + areaKm2(f), 0);
}

/** [west, south, east, north] */
export function bboxOf(geojson) {
  try { return bbox(geojson); } catch { return null; }
}

/** [lng, lat] */
export function centroidOf(geojson) {
  try { return centroid(geojson).geometry.coordinates; } catch { return null; }
}

/** Circular buffer around a point, in kilometres. */
export function bufferPoint([lng, lat], radiusKm) {
  const point = { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} };
  try { return buffer(point, radiusKm, { units: 'kilometers' }); } catch { return null; }
}

/** MapLibre-shaped bounds from a bbox array. */
export const boundsFromBbox = (b) => (b ? [[b[0], b[1]], [b[2], b[3]]] : null);

/** Rough ground resolution in metres per screen pixel. */
export function metresPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * Pick a "nice" scale-bar length (1, 2, 2.5 or 5 × 10ⁿ) that fits within
 * `maxPx` and return both the rounded distance and the pixels it occupies.
 */
export function niceScaleBar(maxPx, mPerPx) {
  const maxMetres = maxPx * mPerPx;
  const pow = Math.pow(10, Math.floor(Math.log10(maxMetres)));
  let value = pow;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (pow * step <= maxMetres) value = pow * step;
  }
  const km = value >= 1000;
  return {
    metres: value,
    px: value / mPerPx,
    label: km ? `${formatNumber(value / 1000)} km` : `${formatNumber(value)} m`,
  };
}

/** Thousands-separated, sensible precision. */
export function formatNumber(n, maxFrac) {
  if (!Number.isFinite(n)) return '—';
  const frac = maxFrac ?? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  return n.toLocaleString(undefined, { maximumFractionDigits: frac });
}

/** "1 234 km²" with a sensible unit for very small areas. */
export function formatArea(km2) {
  if (!Number.isFinite(km2) || km2 <= 0) return '—';
  if (km2 < 0.5) return `${formatNumber(km2 * 1e6, 0)} m²`;
  return `${formatNumber(km2)} km²`;
}

/** 7.4951 → 7°29′42″E */
export function formatDMS(value, axis) {
  const hemi = axis === 'lng' ? (value >= 0 ? 'E' : 'W') : value >= 0 ? 'N' : 'S';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${deg}°${String(min).padStart(2, '0')}′${String(sec).padStart(2, '0')}″${hemi}`;
}

/** Rough geometry type of a FeatureCollection: 'point' | 'line' | 'polygon'. */
export function dominantGeometry(geojson) {
  const features = geojson?.features ?? (geojson ? [geojson] : []);
  const tally = { point: 0, line: 0, polygon: 0 };
  for (const f of features) {
    const t = f?.geometry?.type ?? '';
    if (t.includes('Point')) tally.point++;
    else if (t.includes('LineString')) tally.line++;
    else if (t.includes('Polygon')) tally.polygon++;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

/** Total feature count, tolerant of bare geometries. */
export const featureCount = (geojson) => geojson?.features?.length ?? (geojson ? 1 : 0);

/** Convert an Overpass/GeoJSON bbox to the `s,w,n,e` order Overpass wants. */
export const bboxToOverpass = (b) => `${b[1]},${b[0]},${b[3]},${b[2]}`;

/* ------------------------------------------------------------------ */
/* Point-in-polygon (ray casting) — used to clip generated grids to a  */
/* study area without pulling in a heavier geometry engine.            */
/* ------------------------------------------------------------------ */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(pt, rings) {
  if (!rings.length || !inRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(pt, rings[i])) return false;  // hole
  return true;
}

/** Is [lng, lat] inside any polygon of this GeoJSON? */
export function pointInGeoJson(pt, geojson) {
  if (!geojson) return true;
  return polygonsOf(geojson).some((rings) => inPolygon(pt, rings));
}

/* ------------------------------------------------------------------ */
/* Clipping to a study area                                            */
/*                                                                     */
/* Open data is fetched by bounding box, because that is the only shape */
/* Overpass understands — so a request for "roads in Ikeja" always      */
/* comes back with a rectangle of roads, spilling well past the         */
/* boundary. Clipping is what turns that rectangle back into the study  */
/* area the map is actually about.                                      */
/* ------------------------------------------------------------------ */

/** Every polygon in a GeoJSON, flattened to a list of ring-arrays. */
function polygonsOf(geojson) {
  const out = [];
  for (const f of geojson?.features ?? [geojson]) {
    const g = f?.geometry ?? f;
    if (g?.type === 'Polygon') out.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') out.push(...g.coordinates);
  }
  return out;
}

const lerp = ([x0, y0], [x1, y1], t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];

/**
 * Where the segment p→q crosses any boundary edge, as sorted positions
 * along the segment.
 */
function crossings(p, q, polys) {
  const ts = [];
  const [px, py] = p;
  const dx = q[0] - px;
  const dy = q[1] - py;

  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j];
        const [bx, by] = ring[i];
        const den = dx * (by - ay) - dy * (bx - ax);
        if (Math.abs(den) < 1e-14) continue;                    // parallel
        const t = ((ax - px) * (by - ay) - (ay - py) * (bx - ax)) / den;
        const u = ((ax - px) * dy - (ay - py) * dx) / den;
        if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push(t);
      }
    }
  }
  return ts.sort((a, b) => a - b);
}

/**
 * The parts of one line that fall inside the boundary.
 *
 * Each segment is cut at every boundary crossing and each piece is kept or
 * dropped on the side its midpoint falls — which handles concave shapes and
 * holes that a convex clipper such as Sutherland–Hodgman gets wrong. Pieces
 * that stay inside across a vertex keep accumulating into one line, so a road
 * crossing the area is returned whole rather than as one stub per segment.
 */
function clipLine(coords, polys) {
  const parts = [];
  let run = null;

  for (let i = 0; i < coords.length - 1; i++) {
    const p = coords[i];
    const q = coords[i + 1];
    const stops = [0, ...crossings(p, q, polys), 1];

    for (let k = 0; k < stops.length - 1; k++) {
      const [t0, t1] = [stops[k], stops[k + 1]];
      if (t1 - t0 < 1e-12) continue;
      if (polys.some((rings) => inPolygon(lerp(p, q, (t0 + t1) / 2), rings))) {
        if (!run) run = [lerp(p, q, t0)];
        run.push(lerp(p, q, t1));
      } else if (run) {
        parts.push(run);
        run = null;
      }
    }
  }
  if (run) parts.push(run);
  return parts.filter((l) => l.length > 1);
}

/** The clipped geometry of one feature, or null if nothing survives. */
function clipGeometry(g, polys) {
  if (!g) return null;

  if (g.type === 'Point') {
    return polys.some((rings) => inPolygon(g.coordinates, rings)) ? g : null;
  }
  if (g.type === 'MultiPoint') {
    const kept = g.coordinates.filter((c) => polys.some((rings) => inPolygon(c, rings)));
    return kept.length ? { type: 'MultiPoint', coordinates: kept } : null;
  }
  if (g.type === 'LineString') {
    const parts = clipLine(g.coordinates, polys);
    if (!parts.length) return null;
    return parts.length === 1
      ? { type: 'LineString', coordinates: parts[0] }
      : { type: 'MultiLineString', coordinates: parts };
  }
  if (g.type === 'MultiLineString') {
    const parts = g.coordinates.flatMap((line) => clipLine(line, polys));
    return parts.length ? { type: 'MultiLineString', coordinates: parts } : null;
  }
  // Polygons are left whole. Cutting them needs real polygon booleans, and a
  // half-clipped building or ward reads worse than one that simply overlaps
  // the edge, so membership is decided on a single point instead.
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
    return ring?.some((c) => polys.some((rings) => inPolygon(c, rings))) ? g : null;
  }
  return g;
}

/**
 * Trim a FeatureCollection to a study area's boundary.
 * Returns the input untouched when the area carries no polygon to clip to.
 * @param {object} geojson
 * @param {object} area  a study area's `geojson`
 */
export function clipToArea(geojson, area) {
  const polys = area ? polygonsOf(area) : [];
  if (!polys.length || !geojson?.features) return geojson;

  const features = [];
  for (const f of geojson.features) {
    const geometry = clipGeometry(f.geometry, polys);
    if (geometry) features.push({ ...f, geometry });
  }
  return { ...geojson, features };
}
