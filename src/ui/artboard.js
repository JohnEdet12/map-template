/**
 * The artboard — the printable page floating over the map.
 *
 * Owns three things: the page rectangle's geometry on screen, the DOM for
 * every element inside it, and the drag / resize / snap interaction. All
 * element coordinates are percentages of the artboard, which is what lets
 * the same numbers drive a 96 dpi preview and a 300 dpi export.
 */

import { $, el } from '../core/dom.js';
import { state, set, touch, checkpoint } from '../core/store.js';
import { PAPER_SIZES, paperDimsLabel } from '../core/constants.js';
import { renderElementDom, elementLabel } from '../layout/elements.js';
import { currentMetresPerPixel } from '../layout/derive.js';

let artboard, layer, label, wrap;
const nodes = new Map();          // element id → .el node
let dragging = null;
let guides = [];

const SNAP_TOLERANCE = 0.55;      // percent of artboard
const HANDLES = ['nw', 'ne', 'sw', 'se'];

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

/** Page dimensions in inches, honouring orientation. */
export function paperDims(page = state.page) {
  const paper = PAPER_SIZES[page.size] ?? PAPER_SIZES.a4;
  const orientation = paper.fixedOrientation ?? page.orientation;
  const portrait = orientation === 'portrait';
  const long = Math.max(paper.wIn, paper.hIn);
  const short = Math.min(paper.wIn, paper.hIn);
  return { wIn: portrait ? short : long, hIn: portrait ? long : short, label: paper.label, orientation };
}

/** The artboard rectangle in canvas-wrap pixels. */
export function artboardRect() {
  if (!artboard) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: artboard.offsetLeft,
    y: artboard.offsetTop,
    w: artboard.offsetWidth,
    h: artboard.offsetHeight,
  };
}

/** Unit function: element style numbers → screen pixels. */
const unit = () => {
  const w = artboard?.offsetWidth || 600;
  return (pt) => (pt ?? 0) * 0.001 * w;
};

/**
 * Screen pixels per millimetre of printed page.
 *
 * The bridge between a line weight the user states in millimetres and the
 * pixels MapLibre paints in. It moves whenever the paper size or the window
 * does, which is why layers/render.js re-syncs on both — a stored 0.5 mm has
 * to keep meaning 0.5 mm of paper, not the pixel count it happened to be when
 * the window was that wide.
 */
export function pagePxPerMm() {
  const w = artboard?.offsetWidth;
  if (!w) return 3.3;
  const { wIn } = paperDims();
  return w / (wIn * 25.4);
}

/** Size and centre the page over the map. */
export function layoutArtboard() {
  if (!artboard || !wrap) return;
  const { wIn, hIn, label: paperLabel, orientation } = paperDims();
  const aspect = wIn / hIn;

  const availW = wrap.clientWidth - 96;
  const availH = wrap.clientHeight - 84;
  let w = Math.max(160, availW);
  let h = w / aspect;
  if (h > availH) { h = Math.max(140, availH); w = h * aspect; }

  artboard.style.width = `${Math.round(w)}px`;
  artboard.style.height = `${Math.round(h)}px`;
  artboard.style.left = `${Math.round((wrap.clientWidth - w) / 2)}px`;
  artboard.style.top = `${Math.round((wrap.clientHeight - h) / 2)}px`;

  if (label) {
    const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
    label.textContent = `${paperLabel} ${orientation} · ${paperDimsLabel(paper, orientation === 'portrait')} · ${state.page.dpi} dpi`;
  }
}

/* ------------------------------------------------------------------ */
/* element DOM                                                         */
/* ------------------------------------------------------------------ */

function buildNode(elm) {
  const node = el('div.el', { dataset: { id: elm.id } }, [
    el('div.el-tag', { text: elementLabel(elm) }),
    el('div.el-inner'),
    ...HANDLES.map((h) => el('div.el-handle', { dataset: { h } })),
  ]);
  node.addEventListener('pointerdown', (e) => onPointerDown(e, elm.id));
  return node;
}

function positionNode(node, elm) {
  node.style.left = `${elm.x}%`;
  node.style.top = `${elm.y}%`;
  node.style.width = `${elm.w}%`;
  node.style.height = `${elm.h}%`;
}

