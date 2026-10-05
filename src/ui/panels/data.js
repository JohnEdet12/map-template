/**
 * Data pane — open datasets and your own files.
 *
 * Everything here is scoped to the study area's bounding box, which keeps
 * Overpass queries polite and downloads small enough to draw smoothly.
 *
 * Datasets that come in types (road classes, kinds of health facility) can
 * be narrowed to just the types you want. The fetch itself is cached, so
 * changing the selection re-filters instantly rather than re-downloading.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import {
  GROUPS, datasetsInGroup, datasetBySlug, classify, segmentsOf, isMerged,
} from '../../data/catalog.js';
import { fetchDataset, checkSize, isDatasetCached } from '../../data/overpass.js';
import {
  fetchOvertureSupplement, checkSupplement, isFromOsm, isSupplementCached,
} from '../../data/overture.js';
import { parseGeoFile, ACCEPTED } from '../../data/upload.js';
import { areaParts } from '../../data/study-areas.js';
import { uiIcon } from '../ui-icons.js';
import { addVectorLayer, removeLayer, replaceBySlug } from '../../layers/registry.js';
import { categorisedSymbology, singleSymbology, valuesIn, DEFAULT_LINE_WIDTH_MM } from '../../layers/symbology.js';
import { iconSvg } from '../../layers/icons.js';
import { featureCount, formatNumber, bboxOf, boundsFromBbox, clipToArea, dominantGeometry } from '../../core/geo.js';
import { flyToBounds } from '../../core/map.js';
import { renderElements, hint } from '../artboard.js';
import { setTool } from '../tool.js';
import { head, section, group, row, empty, button, stack, miniBtn, checkRow, chevron } from '../controls.js';

let pane;
const inflight = new Map();          // slug → AbortController
const expanded = new Set();          // dataset slugs whose category picker is open
const chosen = new Map();            // slug → Set of class labels (absent = all)
const counts = new Map();            // slug → Map(label → feature count)

const layerForSlug = (slug) => state.layers.find((l) => l.meta?.slug === slug) ?? null;

/* ------------------------------------------------------------------ */
/* classification + symbology                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* merging the two providers                                           */
/* ------------------------------------------------------------------ */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Rough metres between two lon/lat pairs — fine at the scale of one POI. */
function metresApart([lon1, lat1], [lon2, lat2]) {
  const dx = (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  const dy = (lat2 - lat1) * 110570;
  return Math.hypot(dx, dy);
}

const firstPoint = (geometry) => {
  let c = geometry?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === 'number' ? c : null;
};

/**
 * Combine an OpenStreetMap download with its Overture supplement.
 *
 * Overture *contains* OpenStreetMap, so a plain concatenation would show most
 * features twice. Two passes remove the repeats, in order of how certain they
 * are:
 *
 *   provenance  Overture records which project each feature's geometry came
 *               from. Anything it credits to OpenStreetMap is, by
 *               construction, already in the Overpass result — dropped
 *               outright. This is exact, not a heuristic, and it removes the
 *               large majority.
 *   proximity   the same shop can be mapped independently by OpenStreetMap
 *               and by Meta, with no shared id to link them. A same-named
 *               point within 40 m is treated as the same thing and the
 *               OpenStreetMap one is kept, because it is the version with
 *               the richer tags.
 *
 * What survives is the part Overture adds: the Google and Microsoft building
 * footprints, and the places nobody has put into OpenStreetMap yet.
 */
function mergeProviders(osm, extra) {
  const osmFeatures = osm?.features ?? [];

  // Both sides carry provenance, so "Colour by category → gds_source" is a
  // real option: it is how you get the Google / Microsoft / OpenStreetMap
  // split on a buildings layer that OpenStreetMap itself does not segment.
  for (const f of osmFeatures) {
    f.properties = { ...(f.properties ?? {}), gds_provider: 'OpenStreetMap', gds_source: 'OpenStreetMap' };
  }

  if (!extra?.features?.length) return osm ?? { type: 'FeatureCollection', features: [] };

  const named = new Map();
  for (const f of osmFeatures) {
    const key = norm(f.properties?.name);
    if (!key) continue;
    const pt = firstPoint(f.geometry);
    if (!pt) continue;
    if (!named.has(key)) named.set(key, []);
    named.get(key).push(pt);
  }

  let fromOsm = 0;
  let alsoMapped = 0;
  const added = [];

  for (const f of extra.features) {
    if (isFromOsm({ source: f.properties?.gds_source })) { fromOsm++; continue; }

    const key = norm(f.properties?.name);
    const pt = key ? firstPoint(f.geometry) : null;
    if (pt && named.has(key) && named.get(key).some((p) => metresApart(p, pt) < 40)) {
      alsoMapped++;
      continue;
    }
    added.push(f);
  }

  return {
    type: 'FeatureCollection',
    features: [...osmFeatures, ...added],
    meta: {
      ...(osm?.meta ?? {}),
      merged: {
        osm: osmFeatures.length,
        overtureAdded: added.length,
        overtureDuplicates: fromOsm + alsoMapped,
        zoom: extra.meta?.zoom,
        release: extra.meta?.release,
      },
    },
  };
}

/** Tag every feature with its class and remember how many of each there are. */
function tagAndTally(dataset, geojson) {
  const tally = new Map();
  for (const f of geojson.features ?? []) {
    const klass = classify(dataset, f.properties ?? {});
    f.properties = { ...(f.properties ?? {}), gds_class: klass };
    if (klass) tally.set(klass, (tally.get(klass) ?? 0) + 1);
  }
  counts.set(dataset.slug, tally);
  return tally;
}

function symbologyFor(dataset, geojson) {
  if (!dataset.segments?.length) return singleSymbology(dataset.color);

  const present = new Set(valuesIn(geojson, 'gds_class', 20).map((v) => v.value));
  const declared = segmentsOf(dataset).filter((s) => present.has(s.value));
  // Whatever matched no rule still belongs to this dataset, so it keeps the
  // dataset's own symbol rather than reverting to an anonymous dot.
  if (present.has('Other')) declared.push({ value: 'Other', label: 'Other', color: '#94a3b8', icon: dataset.symbol });

  // One class present is just a single colour with extra steps.
  if (declared.length < 2) return singleSymbology(declared[0]?.color ?? dataset.color);
  return categorisedSymbology('gds_class', declared);
}

/**
 * Turn clipping on or off and rebuild everything already on the map. The
 * downloads are cached per slug and bbox, so this is a re-clip, not a re-fetch.
 */
function reclip(on) {
  set({ clipToArea: on });
  const live = state.layers.filter((l) => (l.source === 'osm' || l.source === 'overture') && l.meta?.slug);
  for (const layer of live) {
    const dataset = datasetBySlug(layer.meta.slug);
    if (dataset) addDataset(dataset, { quiet: true });
  }
  render();
}

/* ------------------------------------------------------------------ */
/* fetching                                                            */
/* ------------------------------------------------------------------ */
/**
 * How to name this study area to the prefetch script.
 *
 * The bare name is not enough and the failure is silent rather than loud:
 * "Niger" is a state and also the country next door, and Nominatim answers
 * with the larger one. Nominatim's own display name resolves unambiguously
 * but can run to eight components, so this keeps the first and the last —
 * "Niger, Nigeria" — which is both short and unmistakable.
 */
function prefetchName(area) {
  const parts = (area.displayName ?? area.name ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return area.name ?? '';
  return `${parts[0]}, ${parts[parts.length - 1]}`;
}

/**
 * Fetch one dataset for one study area, both providers, merged and clipped.
 *
 * Split out because a map can have several areas and they are fetched
 * separately — see fetchAllParts() for why that matters more than it sounds.
 */
async function fetchForPart(dataset, part, { signal, onProgress }) {
  const supplement = dataset.overture;
  // Both providers at once. Overpass and Overture share nothing but the study
  // area, so waiting for one before starting the other would just add the two
  // waits together.
  //
  // The tile budget is a download budget, so a supplement already stored has
  // no tiles to pull and the size check does not apply to it.
  const room = supplement ? checkSupplement(supplement, part.bbox) : { ok: false };
  const supStored = supplement && !room.ok ? await isSupplementCached(supplement, part.bbox) : null;

  const [osm, extra] = await Promise.all([
    // Cached per slug + bbox, so re-filtering never re-downloads.
    fetchDataset(dataset, part.bbox, { signal, onProgress }),
    // Overture is a supplement, never a requirement: if it is unavailable or
    // the area is too big for it, the dataset is still the dataset.
    room.ok || supStored
      ? fetchOvertureSupplement(supplement, part.bbox, { signal, onProgress }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const geojson = mergeProviders(osm, extra);
  // Overpass can only be asked for a rectangle, so trim the corners of that
  // rectangle back to the boundary the map is actually about. Clipping here
  // rather than at the end is what makes several areas work: each part is cut
  // to its *own* outline, so the ground between two distant areas never
  // arrives as data.
  return {
    geojson: state.clipToArea === false ? geojson : clipToArea(geojson, part.geojson),
    meta: geojson.meta,
  };
}

/**
 * Every study area's worth of one dataset, as a single collection.
 *
 * One request per area rather than one over a box covering them all — a
 * rectangle around Lagos and Kano is most of southern Nigeria, which no
 * public Overpass will answer and none of which the map is about.
 *
 * Areas are fetched one after another on purpose. They are separate queries
 * to a donated service, and the client already caps concurrency; firing a
 * state's worth of them at once is how a mirror starts refusing.
 */
async function fetchAllParts(dataset, parts, { signal, onProgress }) {
  const features = [];
  const seen = new Set();
  const metas = [];
  let duplicates = 0;

  for (const [i, part] of parts.entries()) {
    const where = parts.length > 1 ? `${part.name} · ${i + 1} of ${parts.length}` : '';
    const { geojson, meta } = await fetchForPart(dataset, part, {
      signal,
      onProgress: (msg) => onProgress(where ? `${msg}<br />${where}` : msg),
    });
    if (meta) metas.push(meta);

    for (const f of geojson.features ?? []) {
      // Study areas are allowed to overlap — an LGA and the state around it
      // are both reasonable things to add — and a feature in the overlap
      // comes back from both. OpenStreetMap ids are stable and unique, so the
      // second copy is dropped rather than drawn and counted twice.
      const id = f.id ?? f.properties?.['@id'] ?? null;
      if (id !== null) {
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
      }
      features.push(f);
    }
  }

  // The first part's provenance stands for the fetch: the cache note and the
  // Overture counts are about how the data arrived, and it arrived the same
  // way for each of them.
  const merged = metas.reduce((acc, m) => ({
    ...acc,
    ...m,
    merged: m.merged && acc.merged
      ? {
          ...m.merged,
          osm: acc.merged.osm + m.merged.osm,
          overtureAdded: acc.merged.overtureAdded + m.merged.overtureAdded,
          overtureDuplicates: acc.merged.overtureDuplicates + m.merged.overtureDuplicates,
        }
      : (m.merged ?? acc.merged),
  }), {});

  return {
    type: 'FeatureCollection',
    features,
    meta: { ...merged, ...(duplicates ? { areaOverlap: duplicates } : {}) },
  };
}

async function addDataset(dataset, { quiet = false } = {}) {
  const area = state.studyArea;
  if (!area) {
    notify.warn('Load a study area first — open data is fetched for that boundary.');
    setTool('area');
    return;
  }
  if (inflight.has(dataset.slug)) return;

  const parts = areaParts(area);

  // The size limit is about not asking a free public service for a whole
  // state — so it only applies if we would actually have to ask, and it
  // applies to each area separately, because each is its own query. A
  // download already sitting in a cache costs Overpass nothing to serve.
  for (const part of parts) {
    const size = checkSize(dataset, part.bbox);
    if (size.ok) continue;
    if (await isDatasetCached(dataset, part.bbox)) continue;
    // "Zoom in" is only half the answer, and it is the half that makes the
    // map smaller than the user wanted. The other half is that this area can
    // be fetched once, in pieces, into the database — after which it loads at
    // full size. Naming the command with this area already in it is the
    // difference between advice and something you can act on.
    notify.warn(
      `${parts.length > 1 ? `<b>${part.name}</b>: ` : ''}${size.reason}<br /><br />Or fetch ${part.name} into the offline database once — it is downloaded in pieces, so the limit does not apply, and it loads instantly from then on:<br /><code>npm run prefetch -- --areas "${prefetchName(part)}" --tile</code>`,
      { duration: 16000 },
    );
    return;
  }

  const controller = new AbortController();
  inflight.set(dataset.slug, controller);
  render();
  const status = notify.busy(`Fetching <b>${dataset.name}</b>…`);

  try {
    const clipped = await fetchAllParts(dataset, parts, {
      signal: controller.signal,
      onProgress: (msg) => status.update(`${msg}<br /><b>${dataset.name}</b>`),
    });

    if (!featureCount(clipped)) {
      status.update(
        `Neither OpenStreetMap nor Overture has <b>${dataset.name}</b> mapped inside ${area.name} yet.`,
        { tone: 'warn', duration: 7000 },
      );
      removeLayer(layerForSlug(dataset.slug)?.id);
      return;
    }

    tagAndTally(dataset, clipped);

    const pick = chosen.get(dataset.slug);
    const features = pick
      ? (clipped.features ?? []).filter((f) => pick.has(f.properties?.gds_class))
      : (clipped.features ?? []);

    if (!features.length) {
      status.update('None of the selected types are mapped in this area.', { tone: 'warn', duration: 6000 });
      removeLayer(layerForSlug(dataset.slug)?.id);
      return;
    }

    const filtered = { type: 'FeatureCollection', features };
    const symbology = symbologyFor(dataset, filtered);
    // Some Overture layers mix geometry types in one theme, so the kind is
    // read off the data when the catalogue does not commit to one.
    const kind = dataset.kind ?? dominantGeometry(filtered);
    // Lines carry a base thickness in millimetres of printed page;
    // layers/render.js turns it into the class-weighted pixel width the map
    // draws, so the number here stays something the thickness field can read
    // back and the user can type into.
    const style = { labelField: dataset.labelField ?? '' };
    if (kind === 'line') style.widthMm = DEFAULT_LINE_WIDTH_MM;
    if (kind === 'point') style.radius = 5;
    // The dataset's own symbol and line pattern — the fallback for anything
    // its classes have not overridden, and the whole story when it has none.
    if (dataset.symbol) style.icon = dataset.symbol;
    if (dataset.dash) style.dash = dataset.dash;

    const merged = clipped.meta?.merged;

    replaceBySlug(dataset.slug, {
      name: pick && dataset.segments ? `${dataset.name} (${pick.size} of ${dataset.segments.length} types)` : dataset.name,
      source: 'osm',
      geojson: filtered,
      kind,
      color: dataset.color,
      symbology,
      style,
      description: dataset.hint,
      // Carried so the layers panel and the printed credits can say who
      // actually contributed, rather than assuming one provider.
      meta: { merged: merged?.overtureAdded ? merged : null },
    });
    renderElements();

    if (dataset.segments?.length) expanded.add(dataset.slug);
    // Where it came from, in the user's terms. A cached layer arriving
    // instantly is worth saying out loud — it is the difference between the
    // app feeling broken and the app feeling fast — and the age is what tells
    // someone whether to think about refreshing it.
    const cached = clipped.meta?.cache;
    const via = cached
      ? ` from ${cached.source === 'database' ? 'the shared database' : 'cache'}${cached.ageDays > 1 ? `, stored ${cached.ageDays} days ago` : ''}`
      : (clipped.meta?.seconds ? ` in ${clipped.meta.seconds}s` : '');
    const plus = merged?.overtureAdded
      ? ` — ${formatNumber(merged.overtureAdded, 0)} added by Overture on top of OpenStreetMap`
      : '';
    // Worth saying when it happened: overlapping study areas are a legitimate
    // thing to have, and this is the app showing its working rather than
    // quietly returning a different number than the sum of the parts.
    const across = parts.length > 1
      ? ` across ${parts.length} areas${clipped.meta?.areaOverlap ? `, ${formatNumber(clipped.meta.areaOverlap, 0)} overlapping duplicates dropped` : ''}`
      : '';
    if (quiet) status.close();
    else status.update(`<b>${dataset.name}</b> · ${formatNumber(features.length, 0)} features${across}${via}${plus}.`, { tone: 'ok', duration: 5500 });
  } catch (err) {
    if (err.name === 'AbortError') status.close();
    else status.update(`Could not fetch ${dataset.name}. ${err.message}`, { tone: 'error', duration: 8000 });
  } finally {
    inflight.delete(dataset.slug);
    render();
  }
}

/**
 * One click, three sensible layers. Most maps of a place want the same
 * starting point, and picking them one at a time is the slow part.
 */
const STARTER = ['roads-major', 'rivers', 'settlements'];

async function addStarterPack() {
  if (!state.studyArea) {
    notify.warn('Load a study area first.');
    setTool('area');
    return;
  }
  const datasets = STARTER.map(datasetBySlug).filter(Boolean);
  const status = notify.busy(`Adding ${datasets.length} starter layers…`);
  // Deliberately concurrent — the client caps how many reach Overpass at once.
  await Promise.all(datasets.map((d) => addDataset(d, { quiet: true })));
  const got = datasets.filter((d) => layerForSlug(d.slug)).length;
  status.update(got
    ? `<b>${got} of ${datasets.length}</b> starter layers added.`
    : 'None of the starter layers came back — Overpass may be busy. Try again shortly.',
    { tone: got ? 'ok' : 'warn', duration: 5000 });
  render();
}

function toggleDataset(dataset) {
  const existing = layerForSlug(dataset.slug);
  if (existing) {
    removeLayer(existing.id);
    expanded.delete(dataset.slug);
    renderElements();
    render();
    return;
  }
  addDataset(dataset);
}

/** Include or exclude one class, re-filtering from the cached download. */
function toggleClass(dataset, label) {
  const all = segmentsOf(dataset).map((s) => s.value).concat('Other');
  const current = chosen.get(dataset.slug) ?? new Set(all);
  const next = new Set(current);
  if (next.has(label)) next.delete(label); else next.add(label);

  if (!next.size) {
    notify.info('Keep at least one type selected.');
    return;
  }
  // Everything selected is the same as no filter at all.
  if (next.size === all.length) chosen.delete(dataset.slug);
  else chosen.set(dataset.slug, next);

  if (layerForSlug(dataset.slug)) addDataset(dataset, { quiet: true });
  else render();
}

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */
async function handleFiles(files) {
  for (const file of files) {
    const status = notify.busy(`Reading <b>${file.name}</b>…`);
    try {
      const { geojson, name, format } = await parseGeoFile(file);
      const count = featureCount(geojson);
      if (!count) throw new Error('That file contained no features.');
      const layer = addVectorLayer({
        name,
        source: 'upload',
        geojson,
        color: '#7c3aed',
        description: `${format} · ${formatNumber(count, 0)} features`,
      });
      renderElements();
      const bbox = bboxOf(geojson);
      if (bbox) flyToBounds(boundsFromBbox(bbox));
      status.update(`<b>${name}</b> added — ${formatNumber(count, 0)} features from ${format}.`, { tone: 'ok', duration: 4500 });
      hint(`Open <b>Layers</b> to restyle “${layer.name}”.`);
    } catch (err) {
      status.update(err.message ?? 'Could not read that file.', { tone: 'error', duration: 8000 });
    }
  }
  render();
}

function dropZone() {
  const input = el('input', { type: 'file', accept: ACCEPTED, multiple: true, style: { display: 'none' } });
  input.addEventListener('change', () => { handleFiles(Array.from(input.files ?? [])); input.value = ''; });

  const zone = el('div', {
    style: {
      border: '1px dashed var(--line-strong)', borderRadius: '12px', padding: '16px 12px',
      textAlign: 'center', cursor: 'pointer', transition: 'all .15s', background: 'var(--surface-2)',
    },
  }, [
    el('div', { text: '⇪', style: { fontSize: '20px', color: 'var(--ink-faint)' } }),
    el('div', { text: 'Drop a file or click to browse', style: { fontSize: '12px', fontWeight: '600', marginTop: '4px' } }),
    el('div', { text: 'GeoJSON · KML · KMZ · GPX · CSV · zipped Shapefile', style: { fontSize: '10px', color: 'var(--ink-faint)', marginTop: '3px' } }),
    input,
  ]);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-bright)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--line-strong)'; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = 'var(--line-strong)';
    handleFiles(Array.from(e.dataTransfer?.files ?? []));
  });
  return zone;
}

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

/** The tick-list of classes under a segmented dataset. */
function categoryPicker(dataset) {
  const segs = segmentsOf(dataset);
  const tally = counts.get(dataset.slug);
  const pick = chosen.get(dataset.slug);
  const isOn = (label) => !pick || pick.has(label);

  const chips = segs.map((seg) => {
    const n = tally?.get(seg.value);
    const on = isOn(seg.value);
    const chip = el('button', {
      type: 'button',
      title: on ? `Hide ${seg.label}` : `Show ${seg.label}`,
      style: {
        display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
        border: `1px solid ${on ? 'var(--accent-soft)' : 'var(--line)'}`,
        background: on ? 'var(--accent-wash)' : 'transparent',
        borderRadius: '7px', padding: '4px 7px', cursor: 'pointer',
        opacity: on ? '1' : '0.55', transition: 'all .12s',
      },
    }, [
      // Show the mark this class will actually arrive with, not a generic
      // square — picking types is easier when you can see them.
      dataset.kind === 'point' && seg.icon
        ? el('span', { html: iconSvg(seg.icon, seg.color, 13), style: { flex: 'none' } })
        : el('span', {
            style: {
              width: '10px', height: '10px', flex: 'none', borderRadius: '3px',
              background: seg.color, border: '1px solid rgba(var(--shadow-tint),.15)',
            },
          }),
      el('span', {
        text: seg.label,
        style: { fontSize: '11.5px', fontWeight: on ? '600' : '500', color: 'var(--ink)', flex: '1', textAlign: 'left' },
      }),
      el('span', {
        text: n === undefined ? '' : formatNumber(n, 0),
        style: { fontSize: '10.5px', color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' },
      }),
      el('span', { text: on ? '✓' : '', style: { fontSize: '10px', color: 'var(--accent)', width: '8px' } }),
    ]);
    chip.addEventListener('click', (e) => { e.stopPropagation(); toggleClass(dataset, seg.value); });
    return chip;
  });

  const all = segs.map((s) => s.value).concat('Other');
  const setAll = (labels) => {
    if (labels.length === all.length) chosen.delete(dataset.slug);
    else chosen.set(dataset.slug, new Set(labels));
    if (layerForSlug(dataset.slug)) addDataset(dataset, { quiet: true });
    else render();
  };

  return el('div', {
    style: {
      margin: '2px 0 8px 36px', padding: '8px', display: 'grid', gap: '4px',
      borderLeft: '2px solid var(--accent-soft)', background: 'var(--surface-2)',
      borderRadius: '0 8px 8px 0',
    },
  }, [
    el('div', {
      text: tally ? 'Types found here — click to show or hide' : 'Types this dataset contains',
      style: { fontSize: '10px', color: 'var(--ink-faint)', marginBottom: '2px' },
    }),
    ...chips,
    el('div', { style: { display: 'flex', gap: '5px', marginTop: '4px' } }, [
      (() => {
        const b = el('button.btn-ghost', { type: 'button', text: 'All', style: { flex: '1', padding: '3px 0', fontSize: '11px' } });
        b.addEventListener('click', (e) => { e.stopPropagation(); setAll(all); });
        return b;
      })(),
      (() => {
        const b = el('button.btn-ghost', { type: 'button', text: 'Only major', style: { flex: '1', padding: '3px 0', fontSize: '11px' } });
        b.addEventListener('click', (e) => { e.stopPropagation(); setAll(segs.slice(0, Math.max(1, Math.ceil(segs.length / 2))).map((s) => s.value)); });
        return b;
      })(),
    ]),
  ]);
}

function datasetRow(dataset) {
  const added = Boolean(layerForSlug(dataset.slug));
  const loading = inflight.has(dataset.slug);
  const segs = dataset.segments?.length ?? 0;
  const pick = chosen.get(dataset.slug);

  const actions = [];
  if (loading) {
    // Stopping a download and deleting the layer it produced are different
    // enough to deserve different marks — a cross dismisses, a bin destroys.
    actions.push(miniBtn(uiIcon('close'), 'Cancel this fetch', () => {
      inflight.get(dataset.slug)?.abort();
      inflight.delete(dataset.slug);
      render();
    }));
  }
  if (segs) {
    actions.push(miniBtn(chevron(expanded.has(dataset.slug)), 'Choose which types to show', () => {
      if (expanded.has(dataset.slug)) expanded.delete(dataset.slug);
      else expanded.add(dataset.slug);
      render();
    }));
  }
  if (added) actions.push(miniBtn(uiIcon('trash'), 'Remove this layer', () => toggleDataset(dataset), { danger: true }));

  const sub = loading
    ? 'Fetching…'
    : pick
      ? `${pick.size} of ${segs} types shown`
      : dataset.hint;

  const node = row({
    icon: loading ? el('span.spinner.spinner--ink') : dataset.icon,
    title: dataset.name,
    sub,
    active: added,
    onClick: () => toggleDataset(dataset),
    actions,
  });

  // Rows that pull from both say so. It is a note, not a choice — there is
  // nothing to pick, and the merge happens either way.
  if (isMerged(dataset)) {
    node.querySelector('.row-title')?.append(el('span.provider-tag', {
      text: '+ Overture',
      title: 'OpenStreetMap plus Overture Maps — fetched together, duplicates removed, shown as one layer.',
      'data-provider': 'overture',
    }));
  }

  // Always show the picker for segmented datasets when expanded, so the
  // choice can be made *before* downloading anything.
  if (segs && expanded.has(dataset.slug)) {
    return el('div', {}, [node, categoryPicker(dataset)]);
  }
  return node;
}

/* ------------------------------------------------------------------ */
export function render() {
  pane = pane ?? $('#pane-data');
  if (!pane) return;

  const area = state.studyArea;
  const groups = GROUPS.map((g, i) =>
    group(g.label, datasetsInGroup(g.id).map(datasetRow), i === 0));

  const parts = areaParts(area);

  fill(pane, [
    head('Data', area
      ? `Open data for ${area.name}. Click a dataset to add it.`
      : 'Add open map data, or bring your own file.'),
    area ? null : el('div.panel-section', {}, [
      empty('Open data is fetched for a study area.<br />Pick one first.'),
      button('Choose a study area', () => setTool('area'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
    ]),
    area ? section('Quick start', stack([
      button('Add roads, rivers & settlements', addStarterPack, 'primary', { style: { width: '100%' } }),
      el('p', {
        style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
        text: parts.length > 1
          ? `The three layers most maps start with — fetched for each of your ${parts.length} areas and merged.`
          : 'The three layers most maps start with, fetched together.',
      }),
      checkRow(
        parts.length > 1 ? `Clip data to your ${parts.length} areas` : `Clip data to ${area.name}`,
        state.clipToArea !== false,
        reclip,
        'Off keeps the surrounding context that came with the download.',
      ),
    ])) : null,
    ...groups,
    section('Your own data', stack([dropZone()])),
  ]);
}

export function initDataPane() {
  pane = $('#pane-data');
  render();
  subscribe(['layers', 'studyArea', 'studyAreas'], () => { if (state.activeTool === 'data') render(); });
}

export { render as renderDataPane };
