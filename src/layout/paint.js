/**
 * Canvas 2-D drawing primitives shared by every element's export
 * renderer, mirroring what CSS does for the on-screen renderer.
 */

import { FONTS } from '../core/constants.js';
import { drawIcon } from '../layers/icons.js';
import { dashArray, isTransparent, swatchStroke } from '../layers/symbology.js';

/** #rrggbb + alpha → rgba() */
export function rgba(hex, alpha = 1) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return hex || 'transparent';
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => parseInt(c, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Paint an element's card chrome (background, border, shadow).
 * @returns {{x:number,y:number,w:number,h:number}} the content box after padding
 */
export function paintChrome(ctx, box, style, u) {
  const radius = u(style.radius ?? 0);
  const pad = u(style.padding ?? 0);
  const bw = u(style.borderWidth ?? 0);

  const hasFill = (style.bgOpacity ?? 0) > 0 && style.bg;
  const hasStroke = bw > 0 && style.border;

  if (hasFill || hasStroke) {
    ctx.save();
    if (style.shadow) {
      ctx.shadowColor = 'rgba(15,23,42,0.16)';
      ctx.shadowBlur = u(9);
      ctx.shadowOffsetY = u(3);
    }
    roundRect(ctx, box.x, box.y, box.w, box.h, radius);
    if (hasFill) { ctx.fillStyle = rgba(style.bg, style.bgOpacity ?? 1); ctx.fill(); }
    ctx.shadowColor = 'transparent';
    if (hasStroke) { ctx.lineWidth = bw; ctx.strokeStyle = style.border; ctx.stroke(); }
    ctx.restore();
  }

  return { x: box.x + pad + bw, y: box.y + pad + bw, w: box.w - 2 * (pad + bw), h: box.h - 2 * (pad + bw) };
}

/** Set ctx.font from an element style. */
export function setFont(ctx, { font = 'sans', size = 20, weight = 400, italic = false }, u) {
  const stack = FONTS[font]?.stack ?? FONTS.sans.stack;
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${u(size)}px ${stack}`;
}

/** Break `text` into lines that fit `maxWidth`, honouring existing newlines. */
export function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (!paragraph) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw wrapped, aligned text.
 * @returns {number} the y coordinate just below the last line
 */
export function drawParagraph(ctx, text, box, opts) {
  const { color = '#0f172a', align = 'left', lineHeight = 1.3, maxLines = 0, size = 12, u } = opts;
  setFont(ctx, opts, u);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';

  let lines = wrapLines(ctx, text, box.w);
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
  }

  const lh = u(size) * lineHeight;
  let y = box.y;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    const x = align === 'center' ? box.x + (box.w - w) / 2 : align === 'right' ? box.x + box.w - w : box.x;
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y;
}

/** Single line, no wrapping, truncated with an ellipsis. */
export function drawLine(ctx, text, x, y, maxWidth, opts) {
  setFont(ctx, opts, opts.u);
  ctx.fillStyle = opts.color ?? '#0f172a';
  ctx.textBaseline = 'top';
  let str = String(text ?? '');
  if (maxWidth && ctx.measureText(str).width > maxWidth) {
    while (str.length > 1 && ctx.measureText(`${str}…`).width > maxWidth) str = str.slice(0, -1);
    str += '…';
  }
  const w = ctx.measureText(str).width;
  const align = opts.align ?? 'left';
  const dx = align === 'center' ? (maxWidth - w) / 2 : align === 'right' ? maxWidth - w : 0;
  ctx.fillText(str, x + dx, y);
  return w;
}

/**
 * A legend/stat swatch: filled square, line stroke, point dot — or the very
 * icon and line pattern the map is drawing, when the row carries one.
 * @param {{icon?:string, dash?:string, width?:number}} [mark]
 */
export function drawSwatch(ctx, kind, x, y, size, color, mark = {}) {
  // The printed twin of the hollow swatch in elements.js — an outline where
  // a filled mark would be, because nothing is being drawn on the map.
  if (isTransparent(color)) {
    ctx.save();
    ctx.strokeStyle = rgba(mark.inkColor ?? '#0f172a', 0.55);
    ctx.lineWidth = Math.max(0.6, size * 0.07);
    if (kind === 'point') {
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === 'line') {
      const h = Math.max(2, size * 0.5);
      ctx.strokeRect(x, y + (size - h) / 2, size, h);
    } else {
      roundRect(ctx, x, y + size * 0.08, size, size * 0.84, size * 0.18);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (kind === 'point' && mark.icon && drawIcon(ctx, mark.icon, x, y, size, color)) return;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'line') {
    const w = Math.max(1, swatchStroke(size, mark.width));
    const pattern = dashArray(mark.dash);
    ctx.lineWidth = w;
    // Dash lengths are in line widths on the map; scaling them by the swatch
    // stroke keeps the printed pattern recognisably the same rhythm.
    ctx.setLineDash(pattern ? pattern.map((d) => d * w) : []);
    ctx.lineCap = pattern ? 'butt' : 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + size / 2);
    ctx.lineTo(x + size, y + size / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (kind === 'point') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  } else {
    roundRect(ctx, x, y + size * 0.08, size, size * 0.84, size * 0.18);
    ctx.fill();
  }
  ctx.restore();
}
