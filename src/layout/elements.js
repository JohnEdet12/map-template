/**
 * Element catalogue — the movable furniture that sits on the artboard.
 *
 * Every element type is defined exactly once, here, with three things:
 *   1. `defaults` + `style` — where it lands and how it looks
 *   2. `dom()`    — how it draws on screen, inside an `.el-inner` div
 *   3. `paint()`  — how it draws into the export canvas
 *
 * Both renderers read their content from the same helpers in derive.js and
 * use the same unit function `u()`, so what you drag on screen is what
 * comes out of the PDF. Keeping the pair side by side in one file is
 * deliberate: in the v2 prototype the DOM card and the canvas card were in
 * different places and drifted apart.
 */

import { FONTS } from '../core/constants.js';
import { uid, esc } from '../core/dom.js';
import { state } from '../core/store.js';
import { bboxOf } from '../core/geo.js';
import { getMap } from '../core/map.js';
import { contextFor } from '../data/inset-context.js';
import {
  rgba, roundRect, paintChrome, setFont, drawParagraph, drawLine, drawSwatch,
} from './paint.js';
import { legendRows, statsRows, metadataRows, creditsText, scaleBarFor } from './derive.js';
import { iconSvg } from '../layers/icons.js';
import { dashArray, isTransparent, swatchStroke } from '../layers/symbology.js';

/* ------------------------------------------------------------------ */
/* shared style presets                                                */
/* ------------------------------------------------------------------ */
const CARD = {
  bg: '#ffffff', bgOpacity: 0.94, border: '#e2e8f0', borderWidth: 0.9,
  radius: 8, padding: 9, shadow: true,
};
const PLAIN = {
  bg: '#ffffff', bgOpacity: 0, border: '#0f172a', borderWidth: 0,
  radius: 0, padding: 0, shadow: false,
};

const TEXT = { font: 'sans', size: 13, weight: 400, italic: false, color: '#0f172a', align: 'left', lineHeight: 1.32 };

/* ------------------------------------------------------------------ */
/* small helpers used by both renderers                                */
/* ------------------------------------------------------------------ */

/** Content box after border + padding, in the same units as `box`. */
function contentBox(box, style, u) {
  const inset = u(style.padding ?? 0) + u(style.borderWidth ?? 0);
  return { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 };
}

/** Apply an element's chrome + typography to a DOM node. */
function chromeDom(node, style, u) {
  const bw = style.borderWidth ?? 0;
  Object.assign(node.style, {
    background: (style.bgOpacity ?? 0) > 0 ? rgba(style.bg, style.bgOpacity) : 'transparent',
    border: bw > 0 ? `${Math.max(0.5, u(bw))}px solid ${style.border}` : '0',
    borderRadius: `${u(style.radius ?? 0)}px`,
    padding: `${u(style.padding ?? 0)}px`,
    boxShadow: style.shadow ? `0 ${u(2.5)}px ${u(9)}px rgba(15,23,42,.16)` : 'none',
    color: style.color ?? '#0f172a',
    fontFamily: FONTS[style.font]?.stack ?? FONTS.sans.stack,
    fontSize: `${u(style.size ?? 13)}px`,
    fontWeight: String(style.weight ?? 400),
    fontStyle: style.italic ? 'italic' : 'normal',
    textAlign: style.align ?? 'left',
    lineHeight: String(style.lineHeight ?? 1.32),
  });
}

/**
 * Swatch markup for the on-screen legend — the twin of drawSwatch() in
 * paint.js. A row that carries an icon or a line pattern shows it, so the
 * legend key is the same mark the map draws.
 */
function swatchHtml(kind, color, px, mark = {}) {
  // Nothing is drawn, so the key shows an empty outline — the same way a
  // legend has always said "boundary only, no fill".
  if (isTransparent(color)) {
    const w = kind === 'line' ? px : px;
    const h = kind === 'line' ? Math.max(2, px * 0.5) : px * 0.84;
    const radius = kind === 'point' ? '50%' : `${px * 0.18}px`;
    return `<i style="display:block;width:${w}px;height:${h}px;flex:none;border:1px solid currentColor;border-radius:${radius};opacity:.55;background:transparent"></i>`;
  }

  if (kind === 'point' && mark.icon) {
    const svg = iconSvg(mark.icon, color, px);
    if (svg) return svg;
  }
  if (kind === 'line') {
    const h = Math.max(1.2, swatchStroke(px, mark.width));
    const pattern = dashArray(mark.dash);
    if (pattern) {
      // A repeating gradient reproduces the dasharray without an SVG, in the
      // same on/off proportions the map uses — including patterns with more
      // than one dash in them, like dash-dot.
      const stops = [];
      let at = 0;
      pattern.forEach((seg, i) => {
        const end = at + seg * h;
        stops.push(`${i % 2 ? 'transparent' : color} ${at}px ${end}px`);
        at = end;
      });
      return `<i style="display:block;width:${px}px;height:${h}px;flex:none;background:repeating-linear-gradient(90deg,${stops.join(',')})"></i>`;
    }
    return `<i style="display:block;width:${px}px;height:${h}px;border-radius:99px;background:${color};flex:none"></i>`;
  }
  if (kind === 'point') {
    return `<i style="display:block;width:${px * 0.78}px;height:${px * 0.78}px;border-radius:50%;background:${color};box-shadow:0 0 0 ${Math.max(0.6, px * 0.1)}px #fff;flex:none;margin:0 ${px * 0.11}px"></i>`;
  }
  return `<i style="display:block;width:${px}px;height:${px * 0.84}px;border-radius:${px * 0.18}px;background:${color};flex:none"></i>`;
}

