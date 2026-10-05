/**
 * The layer registry — one flat, ordered list of everything drawn on top
 * of the basemap, whatever it came from (OSM, an upload, a boundary
 * lookup or an Earth Engine job). Panels, the legend element and the
 * export all read from this single list.
 */

import { state, set, touch } from '../core/store.js';
import { uid } from '../core/dom.js';
import { dominantGeometry, featureCount, bboxOf } from '../core/geo.js';
import { singleSymbology, paintColor, legendRowsFor, shade, DEFAULT_LINE_WIDTH_MM } from './symbology.js';

export { shade };

/** Sensible default paint for a newly added vector layer. */
export function defaultStyle(kind, color = '#0369a1') {
  return {
    fill: color,
    fillOpacity: kind === 'polygon' ? 0.35 : 0,
    stroke: kind === 'polygon' ? shade(color, -0.25) : color,
    strokeWidth: kind === 'line' ? 1.6 : 1.2,
    // Line work carries its own thickness, separate from the outline width a
    // polygon or a point uses, because on a line layer it is the subject
    // rather than an edge around one. Millimetres of printed page;
    // layers/render.js converts to the pixels the map paints in.
    ...(kind === 'line' ? { widthMm: DEFAULT_LINE_WIDTH_MM } : {}),
    strokeOpacity: 1,
    dash: 'solid',            // a LINE_STYLES id
    icon: '',                 // point symbol id, '' for a plain circle
    radius: 4,                // point radius
    labelField: '',           // property name to label with
    labelSize: 11,
  };
}

/**
 * Recompute a layer's paint and legend from its symbology.
 *
 * This is the one place the two are derived, which is what guarantees the
 * printed legend shows the colours actually on the map.
 */
export function refreshSymbology(layer) {
  if (layer.type === 'raster') return layer;
  const sym = layer.symbology ?? singleSymbology(layer.style?.fill ?? '#0369a1');
  layer.symbology = sym;

  if (sym.mode === 'single') {
    layer.style.fill = sym.color;
    // Lines and points read by their stroke, so keep it in step.
    if (layer.kind !== 'polygon') layer.style.stroke = sym.color;
  } else {
    layer.style.fill = paintColor(sym, '#0369a1');
    if (layer.kind !== 'polygon') layer.style.stroke = layer.style.fill;
  }

  layer.legend = legendRowsFor(layer);
  return layer;
}

/**
 * Add a vector layer.
 * @param {object} spec
 * @param {string} spec.name
 * @param {object} spec.geojson
 * @param {'osm'|'upload'|'boundary'|'analysis'|'sample'} spec.source
 */
export function addVectorLayer(spec) {
  const kind = spec.kind ?? dominantGeometry(spec.geojson);
  const layer = {
    id: spec.id ?? uid('lyr'),
    name: spec.name ?? 'Untitled layer',
    source: spec.source ?? 'upload',
    type: 'vector',
    kind,
    geojson: spec.geojson,
    bbox: bboxOf(spec.geojson),
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 1,
    // Draw beneath the basemap's place names — analysis results and land
    // cover read much better with labels still on top.
    underLabels: spec.underLabels ?? false,
    symbology: spec.symbology ?? singleSymbology(spec.color ?? '#0369a1'),
    style: { ...defaultStyle(kind, spec.color ?? '#0369a1'), ...(spec.style ?? {}) },
    legend: [],
    meta: {
      count: featureCount(spec.geojson),
      addedAt: Date.now(),
      description: spec.description ?? '',
      ...(spec.meta ?? {}),
    },
  };
  refreshSymbology(layer);
  set({ layers: [...state.layers, layer] }, { history: false });
  return layer;
}

/** Give a layer a new symbology; paint and legend follow automatically. */
export function applySymbology(id, symbology) {
  const layer = getLayer(id);
  if (!layer) return null;
  layer.symbology = symbology;
  refreshSymbology(layer);
  touch('layers');
  return layer;
}

/** Add a raster result layer (Earth Engine tiles, or any XYZ template). */
export function addRasterLayer(spec) {
  const layer = {
    id: spec.id ?? uid('lyr'),
    name: spec.name ?? 'Raster result',
    source: spec.source ?? 'analysis',
    type: 'raster',
    tileUrl: spec.tileUrl,
    visible: spec.visible ?? true,
    opacity: spec.opacity ?? 0.85,
    underLabels: spec.underLabels ?? false,
    bbox: spec.bbox ?? null,
    style: {},
    legend: spec.legend ?? [],
    meta: { addedAt: Date.now(), description: spec.description ?? '', ...(spec.meta ?? {}) },
  };
  set({ layers: [...state.layers, layer] }, { history: false });
  return layer;
}

export const getLayer = (id) => state.layers.find((l) => l.id === id) ?? null;
export const findBySource = (source) => state.layers.filter((l) => l.source === source);
export const visibleLayers = () => state.layers.filter((l) => l.visible);

export function updateLayer(id, patch) {
  const layer = getLayer(id);
  if (!layer) return null;
  // `style` is merged, not replaced — pull it out first, or Object.assign
  // would overwrite the whole style object and the merge below would have
  // nothing left to merge into.
  const { style, ...rest } = patch;
  Object.assign(layer, rest);
  if (style) {
    layer.style = { ...layer.style, ...style };
    // A colour picked in the inspector is a single-symbology edit; fold it
    // back into the symbology so the legend follows.
    if (layer.symbology?.mode === 'single' && typeof style.fill === 'string') {
      layer.symbology = { ...layer.symbology, color: style.fill };
    }
  }
  if (layer.type !== 'raster') refreshSymbology(layer);
  touch('layers');
  return layer;
}

export function removeLayer(id) {
  set({ layers: state.layers.filter((l) => l.id !== id) }, { history: false });
}

export function toggleLayer(id, visible) {
  const layer = getLayer(id);
  if (!layer) return;
  layer.visible = visible ?? !layer.visible;
  touch('layers');
}

/** Move a layer up (+1, towards the top of the map) or down (-1). */
export function reorderLayer(id, delta) {
  const list = [...state.layers];
  const i = list.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  set({ layers: list }, { history: false });
}

/** Replace an existing layer that came from the same catalogue entry. */
export function replaceBySlug(slug, spec) {
  const existing = state.layers.find((l) => l.meta?.slug === slug);
  if (existing) removeLayer(existing.id);
  return addVectorLayer({ ...spec, meta: { ...(spec.meta ?? {}), slug } });
}

/** Every legend entry across visible layers, deduplicated by label+colour. */
export function collectLegend() {
  const seen = new Set();
  const out = [];
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const item of layer.legend ?? []) {
      const key = `${item.label}|${item.color}|${item.icon ?? ''}|${item.dash ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, layerId: layer.id });
    }
  }
  return out;
}
