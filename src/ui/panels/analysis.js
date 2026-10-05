/**
 * Analysis pane — simple geoprocessing on the layers already on your map.
 *
 * Tools are picked by the question they answer. Everything runs locally and
 * for real: no service to configure, no credentials, no synthetic numbers.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { TOOL_CATEGORIES, TOOLS, toolsInCategory, defaultParams, runTool } from '../../analysis/tools.js';
import { addVectorLayer, removeLayer } from '../../layers/registry.js';
import { renderElements, hint } from '../artboard.js';
import { setTool as setPane } from '../tool.js';
import {
  head, section, row, empty, button, stack, labelled, select,
  slider, miniBtn, pillRow, inline,
} from '../controls.js';
import { uiIcon } from '../ui-icons.js';

let pane;
let category = 'proximity';
let openId = null;
let params = {};
let picks = {};          // param key → layer id ('__area' for the study area)
let running = false;

const STUDY_AREA = '__area';

/* ------------------------------------------------------------------ */
/** Layers a given parameter will accept. */
function candidates(spec) {
  const list = state.layers.filter((l) => l.type === 'vector' && spec.kinds.includes(l.kind));
  return list.map((l) => ({ value: l.id, label: `${l.name} · ${l.meta?.count ?? 0} features` }));
}

function openTool(tool) {
  openId = tool.id;
  params = defaultParams(tool);
  picks = {};
  // Pre-select the obvious layer when there is only one sensible choice.
  for (const spec of tool.params) {
    if (spec.type !== 'layer') continue;
    const options = candidates(spec);
    if (spec.allowStudyArea && state.studyArea && !options.length) picks[spec.key] = STUDY_AREA;
    else if (options.length === 1) picks[spec.key] = options[0].value;
  }
  render();
}

function paramControl(spec) {
  if (spec.type === 'layer') {
    const options = candidates(spec);
    if (spec.allowStudyArea && state.studyArea) {
      options.unshift({ value: STUDY_AREA, label: `Study area — ${state.studyArea.name}` });
    }
    if (!options.length) {
      return labelled(spec.label, el('p', {
        style: { margin: 0, fontSize: '11px', color: '#b45309', lineHeight: '1.4' },
        text: `No ${spec.kinds.join(' or ')} layer on the map yet. Add one from Data first.`,
      }));
    }
    return labelled(spec.label, select(
      [{ value: '', label: 'Choose a layer…' }, ...options],
      picks[spec.key] ?? '',
      (value) => { picks[spec.key] = value; },
    ));
  }

  const value = params[spec.key];
  const update = (v) => { params[spec.key] = v; };

  if (spec.type === 'range') return labelled(spec.label, slider({ ...spec, value }, update), spec.hint);
  if (spec.type === 'select') return labelled(spec.label, select(spec.options, value, update), spec.hint);
  const input = el('input.field', { type: 'number', value, min: spec.min, max: spec.max, step: spec.step });
  input.addEventListener('change', () => update(Number(input.value)));
  return labelled(spec.label, input, spec.hint);
}

/* ------------------------------------------------------------------ */
async function run(tool) {
  if (running) return;

  const layers = {};
  for (const spec of tool.params) {
    if (spec.type !== 'layer') continue;
    const id = picks[spec.key];
    if (!id) {
      notify.warn(`Choose a layer for “${spec.label}”.`);
      return;
    }
    layers[spec.key] = id === STUDY_AREA ? null : state.layers.find((l) => l.id === id) ?? null;
    if (id === STUDY_AREA && !state.studyArea) {
      notify.warn('Load a study area first.');
      setPane('area');
      return;
    }
  }

  running = true;
  set({ analysisBusy: true }, { history: false });
  render();
  const status = notify.busy(`Running <b>${tool.name}</b>…`);

  try {
    const result = await runTool(tool, {
      layers,
      params: { ...params },
      area: state.studyArea,
      studyAreaKm2: state.studyArea?.areaKm2 ?? 0,
    });

    // One result layer per tool — re-running replaces the previous one.
    state.layers.filter((l) => l.meta?.toolId === tool.id).forEach((l) => removeLayer(l.id));

    addVectorLayer({
      name: result.name,
      source: 'analysis',
      geojson: result.geojson,
      kind: result.kind,
      symbology: result.symbology,
      style: result.style,
      underLabels: result.kind === 'polygon',
      description: result.summary,
      meta: { toolId: tool.id, toolName: tool.name },
    });

    const runs = [...state.analysisRuns.filter((r) => r.tool.id !== tool.id), { tool, params: { ...params }, result }];
    set({ analysisRuns: runs }, { history: false });
    renderElements();

    status.update(`<b>${tool.name}</b> — ${result.summary}`, { tone: 'ok', duration: 9000 });
    hint('The legend and key-figure cards on your page updated themselves.');
  } catch (err) {
    console.error(err);
    status.update(err.message ?? 'That analysis could not run.', { tone: 'error', duration: 9000 });
  } finally {
    running = false;
    set({ analysisBusy: false }, { history: false });
    render();
  }
}

