/**
 * Entry point.
 *
 * Wires the landing page to the studio, boots the map exactly once (the
 * first time the studio is shown, so the container already has a size),
 * and keeps the artboard in step with the store.
 */

import './styles/base.css';
import './styles/landing.css';
import './styles/studio.css';
import './styles/previews.css';

import { $, debounce } from './core/dom.js';
import { state, set, subscribe, saveProject, getProject, hasWork } from './core/store.js';
import { notify } from './core/toast.js';
import {
  initMap, resizeSoon, flyTo, flyToBounds,
  applyLook, applyTerrain, applyBuildingExtrusion, applyBasemapGroups,
} from './core/map.js';
import { initLayerRendering } from './layers/render.js';
import { findBySource } from './layers/registry.js';
import { combineAreas, redrawBoundaries } from './data/study-areas.js';
import { boundsFromBbox } from './core/geo.js';

import { applyTemplate, reapplyMapState, watchBuildings3d } from './templates/apply.js';
import { initArtboard, layoutArtboard, renderElements, hint } from './ui/artboard.js';
import { thumbnailDataUrl } from './export/render.js';
import { initChrome } from './ui/chrome.js';
import { initInspector } from './ui/inspector.js';
import { initLanding, showLanding } from './ui/landing.js';
import { setTool } from './ui/tool.js';
import { initTheme } from './ui/theme.js';

import { initTemplatesPane, renderTemplatesPane } from './ui/panels/templates.js';
import { initAreaPane, renderAreaPane, loadPlace } from './ui/panels/area.js';
import { initDataPane, renderDataPane } from './ui/panels/data.js';
import { initAnalysisPane, renderAnalysisPane } from './ui/panels/analysis.js';
import { initElementsPane, renderElementsPane } from './ui/panels/elements.js';
import { initLayersPane, renderLayersPane } from './ui/panels/layers.js';
import { initAiPane, renderAiPane } from './ui/panels/ai.js';

/** Each pane only refreshes itself while it is the visible one, so it also
 *  has to redraw the moment it becomes visible again. */
const PANE_RENDERERS = {
  templates: renderTemplatesPane,
  area: renderAreaPane,
  data: renderDataPane,
  analysis: renderAnalysisPane,
  ai: renderAiPane,
  elements: renderElementsPane,
  layers: renderLayersPane,
};

let studioReady = false;

/* ------------------------------------------------------------------ */
/* studio boot — runs once                                             */
/* ------------------------------------------------------------------ */
function initStudio() {
  if (studioReady) return;
  studioReady = true;

  initMap('map');
  initLayerRendering();
  watchBuildings3d();

  initArtboard();
  initTemplatesPane();
  initAreaPane();
  initDataPane();
  initAnalysisPane();
  initAiPane();
  initElementsPane();
  initLayersPane();
  initInspector();
  initChrome({ onHome: goHome });

  subscribe(['activeTool'], () => PANE_RENDERERS[state.activeTool]?.());

  // Map-side effects are driven off state rather than off the click that
  // caused it, so undo/redo — which rewrites state directly — puts the
  // basemap back the way it was too.
  subscribe(['mapLook'], () => applyLook(state.mapLook));
  subscribe(['terrain'], () => applyTerrain(state.terrain));
  subscribe(['buildings3d'], () => applyBuildingExtrusion(state.buildings3d));
  subscribe(['basemapGroups'], () => applyBasemapGroups(state.basemapGroups));

  // Anything that changes what the page should say redraws the elements.
  subscribe(['elements', 'layers', 'studyArea', 'analysisRuns', 'page', 'templateId', 'selectedElementId', 'insetContext'], renderElements);

  // The scale bar, north arrow and map-information block all depend on the
  // camera, so they refresh (cheaply) after the map settles.
  const refreshOnCamera = debounce(renderElements, 240);
  subscribe(['mapView'], refreshOnCamera);

  window.addEventListener('beforeunload', () => { if (hasWork()) saveProject(); });
}

/* ------------------------------------------------------------------ */
/* view switching                                                      */
/* ------------------------------------------------------------------ */
function showStudio() {
  $('#landing')?.classList.add('is-hidden');
  $('#studio')?.classList.remove('is-hidden');
  set({ view: 'studio' }, { history: false });
  initStudio();
  layoutArtboard();
  renderElements();
  resizeSoon(60);
}

