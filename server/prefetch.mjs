/**
 * Bulk-fill the geodata database.
 *
 *   node server/prefetch.mjs --areas "Lagos, Nigeria"
 *   node server/prefetch.mjs --nigeria --group services
 *   node server/prefetch.mjs --areas "Rivers, Nigeria" --datasets roads-major,health
 *   node server/prefetch.mjs --list
 *
 * The on-demand cache only helps the *second* person to open an area. This is
 * how the first one stops waiting too: point it at the places your team
 * actually maps, leave it running, and by morning those areas load out of the
 * database instead of out of Overpass.
 *
 * ## Being a good citizen
 *
 * Overpass is donated infrastructure. A script that hammers it is the reason
 * mirrors start refusing requests, so this one is deliberately unhurried: one
 * dataset at a time, a pause between each, exponential backoff on failure, and
 * it gives up on an area rather than retrying forever. A full run over 37
 * states takes hours. That is the correct speed — start it and walk away.
 *
 * It writes to SQLite directly and turns the browser cache layers off, so it
 * does not need the cache server to be running.
 */

import process from 'node:process';
import { openDb, put, stats } from './db.mjs';
import { configure } from '../src/data/cache/index.js';
import { entryKey, normBbox } from '../src/data/cache/key.js';
import { DATASETS, datasetBySlug } from '../src/data/catalog.js';
import { fetchDataset, checkSize, cacheEntryFor as osmEntry, clearCache } from '../src/data/overpass.js';
import {
  fetchOvertureSupplement, checkSupplement, latestRelease,
  cacheEntryFor as overtureEntry,
} from '../src/data/overture.js';
import { NIGERIA_STATES } from '../src/core/constants.js';

// The data modules are shared with the browser, where they read and write the
// two client-side cache layers. Here neither exists, and rows are written
// below by hand, so every layer is switched off and `through()` becomes a
// straight pass to the live provider.
configure({ l1: false, l2: false, revalidate: false });

/** Nominatim asks that automated clients identify themselves. */
const USER_AGENT = 'gis-design-studio-prefetch/1.0 (+https://github.com/JohnEdet12)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/* ------------------------------------------------------------------ */
/* arguments                                                           */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const opts = {
    areas: [], datasets: [], group: null, nigeria: false, list: false,
    overture: true, delay: 1500, retries: 2, dryRun: false, force: false,
    tile: false, maxTiles: 36, heavy: true, status: false, concurrency: 6,
    timeout: 120_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--areas':
        // Takes every following value until the next flag, so quoting each
        // place name is enough — no comma-splitting a name like "Cross River".
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.areas.push(argv[++i]);
        break;
      case '--datasets': opts.datasets = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--group':    opts.group = next(); break;
      case '--nigeria':  opts.nigeria = true; break;
      case '--list':     opts.list = true; break;
      case '--no-overture': opts.overture = false; break;
      case '--delay':    opts.delay = Number(next()); break;
      case '--retries':  opts.retries = Number(next()); break;
      case '--dry-run':  opts.dryRun = true; break;
      case '--force':    opts.force = true; break;
      case '--tile':     opts.tile = true; break;
      case '--max-tiles': opts.maxTiles = Number(next()); break;
      case '--no-heavy': opts.heavy = false; break;
      case '--status':   opts.status = true; break;
      case '--concurrency': opts.concurrency = Math.max(1, Number(next())); break;
      case '--timeout':  opts.timeout = Math.max(5, Number(next())) * 1000; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        opts.areas.push(arg);
    }
  }
  return opts;
}

const HELP = `
Fill the geodata cache database ahead of time.

  --areas <place>...      Places to prefetch, e.g. --areas "Lagos, Nigeria" "Ogun, Nigeria"
  --nigeria               Every Nigerian state (37 areas)
  --datasets a,b,c        Only these dataset slugs        (default: all)
  --group <id>            Only this catalogue group: transport water built services land risk
  --no-overture           Skip Overture supplements, OpenStreetMap only
  --tile                  Split areas that exceed the Overpass size limit into
                          a grid and fetch each cell — the only way to cache
                          heavy datasets (buildings, local roads) for a state
  --max-tiles <n>         Give up rather than split beyond this  (default 36)
  --no-heavy              Skip the three datasets that dominate a run —
                          local roads, buildings, land use. Everything else
                          for all 37 states costs less than these three do.
  --status                Print what the database already covers, and exit
  --delay <ms>            Pause between Overpass requests  (default 1500)
  --concurrency <n>       Overture cells in flight at once (default 6). Only
                          affects Overture — static files on S3, no shared
                          service to congest. Overpass stays one at a time.
  --retries <n>           Attempts after a failure         (default 2)
  --timeout <s>           Abandon a request that goes quiet this long, so one
                          stalled socket cannot halt an overnight run
                          (default 120)
  --force                 Refetch areas already in the database
  --dry-run               Show what would be fetched, fetch nothing
  --list                  Print dataset slugs and exit
`;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const areaKm2 = ([w, s, e, n]) =>
  Math.abs(e - w) * 111.32 * Math.cos(((s + n) / 2 * Math.PI) / 180) * Math.abs(n - s) * 110.57;

