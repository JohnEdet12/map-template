/**
 * The shared geodata database.
 *
 * One SQLite file holding every OpenStreetMap and Overture download the studio
 * has ever made, so that the second person to ask for an area — on any machine,
 * in any browser — gets it from here instead of from a public API.
 *
 * Two decisions are worth stating, because everything else follows from them.
 *
 * **Downloads are stored whole, gzipped, exactly as they will be served.** The
 * database is a cache of answers, not a feature store. It is not trying to be
 * PostGIS: nothing here queries inside a geometry, so paying to shred a
 * FeatureCollection into rows and reassemble it on every read would buy
 * nothing. The blob goes out over HTTP still compressed, so a read costs one
 * index lookup and no parsing at all.
 *
 * **A stored download answers any request it fully contains.** This is what
 * makes the cache hit far more often than exact-match keying would allow: an
 * LGA inside a state that was already fetched is already in the database, and
 * so is the same area after the user pans a little. `bbox_area` exists so the
 * *smallest* covering download wins, which keeps the surplus the client has to
 * filter off as small as possible.
 *
 * Uses node:sqlite, so there is no native module to build and no dependency to
 * install — it ships with Node 22+.
 */

import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PATH = process.env.CACHE_DB ?? resolve(HERE, 'data', 'geodata.db');

/** Total size the cache may reach before least-used entries are dropped. */
export const DEFAULT_BUDGET_BYTES = Number(process.env.CACHE_BUDGET ?? 8 * 1024 ** 3);

/**
 * Slop allowed when testing whether a stored extent covers a requested one.
 *
 * Clients normalise every bbox to five decimal places before asking, and that
 * rounding can push a requested edge up to 5e-6° *outside* the grid that was
 * actually fetched — enough to fail an exact comparison over a sliver about
 * half a metre wide. This is one full quantum of that normalisation, so it
 * absorbs the rounding and nothing larger. At this latitude it is ~1.1 m,
 * which is well inside the positional accuracy of the underlying data.
 */
const EPS = 1e-5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  key         TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  dataset     TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT '',
  w           REAL NOT NULL,
  s           REAL NOT NULL,
  e           REAL NOT NULL,
  n           REAL NOT NULL,
  bbox_area   REAL NOT NULL,
  features    INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,
  raw_bytes   INTEGER NOT NULL DEFAULT 0,
  body        BLOB NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  last_hit    INTEGER NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0
);

-- The containment scan runs family-first, so the leading columns must be the
-- identity and the extent columns must follow them.
CREATE INDEX IF NOT EXISTS idx_entries_family
  ON entries (provider, dataset, variant, w, s, e, n);
