/**
 * Overpass API client.
 *
 * Public Overpass instances are a shared community resource and their load
 * varies minute to minute — a mirror that answers in 4 seconds now can take
 * 40 in an hour's time, or reply "the server is probably too busy". Waiting
 * on one and only trying another *after* it fails is the worst of both.
 *
 * So this client races: it asks the first mirror, and if nothing has come
 * back after a short grace period it asks the next one too, keeping whichever
 * answers first and aborting the rest. Responses are cached for the session,
 * obviously oversized requests are refused before they are sent, and every
 * request is cancellable.
 */

import osmtogeojson from 'osmtogeojson';
import { ENDPOINTS } from '../core/constants.js';
import { bboxToOverpass } from '../core/geo.js';
import { through, available } from './cache/index.js';
import { hash } from './cache/key.js';

/**
 * Session memory, in front of the persistent cache.
 *
 * Re-clipping or re-filtering a layer calls straight back in here, and for
 * that an object already in this tab's heap beats even an IndexedDB read.
 * The layers behind it are what survive a reload.
 */
const cache = new Map();

/** How long to wait for one mirror before also trying the next. */
const STAGGER_MS = 3500;
/** Server-side query budget. Short on purpose: a wedged query should fail
 *  fast so the race can be won somewhere else. */
const QUERY_TIMEOUT_S = 25;
/** How many datasets may be in flight at once. */
const MAX_PARALLEL = 3;

/* ------------------------------------------------------------------ */
/* size guard                                                          */
/* ------------------------------------------------------------------ */
function bboxAreaKm2([w, s, e, n]) {
  const midLat = (s + n) / 2;
  return Math.abs(e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180) * Math.abs(n - s) * 110.57;
}

export const AREA_LIMITS = { heavy: 2500, normal: 60000 };

/**
 * Is this dataset safe to fetch for this bbox?
 * @returns {{ ok: boolean, areaKm2: number, limit: number, reason?: string }}
 */
export function checkSize(dataset, bbox) {
  const areaKm2 = bboxAreaKm2(bbox);
  const limit = dataset.heavy ? AREA_LIMITS.heavy : AREA_LIMITS.normal;
  if (areaKm2 > limit) {
    return {
      ok: false, areaKm2, limit,
      reason: `“${dataset.name}” over ${Math.round(areaKm2).toLocaleString()} km² is too much for the free Overpass service. Zoom into a smaller study area (under ${limit.toLocaleString()} km²) and try again.`,
    };
  }
  return { ok: true, areaKm2, limit };
}

/** Build the full Overpass QL document for a catalogue entry. */
export function buildQuery(dataset, bbox, timeout = QUERY_TIMEOUT_S) {
  const bboxStr = bboxToOverpass(bbox);
  const body = dataset.body.replace(/\$bbox/g, bboxStr);
  return `[out:json][timeout:${timeout}];\n(\n${body}\n);\nout geom qt;`;
}

/* ------------------------------------------------------------------ */
/* transport                                                           */
/* ------------------------------------------------------------------ */
const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

/**
 * Overpass expects a client to say who it is, and answers one that does not
 * with 406 or a rate-limit refusal. A browser fills this in itself and
 * forbids overriding it; Node sends nothing at all, so the prefetch script —
 * which runs this same module — has to introduce itself explicitly.
 */
const IDENTITY = typeof window === 'undefined'
  ? { 'User-Agent': 'gis-design-studio/3.0 (+https://github.com/JohnEdet12/gis-design-studio)' }
  : {};

/**
 * How long to wait on one mirror before treating it as dead.
 *
 * Overpass enforces QUERY_TIMEOUT_S on its own side, so a working mirror
 * either answers within that or refuses. Silence well past it means the
 * connection was accepted and abandoned — and without a deadline here that
 * waits forever, because `fetch` has no default timeout. This is the query
 * budget plus headroom for transfer: long enough that a slow-but-alive mirror
 * still wins the race, short enough that a wedged one loses it.
 */
const REQUEST_TIMEOUT_MS = (QUERY_TIMEOUT_S + 15) * 1000;

async function post(url, query, signal) {
  // Whichever comes first: the caller cancelling, or the mirror going quiet.
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...IDENTITY },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch (err) {
    // A deadline miss is this mirror's failure, not the caller's cancellation,
    // and the race has to be able to tell them apart to keep going.
    if (err.name === 'TimeoutError') throw new Error(`${hostOf(url)} went quiet`);
    throw err;
  }

  if (res.status === 429 || res.status === 504) throw new Error(`${hostOf(url)} is busy`);
  if (!res.ok) throw new Error(`${hostOf(url)} responded ${res.status}`);

  // A congested instance answers 200 with an HTML error page rather than
  // JSON, so the content type is the only reliable tell.
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) {
    const why = /too busy/i.test(text) ? 'is too busy' : 'returned an error page';
    throw new Error(`${hostOf(url)} ${why}`);
  }
  return JSON.parse(text);
}

/**
 * Ask every mirror in turn, staggered, and keep the first good answer.
 * @returns {Promise<{raw: object, host: string}>}
 */