/** Rebuild the element layer from state. */
export function renderElements() {
  if (!layer) return;
  const u = unit();
  const ctx = { u, mPerPx: currentMetresPerPixel(), artW: artboard.offsetWidth };
  const seen = new Set();

  state.elements.forEach((elm, index) => {
    seen.add(elm.id);
    let node = nodes.get(elm.id);
    if (!node) {
      node = buildNode(elm);
      nodes.set(elm.id, node);
      layer.append(node);
    }
    node.style.zIndex = String(index + 1);
    node.classList.toggle('is-selected', elm.id === state.selectedElementId);
    node.classList.toggle('is-locked', Boolean(elm.locked));
    node.style.display = elm.hidden ? 'none' : '';
    node.querySelector('.el-tag').textContent = elementLabel(elm);
    positionNode(node, elm);
    if (!elm.hidden) renderElementDom(node.querySelector('.el-inner'), elm, ctx);
  });

  for (const [id, node] of nodes) {
    if (!seen.has(id)) { node.remove(); nodes.delete(id); }
  }
}

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */
export function selectElement(id) {
  if (state.selectedElementId === id) return;
  set({ selectedElementId: id, selectedLayerId: null }, { history: false });
}

/* ------------------------------------------------------------------ */
/* snapping                                                            */
/* ------------------------------------------------------------------ */
function snapTargets(exceptId) {
  const v = [0, 50, 100];
  const h = [0, 50, 100];
  for (const other of state.elements) {
    if (other.id === exceptId || other.hidden) continue;
    v.push(other.x, other.x + other.w / 2, other.x + other.w);
    h.push(other.y, other.y + other.h / 2, other.y + other.h);
  }
  return { v, h };
}

function nearest(value, candidates) {
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d <= SNAP_TOLERANCE && (best === null || d < Math.abs(value - best))) best = c;
  }
  return best;
}

function clearGuides() {
  guides.forEach((g) => g.remove());
  guides = [];
}

function drawGuide(axis, pct) {
  const g = el(`div.snap-guide.snap-guide--${axis}`);
  if (axis === 'v') g.style.left = `${pct}%`;
  else g.style.top = `${pct}%`;
  artboard.append(g);
  guides.push(g);
}

/** Snap an element's box, returning the adjusted box and the guides to show. */
function applySnap(box, exceptId, mode) {
  const { v, h } = snapTargets(exceptId);
  const shown = [];

  const edgesX = mode === 'move'
    ? [['x', box.x], ['cx', box.x + box.w / 2], ['r', box.x + box.w]]
    : [['x', box.x], ['r', box.x + box.w]];
  for (const [kind, value] of edgesX) {
    const hit = nearest(value, v);
    if (hit === null) continue;
    const delta = hit - value;
    if (mode === 'move') box.x += delta;
    else if (kind === 'x') { box.x += delta; box.w -= delta; }
    else box.w += delta;
    shown.push(['v', hit]);
    break;
  }

  const edgesY = mode === 'move'
    ? [['y', box.y], ['cy', box.y + box.h / 2], ['b', box.y + box.h]]
    : [['y', box.y], ['b', box.y + box.h]];
  for (const [kind, value] of edgesY) {
    const hit = nearest(value, h);
    if (hit === null) continue;
    const delta = hit - value;
    if (mode === 'move') box.y += delta;
    else if (kind === 'y') { box.y += delta; box.h -= delta; }
    else box.h += delta;
    shown.push(['h', hit]);
    break;
  }

  return { box, shown };
}