function removeRun(toolId) {
  state.layers.filter((l) => l.meta?.toolId === toolId).forEach((l) => removeLayer(l.id));
  set({ analysisRuns: state.analysisRuns.filter((r) => r.tool.id !== toolId) }, { history: false });
  renderElements();
  render();
}

/* ------------------------------------------------------------------ */
function toolCard(tool) {
  const isOpen = tool.id === openId;
  const done = state.analysisRuns.some((r) => r.tool.id === tool.id);

  const header = row({
    icon: tool.icon,
    title: tool.name,
    sub: tool.question,
    active: isOpen,
    onClick: () => { if (isOpen) { openId = null; render(); } else openTool(tool); },
    actions: done ? [el('span.chip', { text: '✓ run' })] : [],
  });

  if (!isOpen) return header;

  return el('div', { style: { marginBottom: '8px' } }, [
    header,
    el('div', { style: { padding: '8px 8px 2px', borderLeft: '2px solid var(--accent-soft)', margin: '2px 0 0 13px' } }, [
      el('p', { text: tool.blurb, style: { margin: '0 0 10px', fontSize: '11.5px', lineHeight: '1.45', color: 'var(--ink-soft)' } }),
      ...tool.params.map(paramControl),
      running
        ? button('Working…', () => {}, 'ghost', { style: { width: '100%' }, disabled: true })
        : button(`Run ${tool.name.toLowerCase()}`, () => run(tool), 'primary', { style: { width: '100%' } }),
    ]),
  ]);
}

function resultsSection() {
  if (!state.analysisRuns.length) return null;
  return section('Results', stack(state.analysisRuns.map((r) => el('div.card', { style: { padding: '9px 10px' } }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' } }, [
      el('div', {}, [
        el('div', { text: r.result.name, style: { fontSize: '12.5px', fontWeight: '700' } }),
        el('div', { text: r.result.summary, style: { fontSize: '11px', color: 'var(--ink-soft)', lineHeight: '1.4', marginTop: '2px' } }),
      ]),
      miniBtn(uiIcon('trash'), 'Remove this result', () => removeRun(r.tool.id), { danger: true }),
    ]),
  ]))));
}

/* ------------------------------------------------------------------ */
export function render() {
  pane = pane ?? $('#pane-analysis');
  if (!pane) return;

  const hasLayers = state.layers.some((l) => l.type === 'vector');

  fill(pane, [
    head('Analysis', 'Ask a question about the layers on your map. Everything runs here, on your data.'),
    hasLayers ? null : el('div.panel-section', {}, [
      empty('Analysis works on layers.<br />Add some data first.'),
      button('Browse open data', () => setPane('data'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
    ]),
    pillRow(TOOL_CATEGORIES, category, (id) => { category = id; render(); }),
    el('div', { style: { padding: '4px 14px 12px' } }, toolsInCategory(category).map(toolCard)),
    resultsSection(),
  ]);
}

export function initAnalysisPane() {
  pane = $('#pane-analysis');
  render();
  subscribe(['studyArea', 'analysisRuns', 'layers'], () => { if (state.activeTool === 'analysis') render(); });
}

export { render as renderAnalysisPane, TOOLS };
