/**
 * The layered geodata cache.
 *
 * Every open-data download in the studio goes through `through()`, which asks
 * three sources in order of how long each takes to answer:
 *
 *   L1  IndexedDB, in this browser          — milliseconds
 *   L2  the shared cache database, over HTTP — tens of milliseconds
 *   L3  Overpass or Overture themselves      — seconds to a minute
 *
 * A hit at either cached layer is filled forward, so data that came from the
 * shared database once is local from then on, and data fetched live lands in
 * both. From the caller's side nothing changes: the same GeoJSON comes back,
 * carrying the same `meta`, with `meta.cache` added to say where it came from.
 *
 * ## On staleness
 *
 * OpenStreetMap changes daily, and a cache that could serve a year-old road
 * network without saying so would be worse than no cache. But making people
 * wait for a fresh download just because the stored one is a month old throws
 * away the entire point. So an expired entry is *served immediately and
 * refreshed in the background*: this session shows data that is at most one
 * refresh-interval old, and the next one shows today's. Overture needs none
 * of this — its release id is part of the cache identity, so a new release
 * simply never matches the old rows.
 */

import * as idb from './idb.js';
import * as remote from './remote.js';
import { narrowToBbox, entryKey } from './key.js';

export { CACHE_VERSION } from './key.js';

const DAY = 86_400_000;

/** How old a stored download may be before it is refreshed behind the user. */
export const MAX_AGE = {
  // OpenStreetMap is edited continuously; a month is the point at which a
  // busy area has visibly moved on.
  osm: 30 * DAY,
  // Overture is versioned, and the release id is already in the cache key —
  // a stored entry can only ever be from the release that was current when
  // it was fetched, so age adds nothing. This is a floor on churn, not freshness.
  overture: 365 * DAY,
};

let config = { l1: true, l2: true, revalidate: true };

/** Turn layers off — used by the prefetch script, which writes the DB directly. */
export function configure(patch) { config = { ...config, ...patch }; }
export const settings = () => ({ ...config });

/* ------------------------------------------------------------------ */

const revalidating = new Set();

/** Refresh an expired entry behind the user's back. Failure is ignored. */
function revalidate(entry, load) {
  const key = entryKey(entry);
  if (!config.revalidate || revalidating.has(key)) return;
  revalidating.add(key);

  Promise.resolve()
    .then(() => load())
    .then((fresh) => fresh && write(entry, fresh))
    .catch(() => {})
    .finally(() => revalidating.delete(key));
}

async function write(entry, geojson) {
  // Serialised once, and only for the size figure and the upload body —
  // IndexedDB stores the object itself, which is cheaper to read back.
  let json = '';
  try { json = JSON.stringify(geojson); } catch { /* circular meta, unlikely */ }

  const meta = geojson.meta ?? {};
  if (config.l1) await idb.put(entry, geojson, { meta, bytes: json.length });
  if (config.l2) void remote.store(entry, geojson, meta);
}

/** Tag a cached result so the panel can say where it came from. */
function label(hit, source, entry) {
  const geojson = hit.exact ? hit.geojson : narrowToBbox(hit.geojson, entry.bbox);
  const ageDays = hit.createdAt ? Math.floor((Date.now() - hit.createdAt) / DAY) : null;
  return {
    ...geojson,
    meta: {
      ...(hit.meta ?? {}),
      ...(geojson.meta ?? {}),
      cache: {
        source,                 // 'browser' | 'database'
        exact: Boolean(hit.exact),
        ageDays,
        storedAt: hit.createdAt ?? null,
      },
      seconds: 0,
    },
  };
}

/* ------------------------------------------------------------------ */

/**
 * Serve a download from the fastest layer that has it, fetching live if none do.
 *
 * @param {{provider:'osm'|'overture', dataset:string, variant?:string, bbox:number[]}} entry
 * @param {() => Promise<object>} load  the live fetch, called only on a full miss
 * @param {{onProgress?:(msg:string)=>void, signal?:AbortSignal}} [opts]
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function through(entry, load, opts = {}) {
  const maxAge = MAX_AGE[entry.provider] ?? MAX_AGE.osm;
  const fresh = (hit) => !hit.createdAt || Date.now() - hit.createdAt < maxAge;

  let stale = null;

  if (config.l1) {
    const hit = await idb.get(entry);
    if (hit) {
      if (fresh(hit)) {
        idb.touch(entry);
        opts.onProgress?.('Loaded from this browser’s cache');
        return label(hit, 'browser', entry);
      }
      stale = { hit, source: 'browser' };
    }
  }

  if (config.l2) {
    const hit = await remote.lookup(entry, { maxAgeMs: maxAge });
    if (hit) {
      opts.onProgress?.('Loaded from the shared database');
      const result = label(hit, 'database', entry);
      // Fill L1 with what the database gave us, so the next reload skips
      // even that round trip. Stored against this request's own key.
      if (config.l1) void idb.put({ ...entry, bbox: hit.bbox ?? entry.bbox }, hit.geojson, { meta: hit.meta });
      return result;
    }
  }

  // Expired, but present. Show it now, replace it quietly.
  if (stale) {
    revalidate(entry, load);
    opts.onProgress?.('Loaded from cache — refreshing in the background');
    return label(stale.hit, stale.source, entry);
  }

  const result = await load();
  // An aborted fetch resolves to nothing useful; do not poison the cache.
  if (result && !opts.signal?.aborted) await write(entry, result);
  return result;
}

/**
 * Is this download already stored, anywhere?
 *
 * Exists for one purpose: the size limits that stop the studio asking
 * Overpass for a whole state are limits on *querying a shared public
 * service*, not on how much data a map may carry. Once a download is in a
 * cache there is no query to protect, so the caller checks here before
 * refusing an area for being too large.
 *
 * @returns {Promise<{source:'browser'|'database', bbox:number[], features?:number}|null>}
 */
export async function available(entry) {
  const maxAge = MAX_AGE[entry.provider] ?? MAX_AGE.osm;

  if (config.l1) {
    const hit = await idb.get(entry);
    // Expired is still *available* — `through()` will serve it and refresh
    // behind the user, which is far better than refusing the area outright.
    if (hit) return { source: 'browser', bbox: hit.bbox, features: hit.features };
  }
  if (config.l2) {
    const hit = await remote.probe(entry, { maxAgeMs: maxAge });
    if (hit) return { source: 'database', bbox: hit.bbox, features: hit.features };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* introspection, for a storage panel or the console                   */
/* ------------------------------------------------------------------ */

/** What both cache layers currently hold. `database` is null when unreachable. */
export async function stats() {
  const [browser, database] = await Promise.all([idb.stats(), remote.stats()]);
  return { browser, database, endpoint: remote.endpoint() };
}

/** Empty this browser's cache. The shared database is left alone. */
export const clearLocal = () => idb.clear();
