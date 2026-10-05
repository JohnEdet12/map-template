/**
 * Alignment, distribution and placement for page elements.
 *
 * All coordinates are percentages of the artboard, so these are plain
 * arithmetic — no measuring, no layout thrash, and the result is identical
 * on screen and at 300 dpi.
 */

import { state, touch, checkpoint } from '../core/store.js';

/** Buttons offered by the align toolbar, in display order. */
export const ALIGN_ACTIONS = [
  { id: 'left',   axis: 'x', label: 'Align left',            icon: '⭰' },
  { id: 'centre', axis: 'x', label: 'Centre horizontally',   icon: '⭲' },
  { id: 'right',  axis: 'x', label: 'Align right',           icon: '⭱' },
  { id: 'top',    axis: 'y', label: 'Align top',             icon: '⭯' },
  { id: 'middle', axis: 'y', label: 'Centre vertically',     icon: '⭮' },
  { id: 'bottom', axis: 'y', label: 'Align bottom',          icon: '⭳' },
];

/** The nine snap positions of the placement grid. */
export const PLACEMENT_SPOTS = [
  ['top-left', 'top-centre', 'top-right'],
  ['middle-left', 'centre', 'middle-right'],
  ['bottom-left', 'bottom-centre', 'bottom-right'],
];

const editable = (ids) =>
  state.elements.filter((e) => ids.includes(e.id) && !e.locked && !e.hidden);

/** The bounding box of a set of elements, in page percent. */
export function selectionBounds(elements) {
  if (!elements.length) return null;
  return elements.reduce((box, e) => ({
    x1: Math.min(box.x1, e.x),
    y1: Math.min(box.y1, e.y),
    x2: Math.max(box.x2, e.x + e.w),
    y2: Math.max(box.y2, e.y + e.h),
  }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
}

const pageFrame = (margin) => ({ x1: margin, y1: margin, x2: 100 - margin, y2: 100 - margin });

/**
 * Align elements to the page or to their own bounding box.
 * @param {string[]} ids
 * @param {'left'|'centre'|'right'|'top'|'middle'|'bottom'} mode
 * @param {{relativeTo?: 'page'|'selection', margin?: number}} [opts]
 */
export function alignElements(ids, mode, opts = {}) {
  const { relativeTo = 'page', margin = 0 } = opts;
  const els = editable(ids);
  if (!els.length) return 0;

  // A single element has no meaningful "selection" frame to align within.
  const frame = relativeTo === 'selection' && els.length > 1
    ? selectionBounds(els)
    : pageFrame(margin);

  checkpoint();
  for (const e of els) {
    switch (mode) {
      case 'left':   e.x = frame.x1; break;
      case 'right':  e.x = frame.x2 - e.w; break;
      case 'centre': e.x = frame.x1 + (frame.x2 - frame.x1 - e.w) / 2; break;
      case 'top':    e.y = frame.y1; break;
      case 'bottom': e.y = frame.y2 - e.h; break;
      case 'middle': e.y = frame.y1 + (frame.y2 - frame.y1 - e.h) / 2; break;
      default: break;
    }
    e.x = round(e.x);
    e.y = round(e.y);
  }
  touch('elements');
  return els.length;
}

/**
 * Spread elements so the gaps between them are equal. The outermost two
 * stay put, which is what makes the result predictable.
 * @param {'x'|'y'} axis
 */
export function distributeElements(ids, axis) {
  const els = editable(ids);
  if (els.length < 3) return 0;

  const size = axis === 'x' ? 'w' : 'h';
  const sorted = [...els].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const span = (last[axis] + last[size]) - first[axis];
  const used = sorted.reduce((sum, e) => sum + e[size], 0);
  const gap = (span - used) / (sorted.length - 1);

  checkpoint();
  let cursor = first[axis];
  for (const e of sorted) {
    e[axis] = round(cursor);
    cursor += e[size] + gap;
  }
  touch('elements');
  return sorted.length;
}

/** Make every element the width and/or height of the largest one. */
export function matchSize(ids, axis) {
  const els = editable(ids);
  if (els.length < 2) return 0;
  const size = axis === 'x' ? 'w' : 'h';
  const target = Math.max(...els.map((e) => e[size]));
  checkpoint();
  for (const e of els) e[size] = round(target);
  touch('elements');
  return els.length;
}

/**
 * Drop one element onto a nine-point position on the page.
 * @param {string} id
 * @param {string} spot  e.g. 'top-left', 'centre', 'bottom-right'
 * @param {number} margin  page margin in percent
 */
export function placeElement(id, spot, margin = 4) {
  const e = state.elements.find((x) => x.id === id);
  if (!e || e.locked) return false;
  const [v, h] = spot === 'centre' ? ['middle', 'centre'] : spot.split('-');
  const frame = pageFrame(margin);

  checkpoint();
  if (h === 'left') e.x = frame.x1;
  else if (h === 'right') e.x = frame.x2 - e.w;
  else e.x = frame.x1 + (frame.x2 - frame.x1 - e.w) / 2;

  if (v === 'top') e.y = frame.y1;
  else if (v === 'bottom') e.y = frame.y2 - e.h;
  else e.y = frame.y1 + (frame.y2 - frame.y1 - e.h) / 2;

  e.x = round(e.x);
  e.y = round(e.y);
  touch('elements');
  return true;
}

/** Stretch an element across the page, inside the margin. */
export function fillPage(id, axis, margin = 4) {
  const e = state.elements.find((x) => x.id === id);
  if (!e || e.locked) return false;
  checkpoint();
  if (axis === 'x' || axis === 'both') { e.x = margin; e.w = round(100 - margin * 2); }
  if (axis === 'y' || axis === 'both') { e.y = margin; e.h = round(100 - margin * 2); }
  touch('elements');
  return true;
}

const round = (n) => Number(n.toFixed(2));
