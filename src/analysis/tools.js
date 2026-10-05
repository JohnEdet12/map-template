/**
 * Analysis tools — simple, honest geoprocessing.
 *
 * Every tool here runs for real, in the browser, on the layers already on
 * your map. Nothing is simulated: a buffer is a buffer, an area is computed
 * from the geometry, a distance is measured on the ellipsoid. Each tool is
 * named for the question it answers rather than the operation it performs.
 *
 * Adding a tool = adding an entry to TOOLS. Nothing else changes.
 */

import turfBuffer from '@turf/buffer';
import turfArea from '@turf/area';
import turfIntersect from '@turf/intersect';
import turfDistance from '@turf/distance';
import turfLength from '@turf/length';
import turfCentroid from '@turf/centroid';

import { pointInGeoJson, formatNumber, formatArea } from '../core/geo.js';
import { graduatedSymbology, categorisedSymbology, singleSymbology, valuesIn } from '../layers/symbology.js';

const unwrap = (m) => (typeof m === 'function' ? m : m.default);
const buffer = unwrap(turfBuffer);
const area = unwrap(turfArea);
const intersect = unwrap(turfIntersect);
const distance = unwrap(turfDistance);
const lengthOf = unwrap(turfLength);
const centroid = unwrap(turfCentroid);

export const TOOL_CATEGORIES = [
  { id: 'proximity', label: 'Distance & proximity' },
  { id: 'overlay',   label: 'Overlay & selection' },
  { id: 'measure',   label: 'Measurement' },
  { id: 'pattern',   label: 'Patterns & density' },
];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const featuresOf = (layer) => layer?.geojson?.features ?? [];
const fc = (features) => ({ type: 'FeatureCollection', features });

/** Representative point for any geometry. */
function pointOf(feature) {
  try { return centroid(feature).geometry.coordinates; } catch { return null; }
}

/** Square grid over a bbox, in kilometres, clipped to an optional boundary. */
function gridCells(bbox, cellKm, clipTo) {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const dLat = cellKm / 110.57;
  const dLng = cellKm / (111.32 * Math.max(0.15, Math.cos((midLat * Math.PI) / 180)));

  const cols = Math.ceil((e - w) / dLng);
  const rows = Math.ceil((n - s) / dLat);
  // A runaway cell count locks the tab; refuse instead.
  if (cols * rows > 40000) return null;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = w + c * dLng;
      const y0 = s + r * dLat;
      const x1 = x0 + dLng;
      const y1 = y0 + dLat;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (clipTo && !pointInGeoJson([cx, cy], clipTo)) continue;
      cells.push({ x0, y0, x1, y1, cx, cy, polygon: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
    }
  }
  return cells;
}

const cellFeature = (cell, properties) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: cell.polygon },
  properties,
});

/** Every polygon ring set in a layer, for point-in-polygon work. */
const polygonFeatures = (layer) =>
  featuresOf(layer).filter((f) => (f.geometry?.type ?? '').includes('Polygon'));

/* ------------------------------------------------------------------ */
/* the catalogue                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} AnalysisTool
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} icon
 * @property {string} question   what a non-specialist would ask
 * @property {string} blurb
 * @property {Array}  params     rendered by the Analysis panel
 * @property {'polygon'|'line'|'point'} kind   geometry of the result
 * @property {(ctx) => object} run
 */

