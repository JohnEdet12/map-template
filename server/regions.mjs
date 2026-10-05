/**
 * Study-area bounding boxes, geocoded once and kept.
 *
 * Nominatim allows about one lookup a second, so resolving 37 states costs
 * the better part of a minute — every run, for answers that do not change.
 * They are cached to disk instead, which also means a re-import needs no
 * network at all.
 *
 * Boxes are snapped to five decimal places, the same rounding the browser
 * applies before it asks the cache anything. A stored extent that does not
 * land on that grid can miss the very request it exists to answer.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normBbox } from '../src/data/cache/key.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * In a container the default sits inside the image, where it is discarded the
 * moment the run ends — so every import would re-geocode all 37 states. The
 * override points it at the same volume as the database, which is the only
 * thing that outlives the container.
 */
const CACHE_PATH = process.env.REGIONS_CACHE ?? resolve(HERE, 'data', 'regions.json');

const USER_AGENT = 'gis-design-studio-import/1.0 (+https://github.com/JohnEdet12)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}

function writeCache(all) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(all, null, 2));
}

/** Resolve one place to `{name, bbox}`. */
async function geocode(place) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '5', q: place });
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status} for “${place}”`);

  const rows = await res.json();
  // Nominatim's boundingbox is [south, north, west, east] — an order nothing
  // else in this project uses.
  const hits = rows
    .filter((r) => Array.isArray(r.boundingbox))
    .map((r) => {
      const [s, n, w, e] = r.boundingbox.map(Number);
      return { name: r.display_name, bbox: [w, s, e, n], span: Math.abs(e - w) * Math.abs(n - s) };
    })
    .filter((r) => r.bbox.every(Number.isFinite));

  if (!hits.length) throw new Error(`No boundary found for “${place}”`);
  // Largest match, so a same-named suburb cannot stand in for the state.
  const best = hits.sort((a, b) => b.span - a.span)[0];
  return { name: best.name, bbox: normBbox(best.bbox) };
}

/**
 * Bounding boxes for `places`, from cache where possible.
 * @returns {Promise<Array<{place:string, name:string, bbox:number[]}>>}
 */
export async function loadRegions(places, { onProgress } = {}) {
  const cache = readCache();
  const out = [];
  let fetched = 0;

  for (const place of places) {
    if (cache[place]) { out.push({ place, ...cache[place] }); continue; }

    if (fetched > 0) await sleep(1200);
    onProgress?.(`Locating ${place}…`);
    const found = await geocode(place);
    fetched += 1;
    cache[place] = found;
    writeCache(cache);
    out.push({ place, ...found });
  }

  return out;
}