/**
 * Collapse a run of `swatch: 'ramp'` rows into a single gradient entry.
 * A continuous index (NDVI, temperature) then prints as a colour bar with
 * end labels instead of a stack of near-identical squares.
 */
function groupLegendRows(rows) {
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (row.swatch === 'ramp' && last?.kind === 'ramp') {
      last.colors.push(row.color);
      last.labels.push(row.label);
    } else if (row.swatch === 'ramp') {
      out.push({ kind: 'ramp', colors: [row.color], labels: [row.label] });
    } else {
      out.push({ kind: 'item', ...row });
    }
  }
  return out;
}

const rampEnds = (labels) => {
  const named = labels.filter(Boolean);
  return [named[0] ?? '', named.length > 1 ? named[named.length - 1] : ''];
};

/** Rows of {label, value} as a two-column DOM block. */
function rowsHtml(rows, u, style, { valueAlign = 'right' } = {}) {
  const gap = u(style.gap ?? 2.6);
  return rows.map((r) => {
    const strong = r.emphasis ? `font-weight:700;` : '';
    const muted = r.muted ? `opacity:.6;` : '';
    return `<div style="display:flex;gap:${u(6)}px;justify-content:space-between;align-items:baseline;margin-bottom:${gap}px;${muted}">
      <span style="opacity:.72;white-space:nowrap">${esc(r.label)}</span>
      <span style="${strong}text-align:${valueAlign};min-width:0">${esc(r.value)}</span>
    </div>`;
  }).join('');
}

/** Paint a {label, value} row list into the canvas; returns the y cursor. */
function paintRows(c, rows, box, style, u, opts = {}) {
  const gap = u(style.gap ?? 2.6);
  const lh = u(style.size) * (style.lineHeight ?? 1.32);
  let y = box.y;
  for (const r of rows) {
    if (y + lh > box.y + box.h) break;
    const alpha = r.muted ? 0.6 : 1;
    c.globalAlpha = alpha;
    setFont(c, { ...style, weight: 400 }, u);
    const labelW = c.measureText(r.label).width;
    drawLine(c, r.label, box.x, y, box.w * 0.62, { ...style, weight: 400, color: rgba(style.color, 0.74), u });
    const valueStyle = { ...style, weight: r.emphasis ? 700 : (opts.valueWeight ?? 600), u, color: style.color };
    setFont(c, valueStyle, u);
    const vw = Math.max(0, box.w - labelW - u(6));
    drawLine(c, r.value, box.x + box.w - vw, y, vw, { ...valueStyle, align: 'right' });
    c.globalAlpha = 1;
    y += lh + gap;
  }
  return y;
}

/** Section heading shared by legend / stats / metadata. */
function paintHeading(c, text, box, style, u) {
  if (!text) return box.y;
  const size = (style.size ?? 12) * 0.86;
  setFont(c, { ...style, size, weight: 800 }, u);
  c.fillStyle = rgba(style.color, 0.62);
  c.textBaseline = 'top';
  c.fillText(String(text).toUpperCase(), box.x, box.y);
  return box.y + u(size) * 1.9;
}

function headingHtml(text, style, u) {
  if (!text) return '';
  const size = (style.size ?? 12) * 0.86;
  return `<div style="font-size:${u(size)}px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.62;margin-bottom:${u(size) * 0.75}px">${esc(text)}</div>`;
}

/* ------------------------------------------------------------------ */
/* north arrow glyphs — one description, two renderers                 */
/* ------------------------------------------------------------------ */
const NORTH_SHAPES = {
  arrow: {
    ring: false,
    polys: [{ pts: [[50, 4], [74, 86], [50, 66], [26, 86]], tone: 'solid' }],
  },
  needle: {
    ring: false,
    polys: [
      { pts: [[50, 4], [66, 84], [50, 62]], tone: 'solid' },
      { pts: [[50, 4], [34, 84], [50, 62]], tone: 'light' },
    ],
  },
  compass: {
    ring: true,
    polys: [
      { pts: [[8, 50], [50, 42], [92, 50], [50, 58]], tone: 'light' },
      { pts: [[50, 6], [58, 50], [50, 94], [42, 50]], tone: 'solid' },
    ],
  },
};

const toneFill = (tone, color) => (tone === 'light' ? rgba(color, 0.24) : color);