/** @type {AnalysisTool[]} */
export const TOOLS = [
  /* ---------------- proximity ------------------------------------- */
  {
    id: 'buffer',
    name: 'Buffer zone',
    category: 'proximity',
    icon: '◎',
    question: 'What falls within a certain distance of these features?',
    blurb: 'Draws a zone of the distance you choose around every feature in a layer — a flood setback, a service radius, a safety margin.',
    kind: 'polygon',
    params: [
      { key: 'layer', label: 'Around which layer', type: 'layer', kinds: ['point', 'line', 'polygon'] },
      { key: 'distance', label: 'Distance', type: 'range', min: 0.1, max: 25, step: 0.1, default: 1, suffix: ' km' },
    ],
    run({ layers, params }) {
      const src = layers.layer;
      const radius = Number(params.distance) || 1;
      const out = [];
      for (const f of featuresOf(src)) {
        try {
          const zone = buffer(f, radius, { units: 'kilometers' });
          if (zone) out.push({ ...zone, properties: { ...f.properties, buffer_km: radius } });
        } catch { /* skip a geometry turf cannot buffer */ }
      }
      if (!out.length) throw new Error(`Could not build zones around “${src.name}”.`);

      const km2 = area(fc(out)) / 1e6;
      return {
        name: `${radius} km around ${src.name}`,
        geojson: fc(out),
        kind: 'polygon',
        symbology: singleSymbology('#0ea5e9'),
        style: { fillOpacity: 0.22, strokeWidth: 1.4, stroke: '#0369a1' },
        stats: [
          { label: 'Zones drawn', value: formatNumber(out.length, 0) },
          { label: 'Distance', value: `${radius} km` },
          { label: 'Total zone area', value: formatArea(km2) },
        ],
        summary: `${formatNumber(out.length, 0)} zones of ${radius} km drawn around ${src.name}, covering ${formatArea(km2)} in total (overlapping zones counted more than once).`,
      };
    },
  },

  {
    id: 'nearest',
    name: 'Nearest facility',
    category: 'proximity',
    icon: '⟿',
    question: 'How far is everyone from the nearest facility?',
    blurb: 'Joins every feature in one layer to its closest feature in another and measures the straight-line distance — the standard "how far to the nearest clinic" question.',
    kind: 'line',
    params: [
      { key: 'from', label: 'From (places)', type: 'layer', kinds: ['point', 'polygon'] },
      { key: 'to', label: 'To nearest (facilities)', type: 'layer', kinds: ['point', 'polygon'] },
    ],
    run({ layers }) {
      const from = layers.from;
      const to = layers.to;
      const targets = featuresOf(to).map((f) => ({ f, pt: pointOf(f) })).filter((t) => t.pt);
      if (!targets.length) throw new Error(`“${to.name}” has no features to measure to.`);

      const lines = [];
      let sum = 0;
      let min = Infinity;
      let max = 0;

      for (const f of featuresOf(from)) {
        const origin = pointOf(f);
        if (!origin) continue;
        let best = null;
        let bestKm = Infinity;
        for (const t of targets) {
          const km = distance(origin, t.pt, { units: 'kilometers' });
          if (km < bestKm) { bestKm = km; best = t; }
        }
        if (!best) continue;
        sum += bestKm;
        min = Math.min(min, bestKm);
        max = Math.max(max, bestKm);
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [origin, best.pt] },
          properties: {
            distance_km: Number(bestKm.toFixed(3)),
            from_name: f.properties?.name ?? '',
            to_name: best.f.properties?.name ?? '',
          },
        });
      }
      if (!lines.length) throw new Error('Neither layer had usable coordinates.');

      const mean = sum / lines.length;
      const geojson = fc(lines);
      return {
        name: `${from.name} → nearest ${to.name}`,
        geojson,
        kind: 'line',
        symbology: graduatedSymbology(geojson, 'distance_km', { ramp: 'risk', unit: 'km' }),
        style: { strokeWidth: 1.6 },
        stats: [
          { label: 'Connections', value: formatNumber(lines.length, 0) },
          { label: 'Average distance', value: `${formatNumber(mean)} km`, emphasis: true },
          { label: 'Shortest', value: `${formatNumber(min)} km` },
          { label: 'Furthest', value: `${formatNumber(max)} km` },
        ],
        summary: `On average ${formatNumber(mean)} km from ${from.name} to the nearest ${to.name}; the furthest is ${formatNumber(max)} km. Distances are straight-line, not along roads.`,
      };
    },
  },

  /* ---------------- overlay --------------------------------------- */
  {
    id: 'clip',
    name: 'Clip to boundary',
    category: 'overlay',
    icon: '⊓',
    question: 'How do I keep only the part inside my area?',
    blurb: 'Cuts a layer down to what falls inside a boundary — your study area, a district, a catchment.',
    kind: 'polygon',
    params: [
      { key: 'layer', label: 'Layer to clip', type: 'layer', kinds: ['point', 'line', 'polygon'] },
      { key: 'boundary', label: 'Clip to', type: 'layer', kinds: ['polygon'], allowStudyArea: true },
    ],
    run({ layers, area: studyArea }) {
      const src = layers.layer;
      const boundaryLayer = layers.boundary;
      const boundary = boundaryLayer?.geojson ?? studyArea?.geojson;
      if (!boundary) throw new Error('Pick a boundary to clip to.');

      const kept = [];
      const clippers = polygonFeatures({ geojson: boundary });

      for (const f of featuresOf(src)) {
        const type = f.geometry?.type ?? '';
        if (type.includes('Point')) {
          const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : pointOf(f);
          if (pt && pointInGeoJson(pt, boundary)) kept.push(f);
        } else if (type.includes('Polygon')) {
          let piece = null;
          for (const c of clippers) {
            try {
              const cut = intersect(fc([f, c]));
              if (cut) { piece = { ...cut, properties: f.properties }; break; }
            } catch { /* non-noded geometry — fall through to the centroid test */ }
          }
          if (piece) kept.push(piece);
          else if (pointOf(f) && pointInGeoJson(pointOf(f), boundary)) kept.push(f);
        } else {
          // Lines: kept whole when any vertex falls inside. Splitting lines
          // needs a topology engine this app deliberately does not carry.
          const coords = f.geometry?.coordinates?.flat(Infinity) ?? [];
          let inside = false;
          for (let i = 0; i < coords.length - 1; i += 2) {
            if (pointInGeoJson([coords[i], coords[i + 1]], boundary)) { inside = true; break; }
          }
          if (inside) kept.push(f);
        }
      }

      const before = featuresOf(src).length;
      if (!kept.length) throw new Error(`Nothing in “${src.name}” falls inside that boundary.`);

      return {
        name: `${src.name} (clipped)`,
        geojson: fc(kept),
        kind: src.kind,
        symbology: src.symbology ?? singleSymbology(src.style?.fill ?? '#0369a1'),
        style: { ...src.style },
        stats: [
          { label: 'Kept', value: formatNumber(kept.length, 0), emphasis: true },
          { label: 'Removed', value: formatNumber(before - kept.length, 0) },
          { label: 'Started with', value: formatNumber(before, 0) },
        ],
        summary: `${formatNumber(kept.length, 0)} of ${formatNumber(before, 0)} features in ${src.name} fall inside the boundary.`,
      };
    },
  },

  {
    id: 'count-in',
    name: 'Count inside areas',
    category: 'overlay',
    icon: '⊞',
    question: 'How many of these are in each district?',
    blurb: 'Counts the points of one layer inside each polygon of another and shades the polygons by the result.',
    kind: 'polygon',
    params: [
      { key: 'points', label: 'Count which layer', type: 'layer', kinds: ['point'] },
      { key: 'areas', label: 'Inside which areas', type: 'layer', kinds: ['polygon'], allowStudyArea: true },
    ],
    run({ layers, area: studyArea }) {
      const points = layers.points;
      const areasLayer = layers.areas;
      const areasGeo = areasLayer?.geojson ?? studyArea?.geojson;
      if (!areasGeo) throw new Error('Pick the areas to count inside.');

      const pts = featuresOf(points)
        .map((f) => (f.geometry?.type === 'Point' ? f.geometry.coordinates : pointOf(f)))
        .filter(Boolean);

      const out = [];
      let total = 0;
      let max = 0;

      for (const poly of polygonFeatures({ geojson: areasGeo })) {
        const single = fc([poly]);
        let count = 0;
        for (const pt of pts) if (pointInGeoJson(pt, single)) count++;
        total += count;
        max = Math.max(max, count);
        out.push({ ...poly, properties: { ...poly.properties, count } });
      }
      if (!out.length) throw new Error('That layer has no polygons to count inside.');

      const geojson = fc(out);
      return {
        name: `${points.name} per area`,
        geojson,
        kind: 'polygon',
        symbology: graduatedSymbology(geojson, 'count', { ramp: 'water', unit: '' }),
        style: { fillOpacity: 0.75, strokeWidth: 0.6, stroke: '#ffffff' },
        stats: [
          { label: 'Areas', value: formatNumber(out.length, 0) },
          { label: `Total ${points.name.toLowerCase()}`, value: formatNumber(total, 0), emphasis: true },
          { label: 'Busiest area holds', value: formatNumber(max, 0) },
          { label: 'Average per area', value: formatNumber(total / out.length) },
        ],
        summary: `${formatNumber(total, 0)} ${points.name.toLowerCase()} across ${out.length} areas — the busiest holds ${formatNumber(max, 0)}.`,
      };
    },
  },

  /* ---------------- measurement ----------------------------------- */
  {
    id: 'area',
    name: 'Calculate area',
    category: 'measure',
    icon: '▭',
    question: 'How big is each of these?',
    blurb: 'Measures every polygon on the ellipsoid, adds the figure to each feature and shades the layer from smallest to largest.',
    kind: 'polygon',
    params: [
      { key: 'layer', label: 'Which layer', type: 'layer', kinds: ['polygon'] },
    ],
    run({ layers }) {
      const src = layers.layer;
      const out = [];
      let total = 0;
      let largest = null;

      for (const f of polygonFeatures(src)) {
        const km2 = area(f) / 1e6;
        total += km2;
        const feature = { ...f, properties: { ...f.properties, area_km2: Number(km2.toFixed(4)) } };
        if (!largest || km2 > largest.km2) largest = { km2, name: f.properties?.name ?? '' };
        out.push(feature);
      }
      if (!out.length) throw new Error(`“${src.name}” has no polygons to measure.`);

      const geojson = fc(out);
      return {
        name: `${src.name} — area`,
        geojson,
        kind: 'polygon',
        symbology: graduatedSymbology(geojson, 'area_km2', { ramp: 'earth', unit: 'km²' }),
        style: { fillOpacity: 0.75, strokeWidth: 0.6, stroke: '#ffffff' },
        stats: [
          { label: 'Features measured', value: formatNumber(out.length, 0) },
          { label: 'Total area', value: formatArea(total), emphasis: true },
          { label: 'Average', value: formatArea(total / out.length) },
          largest?.name ? { label: 'Largest', value: `${largest.name} · ${formatArea(largest.km2)}` } : null,
        ].filter(Boolean),
        summary: `${formatNumber(out.length, 0)} features in ${src.name} cover ${formatArea(total)} in total.`,
      };
    },
  },

  {
    id: 'length',
    name: 'Measure network',
    category: 'measure',
    icon: '⌇',
    question: 'How much road or river is there?',
    blurb: 'Totals the length of a line layer, broken down by class where the data has one.',
    kind: 'line',
    params: [
      { key: 'layer', label: 'Which layer', type: 'layer', kinds: ['line'] },
    ],
    run({ layers, studyAreaKm2 }) {
      const src = layers.layer;
      const out = [];
      let total = 0;
      const byClass = new Map();

      for (const f of featuresOf(src)) {
        if (!(f.geometry?.type ?? '').includes('LineString')) continue;
        let km = 0;
        try { km = lengthOf(f, { units: 'kilometers' }); } catch { continue; }
        total += km;
        const klass = f.properties?.gds_class ?? 'Other';
        byClass.set(klass, (byClass.get(klass) ?? 0) + km);
        out.push({ ...f, properties: { ...f.properties, length_km: Number(km.toFixed(3)) } });
      }
      if (!out.length) throw new Error(`“${src.name}” has no lines to measure.`);

      const ranked = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]);
      const geojson = fc(out);
      const classes = valuesIn(geojson, 'gds_class');

      const stats = [
        { label: 'Segments', value: formatNumber(out.length, 0) },
        { label: 'Total length', value: `${formatNumber(total)} km`, emphasis: true },
        ...ranked.slice(0, 4).map(([k, v]) => ({ label: k, value: `${formatNumber(v)} km` })),
      ];
      if (studyAreaKm2 > 0) {
        stats.push({ label: 'Density', value: `${formatNumber(total / studyAreaKm2, 2)} km per km²` });
      }

      return {
        name: `${src.name} — length`,
        geojson,
        kind: 'line',
        symbology: classes.length > 1
          ? categorisedSymbology('gds_class', classes, 'viridis')
          : graduatedSymbology(geojson, 'length_km', { ramp: 'water', unit: 'km' }),
        style: { strokeWidth: 1.8 },
        stats,
        summary: `${formatNumber(total)} km of ${src.name.toLowerCase()} across ${formatNumber(out.length, 0)} segments${ranked.length > 1 ? `, mostly ${ranked[0][0].toLowerCase()}` : ''}.`,
      };
    },
  },

  {
    id: 'volume',
    name: 'Estimate volume',
    category: 'measure',
    icon: '⬢',
    question: 'How much water, fill or material does this hold?',
    blurb: 'Multiplies each polygon’s measured area by a depth or height you supply. A planning-grade estimate for flood storage, excavation or embankment — not a survey.',
    kind: 'polygon',
    params: [
      { key: 'layer', label: 'Which layer', type: 'layer', kinds: ['polygon'] },
      { key: 'depth', label: 'Average depth or height', type: 'range', min: 0.1, max: 30, step: 0.1, default: 1.5, suffix: ' m' },
    ],
    run({ layers, params }) {
      const src = layers.layer;
      const depth = Number(params.depth) || 1;
      const out = [];
      let totalM3 = 0;
      let totalKm2 = 0;

      for (const f of polygonFeatures(src)) {
        const m2 = area(f);
        const m3 = m2 * depth;
        totalM3 += m3;
        totalKm2 += m2 / 1e6;
        out.push({ ...f, properties: { ...f.properties, depth_m: depth, volume_m3: Math.round(m3) } });
      }
      if (!out.length) throw new Error(`“${src.name}” has no polygons to measure.`);

      const geojson = fc(out);
      return {
        name: `${src.name} — volume`,
        geojson,
        kind: 'polygon',
        symbology: graduatedSymbology(geojson, 'volume_m3', { ramp: 'water', unit: 'm³' }),
        style: { fillOpacity: 0.78, strokeWidth: 0.6, stroke: '#ffffff' },
        stats: [
          { label: 'Features', value: formatNumber(out.length, 0) },
          { label: 'Footprint', value: formatArea(totalKm2) },
          { label: 'Assumed depth', value: `${depth} m` },
          { label: 'Estimated volume', value: `${formatNumber(totalM3 / 1e6, 2)} million m³`, emphasis: true },
        ],
        summary: `About ${formatNumber(totalM3 / 1e6, 2)} million m³, from ${formatArea(totalKm2)} at an assumed ${depth} m. This is area × depth — a planning estimate, not a surveyed volume.`,
      };
    },
  },

  /* ---------------- pattern --------------------------------------- */
  {
    id: 'hotspot',
    name: 'Hotspot map',
    category: 'pattern',
    icon: '◉',
    question: 'Where are these clustered?',
    blurb: 'Lays a grid over your study area and counts how many features land in each cell, so concentrations stand out.',
    kind: 'polygon',
    params: [
      { key: 'layer', label: 'Which layer', type: 'layer', kinds: ['point', 'polygon'] },
      { key: 'cell', label: 'Grid cell size', type: 'range', min: 0.5, max: 25, step: 0.5, default: 5, suffix: ' km' },
    ],
    run({ layers, area: studyArea, params }) {
      const src = layers.layer;
      if (!studyArea?.bbox) throw new Error('Load a study area first — the grid is laid over it.');

      const cellKm = Number(params.cell) || 5;
      const cells = gridCells(studyArea.bbox, cellKm, studyArea.geojson);
      if (!cells) throw new Error('That cell size makes too many cells for this area. Use a larger cell.');
      if (!cells.length) throw new Error('The grid did not land inside the study area. Try a smaller cell size.');

      const pts = featuresOf(src)
        .map((f) => (f.geometry?.type === 'Point' ? f.geometry.coordinates : pointOf(f)))
        .filter(Boolean);

      const out = [];
      let max = 0;
      let filled = 0;
      for (const cell of cells) {
        let count = 0;
        for (const [x, y] of pts) {
          if (x >= cell.x0 && x < cell.x1 && y >= cell.y0 && y < cell.y1) count++;
        }
        if (!count) continue;
        filled++;
        max = Math.max(max, count);
        out.push(cellFeature(cell, { count, per_km2: Number((count / (cellKm * cellKm)).toFixed(3)) }));
      }
      if (!out.length) throw new Error(`No ${src.name.toLowerCase()} fall inside the study area.`);

      const geojson = fc(out);
      return {
        name: `${src.name} — hotspots`,
        geojson,
        kind: 'polygon',
        symbology: graduatedSymbology(geojson, 'count', { ramp: 'risk', unit: '' }),
        style: { fillOpacity: 0.8, strokeWidth: 0 },
        stats: [
          { label: 'Features mapped', value: formatNumber(pts.length, 0) },
          { label: 'Cells with any', value: formatNumber(filled, 0) },
          { label: 'Busiest cell', value: `${formatNumber(max, 0)} in ${cellKm}×${cellKm} km`, emphasis: true },
          { label: 'Cell size', value: `${cellKm} km` },
        ],
        summary: `${formatNumber(pts.length, 0)} ${src.name.toLowerCase()} cluster into ${filled} cells; the busiest ${cellKm} km cell holds ${formatNumber(max, 0)}.`,
      };
    },
  },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id) ?? null;
export const toolsInCategory = (id) => TOOLS.filter((t) => t.category === id);

/** Default parameter values for a tool. */
export function defaultParams(tool) {
  return Object.fromEntries(
    (tool.params ?? [])
      .filter((p) => p.type !== 'layer')
      .map((p) => [p.key, p.default]),
  );
}

/**
 * Run a tool. Everything happens synchronously in the browser — the yield
 * back to the event loop is just so the busy toast can paint first.
 * @returns {Promise<object>} the tool's result
 */
export async function runTool(tool, ctx) {
  await new Promise((r) => setTimeout(r, 30));
  const result = tool.run(ctx);
  return { ...result, toolId: tool.id, runAt: new Date().toISOString() };
}
