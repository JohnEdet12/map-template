/**
 * Geodata cache server.
 *
 *   node server/cache-server.mjs
 *
 * Sits between the studio and the public APIs it depends on. The browser asks
 * here first; on a hit it gets a download that has already been made, and
 * Overpass is never troubled at all.
 *
 * The response *is* the stored blob. Entries are kept gzipped, and a browser
 * asking for gzip — every browser — gets those exact bytes handed straight
 * back with `Content-Encoding: gzip` on them, so serving a 40 MB road network
 * costs one index lookup and a socket write, with no JSON ever parsed on this
 * side. Everything the client needs *about* the entry travels in headers for
 * the same reason: touching the body would mean decompressing it.
 *
 * In development Vite proxies /api/cache here (see vite.config.js), so the
 * browser makes a same-origin request. ALLOW_ORIGIN only matters if you point
 * a deployed studio straight at this server.
 */

import { createServer } from 'node:http';
import {
  openDb, lookup, has, assemble, put, stats, prune, purge, gunzipSync, DEFAULT_PATH,
} from './db.mjs';

const PORT = Number(process.env.PORT ?? 8788);
const ORIGIN = process.env.ALLOW_ORIGIN ?? 'http://localhost:5173';
/** Refuse absurd uploads rather than buffering them. */
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD ?? 128 * 1024 * 1024);

const db = openDb();

const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  // Without this the browser can read the body but not the metadata.
  'Access-Control-Expose-Headers':
    'X-Cache-Bbox, X-Cache-Created, X-Cache-Exact, X-Cache-Features, X-Cache-Meta',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** [w,s,e,n] from "w,s,e,n", or null if it is not four finite numbers. */
function parseBbox(text) {
  const parts = String(text ?? '').split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD) throw Object.assign(new Error('Body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

function getEntry(req, res, url) {
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const provider = url.searchParams.get('provider');
  const dataset = url.searchParams.get('dataset');
  if (!bbox || !provider || !dataset) {
    return json(res, 400, { error: 'provider, dataset and bbox=w,s,e,n are required.' });
  }

  const query = {
    key: url.searchParams.get('key') ?? undefined,
    provider,
    dataset,
    variant: url.searchParams.get('variant') ?? '',
    bbox,
    maxAge: num(url.searchParams.get('maxAge'), 0),
  };

  let hit = lookup(db, query);

  // Nothing single covers it — but a grid of prefetched cells might. Merging
  // them is the expensive path, so the result is stored under this request's
  // own extent and the next caller gets an ordinary one-row hit.
  if (!hit) {
    const built = assemble(db, query);
    if (built) {
      const key = query.key
        ?? `assembled|${provider}|${dataset}|${query.variant}|${bbox.join(',')}`;
      put(db, { key, provider, dataset, variant: query.variant, bbox, meta: built.meta }, built.geojson);
      prune(db);
      console.log(`[cache] assembled ${dataset} from ${built.cells} cells — ${built.geojson.features.length} features, ${built.dropped} duplicates dropped`);
      hit = lookup(db, { ...query, key });
    }
  }

  if (!hit) return json(res, 404, { error: 'Not cached.' });

  const headers = {
    'Content-Type': 'application/json',
    'X-Cache-Bbox': hit.bbox.join(','),
    'X-Cache-Created': String(hit.createdAt),
    'X-Cache-Exact': hit.exact ? '1' : '0',
    'X-Cache-Features': String(hit.features),
    // Header values must be ASCII and place names are not — base64 keeps a
    // Nigerian dataset name from breaking the response.
    'X-Cache-Meta': Buffer.from(JSON.stringify(hit.meta)).toString('base64'),
    ...CORS,
  };

  // The stored bytes go out untouched when the client can take them, which is
  // the fast path and effectively always. Anything else pays for a gunzip.
  if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    return res.end(hit.body);
  }
  res.writeHead(200, headers);
  return res.end(gunzipSync(hit.body));
}

async function putEntry(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.status ? err.message : 'Body must be JSON.' });
  }

  const { key, provider, dataset, variant = '', bbox, meta = {}, geojson } = payload ?? {};
  if (!key || !provider || !dataset || !parseBbox(bbox?.join?.(',')) || !geojson?.features) {
    return json(res, 400, { error: 'key, provider, dataset, bbox and geojson are required.' });
  }

  const written = put(db, { key, provider, dataset, variant, bbox, meta }, geojson);
  const dropped = prune(db);
  return json(res, 201, { ok: true, ...written, dropped });
}

/* ------------------------------------------------------------------ */

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, db: DEFAULT_PATH, origin: ORIGIN });
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      return json(res, 200, stats(db));
    }
    if (req.method === 'GET' && url.pathname === '/entry') {
      return getEntry(req, res, url);
    }
    // "Do you have this?", asked before deciding an area is too big to fetch.
    if (req.method === 'GET' && url.pathname === '/has') {
      const bbox = parseBbox(url.searchParams.get('bbox'));
      if (!bbox) return json(res, 400, { error: 'bbox=w,s,e,n is required.' });
      const found = has(db, {
        provider: url.searchParams.get('provider'),
        dataset: url.searchParams.get('dataset'),
        variant: url.searchParams.get('variant') ?? '',
        bbox,
        maxAge: num(url.searchParams.get('maxAge'), 0),
      });
      return found ? json(res, 200, found) : json(res, 404, { error: 'Not cached.' });
    }
    if (req.method === 'PUT' && url.pathname === '/entry') {
      return await putEntry(req, res);
    }
    if (req.method === 'DELETE' && url.pathname === '/entries') {
      const removed = purge(db, {
        provider: url.searchParams.get('provider') ?? undefined,
        dataset: url.searchParams.get('dataset') ?? undefined,
        olderThan: num(url.searchParams.get('olderThan')) || undefined,
      });
      return json(res, 200, { ok: true, removed });
    }
    return json(res, 404, { error: 'GET /entry, PUT /entry, GET /stats, DELETE /entries, GET /health' });
  } catch (err) {
    console.error('[cache]', err);
    return json(res, err.status ?? 500, { error: err.message ?? 'Server error.' });
  }
}).listen(PORT, () => {
  const { entries, bytes } = stats(db);
  console.log(`Geodata cache on http://localhost:${PORT}  (allowing ${ORIGIN})`);
  console.log(`Database ${DEFAULT_PATH}`);
  console.log(`Holding ${entries.toLocaleString()} downloads, ${(bytes / 1024 ** 2).toFixed(1)} MB compressed.`);
});
