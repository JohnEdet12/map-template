/**
 * Import a whole country from a local OpenStreetMap extract.
 *
 *   node server/import-pbf.mjs --pbf server/data/nigeria-latest.osm.pbf --nigeria
 *
 * ## Why this exists
 *
 * Overpass is built for asking pointed questions about small areas. It is not
 * built for "give me everything in Nigeria", and it says so by refusing large
 * queries and rate-limiting bulk ones — which is correct behaviour for a free
 * service shared by everybody. Prefetching a country through it means
 * thousands of queries, hours of waiting, tiled workarounds for anything
 * state-sized, and a run that stalls whenever the mirrors are busy.
 *
 * Geofabrik publishes the same data as one file. Nigeria is a single ~700 MB
 * download containing every node, way and relation in the country. Read it
 * locally and the whole problem disappears: no rate limits, no mirror races,
 * no tiling, no size ceiling. A state is just a bounding box filter over data
 * already on disk, so each state and dataset is stored as **one** entry —
 * which means the studio gets a direct hit rather than an assembled one.
 *
 * ## What it produces
 *
 * Rows identical in shape to what the live client would have cached, under
 * the same keys, so the browser cannot tell the difference. The catalogue's
 * own Overpass queries drive the filtering (see ql.js), so there is no second
 * definition of any dataset to drift out of step.
 *
 * ## How it reads the file
 *
 * A PBF stores nodes, then ways, then relations — so what a way needs is
 * always already behind it. Rather than hold every node in the country in
 * memory, this makes three streaming passes:
 *
 *   1. ways and relations — keep the ones that match a dataset, and note
 *      which nodes and member ways they will need
 *   2. ways again — pick up member ways that only matter because a matching
 *      relation referred to them
 *   3. nodes — take the locations those ways need, and the matching points
 *
 * Ids and coordinates live in sorted typed arrays rather than Maps, which is
 * the difference between a few hundred megabytes and several gigabytes on a
 * dataset like buildings.
 */

import process from 'node:process';
import { statSync } from 'node:fs';
import { createOSMStream } from 'osm-pbf-parser-node';

import { openDb, put, stats } from './db.mjs';
import { compileQuery } from './ql.js';
import { loadRegions } from './regions.mjs';
import { entryKey } from '../src/data/cache/key.js';
import { DATASETS, datasetBySlug } from '../src/data/catalog.js';
import { cacheEntryFor } from '../src/data/overpass.js';
import { NIGERIA_STATES } from '../src/core/constants.js';

/* ------------------------------------------------------------------ */
/* a sorted id index                                                   */
/* ------------------------------------------------------------------ */

/**
 * A set of OSM ids with coordinates attached, held in typed arrays.
 *
 * The obvious implementation is a Map, and on a national extract it is also
 * the one that runs the process out of memory: buildings alone reference tens
 * of millions of nodes, and a Map entry costs an order of magnitude more than
 * the eight bytes the id actually needs. Ids are collected into a flat
 * Float64Array, sorted once, and then found by binary search.
 */
class IdIndex {
  constructor() {
    this.ids = new Float64Array(1 << 16);
    this.count = 0;
    this.sealed = false;
  }

  add(id) {
    if (this.count === this.ids.length) {
      const bigger = new Float64Array(this.ids.length * 2);
      bigger.set(this.ids);
      this.ids = bigger;
    }
    this.ids[this.count++] = id;
  }

  /** Sort, drop repeats, and allocate the coordinate columns. */
  seal() {
    const view = this.ids.subarray(0, this.count).sort();
    let unique = 0;
    for (let i = 0; i < view.length; i++) {
      if (i === 0 || view[i] !== view[i - 1]) view[unique++] = view[i];
    }
    this.ids = view.slice(0, unique);
    this.count = unique;
    this.lon = new Float64Array(unique);
    this.lat = new Float64Array(unique);
    this.known = new Uint8Array(unique);
    this.sealed = true;
    return unique;
  }

