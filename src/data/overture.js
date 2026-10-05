/**
 * Overture Maps client.
 *
 * Overture publishes its releases as GeoParquet on S3, which a browser cannot
 * query — the documented routes are a Python client and DuckDB. What it *also*
 * publishes is one PMTiles archive per theme, and PMTiles is designed to be
 * read a few kilobytes at a time over HTTP range requests. So this module goes
 * in through the tiles: work out which tiles cover the study area, pull only
 * those, decode the vector tiles, and hand back ordinary GeoJSON that behaves
 * exactly like an Overpass download everywhere else in the app.
 *
 * Two consequences of coming in through tiles, both handled here and both
 * stated plainly to the user in the panel:
 *
 *   1. Geometry is tile-clipped. A road crossing a tile edge arrives as two
 *      pieces. Overture gives every feature a stable id, so `stitch()` puts
 *      the pieces back together as one multi-part feature and the counts
 *      describe real things rather than fragments.
 *
 *   2. Geometry is generalised for the zoom it was cut at. These are the
 *      "x-ray" tiles Overture builds for its own explorer, not a survey
 *      product, so this always fetches the deepest zoom available for a
 *      theme and only backs off when the area is too big to do that.
 */

import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { through, available } from './cache/index.js';
import { hash } from './cache/key.js';

/** Overture's own tile distribution. */
const TILE_HOST = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles';
const STAC_CATALOG = 'https://stac.overturemaps.org/catalog.json';

/**
 * Used when the release catalogue cannot be reached. Overture keeps old
 * releases published, so a stale pin still returns real data — it just will
 * not be the newest month.
 */
const FALLBACK_RELEASE = '2026-07-22.0';

/**
 * How many tiles one dataset may pull. This is the whole download budget:
 * a places tile is ~1.6 MB and a buildings tile ~2.5 MB, so the cap is what
 * stops "add buildings for this state" from quietly fetching a gigabyte.
 */
const DEFAULT_BUDGET = 24;

/* ------------------------------------------------------------------ */
/* release discovery                                                   */
/* ------------------------------------------------------------------ */
let releasePromise = null;

/**
 * The newest published release id, e.g. "2026-07-22.0".
 * Releases are child links on the STAC catalogue; the ids sort chronologically.
 */
