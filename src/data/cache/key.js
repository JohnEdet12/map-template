/**
 * Cache identity and geometry helpers, shared by every layer of the cache.
 *
 * The whole cache turns on one question: *is a download I already have good
 * enough to answer this request?* Two things decide it.
 *
 *   identity   provider + dataset + variant. `variant` is what makes a stored
 *              answer stale when the *question* changes rather than when the
 *              world does — a rewritten Overpass query or a new Overture
 *              release produces a different variant, so old rows are simply
 *              never consulted again instead of quietly returning data that
 *              no longer matches the catalogue.
 *
 *   extent     a stored download answers any request whose bbox it fully
 *              contains. Panning a little, or loading a district inside a
 *              state that was already fetched, therefore costs nothing. The
 *              extra features outside the caller's bbox are filtered out on
 *              the way back so a cache hit is indistinguishable from a live
 *              fetch.
 *
 * Bump CACHE_VERSION to invalidate every stored entry everywhere at once.
 */

export const CACHE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* identity                                                            */
/* ------------------------------------------------------------------ */

/** djb2, base36. Short, stable across browser and Node, not a security hash. */
export function hash(text) {
  let h = 5381;
  const str = String(text);
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Coordinates are stored to ~1 m so floating-point noise cannot fork a key. */
export const round = (n) => Math.round(n * 1e5) / 1e5;
export const normBbox = (bbox) => bbox.map(round);
export const bboxKey = (bbox) => normBbox(bbox).join(',');

/**
 * The primary key for one stored download.
 * @param {{provider:string, dataset:string, variant?:string, bbox:number[]}} entry
 */
export const entryKey = ({ provider, dataset, variant = '', bbox }) =>
  `${CACHE_VERSION}|${provider}|${dataset}|${variant}|${bboxKey(bbox)}`;

/** The key without the bbox — everything sharing one is a containment candidate. */
export const familyKey = ({ provider, dataset, variant = '' }) =>
  `${CACHE_VERSION}|${provider}|${dataset}|${variant}`;

/* ------------------------------------------------------------------ */
/* extents                                                             */
/* ------------------------------------------------------------------ */
export const bboxArea = ([w, s, e, n]) => Math.abs(e - w) * Math.abs(n - s);

/** Does `outer` cover every part of `inner`? */
export const contains = (outer, inner) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

export const intersects = (a, b) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** The bbox of one GeoJSON geometry, any type, without pulling in turf. */
export function geometryBbox(geometry) {
  if (!geometry) return null;
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;

  const visit = (coords) => {
    // A position is [lng, lat, …]; anything else is a nested list.
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      return;
    }
    for (const part of coords) visit(part);
  };

  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries ?? []) {
      const b = geometryBbox(g);
      if (!b) continue;
      w = Math.min(w, b[0]); s = Math.min(s, b[1]);
      e = Math.max(e, b[2]); n = Math.max(n, b[3]);
    }
  } else if (geometry.coordinates) {
    visit(geometry.coordinates);
  }

  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/**
 * Narrow a stored download to the extent that was actually asked for.
 *
 * Overpass returns everything *touching* the query rectangle, not everything
 * inside it, so this matches that behaviour: a feature is kept when its own
 * bounding box meets the requested one. Nothing is cut geometrically — a road
 * leaving the area arrives whole, exactly as a live fetch would deliver it.
 */
export function narrowToBbox(geojson, bbox) {
  const features = (geojson.features ?? []).filter((f) => {
    const b = geometryBbox(f.geometry);
    return b ? intersects(b, bbox) : false;
  });
  return { ...geojson, features };
}
