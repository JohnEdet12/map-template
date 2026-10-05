/**
 * Templates pane — pick a style. This is the "Canva" moment: one click
 * swaps the basemap, the look, the page size and the whole element layout.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { TEMPLATE_CATEGORIES, templatesInCategory, templateById } from '../../templates/catalog.js';
import { applyTemplate } from '../../templates/apply.js';
import { templatePreview } from '../preview.js';
import { head, section, pillRow, seg, checkRow, button, stack, labelled, select } from '../controls.js';
import {
  PAPER_SIZES, MAP_LOOKS, MAP_TEXTURES, paperDimsLabel,
  EXPORT_RESOLUTIONS, effectiveDpi, basemapOptions, basemapSpec, isVectorBasemap,
} from '../../core/constants.js';
import { applyLook, setBasemap, applyBasemapGroups, applyTerrain, applyBuildingExtrusion, resizeSoon } from '../../core/map.js';
import { layoutArtboard, renderElements, hint, paperDims } from '../artboard.js';
import { formatNumber } from '../../core/geo.js';

let filterCategory = 'all';
let pane;

function card(tpl) {
  const node = el('button.tpl-card', { type: 'button', title: `${tpl.name} — ${tpl.blurb}` }, [
    el('div.tpl-thumb', {}, [templatePreview(tpl)]),
    el('div.tpl-meta', {}, [
      el('strong', { text: tpl.name }),
      el('span', { text: tpl.tags.join(' · ') }),
    ]),
  ]);
  node.classList.toggle('is-active', tpl.id === state.templateId);
  node.addEventListener('click', () => {
    applyTemplate(tpl.id);
    layoutArtboard();
    renderElements();
    resizeSoon();
    notify.ok(`<b>${tpl.name}</b> applied. Every element is still yours to move and edit.`);
    hint('Drag any card, title or arrow to reposition it. Hold <b>Alt</b> to ignore the snap guides.');
  });
  return node;
}

export function renderTemplatesPane() {
  pane = pane ?? $('#pane-templates');
  if (!pane) return;

  const grid = el('div.tpl-grid');
  for (const tpl of templatesInCategory(filterCategory)) grid.append(card(tpl));

  fill(pane, [
    head('Templates', 'Start from a finished design, then change anything you like.'),
    pillRow(TEMPLATE_CATEGORIES, filterCategory, (id) => { filterCategory = id; renderTemplatesPane(); }),
    grid,
    section('Basemap', basemapControls()),
    section('Page', pageControls()),
    section('Map look', lookControls()),
  ]);
}

/* ------------------------------------------------------------------ */
function pageControls() {
  const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
  const fixed = Boolean(paper.fixedOrientation);

  const update = (patch) => {
    set({ page: { ...state.page, ...patch } });
    layoutArtboard();
    renderElements();
    renderTemplatesPane();
  };

  return stack([
    labelled('Paper size', select(
      Object.entries(PAPER_SIZES).map(([value, p]) => ({ value, label: `${p.label} · ${paperDimsLabel(p)}` })),
      state.page.size,
      (value) => update({ size: value }),
    )),
    labelled('Orientation', seg(
      [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
      fixed ? paper.fixedOrientation : state.page.orientation,
      (value) => update({ orientation: value }),
    ), fixed ? `${paper.label} is always ${paper.fixedOrientation}.` : ''),
    labelled('Export resolution', select(
      EXPORT_RESOLUTIONS.map((r) => ({ value: r.dpi, label: `${r.label} · ${r.dpi} dpi` })),
      state.page.dpi,
      (value) => update({ dpi: Number(value) }),
    ), resolutionNote()),
  ]);
}

/**
 * What this resolution will actually produce, on this paper, in this browser.
 *
 * Said before the export rather than after it, because the two things people
 * get wrong here are both expensive: asking for 600 dpi on A0, where no
 * browser can allocate the canvas, and asking for 96 on something destined for
 * a printer.
 */
function resolutionNote() {
  const asked = Number(state.page.dpi) || 150;
  const { wIn, hIn } = paperDims();
  const real = effectiveDpi(wIn, hIn, asked);
  const W = Math.round(wIn * real);
  const H = Math.round(hIn * real);
  const size = `${formatNumber(W, 0)} × ${formatNumber(H, 0)} px`;
  const hint = EXPORT_RESOLUTIONS.find((r) => r.dpi === asked)?.hint ?? '';

  if (real < asked) {
    return `${PAPER_SIZES[state.page.size]?.label ?? 'This size'} is too big for ${asked} dpi in a browser — the export will be ${real} dpi (${size}).`;
  }
  return `${size}${hint ? ` · ${hint}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* basemap                                                             */
/* ------------------------------------------------------------------ */

/**
 * The ground the map is drawn on, as a section of its own.
 *
 * It used to be one line inside "Map look", between a filter and a paper
 * texture, which is the wrong company: a filter is a finish, and the basemap
 * is the largest single decision about what the map shows. Satellite imagery
 * in particular is what most people are looking for when they open a
 * cartography tool and cannot find it.
 */
function basemapControls() {
  const spec = basemapSpec(state.basemap);
  const vector = isVectorBasemap(state.basemap);

  const toggles = Object.entries(state.basemapGroups).map(([key, on]) =>
    checkRow(groupLabel(key), on, (value) => {
      set({ basemapGroups: { ...state.basemapGroups, [key]: value } }, { history: false });
      applyBasemapGroups(state.basemapGroups);
    }));

  return stack([
    labelled('Basemap', select(
      basemapOptions().map((o) => ({ value: o.value, label: o.label, group: o.group })),
      state.basemap,
      (value) => { setBasemap(value); renderTemplatesPane(); },
    ), spec.hint),

    // The credit changes with the basemap and prints on the map, so it is
    // shown here rather than discovered at export time.
    el('p', {
      style: { margin: 0, fontSize: '10px', color: 'var(--ink-faint)', lineHeight: '1.45' },
      text: spec.attribution,
    }),

    el('div.panel-title', { text: 'Basemap layers', style: { marginTop: '4px' } }),
    vector
      ? stack(toggles, '2px')
      : el('p', {
          style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
          html: `<b>${spec.label}</b> arrives as finished pictures, so its roads, labels and water cannot be switched off individually — they are painted into the tiles. Choose a <b>Vector</b> basemap to get those toggles back.`,
        }),
  ]);
}

/* ------------------------------------------------------------------ */
function lookControls() {
  const look = state.mapLook;
  const setLook = (patch) => {
    set({ mapLook: { ...state.mapLook, ...patch } });
    applyLook(state.mapLook);
    renderTemplatesPane();
  };

  return stack([
    labelled('Filter', select(
      Object.entries(MAP_LOOKS).map(([value, l]) => ({ value, label: l.label })),
      look.filter,
      (value) => setLook({ filter: value }),
    ), hueSafe(look.filter) ? '' : 'Heads up: this filter recolours your data and analysis layers too, so they will no longer match their legend.'),
    labelled('Paper texture', select(
      Object.entries(MAP_TEXTURES).map(([value, t]) => ({ value, label: t.label })),
      look.texture,
      (value) => setLook({ texture: value }),
    ), 'Printed on export only — the preview stays crisp.'),
    labelled('Edge darkening', (() => {
      const input = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: look.vignette ?? 0 });
      input.addEventListener('input', () => setLookQuiet({ vignette: Number(input.value) }));
      return input;
    })()),
    el('div', { style: { height: '4px' } }),
    checkRow('3-D terrain', state.terrain, (on) => {
      set({ terrain: on });
      applyTerrain(on);
      if (on) hint('Hold <b>right-click</b> (or Ctrl + drag) on the map to tilt and orbit.');
    }, 'Raises hills using free elevation tiles'),
    checkRow('3-D buildings', state.buildings3d, (on) => {
      set({ buildings3d: on });
      applyBuildingExtrusion(on);
      if (on) hint('Zoom past level 13 for building heights to appear.');
    }, 'Extrudes OpenStreetMap building footprints'),
    el('div', { style: { height: '4px' } }),
    button('Reset element layout', () => {
      const tpl = templateById(state.templateId);
      if (!tpl) return;
      applyTemplate(tpl.id, { keepPage: true });
      renderElements();
      notify.info('Elements returned to their template positions.');
    }, 'ghost', { style: { width: '100%' } }),
  ]);
}