  /** Position of `id`, or -1. */
  indexOf(id) {
    let lo = 0;
    let hi = this.count - 1;
    const ids = this.ids;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  has(id) { return this.indexOf(id) >= 0; }

  setLocation(id, lon, lat) {
    const i = this.indexOf(id);
    if (i < 0) return false;
    this.lon[i] = lon;
    this.lat[i] = lat;
    this.known[i] = 1;
    return true;
  }

  location(id) {
    const i = this.indexOf(id);
    return i >= 0 && this.known[i] ? [this.lon[i], this.lat[i]] : null;
  }
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

const first = (ring) => ring[0];
const last = (ring) => ring[ring.length - 1];
const samePoint = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

/** A way's coordinates, or null when any node is missing from the extract. */
function wayCoords(refs, index) {
  const coords = new Array(refs.length);
  for (let i = 0; i < refs.length; i++) {
    const at = index.location(refs[i]);
    // A way crossing the extract's edge has nodes that simply are not in the
    // file. Half a road is worse than no road, so it is dropped.
    if (!at) return null;
    coords[i] = at;
  }
  return coords;
}

/** Is this closed way an area rather than a loop of road? */
function looksLikeArea(tags, coords) {
  if (!samePoint(first(coords), last(coords)) || coords.length < 4) return false;
  if (tags.area === 'no') return false;
  if (tags.area === 'yes') return true;
  // A closed highway or barrier is a ring road or a fence, not a polygon.
  if (tags.highway || tags.barrier) return false;
  return true;
}

/**
 * Join member ways end to end into closed rings.
 *
 * Multipolygon members arrive in no particular order and in either direction,
 * which is why a boundary relation cannot simply be concatenated.
 */
function buildRings(ways) {
  const pending = ways.filter((w) => w && w.length > 1).map((w) => w.slice());
  const rings = [];

  while (pending.length) {
    let ring = pending.pop();
    let joined = true;

    while (joined && !samePoint(first(ring), last(ring))) {
      joined = false;
      for (let i = 0; i < pending.length; i++) {
        const part = pending[i];
        if (samePoint(last(ring), first(part))) { ring = ring.concat(part.slice(1)); }
        else if (samePoint(last(ring), last(part))) { ring = ring.concat(part.slice().reverse().slice(1)); }
        else if (samePoint(first(ring), last(part))) { ring = part.slice(0, -1).concat(ring); }
        else if (samePoint(first(ring), first(part))) { ring = part.slice().reverse().slice(0, -1).concat(ring); }
        else continue;
        pending.splice(i, 1);
        joined = true;
        break;
      }
    }

    if (samePoint(first(ring), last(ring)) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/* ------------------------------------------------------------------ */
/* extents                                                             */
/* ------------------------------------------------------------------ */

function featureBbox(geometry) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
      return;
    }
    for (const p of c) visit(p);
  };
  visit(geometry.coordinates);
  return [w, s, e, n];
}

const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/* ------------------------------------------------------------------ */
/* arguments                                                           */
/* ------------------------------------------------------------------ */

const HELP = `
Import a country from a local OpenStreetMap extract.

  --pbf <path>         The .osm.pbf to read  (default server/data/nigeria-latest.osm.pbf)
  --nigeria            Every Nigerian state (37)
  --areas <place>...   Specific places instead
  --datasets a,b,c     Only these dataset slugs   (default: all)
  --group <id>         Only this catalogue group
  --no-heavy           Skip local roads, buildings and land use. These are the
                       memory-hungry ones; run them on their own if you need them.
  --dry-run            Report what would be imported, write nothing

Download the extract first, e.g.
  curl -L -o server/data/nigeria-latest.osm.pbf \\
    https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
`;

function parseArgs(argv) {
  const opts = {
    pbf: 'server/data/nigeria-latest.osm.pbf',
    areas: [], datasets: [], group: null, nigeria: false, heavy: true, dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--pbf': opts.pbf = next(); break;
      case '--nigeria': opts.nigeria = true; break;
      case '--areas': while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.areas.push(argv[++i]); break;
      case '--datasets': opts.datasets = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--group': opts.group = next(); break;
      case '--no-heavy': opts.heavy = false; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: if (argv[i].startsWith('--')) throw new Error(`Unknown option ${argv[i]}`);
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ */

const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const pct = (a, b) => `${((a / b) * 100).toFixed(0)}%`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);

  let size;
  try { size = statSync(opts.pbf).size; } catch {
    throw new Error(`Cannot read ${opts.pbf}. Download the extract first — see --help.`);
  }

  const places = opts.nigeria ? NIGERIA_STATES.map((s) => `${s}, Nigeria`) : opts.areas;
  if (!places.length) { console.log(HELP); throw new Error('Nothing to do — pass --nigeria or --areas.'); }

  let datasets = DATASETS;
  if (!opts.heavy) datasets = datasets.filter((d) => !d.heavy);
  if (opts.group) datasets = datasets.filter((d) => d.group === opts.group);
  if (opts.datasets.length) {
    const missing = opts.datasets.filter((s) => !datasetBySlug(s));
    if (missing.length) throw new Error(`Unknown dataset slug(s): ${missing.join(', ')}`);
    datasets = opts.datasets.map(datasetBySlug);
  }
  if (!datasets.length) throw new Error('That filter matched no datasets.');

  console.log(`\nReading ${opts.pbf} (${mb(size)})`);
  console.log(`${datasets.length} dataset(s) × ${places.length} area(s)\n`);

  const queries = datasets.map((d) => ({ dataset: d, query: compileQuery(d.body) }));
  const wantsWay = queries.filter((q) => q.query.types.has('way'));
  const wantsNode = queries.filter((q) => q.query.types.has('node'));
  const wantsRelation = queries.filter((q) => q.query.types.has('relation'));

  const regions = await loadRegions(places, { onProgress: (m) => console.log(`  ${m}`) });
  console.log(`Located ${regions.length} area(s).\n`);

  /* ---- pass 1: ways and relations ------------------------------- */
  console.log('Pass 1/3 — ways and relations');
  const ways = new Map();          // wayId -> { refs, tags, hits:Set<slug> }
  const relations = [];            // { tags, memberWays, hits:Set<slug> }
  const nodeIndex = new IdIndex();
  const memberWayIds = new IdIndex();
  let seen = 0;

  for await (const item of createOSMStream(opts.pbf)) {
    if (++seen % 2_000_000 === 0) process.stdout.write(`  ${(seen / 1e6).toFixed(0)}M elements\r`);

    if (item.type === 'way') {
      const tags = item.tags ?? {};
      let hits = null;
      for (const { dataset, query } of wantsWay) {
        if (query.match('way', tags)) (hits ??= new Set()).add(dataset.slug);
      }
      if (!hits) continue;
      ways.set(item.id, { refs: item.refs, tags, hits });
      for (const ref of item.refs) nodeIndex.add(ref);
    } else if (item.type === 'relation') {
      const tags = item.tags ?? {};
      let hits = null;
      for (const { dataset, query } of wantsRelation) {
        if (query.match('relation', tags)) (hits ??= new Set()).add(dataset.slug);
      }
      if (!hits) continue;
      const members = (item.members ?? [])
        .filter((m) => m.type === 'way' && m.role !== 'inner')
        .map((m) => m.ref);
      if (!members.length) continue;
      relations.push({ tags, members, hits });
      for (const ref of members) if (!ways.has(ref)) memberWayIds.add(ref);
    }
  }
  console.log(`  ${ways.size.toLocaleString()} matching ways, ${relations.length.toLocaleString()} matching relations`);

  /* ---- pass 2: member ways -------------------------------------- */
  const extraWays = new Map();
  const memberCount = memberWayIds.seal();
  if (memberCount) {
    console.log(`Pass 2/3 — ${memberCount.toLocaleString()} member ways referenced by relations`);
    for await (const item of createOSMStream(opts.pbf)) {
      if (item.type !== 'way') continue;
      if (!memberWayIds.has(item.id)) continue;
      extraWays.set(item.id, item.refs);
      for (const ref of item.refs) nodeIndex.add(ref);
    }
    console.log(`  resolved ${extraWays.size.toLocaleString()}`);
  } else {
    console.log('Pass 2/3 — no relation members to resolve, skipped');
  }

  /* ---- pass 3: node locations and matching points ---------------- */
  const wanted = nodeIndex.seal();
  console.log(`Pass 3/3 — locations for ${wanted.toLocaleString()} nodes`);
  const points = [];               // { geometry, tags, hits }
  let located = 0;

  for await (const item of createOSMStream(opts.pbf)) {
    if (item.type !== 'node') continue;
    if (nodeIndex.setLocation(item.id, item.lon, item.lat)) located++;

    const tags = item.tags;
    if (!tags) continue;
    let hits = null;
    for (const { dataset, query } of wantsNode) {
      if (query.match('node', tags)) (hits ??= new Set()).add(dataset.slug);
    }
    if (hits) {
      points.push({ id: `node/${item.id}`, geometry: { type: 'Point', coordinates: [item.lon, item.lat] }, tags, hits });
    }
  }
  console.log(`  located ${located.toLocaleString()} of ${wanted.toLocaleString()} (${pct(located, wanted || 1)}), ${points.length.toLocaleString()} matching points`);

  /* ---- assemble -------------------------------------------------- */
  console.log('\nBuilding geometry…');
  const features = [];             // { id, geometry, bbox, tags, hits }
  const add = (id, geometry, tags, hits) => {
    features.push({ id, geometry, bbox: featureBbox(geometry), tags, hits });
  };

  let incomplete = 0;
  for (const [id, way] of ways) {
    const coords = wayCoords(way.refs, nodeIndex);
    if (!coords) { incomplete++; continue; }
    const geometry = looksLikeArea(way.tags, coords)
      ? { type: 'Polygon', coordinates: [coords] }
      : { type: 'LineString', coordinates: coords };
    if (geometry.type === 'LineString' && coords.length < 2) continue;
    add(`way/${id}`, geometry, way.tags, way.hits);
  }

  for (const [index, rel] of relations.entries()) {
    const memberCoords = rel.members.map((ref) => {
      const own = ways.get(ref);
      const refs = own ? own.refs : extraWays.get(ref);
      return refs ? wayCoords(refs, nodeIndex) : null;
    }).filter(Boolean);

    const rings = buildRings(memberCoords);
    if (!rings.length) { incomplete++; continue; }
    add(`relation/${index}`, { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) }, rel.tags, rel.hits);
  }

  for (const p of points) add(p.id, p.geometry, p.tags, p.hits);
  console.log(`  ${features.length.toLocaleString()} features (${incomplete.toLocaleString()} dropped as incomplete)`);

  /* ---- slice by area and store ----------------------------------- */
  console.log('\nStoring by area…');
  const db = openDb();
  const tally = { stored: 0, empty: 0, features: 0, bytes: 0 };

  for (const region of regions) {
    const perDataset = new Map();
    for (const f of features) {
      if (!overlaps(f.bbox, region.bbox)) continue;
      for (const slug of f.hits) {
        if (!perDataset.has(slug)) perDataset.set(slug, []);
        perDataset.get(slug).push({ type: 'Feature', id: f.id, properties: f.tags, geometry: f.geometry });
      }
    }

    let regionFeatures = 0;
    let regionBytes = 0;
    for (const { dataset } of queries) {
      const list = perDataset.get(dataset.slug) ?? [];
      if (!list.length) { tally.empty += 1; continue; }
      if (opts.dryRun) { tally.stored += 1; regionFeatures += list.length; continue; }

      const entry = cacheEntryFor(dataset, region.bbox);
      const written = put(db, {
        ...entry,
        key: entryKey(entry),
        meta: {
          host: 'geofabrik.de',
          source: opts.pbf.split(/[\\/]/).pop(),
          region: region.place,
        },
      }, { type: 'FeatureCollection', features: list });

      tally.stored += 1;
      tally.bytes += written.bytes;
      regionBytes += written.bytes;
      regionFeatures += list.length;
    }
    tally.features += regionFeatures;
    console.log(`  ${region.place.padEnd(28)} ${String(perDataset.size).padStart(3)} datasets  ${regionFeatures.toLocaleString().padStart(10)} features  ${mb(regionBytes).padStart(9)}`);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`Stored ${tally.stored.toLocaleString()} downloads · ${tally.features.toLocaleString()} features · ${mb(tally.bytes)} compressed`);
  console.log(`${tally.empty.toLocaleString()} area/dataset pairs had nothing mapped.`);
  if (!opts.dryRun) {
    const total = stats(db);
    console.log(`Database now holds ${total.entries.toLocaleString()} downloads, ${mb(total.bytes)}.`);
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
});