CREATE INDEX IF NOT EXISTS idx_entries_lru ON entries (last_hit);
`;

/* ------------------------------------------------------------------ */

export function openDb(path = DEFAULT_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // WAL lets the prefetch script keep writing while the server serves reads.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

/* ------------------------------------------------------------------ */
/* read                                                                */
/* ------------------------------------------------------------------ */

const SELECT_EXACT = `SELECT * FROM entries WHERE key = ?`;

/**
 * Smallest stored download whose extent covers the requested one.
 * `bbox_area ASC` is the whole point — see the note at the top of this file.
 */
const SELECT_COVERING = `
  SELECT * FROM entries
   WHERE provider = ? AND dataset = ? AND variant = ?
     AND w <= ? AND s <= ? AND e >= ? AND n >= ?
     AND created_at >= ?
   ORDER BY bbox_area ASC
   LIMIT 1`;

/**
 * Find a stored download that answers this request.
 *
 * @param {object} db
 * @param {{key?:string, provider:string, dataset:string, variant?:string,
 *          bbox:number[], maxAge?:number}} q
 * @returns {{body:Buffer, meta:object, bbox:number[], createdAt:number,
 *            features:number, exact:boolean}|null}  `body` is gzipped GeoJSON
 */
export function lookup(db, q) {
  const floor = q.maxAge ? Date.now() - q.maxAge : 0;
  const [w, s, e, n] = q.bbox;

  let row = q.key ? db.prepare(SELECT_EXACT).get(q.key) : null;
  let exact = Boolean(row);
  // An exact key match that has expired is no better than none — fall through
  // to the containment search, which may turn up a fresher, larger download.
  if (row && row.created_at < floor) { row = null; exact = false; }

  if (!row) {
    row = db.prepare(SELECT_COVERING).get(
      q.provider, q.dataset, q.variant ?? '', w + EPS, s + EPS, e - EPS, n - EPS, floor);
  }
  if (!row) return null;

  db.prepare('UPDATE entries SET hits = hits + 1, last_hit = ? WHERE key = ?')
    .run(Date.now(), row.key);

  return {
    body: Buffer.from(row.body),
    meta: safeParse(row.meta),
    bbox: [row.w, row.s, row.e, row.n],
    createdAt: row.created_at,
    features: row.features,
    exact,
  };
}

const safeParse = (text) => { try { return JSON.parse(text); } catch { return {}; } };

/**
 * Is a download stored that answers this request, without reading it?
 *
 * The caller is deciding whether an area is too large to fetch, not fetching
 * it, so this touches metadata only — no blob is read and the hit counter is
 * left alone, because nobody has actually used anything yet.
 */
export function has(db, q) {
  const floor = q.maxAge ? Date.now() - q.maxAge : 0;
  const [w, s, e, n] = q.bbox;
  const row = db.prepare(`
    SELECT key, w, s, e, n, features, bytes, created_at FROM entries
     WHERE provider = ? AND dataset = ? AND variant = ?
       AND w <= ? AND s <= ? AND e >= ? AND n >= ?
       AND created_at >= ?
     ORDER BY bbox_area ASC
     LIMIT 1`).get(q.provider, q.dataset, q.variant ?? '', w + EPS, s + EPS, e - EPS, n - EPS, floor);

  if (row) {
    return { bbox: [row.w, row.s, row.e, row.n], features: row.features, bytes: row.bytes, createdAt: row.created_at };
  }

  // No single download covers it, but a set of prefetched cells may. This is
  // what lets the studio accept a state-sized area that was cached as a grid.
  const set = coveringSet(db, q);
  if (!set) return null;
  return {
    bbox: q.bbox,
    features: set.reduce((sum, r) => sum + r.features, 0),
    bytes: set.reduce((sum, r) => sum + r.bytes, 0),
    createdAt: Math.min(...set.map((r) => r.created_at)),
    cells: set.length,
  };
}

/* ------------------------------------------------------------------ */
/* assembling an answer out of several cells                           */
/* ------------------------------------------------------------------ */

/**
 * Do these rectangles, together, cover the whole target rectangle?
 *
 * Prefetching a large state stores it as a grid of cells, because Overpass
 * will not answer a query that big in one piece. That leaves a request for
 * the *whole* state matching no single stored download — which is the exact
 * moment the studio says "too much for the free Overpass service" about data
 * it already has.
 *
 * The test is a sweep: cut the target along every stored edge that falls
 * inside it, and check each resulting sub-rectangle has some cell over its
 * centre. If every piece is covered, the union covers the target. Cells may
 * overlap, arrive in any order, and come from different runs.
 */
function coversTarget(rects, [tw, ts, te, tn]) {
  const xs = new Set([tw, te]);
  const ys = new Set([ts, tn]);
  for (const [w, s, e, n] of rects) {
    if (w > tw && w < te) xs.add(w);
    if (e > tw && e < te) xs.add(e);
    if (s > ts && s < tn) ys.add(s);
    if (n > ts && n < tn) ys.add(n);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);

  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const cy = (Y[j] + Y[j + 1]) / 2;
      if (!rects.some(([w, s, e, n]) =>
        w <= cx + EPS && e >= cx - EPS && s <= cy + EPS && n >= cy - EPS)) return false;
    }
  }
  return true;
}

const SELECT_INTERSECTING = `
  SELECT key, w, s, e, n, features, bytes, raw_bytes, created_at FROM entries
   WHERE provider = ? AND dataset = ? AND variant = ?
     AND w <= ? AND e >= ? AND s <= ? AND n >= ?
     AND created_at >= ?`;

/** Every stored cell that overlaps this request, newest-first within a family. */
function intersecting(db, q) {
  const floor = q.maxAge ? Date.now() - q.maxAge : 0;
  const [w, s, e, n] = q.bbox;
  return db.prepare(SELECT_INTERSECTING)
    .all(q.provider, q.dataset, q.variant ?? '', e, w, n, s, floor);
}

/**
 * The set of cells that together answer this request, or null.
 * Metadata only — nothing is decompressed to find out.
 */
export function coveringSet(db, q) {
  const rows = intersecting(db, q);
  if (rows.length < 2) return null;
  const rects = rows.map((r) => [r.w, r.s, r.e, r.n]);
  if (!coversTarget(rects, q.bbox)) return null;
  return rows;
}

/**
 * What one feature is, for the purpose of not storing it twice.
 *
 * Overpass returns a way's full geometry whenever it touches the query box,
 * so a road crossing a cell edge arrives *complete* in both cells — these are
 * duplicates to drop, not halves to join. OpenStreetMap features carry a
 * stable id and that settles it. Overture features have had theirs consumed
 * by tile-stitching upstream, so they fall back to a geometry signature:
 * type, size and endpoints, which two genuinely different features do not
 * share and one feature repeated always does.
 */
function featureKey(f) {
  if (f.id != null) return `id:${f.id}`;
  const at = f.properties?.['@id'];
  if (at != null) return `id:${at}`;

  const g = f.geometry;
  if (!g?.coordinates) return `n:${Math.random()}`;
  const flat = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') { flat.push(c); return; }
    for (const p of c) walk(p);
  };
  walk(g.coordinates);
  const first = flat[0] ?? [];
  const last = flat[flat.length - 1] ?? [];
  return `g:${g.type}:${flat.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`;
}

/** Ceiling on how much uncompressed GeoJSON one assembly may hold. */
export const MAX_ASSEMBLY_BYTES = Number(process.env.CACHE_MAX_ASSEMBLY ?? 512 * 1024 ** 2);

/**
 * Merge a covering set of cells into a single FeatureCollection.
 *
 * @returns {{geojson:object, cells:number, dropped:number, createdAt:number}|null}
 */
export function assemble(db, q) {
  const rows = coveringSet(db, q);
  if (!rows) return null;

  const raw = rows.reduce((sum, r) => sum + r.raw_bytes, 0);
  if (raw > MAX_ASSEMBLY_BYTES) return null;

  const read = db.prepare('SELECT body, meta FROM entries WHERE key = ?');
  const seen = new Set();
  const features = [];
  let dropped = 0;
  let meta = {};

  for (const row of rows) {
    const stored = read.get(row.key);
    if (!stored) continue;
    const part = JSON.parse(gunzipSync(Buffer.from(stored.body)).toString('utf8'));
    // The first cell's provenance stands in for the whole — they came from
    // the same run against the same provider.
    if (!meta.host) meta = { ...safeParse(stored.meta) };
    for (const f of part.features ?? []) {
      const key = featureKey(f);
      if (seen.has(key)) { dropped += 1; continue; }
      seen.add(key);
      features.push(f);
    }
  }

  return {
    geojson: { type: 'FeatureCollection', features },
    meta: { ...meta, assembledFrom: rows.length, duplicatesDropped: dropped },
    cells: rows.length,
    dropped,
    createdAt: Math.min(...rows.map((r) => r.created_at)),
  };
}

/* ------------------------------------------------------------------ */
/* write                                                               */
/* ------------------------------------------------------------------ */

const UPSERT = `
  INSERT INTO entries
    (key, provider, dataset, variant, w, s, e, n, bbox_area,
     features, bytes, raw_bytes, body, meta, created_at, last_hit, hits)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
  ON CONFLICT(key) DO UPDATE SET
    body = excluded.body, meta = excluded.meta, features = excluded.features,
    bytes = excluded.bytes, raw_bytes = excluded.raw_bytes,
    created_at = excluded.created_at, last_hit = excluded.last_hit`;

/**
 * Store one download. `geojson` may be an object or a JSON string; either way
 * what lands in the row is gzip, because that is what will be served.
 * @returns {{bytes:number, rawBytes:number, features:number}}
 */
export function put(db, entry, geojson) {
  const json = typeof geojson === 'string' ? geojson : JSON.stringify(geojson);
  const body = gzipSync(json, { level: 6 });
  const features = typeof geojson === 'string'
    ? (safeParse(json).features?.length ?? 0)
    : (geojson.features?.length ?? 0);

  const [w, s, e, n] = entry.bbox;
  const now = Date.now();

  db.prepare(UPSERT).run(
    entry.key, entry.provider, entry.dataset, entry.variant ?? '',
    w, s, e, n, Math.abs(e - w) * Math.abs(n - s),
    features, body.length, json.length,
    body, JSON.stringify(entry.meta ?? {}), now, now,
  );

  return { bytes: body.length, rawBytes: json.length, features };
}

/** Read one entry back as an object — used by tooling, not by the hot path. */
export const decode = (body) => JSON.parse(gunzipSync(body).toString('utf8'));
export const encode = (json) => gzipSync(json, { level: 6 });
export { gunzipSync };

/* ------------------------------------------------------------------ */
/* housekeeping                                                        */
/* ------------------------------------------------------------------ */

export function stats(db) {
  const totals = db.prepare(`
    SELECT COUNT(*) AS entries, COALESCE(SUM(bytes),0) AS bytes,
           COALESCE(SUM(raw_bytes),0) AS rawBytes,
           COALESCE(SUM(features),0) AS features,
           COALESCE(SUM(hits),0) AS hits,
           MIN(created_at) AS oldest, MAX(created_at) AS newest
      FROM entries`).get();

  const byProvider = db.prepare(`
    SELECT provider, COUNT(*) AS entries, COALESCE(SUM(bytes),0) AS bytes
      FROM entries GROUP BY provider ORDER BY bytes DESC`).all();

  const top = db.prepare(`
    SELECT dataset, provider, COUNT(*) AS areas, SUM(hits) AS hits, SUM(features) AS features
      FROM entries GROUP BY dataset, provider ORDER BY hits DESC LIMIT 12`).all();

  return { ...totals, byProvider, top };
}

/** Drop least-recently-used rows until the file is back inside budget. */
export function prune(db, budget = DEFAULT_BUDGET_BYTES) {
  const { bytes } = db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM entries').get();
  if (bytes <= budget) return 0;

  const rows = db.prepare('SELECT key, bytes FROM entries ORDER BY last_hit ASC').all();
  let total = bytes;
  const doomed = [];
  for (const row of rows) {
    if (total <= budget) break;
    doomed.push(row.key);
    total -= row.bytes;
  }

  const del = db.prepare('DELETE FROM entries WHERE key = ?');
  for (const key of doomed) del.run(key);
  return doomed.length;
}

/** Forget entries, optionally narrowed to one provider or dataset. */
export function purge(db, { provider, dataset, olderThan } = {}) {
  const where = [];
  const args = [];
  if (provider) { where.push('provider = ?'); args.push(provider); }
  if (dataset) { where.push('dataset = ?'); args.push(dataset); }
  if (olderThan) { where.push('created_at < ?'); args.push(Date.now() - olderThan); }
  const sql = `DELETE FROM entries${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).run(...args).changes;
}