function northSvg(variant, color, rotation) {
  const shape = NORTH_SHAPES[variant] ?? NORTH_SHAPES.arrow;
  const ring = shape.ring
    ? `<circle cx="50" cy="50" r="47" fill="none" stroke="${color}" stroke-width="3"/>`
    : '';
  const polys = shape.polys.map((p) =>
    `<polygon points="${p.pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${toneFill(p.tone, color)}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
  return `<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;transform:rotate(${rotation}deg)">${ring}${polys}</svg>`;
}

function paintNorthGlyph(c, variant, color, cx, cy, side, rotation) {
  const shape = NORTH_SHAPES[variant] ?? NORTH_SHAPES.arrow;
  c.save();
  c.translate(cx, cy);
  c.rotate((rotation * Math.PI) / 180);
  c.scale(side / 100, side / 100);
  c.translate(-50, -50);
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.lineWidth = 1.6;
  if (shape.ring) {
    c.beginPath();
    c.arc(50, 50, 47, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.stroke();
    c.lineWidth = 1.6;
  }
  for (const poly of shape.polys) {
    c.beginPath();
    poly.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = toneFill(poly.tone, color);
    c.fill();
    c.stroke();
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* shapes — one geometry description, two renderers                    */
/* ------------------------------------------------------------------ */
export const SHAPE_VARIANTS = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse',   label: 'Ellipse' },
  { id: 'triangle',  label: 'Triangle' },
  { id: 'diamond',   label: 'Diamond' },
  { id: 'star',      label: 'Star' },
  { id: 'line',      label: 'Line' },
  { id: 'arrow',     label: 'Arrow' },
];

/** Points on a 0–100 grid, or null for shapes drawn with their own path. */
function shapePoints(variant) {
  switch (variant) {
    case 'triangle': return [[50, 2], [98, 98], [2, 98]];
    case 'diamond':  return [[50, 2], [98, 50], [50, 98], [2, 50]];
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 21 : 49;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push([50 + Math.cos(a) * r * 2, 50 + Math.sin(a) * r * 2]);
      }
      return pts;
    }
    case 'arrow': return [[2, 36], [64, 36], [64, 14], [98, 50], [64, 86], [64, 64], [2, 64]];
    case 'line':  return [[2, 50], [98, 50]];
    default: return null;
  }
}

const DASH_ARRAY = { solid: '', dashed: '6 4', dotted: '1.5 4' };

function shapeSvg(s, u) {
  const stroke = Math.max(0, u(s.strokeWidth ?? 0));
  const fill = (s.fillOpacity ?? 0) > 0 ? rgba(s.fill, s.fillOpacity) : 'none';
  const dash = DASH_ARRAY[s.dash] ?? '';
  const common = `fill="${fill}" stroke="${s.stroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}`;

  let body;
  if (s.variant === 'ellipse') {
    body = `<ellipse cx="50" cy="50" rx="48" ry="48" ${common}/>`;
  } else if (s.variant === 'rectangle' || !s.variant) {
    const r = Math.max(0, Math.min(40, s.radius ?? 0));
    body = `<rect x="2" y="2" width="96" height="96" rx="${r}" ${common}/>`;
  } else if (s.variant === 'line') {
    body = `<line x1="2" y1="50" x2="98" y2="50" fill="none" stroke="${s.stroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  } else {
    const pts = shapePoints(s.variant) ?? [];
    body = `<polygon points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" ${common}/>`;
  }

  const spin = s.rotation ? ` transform="rotate(${s.rotation} 50 50)"` : '';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible"><g${spin}>${body}</g></svg>`;
}

function paintShape(c, s, box, u) {
  const stroke = Math.max(0, u(s.strokeWidth ?? 0));
  const hasFill = (s.fillOpacity ?? 0) > 0;

  c.save();
  c.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (s.rotation) c.rotate((s.rotation * Math.PI) / 180);
  c.translate(-box.w / 2, -box.h / 2);

  const sx = box.w / 100;
  const sy = box.h / 100;
  const at = (x, y) => [x * sx, y * sy];

  c.beginPath();
  if (s.variant === 'ellipse') {
    c.ellipse(box.w / 2, box.h / 2, (box.w / 2) * 0.96, (box.h / 2) * 0.96, 0, 0, Math.PI * 2);
  } else if (s.variant === 'rectangle' || !s.variant) {
    const r = Math.min((s.radius ?? 0) * sx, box.w / 2, box.h / 2);
    roundRect(c, 2 * sx, 2 * sy, 96 * sx, 96 * sy, r);
  } else {
    const pts = shapePoints(s.variant) ?? [];
    pts.forEach(([x, y], i) => {
      const [px, py] = at(x, y);
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    });
    if (s.variant !== 'line') c.closePath();
  }

  if (hasFill && s.variant !== 'line') {
    c.fillStyle = rgba(s.fill, s.fillOpacity);
    c.fill();
  }
  if (stroke > 0) {
    c.lineWidth = stroke;
    c.strokeStyle = s.stroke;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (s.dash === 'dashed') c.setLineDash([stroke * 3, stroke * 2]);
    else if (s.dash === 'dotted') c.setLineDash([stroke * 0.8, stroke * 2.2]);
    c.stroke();
  }
  c.restore();
}

/* ------------------------------------------------------------------ */
/* locator inset — project a study area into a small box               */
/* ------------------------------------------------------------------ */
/**
 * A lng/lat → box-pixel function fitted to `reference`, aspect preserved.
 *
 * Split out from the ring extraction below so that several outlines — a study
 * area and the region containing it — can share **one** projection. Projecting
 * each to its own bounds would centre both in the box and draw the study area
 * filling a country it is a fiftieth the size of.
 */
function ringProjector(reference, box) {
  const b = bboxOf(reference);
  if (!b) return null;
  const [w, s, e, n] = b;
  const spanX = Math.max(e - w, 1e-9);
  const spanY = Math.max(n - s, 1e-9);
  const k = Math.min(box.w / spanX, box.h / spanY);
  const ox = box.x + (box.w - spanX * k) / 2;
  const oy = box.y + (box.h - spanY * k) / 2;
  return ([lng, lat]) => [ox + (lng - w) * k, oy + (n - lat) * k];
}

/** Every polygon ring of a GeoJSON, projected and thinned for drawing. */
function ringsOf(geojson, project, stride = 1) {
  const rings = [];
  for (const f of geojson?.features ?? [geojson]) {
    const g = f?.geometry ?? f;
    if (!g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const poly of polys) {
      for (const ring of poly) {
        // An administrative outline can run to thousands of vertices and the
        // inset is a few centimetres across; past a few hundred points nothing
        // is added but time, on every repaint.
        const step = Math.max(stride, Math.ceil(ring.length / 400));
        const out = [];
        for (let i = 0; i < ring.length; i += step) out.push(project(ring[i]));
        if (out.length > 2) rings.push(out);
      }
    }
  }
  return rings.length ? rings : null;
}

/**
 * Everything the locator inset needs to draw, computed once for both
 * renderers.
 *
 * Both of them used to project the geometry themselves, which is how the
 * on-screen inset and the printed one came to disagree. One function, two
 * callers, no second opinion — the same rule the rest of this module follows.
 *
 * Projection is fitted to *the widest thing being drawn*: with a context
 * outline that is the context, so the study area lands in its true position
 * inside it, which is the entire point of a locator. Without one it is the
 * study area, exactly as before.
 *
 * @param {object} elm
 * @param {{x,y,w,h}} [box]  canvas pixels; omitted for the screen, which
 *        works in a viewBox of the element's own proportions instead.
 */
function insetPlan(elm, box) {
  const sa = state.studyArea;
  if (!sa?.geojson) return null;

  const s = elm.style ?? {};
  const mode = s.context ?? 'auto';
  const ctx = mode === 'none' ? null : contextFor(sa, mode);

  // On screen the viewBox is the element's aspect, scaled to a comfortable
  // number of user units; on canvas it is the box we were handed.
  const aspect = box ? box.w / box.h : Math.max(0.05, (elm.w || 1) / (elm.h || 1));
  const W = box ? box.w : (aspect >= 1 ? 100 : 100 * aspect);
  const H = box ? box.h : (aspect >= 1 ? 100 / aspect : 100);
  const pad = Math.min(W, H) * 0.04;
  const frame = box
    ? { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 }
    : { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };

  // One projection for every ring, taken from whichever outline is widest, so
  // the study area sits where it really sits inside the context.
  const reference = ctx?.geojson ?? sa.geojson;
  const project = ringProjector(reference, frame);
  if (!project) return null;

  const area = ringsOf(sa.geojson, project);
  if (!area?.length) return null;

  let extent = null;
  if (s.extent) {
    const b = viewBboxOf();
    if (b) {
      const [x0, y1] = project([b[0], b[3]]);
      const [x1, y0] = project([b[2], b[1]]);
      // A view zoomed well inside the study area collapses to a dot, which
      // reads as a stray mark rather than as "you are here".
      if (Math.abs(x1 - x0) >= 1.5 && Math.abs(y0 - y1) >= 1.5) {
        extent = { x: x0, y: y1, w: x1 - x0, h: y0 - y1 };
      }
    }
  }

  return {
    W, H,
    area,
    context: ctx ? ringsOf(ctx.geojson, project) : null,
    extent,
    stroke: box ? 1 : Math.max(0.6, Math.min(W, H) * 0.012),
  };
}

/**
 * The pixel box of an element's inner node, or null before it has one.
 *
 * Null on the very first paint of a fresh artboard, which is why insetPlan
 * still has a fallback: the element renders once at an estimated aspect and
 * again, correctly, as soon as it has been laid out.
 */
function boxOfNode(node) {
  if (!node) return null;
  // getBoundingClientRect, not clientWidth: the latter is rounded to whole
  // pixels, and a 100 × 66.4 box reported as 100 × 66 is an aspect ratio 1.5%
  // out — which the SVG then applies to the outline as a 1.5% stretch.
  const { width: w, height: h } = node.getBoundingClientRect();
  return w > 2 && h > 2 ? { x: 0, y: 0, w, h } : null;
}

/** The bounding box the main map is currently showing, as [w, s, e, n]. */
function viewBboxOf() {
  try {
    const b = getMap()?.getBounds();
    if (!b) return null;
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* the catalogue                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} ElementDef
 * @property {string} label    shown in the Elements panel and the selection tag
 * @property {string} icon
 * @property {string} hint
 * @property {string[]} inspect  which inspector control groups to show
 * @property {object} defaults   x, y, w, h (percent of artboard) and text
 * @property {object} style
 * @property {(inner: HTMLElement, elm: object, ctx: object) => void} dom
 * @property {(c: CanvasRenderingContext2D, elm: object, box: object, ctx: object) => void} paint
 */

/** @type {Record<string, ElementDef>} */
export const ELEMENT_TYPES = {
  /* ---------------------------------------------------------------- */
  title: {
    label: 'Title', icon: 'T', hint: 'The headline of the map',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 5, w: 62, h: 8, text: 'Map title' },
    style: { ...TEXT, ...PLAIN, font: 'display', size: 34, weight: 600, lineHeight: 1.12 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  subtitle: {
    label: 'Subtitle', icon: 't', hint: 'A line of context under the title',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 13.4, w: 62, h: 5, text: 'Study area · prepared 2026' },
    style: { ...TEXT, ...PLAIN, size: 15, weight: 400, color: '#475569', lineHeight: 1.25 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  text: {
    label: 'Text box', icon: '¶', hint: 'Free text — notes, a caption, a disclaimer',
    inspect: ['text', 'type', 'chrome'],
    defaults: { x: 6, y: 62, w: 34, h: 12, text: 'Add your note here.' },
    style: { ...TEXT, ...PLAIN, size: 12 },
    dom(inner, elm) {
      inner.style.whiteSpace = 'pre-wrap';
      inner.textContent = elm.text ?? '';
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, elm.text ?? '', box, { ...elm.style, u: ctx.u });
    },
  },

  /* ---------------------------------------------------------------- */
  legend: {
    label: 'Legend', icon: '▤', hint: 'Updates itself from the visible layers',
    inspect: ['heading', 'type', 'chrome', 'legend'],
    defaults: { x: 6, y: 72, w: 30, h: 22, text: 'Legend' },
    style: { ...TEXT, ...CARD, size: 11, gap: 2.6, swatch: 13 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const groups = groupLegendRows(legendRows());
      const sw = u(elm.style.swatch ?? 13);
      const gap = u(elm.style.gap ?? 2.6);

      const body = groups.length
        ? groups.map((g) => {
            if (g.kind === 'ramp') {
              const [from, to] = rampEnds(g.labels);
              return `<div style="margin-bottom:${gap * 1.6}px">
                <div style="height:${sw * 0.86}px;border-radius:${sw * 0.16}px;background:linear-gradient(90deg,${g.colors.join(',')})"></div>
                <div style="display:flex;justify-content:space-between;gap:${u(4)}px;margin-top:${u(1.4)}px;opacity:.72">
                  <span>${esc(from)}</span><span>${esc(to)}</span>
                </div>
              </div>`;
            }
            return `<div style="display:flex;align-items:center;gap:${u(5)}px;margin-bottom:${gap}px">
              ${swatchHtml(g.swatch, g.color, sw, g)}
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.label)}</span>
            </div>`;
          }).join('')
        : `<div style="opacity:.55">Turn on a layer and it appears here.</div>`;

      inner.innerHTML = headingHtml(elm.text, elm.style, u) + body;
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      let y = paintHeading(c, elm.text, box, s, u);
      const groups = groupLegendRows(legendRows());
      const sw = u(s.swatch ?? 13);
      const lh = u(s.size) * (s.lineHeight ?? 1.32);
      const gap = u(s.gap ?? 2.6);
      const bottom = box.y + box.h;

      if (!groups.length) {
        drawLine(c, 'Turn on a layer and it appears here.', box.x, y, box.w, { ...s, u, color: rgba(s.color, 0.55) });
        return;
      }

      for (const g of groups) {
        if (g.kind === 'ramp') {
          const barH = sw * 0.86;
          if (y + barH + lh > bottom + lh * 0.4) break;
          const grad = c.createLinearGradient(box.x, 0, box.x + box.w, 0);
          g.colors.forEach((color, i) => grad.addColorStop(g.colors.length === 1 ? 0 : i / (g.colors.length - 1), color));
          roundRect(c, box.x, y, box.w, barH, barH * 0.16);
          c.fillStyle = grad;
          c.fill();

          const [from, to] = rampEnds(g.labels);
          const labelY = y + barH + u(1.4);
          drawLine(c, from, box.x, labelY, box.w / 2, { ...s, u, color: rgba(s.color, 0.72) });
          drawLine(c, to, box.x + box.w / 2, labelY, box.w / 2, { ...s, u, align: 'right', color: rgba(s.color, 0.72) });
          y = labelY + lh + gap * 1.6;
          continue;
        }

        const step = Math.max(lh, sw) + gap;
        if (y + step > bottom + step * 0.4) break;
        // `inkColor` lets a hollow swatch borrow the legend's own text colour,
        // which is what `currentColor` does for the on-screen twin.
        drawSwatch(c, g.swatch, box.x, y + (lh - sw * 0.84) / 2 - u(0.5), sw, g.color, { ...g, inkColor: s.color });
        drawLine(c, g.label, box.x + sw + u(5), y, box.w - sw - u(5), { ...s, u });
        y += step;
      }
    },
  },

  stats: {
    label: 'Key figures', icon: '◫', hint: 'Study area, feature counts, analysis results',
    inspect: ['heading', 'type', 'chrome'],
    defaults: { x: 68, y: 72, w: 26, h: 20, text: 'Key figures' },
    style: { ...TEXT, ...CARD, size: 11, gap: 2.4 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      inner.innerHTML = headingHtml(elm.text, elm.style, u) + rowsHtml(statsRows(), u, elm.style);
    },
    paint(c, elm, box, ctx) {
      const s = elm.style;
      const y = paintHeading(c, elm.text, box, s, ctx.u);
      paintRows(c, statsRows(), { ...box, y, h: box.h - (y - box.y) }, s, ctx.u);
    },
  },

  metadata: {
    label: 'Map information', icon: 'ℹ', hint: 'Author, date, projection, sources',
    inspect: ['heading', 'type', 'chrome'],
    defaults: { x: 68, y: 46, w: 26, h: 24, text: 'Map information' },
    style: { ...TEXT, ...CARD, size: 9, gap: 2.2, lineHeight: 1.28 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      inner.innerHTML = headingHtml(elm.text, elm.style, u) + rowsHtml(metadataRows(), u, elm.style);
    },
    paint(c, elm, box, ctx) {
      const s = elm.style;
      const y = paintHeading(c, elm.text, box, s, ctx.u);
      paintRows(c, metadataRows(), { ...box, y, h: box.h - (y - box.y) }, s, ctx.u, { valueWeight: 500 });
    },
  },

  credits: {
    label: 'Credits', icon: '©', hint: 'Data attribution — required by OpenStreetMap',
    inspect: ['type', 'chrome'],
    defaults: { x: 6, y: 95.5, w: 60, h: 3.4 },
    style: { ...TEXT, ...PLAIN, size: 7.5, color: '#64748b', lineHeight: 1.35 },
    dom(inner, elm) {
      inner.textContent = creditsText();
    },
    paint(c, elm, box, ctx) {
      drawParagraph(c, creditsText(), box, { ...elm.style, u: ctx.u, maxLines: 3 });
    },
  },

  /* ---------------------------------------------------------------- */
  north: {
    label: 'North arrow', icon: '⇧', hint: 'Rotates with the map',
    inspect: ['north', 'chrome'],
    defaults: { x: 88, y: 5, w: 7, h: 9 },
    style: { ...TEXT, ...PLAIN, size: 10, weight: 800, color: '#0f172a', align: 'center', variant: 'arrow', showLabel: true },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const s = elm.style;
      const labelH = s.showLabel === false ? 0 : u(s.size) * 1.35;
      inner.innerHTML =
        `<div style="height:calc(100% - ${labelH}px);display:grid;place-items:center">
           <div style="height:100%;aspect-ratio:1">${northSvg(s.variant, s.color, -(state.mapView.bearing ?? 0))}</div>
         </div>` +
        (labelH ? `<div style="height:${labelH}px;line-height:${labelH}px;text-align:center;font-weight:${s.weight}">N</div>` : '');
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      const labelH = s.showLabel === false ? 0 : u(s.size) * 1.35;
      const side = Math.max(4, Math.min(box.w, box.h - labelH));
      paintNorthGlyph(c, s.variant, s.color, box.x + box.w / 2, box.y + (box.h - labelH) / 2, side, -(state.mapView.bearing ?? 0));
      if (labelH) {
        setFont(c, s, u);
        c.fillStyle = s.color;
        c.textBaseline = 'top';
        const w = c.measureText('N').width;
        c.fillText('N', box.x + (box.w - w) / 2, box.y + box.h - labelH + u(s.size) * 0.12);
      }
    },
  },

  scale: {
    label: 'Scale bar', icon: '⊢', hint: 'Ground distance at the current zoom',
    inspect: ['scale', 'chrome'],
    defaults: { x: 68, y: 94, w: 26, h: 4.2 },
    style: { ...TEXT, ...PLAIN, size: 9, weight: 700, color: '#0f172a', align: 'left', variant: 'checker', thickness: 4 },
    dom(inner, elm, ctx) {
      const { u, mPerPx } = ctx;
      const s = elm.style;
      const inset = u(s.padding ?? 0) + u(s.borderWidth ?? 0);
      const avail = Math.max(20, inner.clientWidth - inset * 2 || inner.getBoundingClientRect().width - inset * 2);
      const bar = scaleBarFor(avail, mPerPx);
      const px = Math.max(12, bar.fraction * avail);
      const th = u(s.thickness ?? 4);
      let barHtml;
      if (s.variant === 'line') {
        barHtml = `<div style="width:${px}px;height:${th}px;border-left:${Math.max(1, th * 0.22)}px solid ${s.color};border-right:${Math.max(1, th * 0.22)}px solid ${s.color};border-bottom:${Math.max(1, th * 0.28)}px solid ${s.color}"></div>`;
      } else if (s.variant === 'bar') {
        barHtml = `<div style="width:${px}px;height:${th}px;background:${s.color};border-radius:${th * 0.2}px"></div>`;
      } else {
        const seg = px / 4;
        barHtml = `<div style="display:flex;width:${px}px;height:${th}px;border:${Math.max(0.6, th * 0.13)}px solid ${s.color};box-sizing:border-box">
          ${[0, 1, 2, 3].map((i) => `<span style="width:${seg}px;background:${i % 2 ? 'transparent' : s.color}"></span>`).join('')}
        </div>`;
      }
      inner.innerHTML = `<div style="display:flex;flex-direction:column;gap:${u(1.6)}px;align-items:${s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start'}">
        ${barHtml}<div style="font-weight:${s.weight}">${esc(bar.label)}</div></div>`;
    },
    paint(c, elm, box, ctx) {
      const { u, scale, mPerPx } = ctx;
      const s = elm.style;
      const screenW = box.w / (scale || 1);
      const bar = scaleBarFor(screenW, mPerPx);
      const px = Math.max(u(6), bar.fraction * box.w);
      const th = u(s.thickness ?? 4);
      const x0 = s.align === 'center' ? box.x + (box.w - px) / 2 : s.align === 'right' ? box.x + box.w - px : box.x;

      c.save();
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
      if (s.variant === 'line') {
        c.lineWidth = Math.max(1, th * 0.24);
        c.beginPath();
        c.moveTo(x0, box.y);
        c.lineTo(x0, box.y + th);
        c.lineTo(x0 + px, box.y + th);
        c.lineTo(x0 + px, box.y);
        c.stroke();
      } else if (s.variant === 'bar') {
        roundRect(c, x0, box.y, px, th, th * 0.2);
        c.fill();
      } else {
        const seg = px / 4;
        for (let i = 0; i < 4; i++) {
          if (i % 2 === 0) c.fillRect(x0 + i * seg, box.y, seg, th);
        }
        c.lineWidth = Math.max(0.6, th * 0.13);
        c.strokeRect(x0, box.y, px, th);
      }
      c.restore();

      setFont(c, s, u);
      c.fillStyle = s.color;
      c.textBaseline = 'top';
      const tw = c.measureText(bar.label).width;
      const tx = s.align === 'center' ? box.x + (box.w - tw) / 2 : s.align === 'right' ? box.x + box.w - tw : box.x;
      c.fillText(bar.label, tx, box.y + th + u(1.8));
    },
  },

  /* ---------------------------------------------------------------- */
  neatline: {
    label: 'Neatline', icon: '▭', hint: 'A cartographic frame around the page',
    inspect: ['neatline'],
    defaults: { x: 2.5, y: 2.5, w: 95, h: 95 },
    style: { ...PLAIN, color: '#0f172a', borderWidth: 2, gap: 2.2, inner: true, innerWidth: 0.7 },
    dom(inner, elm, ctx) {
      const { u } = ctx;
      const s = elm.style;
      inner.style.border = `${Math.max(0.6, u(s.borderWidth))}px solid ${s.color}`;
      inner.innerHTML = s.inner
        ? `<div style="position:absolute;inset:${u(s.gap)}px;border:${Math.max(0.4, u(s.innerWidth))}px solid ${s.color}"></div>`
        : '';
      inner.style.position = 'absolute';
      inner.style.inset = '0';
    },
    paint(c, elm, box, ctx) {
      const { u } = ctx;
      const s = elm.style;
      c.save();
      c.strokeStyle = s.color;
      c.lineWidth = Math.max(0.6, u(s.borderWidth));
      c.strokeRect(box.x, box.y, box.w, box.h);
      if (s.inner) {
        const g = u(s.gap);
        c.lineWidth = Math.max(0.4, u(s.innerWidth));
        c.strokeRect(box.x + g, box.y + g, box.w - g * 2, box.h - g * 2);
      }
      c.restore();
    },
  },

  inset: {
    label: 'Locator inset', icon: '⊞', hint: 'Where the study area sits in the wider region',
    inspect: ['inset', 'chrome'],
    defaults: { x: 68, y: 20, w: 26, h: 20 },
    style: {
      ...TEXT, ...CARD, size: 8, color: '#0f172a',
      fill: '#38bdf8', stroke: '#0369a1', fillOpacity: 0.55, padding: 5,
      context: 'auto', contextFill: '#e2e8f0', contextStroke: '#94a3b8',
      extent: false, extentStroke: '#dc2626',
    },
    dom(inner, elm) {
      // Measured, not derived. An element's `w` is a percentage of page width
      // and its `h` a percentage of page *height*, so w/h is not its aspect
      // ratio on any paper that is not square — and an inset drawn to the
      // wrong aspect is an outline of the wrong shape. The node is positioned
      // before this runs, so its real pixel box is there to be read, and using
      // it makes the preview identical to the canvas path by construction.
      const plan = insetPlan(elm, boxOfNode(inner));
      if (!plan) {
        inner.innerHTML = '<div style="height:100%;display:grid;place-items:center;opacity:.5;text-align:center">Load a study area</div>';
        return;
      }
      const s = elm.style;
      // The viewBox matches the element's own proportions and the projection
      // is aspect-correct inside it, so the preview is the print. It used to
      // be a square viewBox stretched with preserveAspectRatio="none", which
      // squashed every outline on screen by exactly the amount the element was
      // off square — and then printed it correctly, so the two disagreed.
      const { W, H, context, area, extent, stroke } = plan;
      const path = (rings) => (rings ?? [])
        .map((r) => `M${r.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`).join('');

      inner.innerHTML = `<svg viewBox="0 0 ${W.toFixed(3)} ${H.toFixed(3)}" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
        ${context ? `<path d="${path(context)}" fill="${rgba(s.contextFill, 1)}" stroke="${s.contextStroke}" stroke-width="${stroke * 0.75}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
        <path d="${path(area)}" fill="${rgba(s.fill, s.fillOpacity)}" stroke="${s.stroke}" stroke-width="${stroke}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        ${extent ? `<rect x="${extent.x.toFixed(2)}" y="${extent.y.toFixed(2)}" width="${extent.w.toFixed(2)}" height="${extent.h.toFixed(2)}" fill="none" stroke="${s.extentStroke}" stroke-width="${stroke}" vector-effect="non-scaling-stroke"/>` : ''}
      </svg>`;
    },
    paint(c, elm, box, ctx) {
      const plan = insetPlan(elm, box);
      if (!plan) return;
      const s = elm.style;
      const w = Math.max(0.7, ctx.u(0.8));

      const trace = (rings) => {
        c.beginPath();
        for (const ring of rings) {
          ring.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
          c.closePath();
        }
      };

      c.save();
      c.lineJoin = 'round';

      // The surrounding region first, so the study area reads as sitting
      // inside it rather than beside it.
      if (plan.context) {
        trace(plan.context);
        c.fillStyle = rgba(s.contextFill, 1);
        c.fill('evenodd');
        c.strokeStyle = s.contextStroke;
        c.lineWidth = w * 0.75;
        c.stroke();
      }

      trace(plan.area);
      c.fillStyle = rgba(s.fill, s.fillOpacity);
      c.fill('evenodd');
      c.strokeStyle = s.stroke;
      c.lineWidth = w;
      c.stroke();

      if (plan.extent) {
        c.strokeStyle = s.extentStroke;
        c.lineWidth = w;
        c.strokeRect(plan.extent.x, plan.extent.y, plan.extent.w, plan.extent.h);
      }
      c.restore();
    },
  },

  shape: {
    label: 'Shape', icon: '◇', hint: 'Rectangle, circle, line, arrow or star',
    inspect: ['shape'],
    defaults: { x: 40, y: 45, w: 16, h: 12 },
    style: {
      ...PLAIN,
      variant: 'rectangle',
      fill: '#0369a1', fillOpacity: 0.18,
      stroke: '#0369a1', strokeWidth: 1.6,
      radius: 2, rotation: 0, dash: 'solid',
    },
    dom(inner, elm, ctx) {
      inner.innerHTML = shapeSvg(elm.style, ctx.u);
    },
    paint(c, elm, box, ctx) {
      paintShape(c, elm.style, box, ctx.u);
    },
  },

  logo: {
    label: 'Logo / image', icon: '▣', hint: 'Drop in an organisation logo',
    inspect: ['logo', 'chrome'],
    defaults: { x: 84, y: 88, w: 11, h: 8 },
    style: { ...PLAIN, src: '', fit: 'contain' },
    dom(inner, elm) {
      const src = elm.style.src;
      inner.innerHTML = src
        ? `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:${elm.style.fit};display:block" alt="" />`
        : `<div style="height:100%;display:grid;place-items:center;border:1px dashed #cbd5e1;border-radius:6px;color:#94a3b8;font-size:9px;text-align:center">Add image</div>`;
    },
    paint(c, elm, box) {
      const img = elm._img;
      if (!img || !img.complete || !img.naturalWidth) return;
      const k = elm.style.fit === 'cover'
        ? Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight)
        : Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      c.save();
      c.beginPath();
      c.rect(box.x, box.y, box.w, box.h);
      c.clip();
      c.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
      c.restore();
    },
  },
};

/** Order shown in the "Add element" panel. */
export const ELEMENT_ORDER = [
  'title', 'subtitle', 'text', 'legend', 'stats', 'metadata',
  'north', 'scale', 'inset', 'shape', 'logo', 'neatline', 'credits',
];

/* ------------------------------------------------------------------ */
/* factory + renderers                                                 */
/* ------------------------------------------------------------------ */

/** Build an element instance, merging template or user overrides. */
export function createElement(type, patch = {}) {
  const def = ELEMENT_TYPES[type];
  if (!def) throw new Error(`Unknown element type "${type}"`);
  const { style: stylePatch, ...rest } = patch;
  return {
    ...def.defaults,
    ...rest,
    id: patch.id ?? uid('el'),
    type,
    locked: patch.locked ?? false,
    hidden: patch.hidden ?? false,
    style: { ...def.style, ...(stylePatch ?? {}) },
  };
}

export const elementLabel = (elm) => ELEMENT_TYPES[elm.type]?.label ?? elm.type;

/**
 * Draw an element on screen.
 * @param {HTMLElement} inner  the `.el-inner` node
 * @param {object} elm
 * @param {{u: (pt:number)=>number, mPerPx: number}} ctx
 */
export function renderElementDom(inner, elm, ctx) {
  const def = ELEMENT_TYPES[elm.type];
  if (!def) return;
  inner.replaceChildren();
  inner.removeAttribute('style');
  if (elm.type !== 'neatline') chromeDom(inner, elm.style, ctx.u);
  def.dom(inner, elm, ctx);
}

/**
 * Draw an element into the export canvas.
 * @param {CanvasRenderingContext2D} c
 * @param {object} elm
 * @param {{x:number,y:number,w:number,h:number}} box  the element's page rect
 * @param {object} ctx  render context from derive.buildRenderContext()
 */
export function paintElement(c, elm, box, ctx) {
  const def = ELEMENT_TYPES[elm.type];
  if (!def) return;
  c.save();
  if (elm.type === 'neatline') {
    def.paint(c, elm, box, ctx);
  } else {
    paintChrome(c, box, elm.style, ctx.u);
    def.paint(c, elm, contentBox(box, elm.style, ctx.u), ctx);
  }
  c.restore();
}

/** Preload any images an element needs before an export pass. */
export function preloadElementAssets(elements) {
  const jobs = [];
  for (const elm of elements) {
    if (elm.type !== 'logo' || !elm.style.src) continue;
    jobs.push(new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => { elm._img = img; resolve(); };
      img.src = elm.style.src;
    }));
  }
  return Promise.all(jobs);
}