/**
 * Cut a bbox into a grid of cells that each fit inside `limitKm2`.
 *
 * This is what makes it possible to cache the heavy datasets — building
 * footprints, local roads — for a whole state. Overpass will not answer a
 * query that big, and it is right not to: the limit exists so one user cannot
 * monopolise a free service. But the same ground asked for in twelve pieces
 * is twelve ordinary queries, and the studio only ever draws a piece at a
 * time anyway.
 *
 * The consequence, stated plainly because it matters: cells are stored
 * separately, so the cache answers any request that fits *inside* one cell,
 * not one that straddles two. For district and city maps — what these
 * datasets are actually used for — that is the whole of the need.
 */
function splitBbox(bbox, limitKm2) {
  const [w, s, e, n] = bbox;
  // 0.75 rather than 1.0: cells sized exactly at the limit sit right on the
  // boundary of what Overpass will accept, and a marginal query that times
  // out costs far more than one extra column of cells.
  const divisions = Math.ceil(Math.sqrt(areaKm2(bbox) / (limitKm2 * 0.75)));
  if (divisions <= 1) return [bbox];

  const dx = (e - w) / divisions;
  const dy = (n - s) / divisions;
  const cells = [];
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < divisions; j++) {
      cells.push([w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy]);
    }
  }
  return cells;
}

let lastGeocode = 0;

/**
 * Resolve a place name to a bbox.
 *
 * Deliberately not reusing data/boundaries.js: that runs in a browser, where
 * the User-Agent is the browser's own. Nominatim blocks unidentified scripts,
 * so an automated client has to send its own — and it needs nothing here but
 * the bounding box, not the polygon.
 */
