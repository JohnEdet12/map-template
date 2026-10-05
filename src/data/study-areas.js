/**
 * The study areas a map is about — one, or several.
 *
 * A map is often not about one administrative unit. A catchment crosses three
 * LGAs, a corridor study covers the states along it, a comparison plate wants
 * two cities side by side. So the source of truth is a *list*, held in
 * `state.studyAreas`.
 *
 * `state.studyArea` stays alongside it as the combined view of that list: one
 * area-shaped object whose geojson holds every part, whose bbox covers them
 * all and whose areaKm2 is their total. Everything downstream — clipping,
 * analysis, the map-information element, the AI briefing — reads it exactly as
 * it did when there could only be one, and needs no idea that there are now
 * several. `parts` carries the originals for the two callers that do care:
 * the panel that lists them, and the data fetch, which asks each part for its
 * own bounding box rather than one rectangle spanning the gap between them.
 */

import { state, set } from '../core/store.js';
import { combinedAreaKm2 } from '../core/geo.js';
import { addVectorLayer, removeLayer, findBySource } from '../layers/registry.js';

/**
 * A stable identity for one area.
 *
 * OpenStreetMap's id where there is one; otherwise the full display name,
 * which is what distinguishes two same-named places anyway.
 */
export const areaKey = (area) =>
  String(area?.osmId ?? area?.id ?? area?.displayName ?? area?.name ?? '');

/** Every study area on this map, always an array. */
export const studyAreas = () => state.studyAreas ?? [];

/**
 * The parts a request should be made against.
 *
 * One area is its own only part, so a caller can loop over this without
 * caring which case it is in.
 */
export const areaParts = (area = state.studyArea) =>
  (area?.parts?.length ? area.parts : area ? [area] : []);

/* ------------------------------------------------------------------ */
/* combining                                                           */
/* ------------------------------------------------------------------ */

/** The smallest box containing every part. */
function unionBbox(areas) {
  const boxes = areas.map((a) => a.bbox).filter((b) => Array.isArray(b) && b.length === 4);
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * How several areas are named on the page.
 *
 * Two get both names, because "Lagos & Ogun" is what the map is of. Beyond
 * that the list stops being a title and becomes a caption, so it is counted
 * instead — the map information element still lists them in full.
 */
function combinedName(areas) {
  if (areas.length === 1) return areas[0].name;
  if (areas.length === 2) return `${areas[0].name} & ${areas[1].name}`;
  return `${areas[0].name} and ${areas.length - 1} other areas`;
}

/**
 * Fold a list of study areas into the single one the rest of the app reads.
 * Returns null for an empty list, which is the same "no study area" every
 * caller already handles.
 */
export function combineAreas(areas) {
  if (!areas?.length) return null;
  if (areas.length === 1) return { ...areas[0], parts: [areas[0]] };

  const features = areas.flatMap((a) => a.geojson?.features ?? []);
  const geojson = { type: 'FeatureCollection', features };

  return {
    name: combinedName(areas),
    displayName: areas.map((a) => a.name).join(' · '),
    level: 'multi',
    geojson,
    bbox: unionBbox(areas),
    // Dissolved, not summed: an LGA inside a state someone also added shares
    // ground with it, and that ground must not be counted twice in a figure
    // the map prints as fact.
    areaKm2: combinedAreaKm2(areas.map((a) => a.geojson))
      || areas.reduce((sum, a) => sum + (a.areaKm2 ?? 0), 0),
    center: areas[0].center ?? null,
    parts: areas,
  };
}

/**
 * Write the list and its combined view together.
 *
 * Both keys are set in one `set()` so a subscriber watching either sees them
 * consistent — a studyArea that disagrees with studyAreas for even one frame
 * is a legend or a figure briefly telling the truth about neither.
 */
function commit(areas) {
  set({ studyAreas: areas, studyArea: combineAreas(areas) });
}

/* ------------------------------------------------------------------ */
/* the boundary layers                                                 */
/* ------------------------------------------------------------------ */

/** The drawn outline for one area, named so it can be found again. */
function drawBoundary(area) {
  addVectorLayer({
    name: `${area.name} boundary`,
    source: 'boundary',
    geojson: area.geojson,
    kind: 'polygon',
    color: '#0369a1',
    style: { fillOpacity: 0.07, strokeWidth: 2.2, stroke: '#0369a1' },
    description: area.displayName,
    meta: { slug: 'study-area', level: area.level, areaKey: areaKey(area) },
  });
}

/** Remove the outline belonging to one area, leaving the others alone. */
function eraseBoundary(key) {
  findBySource('boundary')
    .filter((l) => l.meta?.areaKey === key)
    .forEach((l) => removeLayer(l.id));
}

/** Redraw every outline from the list — used after loading a saved project. */
export function redrawBoundaries() {
  findBySource('boundary').forEach((l) => removeLayer(l.id));
  studyAreas().forEach(drawBoundary);
}

/* ------------------------------------------------------------------ */
/* editing the list                                                    */
/* ------------------------------------------------------------------ */

/**
 * Add one area to the map.
 *
 * @param {object} area   from lookupBoundary()
 * @param {{replace?: boolean}} [opts]  replace:true is the old single-area
 *        behaviour — used by the landing search, where typing a new place
 *        means "map this instead", not "map this as well".
 * @returns {{added: boolean, reason?: string}}
 */
export function addStudyArea(area, { replace = false } = {}) {
  if (!area) return { added: false, reason: 'No area' };
  const key = areaKey(area);

  if (replace) {
    findBySource('boundary').forEach((l) => removeLayer(l.id));
    commit([area]);
    drawBoundary(area);
    return { added: true };
  }

  if (studyAreas().some((a) => areaKey(a) === key)) {
    return { added: false, reason: `${area.name} is already one of your study areas.` };
  }

  commit([...studyAreas(), area]);
  drawBoundary(area);
  return { added: true };
}

export function removeStudyArea(key) {
  eraseBoundary(key);
  commit(studyAreas().filter((a) => areaKey(a) !== key));
}

export function clearStudyAreas() {
  findBySource('boundary').forEach((l) => removeLayer(l.id));
  commit([]);
}