export function latestRelease() {
  releasePromise = releasePromise ?? (async () => {
    try {
      // Every Overture fetch waits on this one, and it has a good fallback
      // sitting right there — so an unresponsive catalogue must cost a few
      // seconds and a slightly older release, never the whole run.
      const res = await fetch(STAC_CATALOG, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      const json = await res.json();
      const ids = (json.links ?? [])
        .filter((l) => l.rel === 'child' && typeof l.href === 'string')
        .map((l) => l.href.replace(/^\.\//, '').replace(/\/catalog\.json$/, ''))
        .filter((id) => /^\d{4}-\d{2}-\d{2}\.\d+$/.test(id))
        .sort();
      return ids[ids.length - 1] ?? FALLBACK_RELEASE;
    } catch {
      return FALLBACK_RELEASE;
    }
  })();
  return releasePromise;
}

/* ------------------------------------------------------------------ */
/* tiles                                                               */
/* ------------------------------------------------------------------ */
const archives = new Map();

function archiveFor(theme, release) {
  const key = `${release}/${theme}`;
  if (!archives.has(key)) archives.set(key, new PMTiles(`${TILE_HOST}/${release}/${theme}.pmtiles`));
  return archives.get(key);
}

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const tileCount = (bbox, z) => {
  const [w, s, e, n] = bbox;
  return {
    x0: lonToX(w, z), x1: lonToX(e, z),
    y0: latToY(n, z), y1: latToY(s, z),
    get n() { return (this.x1 - this.x0 + 1) * (this.y1 - this.y0 + 1); },
  };
};

/**
 * The tiles covering `bbox`, at the deepest zoom that stays inside the budget.
 *
 * Backing off a zoom level is *not* free, and how much it costs depends
 * entirely on the theme. Overture's tiles are built for its own explorer, so
 * each one carries the detail that is worth drawing at that zoom and no more:
 *
 *   places          exists at zoom 14 and nowhere else. Zoom 13 is empty.
 *   buildings       10,895 in a zoom-14 tile, 4,363 at 13, 518 at 12.
 *   transportation  present all the way down.
 *   base            tops out at 13 and is complete at every zoom below.
 *
 * So a dataset declares the lowest zoom at which it is still worth having,
 * and an area too big to fetch at that zoom is refused rather than silently
 * answered with a fraction of the data — or, in the case of places, none.
 *
 * @returns {{z:number, tiles:Array<[number,number]>, capped:boolean, over:boolean, needed:number}}
 */
export function tilesFor(bbox, maxZoom, minZoom = 4, budget = DEFAULT_BUDGET) {
  const floor = Math.min(minZoom, maxZoom);
  for (let z = maxZoom; z >= floor; z--) {
    const box = tileCount(bbox, z);
    if (box.n <= budget || z === floor) {
      const over = box.n > budget;
      const tiles = [];
      if (!over) {
        for (let x = box.x0; x <= box.x1; x++) for (let y = box.y0; y <= box.y1; y++) tiles.push([x, y]);
      }
      return { z, tiles, capped: z < maxZoom, over, needed: box.n };
    }
  }
  return { z: maxZoom, tiles: [], capped: false, over: true, needed: tileCount(bbox, floor).n };
}

/* ------------------------------------------------------------------ */
/* properties                                                          */
/* ------------------------------------------------------------------ */

/** Overture packs structured values as JSON strings inside the tile. */
const parseJson = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/**
 * The readable facts hiding inside one Overture feature's tile properties.
 *
 * Raw Overture properties are mostly JSON blobs — `names`, `categories`,
 * `sources`, `connectors` — precise, and completely unusable in a "label
 * features with…" dropdown. This pulls out the handful that matter and the
 * provenance, which is what tells us whether a feature is new information or
 * a copy of something OpenStreetMap already gave us.
 */
export function readOverture(props) {
  const taxonomy = parseJson(props.taxonomy);
  const categories = parseJson(props.categories);
  const address = parseJson(props.addresses)?.[0];

  return {
    name: props['@name'] ?? parseJson(props.names)?.primary ?? '',
    // Which project the geometry actually came from. Overture *contains*
    // OpenStreetMap, so without this every merged layer would show each
    // OSM feature twice.
    source: String(props['@geometry_source'] ?? parseJson(props.sources)?.[0]?.dataset ?? ''),
    category: String(taxonomy?.primary ?? categories?.primary ?? '').replace(/_/g, ' '),
    group: String(taxonomy?.hierarchy?.[0] ?? '').replace(/_/g, ' '),
    confidence: Number.isFinite(props.confidence) ? Math.round(props.confidence * 100) / 100 : undefined,
    address: address?.freeform ?? '',
    class: props.class ?? '',
    subtype: props.subtype ?? '',
    height: props.height,
    raw: props,
  };
}

/** Is this feature just a copy of something OpenStreetMap already has? */
export const isFromOsm = (info) => /^openstreetmap$/i.test(info.source);

/* ------------------------------------------------------------------ */
/* stitching                                                           */
/* ------------------------------------------------------------------ */

/**
 * Put tile-split features back together, and throw away the duplicates.
 *
 * Every Overture feature carries a stable id, so pieces of the same thing
 * found in different tiles are recognisable as one. Two different things can
 * happen to such a feature, and they need opposite treatment:
 *
 *   duplicated  tiles carry a buffer beyond their own edge, so a feature near
 *               a border arrives *complete* in both tiles. Merging those would
 *               invent a two-part building out of one, and would double every
 *               point near a tile seam.
 *   split       a feature genuinely crossing the edge arrives as two different
 *               pieces, which do belong together.
 *
 * Identical geometry means duplicated; different geometry means split. So
 * drop the repeats first, then merge whatever distinct pieces remain.
 */
function stitch(parts) {
  const out = [];
  for (const group of parts.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }

    const seen = new Set();
    const distinct = [];
    for (const f of group) {
      const key = JSON.stringify(f.geometry.coordinates);
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(f);
    }

    if (distinct.length === 1) { out.push(distinct[0]); continue; }

    const first = distinct[0];
    const type = first.geometry.type;
    const multi = type.startsWith('Multi') ? type : `Multi${type}`;
    const coordinates = [];
    for (const f of distinct) {
      if (f.geometry.type === multi) coordinates.push(...f.geometry.coordinates);
      else coordinates.push(f.geometry.coordinates);
    }
    out.push({ ...first, geometry: { type: multi, coordinates } });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* fetch                                                               */
/* ------------------------------------------------------------------ */
const cache = new Map();

/**
 * What identifies a supplement to the cache.
 *
 * The release id leads, because a stored download can only ever be from the
 * release that was current when it was made — when Overture publishes a new
 * one, old rows stop matching rather than needing to be expired. The hash
 * covers the parts of the supplement definition that change what comes back,
 * so retuning a zoom or a tile budget also retires the old downloads.
 */
export const cacheEntryFor = (sup, bbox, release) => ({
  provider: 'overture',
  dataset: sup.id,
  variant: `${release}|${hash(`${sup.theme}/${sup.layer}/${sup.maxZoom ?? 14}/${sup.minZoom ?? ''}/${sup.tileBudget ?? ''}`)}`,
  bbox,
});

/** Pull and decode the tiles. Called only when no cache layer has the answer. */
async function fetchLive(sup, bbox, release, opts) {
  const archive = archiveFor(sup.theme, release);
  const header = await archive.getHeader();
  const maxZoom = Math.min(sup.maxZoom ?? 14, header.maxZoom);
  const { z, tiles, capped, over } = tilesFor(bbox, maxZoom, sup.minZoom ?? maxZoom, sup.tileBudget);
  if (over) throw Object.assign(new Error('Area too large for Overture at full detail.'), { name: 'OvertureTooBig' });

  const started = Date.now();
  const parts = new Map();
  let anonymous = 0;
  let done = 0;

  for (const [x, y] of tiles) {
    if (opts.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    opts.onProgress?.(`Reading Overture tile ${++done} of ${tiles.length}…`);

    const tile = await archive.getZxy(z, x, y);
    if (!tile) continue;

    const layer = new VectorTile(new PbfReader(tile.data)).layers[sup.layer];
    if (!layer) continue;

    for (let i = 0; i < layer.length; i++) {
      const raw = layer.feature(i);
      const props = raw.properties;
      const info = readOverture(props);

      // A supplement that cannot express this feature as OSM tags does not
      // want it — that is how each one narrows a whole theme down to its
      // own subject.
      const tags = sup.tags(info);
      if (!tags) continue;

      const geojson = raw.toGeoJSON(x, y, z);
      // An id-less feature cannot be stitched, so it gets a key of its own
      // rather than being merged with every other id-less feature.
      const id = props.id ?? `anon-${anonymous++}`;

      const feature = {
        type: 'Feature',
        properties: {
          ...tags,
          ...(info.name ? { name: info.name } : {}),
          gds_provider: 'Overture',
          gds_source: info.source,
        },
        geometry: geojson.geometry,
      };
      if (!parts.has(id)) parts.set(id, [feature]);
      else parts.get(id).push(feature);
    }
  }

  const features = stitch(parts);
  return {
    type: 'FeatureCollection',
    features,
    meta: {
      release,
      zoom: z,
      tiles: tiles.length,
      capped,
      seconds: ((Date.now() - started) / 1000).toFixed(1),
      host: 'overturemaps.org',
    },
  };
}

/**
 * Fetch an Overture supplement, already speaking OpenStreetMap's vocabulary.
 *
 * The whole point of a supplement is that the rest of the app should not be
 * able to tell where a feature came from. Each one carries a `tags()` that
 * turns Overture's fields into the OSM tags the catalogue already segments
 * on — an Overture road with `class: "motorway"` comes out as
 * `highway: "motorway"`, so the same rule that colours OSM motorways colours
 * this one, and the legend has no idea two providers were involved.
 *
 * Every feature also keeps `gds_provider` and `gds_source`, which is what the
 * caller uses to drop the copies of things OpenStreetMap already supplied.
 *
 * The cache is consulted before the tile budget is, deliberately: an area
 * that is too large to pull as tiles *now* is not too large to serve if the
 * prefetch script already assembled it, so the size refusal belongs on the
 * live path and nowhere else.
 *
 * @param {object} sup    a supplement from overture-merge.js
 * @param {number[]} bbox [w, s, e, n]
 * @param {{signal?:AbortSignal, onProgress?:(msg:string)=>void}} [opts]
 * @returns {Promise<object>} GeoJSON FeatureCollection, with `meta`
 */
export async function fetchOvertureSupplement(sup, bbox, opts = {}) {
  const release = await latestRelease();
  const key = `${release}|${sup.id}|${bbox.map((n) => n.toFixed(4)).join(',')}`;
  if (cache.has(key)) return cache.get(key);

  const result = await through(
    cacheEntryFor(sup, bbox, release),
    () => fetchLive(sup, bbox, release, opts),
    opts,
  );

  cache.set(key, result);
  return result;
}

/**
 * Is this supplement already stored for this area?
 *
 * The counterpart to `checkSupplement`: that one answers "can we afford to
 * pull this many tiles", which stops mattering once the tiles have been
 * pulled and the result stored.
 *
 * @returns {Promise<{source:string, bbox:number[]}|null>}
 */
export async function isSupplementCached(sup, bbox) {
  try {
    const release = await latestRelease();
    return await available(cacheEntryFor(sup, bbox, release));
  } catch {
    return null;
  }
}

/**
 * Is this area a sensible size to pull as tiles?
 *
 * The limit is the tile budget, not a server's patience — Overture has no
 * shared query service to overload, so the only cost is the user's bandwidth.
 * @returns {{ok:boolean, tiles:number, zoom:number, capped:boolean, reason?:string}}
 */
/**
 * Can this supplement be fetched for this area?
 *
 * A supplement is an extra, never a requirement, so this never blocks a
 * dataset — the caller uses it to decide whether to *skip* Overture and
 * return OpenStreetMap alone, and to say so.
 * @returns {{ok:boolean, tiles:number, zoom:number, capped:boolean, needed:number}}
 */
export function checkSupplement(sup, bbox) {
  const maxZoom = sup.maxZoom ?? 14;
  const { z, tiles, capped, over, needed } = tilesFor(bbox, maxZoom, sup.minZoom ?? maxZoom, sup.tileBudget);
  return { ok: !over, tiles: tiles.length, zoom: z, capped, needed };
}