async function resolveArea(place) {
  const wait = 1200 - (Date.now() - lastGeocode);
  if (wait > 0) await sleep(wait);
  lastGeocode = Date.now();

  const params = new URLSearchParams({ format: 'jsonv2', limit: '5', q: place });
  const res = await fetch(`${NOMINATIM}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);

  const rows = await res.json();
  // Nominatim's boundingbox is [south, north, west, east] — not a bbox order
  // anything else in this project uses.
  const hits = rows
    .filter((r) => Array.isArray(r.boundingbox))
    .map((r) => {
      const [s, n, w, e] = r.boundingbox.map(Number);
      return { name: r.display_name, bbox: [w, s, e, n], area: Math.abs(e - w) * Math.abs(n - s) };
    })
    .filter((r) => r.bbox.every(Number.isFinite));

  if (!hits.length) throw new Error(`No boundary found for “${place}”`);
  // Largest match, for the same reason the app does it: a same-named suburb
  // must not stand in for the state that was asked for.
  const best = hits.sort((a, b) => b.area - a.area)[0];
  // Snapped to the same five decimal places the browser rounds to before it
  // asks, so a prefetched grid lines up exactly with the requests it exists
  // to answer rather than missing them by a fraction of a metre.
  return { ...best, bbox: normBbox(best.bbox) };
}

/** Run `fn` over `items`, at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const queue = items.map((item, index) => [item, index]);
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await fn(next[0], next[1]);
    }
  });
  await Promise.all(workers);
}

/**
 * Run `task`, giving up on it if it goes quiet, and retrying with a widening
 * pause.
 *
 * The timeout is not belt-and-braces. Neither provider is reliably prompt:
 * an Overpass mirror can accept a connection and then never answer, and a
 * PMTiles range request can hang on a stalled socket. Without a deadline
 * here, one such request stops an overnight run dead — everything after it
 * simply never happens, and the only symptom is a log that stopped. An
 * unanswered request is a failed request, so it is treated as one.
 *
 * `task` receives an AbortSignal. Overpass honours it and drops the request
 * outright; the Overture tile loop checks it between tiles, so a hung tile is
 * abandoned at the next boundary rather than instantly. Either way the run
 * moves on.
 */
async function withRetry(task, retries, delay, label, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        task(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`no response after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs);
        }),
      ]);
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoff = delay * 2 ** (attempt + 1);
      console.log(`      retry ${attempt + 1}/${retries} after ${(backoff / 1000).toFixed(1)}s — ${label}: ${err.message}`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) return console.log(HELP);

  // A run over 37 states takes long enough that "where did it get to?" is a
  // question worth being able to answer without reading a scrollback.
  if (opts.status) {
    const db = openDb();
    const rows = db.prepare(`
      SELECT json_extract(meta, '$.region') AS region,
             COUNT(*) AS entries, COUNT(DISTINCT dataset) AS datasets,
             SUM(features) AS features, SUM(bytes) AS bytes
        FROM entries WHERE region IS NOT NULL
       GROUP BY region ORDER BY region`).all();

    if (!rows.length) return console.log('Nothing prefetched yet.');
    console.log('\nRegion                          datasets   entries      features      size');
    for (const r of rows) {
      console.log(`  ${String(r.region).slice(0, 28).padEnd(30)}${String(r.datasets).padStart(5)}${String(r.entries).padStart(10)}${r.features.toLocaleString().padStart(14)}${mb(r.bytes).padStart(10)}`);
    }
    const all = stats(db);
    console.log(`\n${rows.length} region(s) · ${all.entries.toLocaleString()} downloads · ${mb(all.bytes)} total\n`);
    return;
  }

  if (opts.list) {
    for (const d of DATASETS) {
      console.log(`  ${d.slug.padEnd(18)} ${d.group.padEnd(10)} ${d.name}${d.overture ? '  + Overture' : ''}${d.heavy ? '  [heavy]' : ''}`);
    }
    return;
  }

  const places = opts.nigeria
    ? NIGERIA_STATES.map((s) => `${s}, Nigeria`)
    : opts.areas;

  if (!places.length) {
    console.log(HELP);
    console.error('Nothing to do — pass --areas or --nigeria.');
    process.exitCode = 1;
    return;
  }

  let datasets = DATASETS;
  if (!opts.heavy) datasets = datasets.filter((d) => !d.heavy);
  if (opts.group) datasets = datasets.filter((d) => d.group === opts.group);
  if (opts.datasets.length) {
    const missing = opts.datasets.filter((s) => !datasetBySlug(s));
    if (missing.length) throw new Error(`Unknown dataset slug(s): ${missing.join(', ')}. Try --list.`);
    datasets = opts.datasets.map(datasetBySlug);
  }
  if (!datasets.length) throw new Error('That filter matched no datasets. Try --list.');

  const db = openDb();
  const release = opts.overture ? await latestRelease().catch(() => null) : null;

  console.log(`\n${places.length} area(s) × ${datasets.length} dataset(s) = up to ${places.length * datasets.length} downloads`);
  if (release) console.log(`Overture release ${release}`);
  if (opts.dryRun) console.log('DRY RUN — nothing will be fetched.\n');

  const seen = db.prepare('SELECT 1 FROM entries WHERE key = ?');
  const tally = { stored: 0, skipped: 0, failed: 0, empty: 0, bytes: 0, features: 0 };
  const started = Date.now();

  for (const [index, place] of places.entries()) {
    console.log(`\n[${index + 1}/${places.length}] ${place}`);

    let area;
    try {
      area = await resolveArea(place);
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
      tally.failed += 1;
      continue;
    }
    console.log(`  ${area.name}`);
    console.log(`  bbox ${area.bbox.map((n) => n.toFixed(3)).join(', ')}`);

    for (const dataset of datasets) {
      // --- OpenStreetMap ------------------------------------------------
      const size = checkSize(dataset, area.bbox);

      // An area Overpass will not answer in one piece becomes a grid, or is
      // skipped — but never silently: a partial answer for a dataset someone
      // will draw conclusions from is worse than no answer.
      let cells = [area.bbox];
      if (!size.ok) {
        if (!opts.tile) {
          console.log(`    – ${dataset.slug}: too large (${Math.round(size.areaKm2).toLocaleString()} km² > ${size.limit.toLocaleString()} km²) — pass --tile to split it`);
          tally.skipped += 1;
          cells = [];
        } else {
          cells = splitBbox(area.bbox, size.limit);
          if (cells.length > opts.maxTiles) {
            console.log(`    – ${dataset.slug}: would need ${cells.length} cells, over --max-tiles ${opts.maxTiles}`);
            tally.skipped += 1;
            cells = [];
          } else {
            console.log(`    ⊞ ${dataset.slug}: ${Math.round(size.areaKm2).toLocaleString()} km² split into ${cells.length} cells`);
          }
        }
      }

      for (const [cellIndex, cell] of cells.entries()) {
        const entry = osmEntry(dataset, cell);
        const key = entryKey(entry);
        const label = cells.length > 1 ? `${dataset.slug} [${cellIndex + 1}/${cells.length}]` : dataset.slug;

        if (!opts.force && seen.get(key)) {
          if (cells.length === 1) console.log(`    · ${label}: already stored`);
          tally.skipped += 1;
          continue;
        }
        if (opts.dryRun) { console.log(`    → ${label}`); continue; }

        try {
          // The session map inside overpass.js would otherwise grow to hold
          // every download of the whole run.
          clearCache();
          const geojson = await withRetry(
            (signal) => fetchDataset(dataset, cell, { signal }),
            opts.retries, opts.delay, label, opts.timeout);
          const count = geojson.features?.length ?? 0;

          if (!count) {
            if (cells.length === 1) console.log(`    ○ ${label}: nothing mapped here`);
            tally.empty += 1;
          } else {
            // The region is stamped on the row so `--status` can report
            // coverage by place. Nothing reads it at serve time.
            const w = put(db, { ...entry, key, meta: { ...(geojson.meta ?? {}), region: place } }, geojson);
            console.log(`    ✓ ${label}: ${count.toLocaleString()} features, ${mb(w.bytes)}`);
            tally.stored += 1;
            tally.bytes += w.bytes;
            tally.features += count;
          }
        } catch (err) {
          console.log(`    ✗ ${label}: ${err.message}`);
          tally.failed += 1;
        }
        await sleep(opts.delay);
      }

      // --- Overture supplement -----------------------------------------
      if (!release || !dataset.overture) continue;

      const sup = dataset.overture;
      // Overture's ceiling is a tile count rather than an area, so the grid is
      // found by trying: divide until every cell is inside the tile budget.
      let supCells = [area.bbox];
      if (!checkSupplement(sup, area.bbox).ok) {
        if (!opts.tile) {
          tally.skipped += 1;
          continue;
        }
        let found = null;
        for (let g = 2; g * g <= opts.maxTiles; g++) {
          const grid = splitBbox(area.bbox, areaKm2(area.bbox) / (g * g));
          if (grid.every((cell) => checkSupplement(sup, cell).ok)) { found = grid; break; }
        }
        if (!found) {
          console.log(`    – ${sup.id} (overture): will not fit in ${opts.maxTiles} cells`);
          tally.skipped += 1;
          continue;
        }
        supCells = found;
        console.log(`    ⊞ ${sup.id} (overture): split into ${supCells.length} cells`);
      }

      // Overture cells go in parallel, with no pause between them, and this
      // is the single biggest thing that decides how long a national run
      // takes. It is not impoliteness: Overture publishes static PMTiles
      // archives on S3, read by HTTP range request. There is no shared query
      // engine to congest — unlike Overpass, where the queueing below is the
      // whole point — and the studio itself already pulls these tiles in a
      // loop. Serialising them behind a courtesy delay bought nothing and
      // cost most of the run.
      await mapLimit(supCells, opts.concurrency, async (cell, cellIndex) => {
        const supEntry = overtureEntry(sup, cell, release);
        const supKey = entryKey(supEntry);
        const label = supCells.length > 1
          ? `${sup.id} (overture) [${cellIndex + 1}/${supCells.length}]`
          : `${sup.id} (overture)`;

        if (!opts.force && seen.get(supKey)) { tally.skipped += 1; return; }
        if (opts.dryRun) { console.log(`    → ${label}`); return; }

        try {
          const geojson = await withRetry(
            (signal) => fetchOvertureSupplement(sup, cell, { signal }),
            opts.retries, opts.delay, label, opts.timeout);
          const count = geojson.features?.length ?? 0;
          if (!count) {
            tally.empty += 1;
          } else {
            const w = put(db, { ...supEntry, key: supKey, meta: { ...(geojson.meta ?? {}), region: place } }, geojson);
            console.log(`    ✓ ${label}: ${count.toLocaleString()} features, ${mb(w.bytes)}`);
            tally.stored += 1;
            tally.bytes += w.bytes;
            tally.features += count;
          }
        } catch (err) {
          // Overture is a supplement everywhere else in the app, and it stays
          // one here — a theme that will not load is not a failed area.
          console.log(`    ✗ ${label}: ${err.message}`);
          tally.failed += 1;
        }
      });
    }
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n─────────────────────────────────────────`);
  console.log(`Stored ${tally.stored} downloads (${tally.features.toLocaleString()} features, ${mb(tally.bytes)} compressed) in ${mins} min`);
  console.log(`Skipped ${tally.skipped} · empty ${tally.empty} · failed ${tally.failed}`);

  const total = stats(db);
  console.log(`Database now holds ${total.entries.toLocaleString()} downloads, ${mb(total.bytes)}.`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
});
