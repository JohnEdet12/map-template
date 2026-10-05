/**
 * Central application state with a tiny pub/sub layer and an undo stack.
 *
 * Everything the UI renders comes from here. Modules never talk to each
 * other directly — they `set()` state and `subscribe()` to the keys they
 * care about, which is what keeps the panels, the map and the export
 * pipeline from drifting apart the way they did in the v2 prototype.
 */

// The catalogue is a static data module with no imports of its own, so this
// stays a leaf dependency rather than a cycle back into the UI.
import { templateById } from '../templates/catalog.js';

const HISTORY_KEYS = ['elements', 'page', 'templateId', 'mapLook'];
const HISTORY_LIMIT = 60;

export const state = {
  view: 'landing',                     // 'landing' | 'studio'
  projectId: null,                     // entry in the saved project library
  projectName: 'Untitled map',
  activeTool: 'templates',             // which left panel is showing

  templateId: 'quiet-canvas',

  basemap: 'liberty',
  basemapGroups: { roads: true, water: true, buildings: true, boundaries: true, labels: true, landcover: true },
  mapView: { center: [7.4951, 9.0579], zoom: 5.6, pitch: 0, bearing: 0 },
  terrain: false,
  buildings3d: false,
  mapLook: { filter: 'none', texture: 'none', vignette: 0 },

  page: { size: 'a4', orientation: 'portrait', dpi: 150, background: '#ffffff' },

  // The areas this map is about, and the combined view of them that the rest
  // of the app reads. Both are written together by data/study-areas.js —
  // never assign either one directly.
  studyAreas: [],                      // [{ name, level, geojson, bbox, areaKm2 }]
  studyArea: null,                     // the same shape, covering all of them
  clipToArea: true,                    // trim open data to the boundary, not the bbox
  // Bumped when a locator-inset context outline finishes loading. A counter,
  // not the outline: several insets can want different ones, and each looks
  // its own up. See data/inset-context.js.
  insetContext: 0,

  layers: [],                          // see layers/registry.js
  elements: [],                        // see layout/elements.js
  selectedElementId: null,
  selectedLayerId: null,               // right panel shows layer styling instead

  analysisRuns: [],                    // completed analysis jobs
  analysisBusy: false,

  hydrated: false,
};

/* ------------------------------------------------------------------ */
/* pub / sub                                                           */
/* ------------------------------------------------------------------ */
const subscribers = new Set();

/**
 * @param {string[]|'*'} keys  top-level state keys to watch
 * @param {(state:object, changed:string[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(keys, fn) {
  const entry = { keys: keys === '*' ? null : new Set([].concat(keys)), fn };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

function emit(changed) {
  if (!changed.length) return;
  for (const { keys, fn } of Array.from(subscribers)) {
    if (!keys || changed.some((k) => keys.has(k))) {
      try { fn(state, changed); } catch (err) { console.error('[store] subscriber failed', err); }
    }
  }
}

/**
 * Merge a patch into state and notify subscribers.
 * @param {object} patch
 * @param {{history?: boolean, silent?: boolean}} [opts]
 *        history:true records an undo checkpoint *before* applying.
 */
export function set(patch, opts = {}) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] === value) continue;
    changed.push(key);
  }
  if (!changed.length) return;

  if (opts.history !== false && changed.some((k) => HISTORY_KEYS.includes(k))) checkpoint();

  Object.assign(state, patch);
  if (!opts.silent) emit(changed);
}

/** Force-notify keys whose contents were mutated in place. */
export function touch(...keys) { emit(keys); }

/* ------------------------------------------------------------------ */
/* undo / redo                                                         */
/* ------------------------------------------------------------------ */
const past = [];
const future = [];
let restoring = false;

const snapshot = () => JSON.parse(JSON.stringify(Object.fromEntries(HISTORY_KEYS.map((k) => [k, state[k]]))));

/** Record the current document so the next change can be undone. */
export function checkpoint() {
  if (restoring) return;
  past.push(snapshot());
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  emit(['history']);
}