/**
 * Leave the studio, saving the current project with a fresh thumbnail.
 * The thumbnail has to be composed *before* the studio is hidden — it is
 * cropped from the live map canvas.
 */
async function goHome() {
  // Leaving a template you only looked at saves nothing — see hasWork().
  if (!hasWork()) {
    set({ view: 'landing' }, { history: false });
    showLanding();
    return;
  }

  let thumbnail;
  try {
    if (state.elements.length) thumbnail = await thumbnailDataUrl();
  } catch (err) {
    console.warn('[main] could not compose a project thumbnail', err);
  }
  const result = saveProject({ thumbnail });
  set({ view: 'landing' }, { history: false });
  showLanding();
  if (!result.ok) notify.warn(result.error, { duration: 8000 });
}

/** Clear the live document so a new map does not inherit the last one. */
function resetDocument() {
  set({
    projectId: null,
    layers: [],
    elements: [],
    analysisRuns: [],
    studyAreas: [],
    studyArea: null,
    selectedElementId: null,
    selectedLayerId: null,
  }, { history: false });
}

/**
 * Open the studio on a new, empty project.
 * @param {{templateId?: string, tool?: string, place?: string}} opts
 */
function openStudio(opts = {}) {
  showStudio();
  resetDocument();

  if (opts.templateId) {
    const tpl = applyTemplate(opts.templateId);
    if (tpl) set({ projectName: tpl.name }, { history: false });
    const name = $('#project-name');
    if (name) name.value = state.projectName;
    layoutArtboard();
    renderElements();
    resizeSoon(80);
  }
  if (opts.tool) setTool(opts.tool);

  if (opts.place) {
    loadPlace(opts.place).catch(() => { /* the panel reports its own errors */ });
  } else {
    hint('Start on the left: choose a <b>study area</b>, then add <b>data</b>. Drag anything inside the dashed page frame.', 7000);
  }
}

/** Reopen a saved project by its library id. */
function openProject(id) {
  const entry = getProject(id);
  if (!entry?.doc) {
    notify.error('That project could not be read — it may have been cleared by the browser.');
    return;
  }
  restoreProject(entry.doc, entry.id);
}

function restoreProject(doc, projectId = null) {
  showStudio();
  resetDocument();

  // Projects saved before a map could have several areas carry a single
  // `studyArea`; it becomes a list of one, which is the same map.
  const areas = doc.studyAreas?.length ? doc.studyAreas : (doc.studyArea ? [doc.studyArea] : []);
  const { studyArea, studyAreas, ...rest } = doc;
  set({ ...rest, projectId, selectedElementId: null, selectedLayerId: null }, { history: false });
  set({ studyAreas: areas, studyArea: combineAreas(areas) }, { history: false });

  // Layers are not persisted, but the study-area outlines can be rebuilt from
  // the saved boundaries so the map does not come back empty.
  if (areas.length && !findBySource('boundary').length) redrawBoundaries();

  const name = $('#project-name');
  if (name) name.value = state.projectName;

  reapplyMapState();
  if (doc.mapView) flyTo(doc.mapView);
  else if (state.studyArea?.bbox) flyToBounds(boundsFromBbox(state.studyArea.bbox));

  layoutArtboard();
  renderElements();
  resizeSoon(80);
  notify.info(`Reopened <b>${state.projectName}</b>. Data layers need adding again — the boundary is back.`, { duration: 6000 });
}

/* ------------------------------------------------------------------ */
/* go                                                                  */
/* ------------------------------------------------------------------ */
initTheme();
// Dev-only console handle, bound here rather than inside store.js on purpose.
// Vite serves an edited module under a new URL, so a bare
// `import('/src/core/store.js')` can hand back a *second*, stale copy — and a
// handle assigned at module scope would be whichever copy happened to
// evaluate last. main.js is the entry point and runs once, so this is
// always the state the app is actually running on.
if (import.meta.env?.DEV) window.__state = state;

initLanding({ openStudio, openProject });

// A hash link like #studio/oil-spill opens straight into a template.
const [view, templateId] = window.location.hash.replace(/^#/, '').split('/');
if (view === 'studio') openStudio({ templateId: templateId || 'quiet-canvas', tool: 'area' });