function race(query, { signal, onProgress }) {
  const controller = new AbortController();
  const abortAll = () => controller.abort();
  signal?.addEventListener('abort', abortAll, { once: true });

  return new Promise((resolve, reject) => {
    const errors = [];
    let settled = false;
    let launched = 0;
    let done = 0;
    let empty = null;          // a valid but featureless answer, held back
    let timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortAll);
      fn(value);
    };

    /** Nothing left running, so an empty answer is the real answer. */
    const settleIfExhausted = () => {
      if (done < launched || launched < ENDPOINTS.overpass.length) return;
      if (empty) finish(resolve, empty);
      else finish(reject, new Error(`Every Overpass mirror refused: ${errors.join('; ')}`));
    };

    const launch = () => {
      const url = ENDPOINTS.overpass[launched];
      if (url === undefined) return;
      launched += 1;

      if (launched > 1) onProgress?.(`Still waiting — also trying ${hostOf(url)}…`);
      else onProgress?.(`Querying ${hostOf(url)}…`);

      post(url, query, controller.signal)
        .then((raw) => {
          done += 1;
          // An empty result is only trustworthy once nothing else can beat
          // it. A mirror carrying a partial extract answers quickly and
          // legitimately with zero elements outside its own region, and
          // taking that as the winner silently loses everyone else's data.
          if (!(raw.elements ?? []).length) {
            empty = empty ?? { raw, host: hostOf(url) };
            if (launched < ENDPOINTS.overpass.length) launch();
            else settleIfExhausted();
            return;
          }
          controller.abort();               // stand the other mirrors down
          finish(resolve, { raw, host: hostOf(url) });
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          done += 1;
          errors.push(err.message);
          // A failure frees the race up immediately.
          if (launched < ENDPOINTS.overpass.length) launch();
          else settleIfExhausted();
        });

      if (launched < ENDPOINTS.overpass.length) {
        timer = setTimeout(launch, STAGGER_MS);
      }
    };

    if (signal?.aborted) return finish(reject, new DOMException('Aborted', 'AbortError'));
    controller.signal.addEventListener('abort', () => {
      if (signal?.aborted) finish(reject, new DOMException('Aborted', 'AbortError'));
    }, { once: true });

    launch();
  });
}

/* ------------------------------------------------------------------ */
/* queue — bounded, not serial                                         */
/* ------------------------------------------------------------------ */
let active = 0;
const waiting = [];

function withSlot(run) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      run().then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < MAX_PARALLEL) start();
    else waiting.push(start);
  });
}

/* ------------------------------------------------------------------ */
/* fetching                                                            */
/* ------------------------------------------------------------------ */

/**
 * What identifies this dataset to the cache.
 *
 * The variant is a hash of the Overpass query itself, so editing a
 * catalogue entry's `body` retires everything stored under the old
 * definition instead of serving data that no longer matches it.
 */
export const cacheEntryFor = (dataset, bbox) => ({
  provider: 'osm',
  dataset: dataset.slug,
  variant: hash(dataset.body),
  bbox,
});

/** Actually ask Overpass. Called only when no cache layer has the answer. */
function fetchLive(dataset, bbox, opts) {
  const query = buildQuery(dataset, bbox);

  return withSlot(async () => {
    const started = Date.now();
    const tick = setInterval(() => {
      opts.onProgress?.(`Waiting on OpenStreetMap — ${Math.round((Date.now() - started) / 1000)}s`);
    }, 2000);

    try {
      const { raw, host } = await race(query, {
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      clearInterval(tick);

      opts.onProgress?.(`Converting ${(raw.elements ?? []).length.toLocaleString()} features…`);
      const geojson = osmtogeojson(raw, { flatProperties: true });
      // Overpass returns bare nodes for `nwr` matches on ways; drop empties.
      geojson.features = (geojson.features ?? []).filter((f) => f.geometry);
      geojson.meta = { host, seconds: Math.round((Date.now() - started) / 100) / 10 };
      return geojson;
    } finally {
      clearInterval(tick);
    }
  });
}

/**
 * Fetch one catalogue dataset for a bbox and return GeoJSON.
 *
 * Resolved from the fastest source that has it — this tab, this browser's
 * database, the shared database, then Overpass — and stored on the way back
 * so the next request for this area does not reach the network at all.
 *
 * @param {import('./osm-catalog.js').OsmDataset} dataset
 * @param {number[]} bbox  [w, s, e, n]
 * @param {{signal?: AbortSignal, onProgress?: (msg: string) => void}} [opts]
 */
export function fetchDataset(dataset, bbox, opts = {}) {
  const key = `${dataset.slug}|${bbox.map((n) => n.toFixed(4)).join(',')}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  return through(
    cacheEntryFor(dataset, bbox),
    () => fetchLive(dataset, bbox, opts),
    opts,
  ).then((geojson) => {
    cache.set(key, geojson);
    return geojson;
  });
}

/**
 * Is this dataset already stored for this area?
 *
 * `checkSize` refuses areas that would be unfair to ask Overpass for. That
 * reasoning does not apply to a download that has already been made — so the
 * panel asks this before turning a large study area away, and a state-sized
 * buildings layer that the prefetch script assembled loads normally.
 *
 * @returns {Promise<{source:string, bbox:number[]}|null>}
 */
export const isDatasetCached = (dataset, bbox) =>
  available(cacheEntryFor(dataset, bbox)).catch(() => null);

/** Forget this tab's copies. The stored databases are left alone. */
export function clearCache() { cache.clear(); }
export const cacheSize = () => cache.size;
