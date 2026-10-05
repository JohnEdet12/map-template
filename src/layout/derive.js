/**
 * Derived content for "smart" elements.
 *
 * The legend, stats, metadata, scale bar and credits elements do not
 * store their own text — they read the live document, so adding a layer
 * or running an analysis updates the printed map automatically. Users
 * can still override any of it in the inspector.
 */

import { state } from '../core/store.js';
import { collectLegend } from '../layers/registry.js';
import { APP, PAPER_SIZES, attributionFor, basemapSpec } from '../core/constants.js';
import { formatArea, formatNumber, formatDMS, metresPerPixel, niceScaleBar } from '../core/geo.js';

/**
 * Legend rows for the current document. `swatch: 'ramp'` is passed through
 * untouched — the legend element groups consecutive ramp rows into one
 * gradient bar rather than a column of squares.
 */
export function legendRows() {
  return collectLegend().map(({ label, color, swatch, icon, dash, width }) => ({
    label,
    color,
    swatch: swatch ?? 'polygon',
    // Carried so the printed swatch is the mark the map actually draws —
    // a cross for hospitals, a dashed rule for a proposed road, a trunk road
    // heavier than the service road below it.
    icon: icon ?? '',
    dash: dash ?? 'solid',
    ...(width ? { width } : {}),
  }));
}

/**
 * Study-area and analysis figures as label → value rows.
 * Analysis tools return their own rows, so this needs no per-tool knowledge.
 */
export function statsRows() {
  const rows = [];
  const sa = state.studyArea;
  if (sa) {
    rows.push({ label: 'Study area', value: sa.name, emphasis: true });
    rows.push({ label: 'Approx. area', value: formatArea(sa.areaKm2) });
  }

  const dataLayers = state.layers.filter((l) => l.source === 'osm' || l.source === 'overture' || l.source === 'upload');
  if (dataLayers.length) {
    const total = dataLayers.reduce((sum, l) => sum + (l.meta?.count ?? 0), 0);
    rows.push({ label: 'Mapped features', value: formatNumber(total, 0) });
  }

  const run = state.analysisRuns[state.analysisRuns.length - 1];
  for (const row of run?.result?.stats ?? []) rows.push(row);

  if (!rows.length) rows.push({ label: 'Study area', value: 'Not set yet', muted: true });
  return rows;
}

/** Map-information block: who, when, what projection, which sources. */
export function metadataRows() {
  const paper = PAPER_SIZES[state.page.size];
  const { center, zoom } = state.mapView;
  const sources = new Set();
  if (state.layers.some((l) => l.source === 'osm' || l.source === 'boundary')) sources.add('OpenStreetMap');
  // Overture is a conflation, so it earns its own line on the printed map
  // rather than hiding under the OpenStreetMap credit it partly derives from.
  if (state.layers.some((l) => l.meta?.merged?.overtureAdded)) sources.add('Overture Maps');
  if (state.layers.some((l) => l.source === 'upload')) sources.add('User data');
  if (state.analysisRuns.length) sources.add('On-device analysis');
  // Named, not assumed: "OpenFreeMap basemap" was hard-coded here and is wrong
  // on nine of the twelve basemaps this studio now offers.
  sources.add(`${basemapSpec(state.basemap).label} basemap`);

  // With several study areas the block names all of them. The title can say
  // "Lagos and 2 other areas" and still be a title; map information is where
  // a reader goes to find out which two, and it has to answer.
  const parts = state.studyArea?.parts ?? [];

  return [
    { label: 'Prepared by', value: APP.org },
    ...(parts.length > 1
      ? [{ label: 'Study areas', value: parts.map((p) => p.name).join(', ') }]
      : []),
    { label: 'Date', value: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) },
    { label: 'Projection', value: 'WGS 84 / Web Mercator (EPSG:3857)' },
    { label: 'Centre', value: `${formatDMS(center[1], 'lat')}, ${formatDMS(center[0], 'lng')}` },
    { label: 'Page', value: `${paper.label} ${state.page.orientation} · ${state.page.dpi} dpi` },
    { label: 'Zoom level', value: zoom.toFixed(1) },
    { label: 'Sources', value: Array.from(sources).join(', ') },
  ];
}

/** Attribution line, plus a note on any assumption-based analysis. */
export function creditsText() {
  // The basemap names itself: these are no longer all OpenStreetMap, and a
  // satellite map crediting OpenFreeMap is a false statement on a printed page.
  const parts = [attributionFor(state.basemap)];
  // Only credited when Overture actually contributed features — a map whose
  // layers came back entirely from OpenStreetMap should not claim otherwise.
  if (state.layers.some((l) => l.meta?.merged?.overtureAdded)) {
    parts.push('Overture Maps data © Overture Maps Foundation, from OpenStreetMap (ODbL), Google Open Buildings, Microsoft and Esri.');
  }
  if (state.analysisRuns.some((r) => r.result.toolId === 'volume')) {
    parts.push('Volume figures are area × assumed depth — a planning estimate, not a surveyed volume.');
  }
  if (state.analysisRuns.some((r) => r.result.toolId === 'nearest')) {
    parts.push('Distances are straight-line, not measured along roads.');
  }
  return parts.join(' ');
}

/**
 * Scale-bar geometry, computed once against the on-screen artboard so
 * the printed bar represents the same ground distance as the preview.
 * @param {number} availableScreenPx  usable width of the element on screen
 * @returns {{ label: string, fraction: number, metres: number }}
 */
export function scaleBarFor(availableScreenPx, mPerPx) {
  const usable = Math.max(24, availableScreenPx);
  const bar = niceScaleBar(usable * 0.92, mPerPx);
  return { label: bar.label, metres: bar.metres, fraction: Math.min(1, bar.px / usable) };
}

/** Metres per screen pixel at the current camera. */
export function currentMetresPerPixel() {
  const { center, zoom } = state.mapView;
  return metresPerPixel(center[1], zoom);
}

/** Everything an element renderer might need, computed once per pass. */
export function buildRenderContext({ W, H, artWScreen, media }) {
  const u = (pt) => (pt ?? 0) * 0.001 * W;
  return {
    W, H, u, media,
    artWScreen: artWScreen ?? W,
    scale: W / (artWScreen ?? W),
    mPerPx: currentMetresPerPixel(),
    state,
    legendRows,
    statsRows,
    metadataRows,
    creditsText,
    scaleBarFor,
  };
}