/**
 * The look is a CSS filter over the whole map canvas, overlays included.
 * These leave hues alone; the rest genuinely restyle the data as well.
 */
const HUE_SAFE = new Set(['none', 'soft', 'vivid']);
const hueSafe = (filter) => HUE_SAFE.has(filter)
  || !state.layers.some((l) => l.source === 'analysis' || l.source === 'osm' || l.source === 'overture');

/** Vignette drags should not rebuild the panel on every frame. */
function setLookQuiet(patch) {
  set({ mapLook: { ...state.mapLook, ...patch } }, { history: false });
  applyLook(state.mapLook);
}

/* ------------------------------------------------------------------ */
export function initTemplatesPane() {
  pane = $('#pane-templates');
  renderTemplatesPane();
  subscribe(['templateId', 'page', 'basemap', 'terrain', 'buildings3d'], () => {
    if (state.activeTool === 'templates') renderTemplatesPane();
  });
}

/** Layer-group toggles live here too — used by the map controls popover. */
export function basemapGroupControls() {
  return stack(Object.entries(state.basemapGroups).map(([key, on]) =>
    checkRow(groupLabel(key), on, (value) => {
      set({ basemapGroups: { ...state.basemapGroups, [key]: value } }, { history: false });
      applyBasemapGroups(state.basemapGroups);
    })));
}

const GROUP_LABELS = {
  roads: 'Roads & streets', water: 'Rivers & water', buildings: 'Buildings',
  boundaries: 'Admin borders', labels: 'Place names', landcover: 'Parks & landuse',
};
const groupLabel = (key) => GROUP_LABELS[key] ?? key;
