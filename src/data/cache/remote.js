/**
 * L2 cache client — the shared database, over HTTP.
 *
 * L1 makes a reload free for one person on one machine. This is the layer
 * that makes it free for everyone else: the first colleague to download
 * Lagos health facilities fills the database, and the next person to open
 * the same area — different browser, different laptop, cleared cache —
 * gets it from there instead of from Overpass.
 *
 * The server is optional and the app must be fully usable without it, so
 * two things are true of every call here:
 *
 *   1. A failure is a miss, never an error. The caller falls through to the
 *      live provider exactly as if the database had nothing.
 *
 *   2. Repeated failures stop the attempts. If nobody is running the cache
 *      server, asking it on every dataset would add a connection refusal to
 *      each one; instead a short circuit-breaker trips and the whole layer
 *      is skipped until it is worth trying again.
 */

import { entryKey, normBbox } from './key.js';

/**
 * In dev this is proxied by Vite to the cache server, so the browser makes a
 * same-origin request and CORS never enters into it. In a deployment, put the
 * cache server behind the same origin at this path, or set VITE_CACHE_URL.
 */
const BASE = (import.meta.env?.VITE_CACHE_URL ?? '/api/cache').replace(/\/$/, '');

/** How long to wait on the database before deciding a live fetch is faster. */
const TIMEOUT_MS = 4000;
/** Consecutive failures before the layer switches itself off. */
const TRIP_AFTER = 2;
/** How long it stays off. */
const COOLDOWN_MS = 60_000;

let failures = 0;
let offUntil = 0;

const isOpen = () => Date.now() >= offUntil;

function succeeded() { failures = 0; offUntil = 0; }

function failed() {
  failures += 1;
  if (failures >= TRIP_AFTER) offUntil = Date.now() + COOLDOWN_MS;
}

async function call(path, init = {}) {
  if (!isOpen()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal });
    // 404 is a legitimate answer — the database simply has not got this one.
    // It proves the server is up, so it must not count against the breaker.
    if (res.status === 404) { succeeded(); return null; }
    if (!res.ok) { failed(); return null; }
    succeeded();
    return res;
  } catch {
    failed();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Ask the database for a download covering this request.
 * @returns {Promise<{geojson:object, meta:object, bbox:number[], createdAt:number, exact:boolean}|null>}
 */
export async function lookup(entry, { maxAgeMs } = {}) {
  const params = new URLSearchParams({
    provider: entry.provider,
    dataset: entry.dataset,
    variant: entry.variant ?? '',
    bbox: normBbox(entry.bbox).join(','),
  });
  if (maxAgeMs) params.set('maxAge', String(maxAgeMs));

  const res = await call(`/entry?${params}`);
  if (!res) return null;

  try {
    // The body is the GeoJSON itself and nothing else — the server hands over
    // its stored gzip untouched and fetch inflates it — so everything *about*
    // the entry arrives in headers rather than in a wrapper object.
    const geojson = await res.json();
    if (!geojson?.features) return null;

    const bbox = res.headers.get('X-Cache-Bbox')?.split(',').map(Number);
    return {
      geojson,
      meta: decodeMeta(res.headers.get('X-Cache-Meta')),
      bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? bbox : normBbox(entry.bbox),
      createdAt: Number(res.headers.get('X-Cache-Created')) || 0,
      exact: res.headers.get('X-Cache-Exact') === '1',
    };
  } catch {
    return null;
  }
}

/**
 * Does the database hold something covering this request?
 *
 * Metadata only — asked when the caller is deciding whether an area is too
 * large to fetch, which is a question about existence, not content.
 */
export async function probe(entry, { maxAgeMs } = {}) {
  const params = new URLSearchParams({
    provider: entry.provider,
    dataset: entry.dataset,
    variant: entry.variant ?? '',
    bbox: normBbox(entry.bbox).join(','),
  });
  if (maxAgeMs) params.set('maxAge', String(maxAgeMs));

  const res = await call(`/has?${params}`);
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
}

/** Meta travels base64-encoded so place names cannot break the header. */
function decodeMeta(encoded) {
  if (!encoded) return {};
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

/**
 * Offer a fresh download to the database.
 *
 * Fire-and-forget by design — the user already has their data, and whether
 * the next person gets it faster is not worth one second of their time.
 */
export async function store(entry, geojson, meta = {}) {
  await call('/entry', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: entryKey(entry),
      provider: entry.provider,
      dataset: entry.dataset,
      variant: entry.variant ?? '',
      bbox: normBbox(entry.bbox),
      meta,
      geojson,
    }),
  });
}

/** What the database holds, for the storage panel. Null when unreachable. */
export async function stats() {
  // A deliberate check should never be silently skipped by the breaker.
  offUntil = 0;
  const res = await call('/stats');
  if (!res) return null;
  try { return await res.json(); } catch { return null; }
}

export const endpoint = () => BASE;