/* ------------------------------------------------------------------ */
/* drag + resize                                                       */
/* ------------------------------------------------------------------ */
function onPointerDown(event, id) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  event.stopPropagation();
  selectElement(id);
  if (elm.locked || event.button !== 0) return;

  const handle = event.target.closest('.el-handle')?.dataset.h ?? null;
  const rect = artboardRect();
  const node = nodes.get(id);

  dragging = {
    id, handle, node,
    startX: event.clientX,
    startY: event.clientY,
    origin: { x: elm.x, y: elm.y, w: elm.w, h: elm.h },
    rect,
    moved: false,
  };

  node.setPointerCapture(event.pointerId);
  node.classList.add('is-dragging');
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(event) {
  if (!dragging) return;
  const { rect, origin, handle } = dragging;
  const dx = ((event.clientX - dragging.startX) / rect.w) * 100;
  const dy = ((event.clientY - dragging.startY) / rect.h) * 100;
  if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) dragging.moved = true;

  let box;
  if (!handle) {
    box = { x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h };
  } else {
    box = { ...origin };
    if (handle.includes('w')) { box.x = origin.x + dx; box.w = origin.w - dx; }
    if (handle.includes('e')) { box.w = origin.w + dx; }
    if (handle.includes('n')) { box.y = origin.y + dy; box.h = origin.h - dy; }
    if (handle.includes('s')) { box.h = origin.h + dy; }
    box.w = Math.max(3, box.w);
    box.h = Math.max(1.6, box.h);
  }

  clearGuides();
  if (!event.altKey) {
    const { box: snapped, shown } = applySnap(box, dragging.id, handle ? 'resize' : 'move');
    box = snapped;
    shown.forEach(([axis, pct]) => drawGuide(axis, pct));
  }

  // Keep at least a sliver on the page.
  box.x = Math.min(Math.max(box.x, -box.w + 4), 96);
  box.y = Math.min(Math.max(box.y, -box.h + 2), 98);

  dragging.box = box;
  positionNode(dragging.node, box);
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  clearGuides();
  if (!dragging) return;
  const { id, node, box, moved } = dragging;
  node.classList.remove('is-dragging');

  if (moved && box) {
    checkpoint();
    const elm = state.elements.find((e) => e.id === id);
    if (elm) {
      Object.assign(elm, {
        x: Number(box.x.toFixed(2)), y: Number(box.y.toFixed(2)),
        w: Number(box.w.toFixed(2)), h: Number(box.h.toFixed(2)),
      });
      touch('elements');
    }
  }
  dragging = null;
}

/* ------------------------------------------------------------------ */
/* element operations used by the panels                               */
/* ------------------------------------------------------------------ */
export function addElement(elm, { select = true } = {}) {
  checkpoint();
  set({ elements: [...state.elements, elm] }, { history: false });
  if (select) selectElement(elm.id);
  return elm;
}

export function updateElement(id, patch, { history = true } = {}) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  if (history) checkpoint();
  const { style, ...rest } = patch;
  Object.assign(elm, rest);
  if (style) elm.style = { ...elm.style, ...style };
  touch('elements');
}

export function removeElement(id) {
  checkpoint();
  set({ elements: state.elements.filter((e) => e.id !== id) }, { history: false });
  if (state.selectedElementId === id) set({ selectedElementId: null }, { history: false });
}

export function reorderElement(id, delta) {
  const list = [...state.elements];
  const i = list.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  checkpoint();
  [list[i], list[j]] = [list[j], list[i]];
  set({ elements: list }, { history: false });
}

export function duplicateElement(id) {
  const elm = state.elements.find((e) => e.id === id);
  if (!elm) return;
  const copy = {
    ...structuredClone({ ...elm, _img: undefined }),
    id: `${elm.id}_c${Math.floor(Math.random() * 1e4).toString(36)}`,
    x: Math.min(92, elm.x + 2),
    y: Math.min(96, elm.y + 2),
  };
  addElement(copy);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
export function initArtboard() {
  artboard = $('#artboard');
  layer = $('#element-layer');
  label = $('#artboard-label');
  wrap = $('#canvas-wrap');
  if (!artboard) return;

  // Click on empty canvas clears the selection.
  wrap.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.el')) return;
    if (state.selectedElementId) set({ selectedElementId: null }, { history: false });
  });

  window.addEventListener('resize', () => { layoutArtboard(); renderElements(); });

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio') return;
    const target = event.target;
    if (target.matches('input, textarea, select, [contenteditable]')) return;
    const id = state.selectedElementId;
    if (!id) return;
    const elm = state.elements.find((e) => e.id === id);
    if (!elm || elm.locked) return;

    if (event.key === 'Escape') { set({ selectedElementId: null }, { history: false }); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeElement(id); return; }

    const step = event.shiftKey ? 1 : 0.2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    updateElement(id, { x: Number((elm.x + move[0]).toFixed(2)), y: Number((elm.y + move[1]).toFixed(2)) }, { history: false });
  });

  layoutArtboard();
  renderElements();
}

/** Show a transient hint over the canvas. */
export function hint(message, ms = 4200) {
  const node = $('#canvas-hint');
  if (!node) return;
  node.innerHTML = message;
  node.classList.add('is-shown');
  clearTimeout(hint._t);
  hint._t = setTimeout(() => node.classList.remove('is-shown'), ms);
}

export const artboardNode = () => artboard;
