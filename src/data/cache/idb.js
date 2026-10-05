/**
 * L1 cache — IndexedDB, in the user's own browser.
 *
 * This is the layer that makes a *reload* free. It holds whole GeoJSON
 * downloads as structured-clone objects, which is both smaller and far faster
 * to read back than JSON text, and it survives refreshes, restarts and going
 * offline entirely.
 *
 * Everything here is written to fail quietly. A cache is an optimisation, and
 * a browser can refuse it for reasons that have nothing to do with this app —
 * private windows, disabled storage, a full disk, a blocked upgrade because
 * the studio is open in another tab. Every function below therefore resolves
 * to "no" rather than rejecting, and the caller falls through to the next
 * layer without ever showing the user an error about a cache.
 *
 * The module is also a no-op under Node, so the same data modules can be
 * imported by the prefetch script without pretending a browser is present.
 */

import { entryKey, familyKey, contains, bboxArea, normBbox } from './key.js';

const DB_NAME = 'gds-geodata';
const DB_VERSION = 1;
const STORE = 'entries';

/** Roughly how much GeoJSON we are willing to keep per browser. */
export const BUDGET_BYTES = 400 * 1024 * 1024;

const supported = typeof indexedDB !== 'undefined';

let dbPromise = null;

function open() {
  if (!supported) return Promise.resolve(null);
  dbPromise = dbPromise ?? new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return;
      const store = db.createObjectStore(STORE, { keyPath: 'key' });
      // Containment candidates are found family-first, so this index is what
      // keeps the scan proportional to one dataset rather than the whole cache.
      store.createIndex('family', 'family', { unique: false });
      store.createIndex('lastHit', 'lastHit', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Another tab holds an old version open; give up rather than hang.
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const tx = async (mode, run) => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    let out = null;
    let t;
    try { t = db.transaction(STORE, mode); } catch { return resolve(null); }
    t.oncomplete = () => resolve(out);
    t.onerror = () => resolve(null);
    t.onabort = () => resolve(null);
    try { run(t.objectStore(STORE), (value) => { out = value; }); } catch { resolve(null); }
  });
};

const request = (req, done) => {
  req.onsuccess = () => done(req.result);
};

/* ------------------------------------------------------------------ */
/* read                                                                */
/* ------------------------------------------------------------------ */

/**
 * The best stored answer for this request, or null.
 *
 * Tries the exact key first — that is the common case and it is a single
 * primary-key lookup. Only when that misses does it look for a larger
 * download that already covers this bbox, preferring the smallest such
 * envelope so the least amount of surplus has to be filtered off.
 *
 * @returns {Promise<{geojson:object, meta:object, bbox:number[], createdAt:number, exact:boolean}|null>}
 */
export async function get(entry) {
  const key = entryKey(entry);
  const bbox = normBbox(entry.bbox);

  const exact = await tx('readonly', (store, done) => {
    request(store.get(key), (row) => done(row ?? null));
  });
  if (exact) return { ...exact, exact: true };

  const family = familyKey(entry);
  return tx('readonly', (store, done) => {
    let best = null;
    const cursorReq = store.index('family').openCursor(IDBKeyRange.only(family));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        done(best ? { ...best, exact: false } : null);
        return;
      }
      const row = cursor.value;
      if (contains(row.bbox, bbox) && (!best || bboxArea(row.bbox) < bboxArea(best.bbox))) best = row;
      cursor.continue();
    };
  });
}

/** Record that an entry was used, for LRU eviction. Best-effort, never awaited. */
export function touch(entry) {
  const key = entryKey(entry);
  tx('readwrite', (store) => {
    const req = store.get(key);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      row.hits = (row.hits ?? 0) + 1;
      row.lastHit = Date.now();
      store.put(row);
    };
  });
}

/* ------------------------------------------------------------------ */
/* write                                                               */
/* ------------------------------------------------------------------ */
export async function put(entry, geojson, { meta = {}, bytes = 0 } = {}) {
  const now = Date.now();
  const row = {
    key: entryKey(entry),
    family: familyKey(entry),
    provider: entry.provider,
    dataset: entry.dataset,
    variant: entry.variant ?? '',
    bbox: normBbox(entry.bbox),
    geojson,
    meta,
    features: geojson.features?.length ?? 0,
    bytes: bytes || (geojson.features?.length ?? 0) * 250,
    createdAt: now,
    lastHit: now,
    hits: 0,
  };

  const ok = await tx('readwrite', (store, done) => {
    request(store.put(row), () => done(true));
  });
  if (ok) void prune();
  return Boolean(ok);
}

/* ------------------------------------------------------------------ */
/* housekeeping                                                        */
/* ------------------------------------------------------------------ */

/** Count and total size of everything stored. */
export async function stats() {
  const rows = await tx('readonly', (store, done) => {
    request(store.getAll(), (all) => done(all ?? []));
  });
  const list = rows ?? [];
  return {
    supported,
    entries: list.length,
    bytes: list.reduce((sum, r) => sum + (r.bytes ?? 0), 0),
    features: list.reduce((sum, r) => sum + (r.features ?? 0), 0),
    oldest: list.reduce((min, r) => Math.min(min, r.createdAt ?? Infinity), Infinity),
  };
}

/**
 * Drop least-recently-used entries until the store is back inside budget.
 *
 * Eviction is by last use rather than age on purpose: the state boundary
 * someone opens every morning should outlive the one-off download of a
 * district they looked at once, however recently.
 */
export async function prune(budget = BUDGET_BYTES) {
  const rows = await tx('readonly', (store, done) => {
    request(store.getAll(), (all) => done(all ?? []));
  });
  if (!rows) return 0;

  let total = rows.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  if (total <= budget) return 0;

  const victims = rows.sort((a, b) => (a.lastHit ?? 0) - (b.lastHit ?? 0));
  const doomed = [];
  for (const row of victims) {
    if (total <= budget) break;
    doomed.push(row.key);
    total -= row.bytes ?? 0;
  }

  await tx('readwrite', (store) => { for (const key of doomed) store.delete(key); });
  return doomed.length;
}

export async function clear() {
  await tx('readwrite', (store) => store.clear());
}

export const isSupported = () => supported;