function restore(snap) {
  restoring = true;
  Object.assign(state, JSON.parse(JSON.stringify(snap)));
  restoring = false;
  emit([...HISTORY_KEYS, 'selectedElementId', 'history']);
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  restore(past.pop());
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  restore(future.pop());
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

/* ------------------------------------------------------------------ */
/* project library — many projects, saved in this browser              */
/* ------------------------------------------------------------------ */
const LIBRARY_KEY = 'gds.projects.v3';
const LEGACY_KEY = 'gds.project.v3';      // the old single-slot format
const PERSIST_KEYS = [
  'projectName', 'templateId', 'basemap', 'basemapGroups', 'mapView', 'terrain',
  'buildings3d', 'mapLook', 'page', 'elements', 'studyAreas', 'clipToArea',
];

/** Beyond this the oldest project is dropped — localStorage is finite. */
export const MAX_PROJECTS = 24;

const newId = () => `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function readLibrary() {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Write, shedding thumbnails and then whole projects if the quota bites. */
function writeLibrary(list) {
  const attempts = [
    list,
    list.map((p, i) => (i === 0 ? p : { ...p, thumb: '' })),   // keep newest thumb
    list.map((p) => ({ ...p, thumb: '' })),
    list.slice(0, Math.max(1, Math.floor(list.length / 2))).map((p) => ({ ...p, thumb: '' })),
  ];
  for (const attempt of attempts) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(attempt));
      return { ok: true, trimmed: attempt.length < list.length || attempt.some((p, i) => !p.thumb && list[i].thumb) };
    } catch { /* try a smaller payload */ }
  }
  return { ok: false, error: 'This browser is out of storage space for saved projects. Delete a few from the home page.' };
}

let migrated = false;
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const { savedAt, doc } = JSON.parse(raw);
    if (doc) {
      const list = readLibrary();
      list.unshift({
        id: newId(),
        name: doc.projectName || 'Untitled map',
        templateId: doc.templateId,
        savedAt: savedAt ?? Date.now(),
        thumb: '',
        doc,
      });
      writeLibrary(list);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* nothing worth recovering */ }
}

/** Every saved project, newest first, without the (large) document body. */
export function listProjects() {
  migrateLegacy();
  return readLibrary()
    .map(({ doc, ...meta }) => meta)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getProject(id) {
  migrateLegacy();
  return readLibrary().find((p) => p.id === id) ?? null;
}

/**
 * Save the live document into the current project, creating one on first
 * save. Pass a thumbnail data URL to refresh the home-page card.
 * @returns {{ok: boolean, id?: string, error?: string}}
 */
/**
 * Is the page still exactly what the template laid out?
 *
 * Compared field by field rather than by a "dirty" flag, so it stays honest
 * no matter which panel made the change — moving a title, typing one, adding
 * or deleting an element all show up here without any of them having to
 * remember to report it.
 */
function elementsAreUntouched() {
  const tpl = templateById(state.templateId);
  if (!tpl) return false;
  if (state.elements.length !== tpl.elements.length) return false;
  return state.elements.every((elm, i) => {
    const spec = tpl.elements[i];
    return elm.type === spec.type
      && elm.x === spec.x && elm.y === spec.y && elm.w === spec.w && elm.h === spec.h
      && (elm.text ?? '') === (spec.text ?? '');
  });
}

/**
 * Has the user actually started something here?
 *
 * Opening a template is browsing, not work — on its own it must never reach
 * the project library, or looking through the gallery fills the home page
 * with identical stubs. Loading an area, adding data, running an analysis or
 * editing the page all count; so does a project that has been saved once
 * already, which from then on keeps itself up to date.
 */
export function hasWork() {
  return Boolean(
    state.projectId
    || state.studyArea
    || state.layers.length
    || state.analysisRuns.length
    || !elementsAreUntouched(),
  );
}

export function saveProject({ thumbnail, name } = {}) {
  migrateLegacy();
  const doc = Object.fromEntries(PERSIST_KEYS.map((k) => [k, state[k]]));
  const list = readLibrary();
  const id = state.projectId ?? newId();
  const existing = list.find((p) => p.id === id);

  const entry = {
    id,
    name: name ?? state.projectName ?? 'Untitled map',
    templateId: state.templateId,
    savedAt: Date.now(),
    thumb: thumbnail ?? existing?.thumb ?? '',
    doc,
  };

  const next = [entry, ...list.filter((p) => p.id !== id)].slice(0, MAX_PROJECTS);
  const result = writeLibrary(next);
  if (!result.ok) return result;

  if (state.projectId !== id) set({ projectId: id }, { history: false });
  return { ok: true, id };
}

/** Fork the live document into a brand-new project. */
export function saveProjectAs(name, thumbnail) {
  set({ projectId: null, projectName: name || state.projectName }, { history: false });
  return saveProject({ thumbnail, name });
}

export function deleteProject(id) {
  const result = writeLibrary(readLibrary().filter((p) => p.id !== id));
  if (state.projectId === id) set({ projectId: null }, { history: false });
  return result;
}

export function renameProject(id, name) {
  const list = readLibrary();
  const entry = list.find((p) => p.id === id);
  if (!entry) return { ok: false };
  entry.name = name;
  if (entry.doc) entry.doc.projectName = name;
  return writeLibrary(list);
}

/** Serialise the whole project for "download .gdsmap" / re-import. */
export function exportProject() {
  return {
    format: 'gis-design-studio/project',
    version: 3,
    savedAt: new Date().toISOString(),
    doc: Object.fromEntries(PERSIST_KEYS.map((k) => [k, state[k]])),
    layers: state.layers.map(({ id, name, source, kind, style, visible, legend, meta }) => ({
      id, name, source, kind, style, visible, legend, meta,
    })),
  };
}
