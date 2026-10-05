/**
 * Symbology — the single source of truth for how a layer is coloured.
 *
 * Three modes cover everything the studio needs:
 *   single      one colour for the whole layer
 *   categorised one colour per class (road type, facility type, land cover…)
 *   graduated   a colour ramp across a numeric range (density, area, distance)
 *
 * The map paint expression AND the legend rows are both derived from the
 * same symbology object, so a legend can never show a colour the map is not
 * using. Change the symbology and both update together.
 */

import { RAMPS } from '../core/constants.js';

export const SYMBOLOGY_MODES = [
  { id: 'single', label: 'Single colour', hint: 'One colour for every feature' },
  { id: 'categorised', label: 'By category', hint: 'A colour per type — road class, facility type…' },
  { id: 'graduated', label: 'By value', hint: 'A colour ramp across a number' },
];

export const RAMP_PRESETS = Object.entries(RAMPS).map(([id, r]) => ({ id, ...r }));

/**
 * Line patterns, in the one place that both the map and the legend read.
 *
 * `dash` is in line-width multiples, which is how MapLibre reads
 * `line-dasharray` — so a pattern keeps its proportions as the line gets
 * heavier instead of turning back into a solid stroke.
 */
export const LINE_STYLES = [
  { id: 'solid', label: 'Solid', dash: null },
  { id: 'dashed', label: 'Dashed', dash: [2.4, 1.6] },
  { id: 'dotted', label: 'Dotted', dash: [0.4, 1.6] },
  { id: 'dash-dot', label: 'Dash-dot', dash: [3.2, 1.4, 0.4, 1.4] },
  { id: 'long-dash', label: 'Long dash', dash: [5, 2.4] },
  { id: 'fine-dash', label: 'Fine dash', dash: [1.2, 1] },
];

const LINE_BY_ID = new Map(LINE_STYLES.map((s) => [s.id, s]));

/** The dash array for a style id, or null for a solid line. */
export const dashArray = (id) => LINE_BY_ID.get(id)?.dash ?? null;

/**
 * @typedef {object} Symbology
 * @property {'single'|'categorised'|'graduated'} mode
 * @property {string}  color        single mode
 * @property {string}  label        single mode: legend row text, defaults to the layer name
 * @property {string}  field        categorised / graduated: property to read
 * @property {Array<{value:string, label:string, color:string, icon?:string, dash?:string, width?:number}>} categories
 * @property {{label:string, color:string}} other   categorised fallback bucket
 * @property {Array<{min:number, max:number, color:string, label?:string}>} classes  graduated
 * @property {string}  ramp         graduated: RAMPS key
 * @property {string}  unit
 */

/* ------------------------------------------------------------------ */
/* colour helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * "No colour" — the cartographic one, not a colour that happens to be
 * invisible. An outline-only polygon is how every GIS draws a boundary you
 * want to see *through*, and it is the one thing a colour picker cannot say.
 *
 * It travels as this sentinel rather than as rgba(0,0,0,0) so the difference
 * between "deliberately empty" and "black at zero opacity" survives a save,
 * a legend row and a PDF.
 */
export const TRANSPARENT = 'transparent';

export const isTransparent = (color) => color === TRANSPARENT || color === 'none' || color === '';

/** The same colour in a form MapLibre and canvas both accept. */
export const cssColor = (color) =>
  (typeof color === 'string' && isTransparent(color) ? 'rgba(0,0,0,0)' : color);

const parse = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [148, 163, 184];
};
const toHex = (rgb) => `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(parse(a).map((c, i) => c + (parse(b)[i] - c) * t));

/** Sample a list of colours as a continuous ramp at position `t` (0…1). */
export function sampleRamp(colors, t) {
  if (!colors?.length) return '#94a3b8';
  if (colors.length === 1) return colors[0];
  const x = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i = Math.floor(x);
  return i >= colors.length - 1 ? colors[colors.length - 1] : mix(colors[i], colors[i + 1], x - i);
}

export function shade(hex, t) {
  // Nothing shaded stays nothing — a darker edge derived from an empty fill
  // would put a colour back on a shape the user just emptied.
  if (isTransparent(hex)) return TRANSPARENT;
  const rgb = parse(hex).map((c) => (t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return toHex(rgb);
}

/* ------------------------------------------------------------------ */
/* builders                                                            */
/* ------------------------------------------------------------------ */
export const singleSymbology = (color = '#0369a1', extra = {}) => ({ mode: 'single', color, ...extra });

/**
 * Build a categorised symbology from a dataset's declared classes, or from
 * the values actually present in the data.
 *
 * `icon`, `dash` and `width` ride along on a category when the caller has an
 * opinion about them, so a health layer can arrive with a cross on hospitals
 * and a pill on pharmacies rather than five identical dots.
 */
export function categorisedSymbology(field, categories, rampId = 'viridis') {
  const colors = RAMPS[rampId]?.colors ?? RAMPS.viridis.colors;
  return {
    mode: 'categorised',
    field,
    categories: categories.map((c, i) => ({
      value: c.value,
      label: c.label ?? c.value,
      color: c.color ?? sampleRamp(colors, categories.length <= 1 ? 0 : i / (categories.length - 1)),
      ...(c.width ? { width: c.width } : {}),
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.dash ? { dash: c.dash } : {}),
    })),
    other: { label: 'Other', color: '#94a3b8' },
  };
}

/** Distinct values of `field`, most common first. */
export function valuesIn(geojson, field, limit = 12) {
  const tally = new Map();
  for (const f of geojson?.features ?? []) {
    const v = f.properties?.[field];
    if (v === undefined || v === null || v === '') continue;
    const key = String(v);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => ({ value, label: value }));
}

const round = (n) => {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return Number(n.toFixed(digits));
};

/**
 * Build a graduated symbology by splitting `field` into `count` classes.
 * @param {'quantile'|'equal'} method
 */
export function graduatedSymbology(geojson, field, { count = 5, ramp = 'risk', method = 'quantile', unit = '' } = {}) {
  const values = (geojson?.features ?? [])
    .map((f) => Number(f.properties?.[field]))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const colors = RAMPS[ramp]?.colors ?? RAMPS.risk.colors;
  if (!values.length) {
    return { mode: 'graduated', field, ramp, method, unit, classes: [{ min: 0, max: 1, color: colors[0] }] };
  }

  const lo = values[0];
  const hi = values[values.length - 1];
  const edges = [];

  if (method === 'equal' || lo === hi) {
    const step = (hi - lo) / count || 1;
    for (let i = 0; i <= count; i++) edges.push(lo + step * i);
  } else {
    for (let i = 0; i <= count; i++) {
      const idx = Math.min(values.length - 1, Math.floor((i / count) * values.length));
      edges.push(values[idx]);
    }
    edges[count] = hi;
  }

  const classes = [];
  for (let i = 0; i < count; i++) {
    const min = round(edges[i]);
    const max = round(edges[i + 1]);
    // Collapsed buckets (many identical values) add nothing to the legend.
    if (i > 0 && max <= classes[classes.length - 1].max) continue;
    classes.push({ min, max, color: sampleRamp(colors, count <= 1 ? 0 : i / (count - 1)) });
  }

  return { mode: 'graduated', field, ramp, method, unit, classes };
}

/* ------------------------------------------------------------------ */
/* map paint                                                           */
/* ------------------------------------------------------------------ */

/** MapLibre colour expression (or a plain colour string) for a symbology. */
export function paintColor(sym, fallback = '#0369a1') {
  if (!sym || sym.mode === 'single') return cssColor(sym?.color ?? fallback);

  if (sym.mode === 'categorised') {
    if (!sym.categories.length) return cssColor(sym.other?.color ?? fallback);
    const expr = ['match', ['to-string', ['coalesce', ['get', sym.field], '']]];
    for (const c of sym.categories) expr.push(String(c.value), cssColor(c.color));
    expr.push(cssColor(sym.other?.color ?? fallback));
    return expr;
  }

  if (sym.mode === 'graduated') {
    const classes = sym.classes ?? [];
    if (!classes.length) return fallback;
    if (classes.length === 1) return cssColor(classes[0].color);
    // `step` matches how the legend reads: "up to X" bands, not a blend.
    const expr = ['step', ['to-number', ['coalesce', ['get', sym.field], 0]], cssColor(classes[0].color)];
    for (let i = 1; i < classes.length; i++) expr.push(classes[i].min, cssColor(classes[i].color));
    return expr;
  }

  return fallback;
}

/* ------------------------------------------------------------------ */
/* icons & dashes                                                      */
/* ------------------------------------------------------------------ */

/** True when a categorised symbology gives at least one class its own icon. */
export const hasCategoryIcons = (sym) =>
  sym?.mode === 'categorised' && sym.categories.some((c) => c.icon);

/**
 * `icon-image` for a layer, as a plain sprite name or a match expression.
 *
 * A class with no symbol of its own falls back to the layer's, and failing
 * that to a plain dot in its own colour — giving one class a cross must not
 * drag the other four onto it.
 * @param {object} sym
 * @param {(id:string, color:string) => string} spriteOf  registers and names one image
 * @param {string} fallbackIcon
 */
export function iconImage(sym, spriteOf, fallbackIcon = '') {
  const other = sym?.other?.color ?? '#64748b';

  if (sym?.mode === 'categorised' && (hasCategoryIcons(sym) || fallbackIcon)) {
    const expr = ['match', ['to-string', ['coalesce', ['get', sym.field], '']]];
    for (const c of sym.categories) {
      expr.push(String(c.value), spriteOf(c.icon || fallbackIcon || 'circle', c.color));
    }
    // A match needs at least one case; with none, every feature is the
    // fallback anyway.
    if (expr.length < 4) return spriteOf(fallbackIcon || 'circle', other);
    expr.push(spriteOf(fallbackIcon || 'circle', other));
    return expr;
  }

  if (!fallbackIcon) return null;
  return spriteOf(fallbackIcon, sym?.mode === 'single' ? sym.color : '#0369a1');
}

/**
 * Group a categorised symbology's classes by line pattern.
 *
 * `line-dasharray` is the one line property MapLibre will not evaluate per
 * feature, so a layer whose classes want different patterns has to become
 * several map layers — one per pattern, each filtered to its own classes.
 * Returns a single unfiltered group when nothing asks for anything else.
 *
 * `values: null` means "draw everything"; `rest: true` means "draw whatever
 * matched no class", which is how the fallback colour keeps its features.
 * @returns {Array<{dash:string, values:string[]|null, rest?:boolean}>}
 */
export function dashGroups(sym, fallback = 'solid') {
  if (sym?.mode !== 'categorised' || !sym.categories.some((c) => (c.dash ?? fallback) !== fallback)) {
    return [{ dash: fallback, values: null }];
  }
  const byDash = new Map();
  for (const c of sym.categories) {
    const key = c.dash || fallback;
    if (!byDash.has(key)) byDash.set(key, []);
    byDash.get(key).push(String(c.value));
  }
  const groups = Array.from(byDash, ([dash, values]) => ({ dash, values }));
  groups.push({ dash: fallback, values: null, rest: true });
  return groups;
}

/**
 * Line thicknesses are **millimetres on the printed page**, everywhere.
 *
 * This is how a desktop GIS states a line width, and it is the only definition
 * that means the same thing twice: a "2 pixel" road is a different road on a
 * laptop, on a phone and on an A0 plot, whereas 0.5 mm is half a millimetre on
 * all three. It also makes the preview honest — the artboard knows how many
 * screen pixels a millimetre of paper currently occupies, so what you see is
 * the weight that prints.
 *
 * The consequence worth stating: thickness no longer changes with zoom. A
 * 0.5 mm road is 0.5 mm zoomed in and 0.5 mm zoomed out, which is what a
 * cartographer means by a line weight. Zooming out shows more roads, not
 * thinner ones.
 */
export const DEFAULT_LINE_WIDTH_MM = 0.45;

/** Screen pixels per millimetre of paper, when the artboard has not said. */
const FALLBACK_PX_PER_MM = 3.3;

/**
 * The base thickness stored on a layer's style, in millimetres.
 *
 * Tolerant of what earlier versions left behind: `width` used to be a screen
 * pixel count and `strokeWidth` used to hold the whole zoom expression, and a
 * saved project or an analysis result can still carry either. A stored
 * expression is not a thickness at all, so the default stands in for it; a
 * stored pixel count is converted on the old screen-scale assumption, which
 * lands an old project within a hair of how it used to look.
 */
export function baseWidthOf(style = {}) {
  if (Number.isFinite(style.widthMm)) return style.widthMm;
  if (Number.isFinite(style.width)) return style.width / FALLBACK_PX_PER_MM;
  if (Number.isFinite(style.strokeWidth)) return style.strokeWidth / FALLBACK_PX_PER_MM;
  return DEFAULT_LINE_WIDTH_MM;
}

/**
 * Line width for a layer, as a MapLibre value in screen pixels.
 *
 * Millimetres are the currency everywhere else; this is the one place they
 * become pixels, because that is the only unit MapLibre paints in. `pxPerMm`
 * comes from the artboard — page width in millimetres against page width on
 * screen — so the same stored 0.5 mm draws correctly at any window size and,
 * in the export, at any dpi.
 *
 * A flat number still cannot hold the class hierarchy a road map needs, so a
 * categorised layer returns a `match` and each class keeps its own weight.
 */
export function lineWidth(sym, baseMm = DEFAULT_LINE_WIDTH_MM, pxPerMm = FALLBACK_PX_PER_MM) {
  // Below about a third of a pixel a line stops being drawn at all rather than
  // being drawn faintly, which reads as a bug rather than as a hairline.
  const px = (mm) => Number(Math.max(0.35, (Number(mm) || 0) * pxPerMm).toFixed(3));
  const perClass = sym?.mode === 'categorised' && sym.categories.some((c) => c.width);
  if (!perClass) return px(baseMm);

  // Class weights are relative to the catalogue's default, so making the
  // layer heavier makes every class heavier *in proportion* — trunk roads stay
  // ahead of service roads instead of the hierarchy collapsing onto one number.
  const factor = baseMm / DEFAULT_LINE_WIDTH_MM;
  const match = ['match', ['to-string', ['coalesce', ['get', sym.field], '']]];
  for (const c of sym.categories) {
    match.push(String(c.value), px((c.width ?? DEFAULT_LINE_WIDTH_MM) * factor));
  }
  match.push(px(baseMm));
  return match;
}

/**
 * The stroke a legend swatch draws for a line of thickness `mm`.
 *
 * Proportional to the layer's weight rather than equal to it: a swatch is
 * about 13 pt wide, so a 1.5 mm trunk road drawn at its true thickness would
 * be a black block. Clamped at both ends — a hairline still has to be visible
 * in print, and the heaviest class still has to read as a line.
 */
export function swatchStroke(size, mm) {
  const rel = (Number(mm) || DEFAULT_LINE_WIDTH_MM) / DEFAULT_LINE_WIDTH_MM;
  return Math.max(size * 0.1, Math.min(size * 0.6, size * 0.26 * rel));
}

/* ------------------------------------------------------------------ */
/* legend                                                              */
/* ------------------------------------------------------------------ */

/**
 * Legend rows for a layer, derived from its symbology — never stored
 * separately, so the printed legend always matches what is drawn.
 * @param {object} layer
 */
export function legendRowsFor(layer) {
  const sym = layer.symbology;
  const style = layer.style ?? {};
  const swatch = layer.kind === 'line' ? 'line' : layer.kind === 'point' ? 'point' : 'polygon';
  const layerIcon = layer.kind === 'point' ? (style.icon ?? '') : '';
  const layerDash = layer.kind === 'point' ? '' : (style.dash ?? 'solid');
  const layerWidth = baseWidthOf(style);

  /**
   * A row draws the same mark the map does — same icon, same pattern, same
   * weight. Only points carry icons and only line work carries a pattern and
   * a thickness, because that is all the map itself does with them.
   */
  const mark = (extra = {}) => {
    if (layer.kind === 'point') {
      const icon = extra.icon || layerIcon;
      return { swatch, ...(icon ? { icon } : {}) };
    }
    const row = { swatch, dash: extra.dash || layerDash };
    // A trunk road is heavier than a service road on the map, so it has to be
    // heavier in the key as well — a legend that flattens them is telling the
    // reader the map does not distinguish them.
    if (layer.kind === 'line') row.width = extra.width ?? layerWidth;
    return row;
  };

  if (!sym || sym.mode === 'single') {
    // An outline-only polygon reads by its stroke, so that is the colour the
    // legend must show.
    const outlineOnly = layer.kind === 'polygon' && (style.fillOpacity ?? 0) < 0.08;
    const color = sym?.color ?? (outlineOnly ? style.stroke : style.fill) ?? '#0369a1';
    return [{
      label: sym?.label || layer.name,
      color: typeof color === 'string' ? color : '#0369a1',
      ...mark(),
    }];
  }

  if (sym.mode === 'categorised') {
    const rows = sym.categories.map((c) => ({
      label: c.label, color: c.color, ...mark({ icon: c.icon, dash: c.dash, width: c.width }),
    }));
    if (sym.other?.include) rows.push({ label: sym.other.label, color: sym.other.color, ...mark() });
    return rows;
  }

  const unit = sym.unit ? ` ${sym.unit}` : '';
  return (sym.classes ?? []).map((c, i) => ({
    // A typed label wins over the computed range — the numbers are still the
    // ones the map breaks on, but "Low risk" reads better than "0 – 2.4".
    label: c.label || (i === 0 ? `up to ${c.max}${unit}` : `${c.min} – ${c.max}${unit}`),
    color: c.color,
    ...mark(),
  }));
}

/* ------------------------------------------------------------------ */
/* edits                                                               */
/* ------------------------------------------------------------------ */
/** Change one field of one category — colour, label, icon or line pattern. */
export const patchCategory = (sym, index, patch) => ({
  ...sym,
  categories: sym.categories.map((c, i) => (i === index ? { ...c, ...patch } : c)),
});

export const patchClass = (sym, index, patch) => ({
  ...sym,
  classes: sym.classes.map((c, i) => (i === index ? { ...c, ...patch } : c)),
});

/**
 * Edit whichever bucket a legend row came from, whatever the mode.
 *
 * The legend editor works in rows, not modes: row 0 of a single-colour layer
 * is the layer itself, row 2 of a categorised one is its third class. This is
 * the one place that mapping lives.
 */
export function patchBucket(sym, index, patch) {
  if (!sym || sym.mode === 'single') return { ...sym, ...patch };
  if (sym.mode === 'categorised') {
    return index < sym.categories.length
      ? patchCategory(sym, index, patch)
      : { ...sym, other: { ...sym.other, ...patch } };
  }
  return patchClass(sym, index, patch);
}

/** Re-colour every bucket from a preset ramp, keeping labels and breaks. */
export function applyRamp(sym, rampId) {
  const colors = RAMPS[rampId]?.colors ?? RAMPS.viridis.colors;
  if (sym.mode === 'categorised') {
    const n = sym.categories.length;
    return {
      ...sym,
      ramp: rampId,
      categories: sym.categories.map((c, i) => ({ ...c, color: sampleRamp(colors, n <= 1 ? 0 : i / (n - 1)) })),
    };
  }
  if (sym.mode === 'graduated') {
    const n = sym.classes.length;
    return {
      ...sym,
      ramp: rampId,
      classes: sym.classes.map((c, i) => ({ ...c, color: sampleRamp(colors, n <= 1 ? 0 : i / (n - 1)) })),
    };
  }
  return { ...sym, color: colors[Math.floor(colors.length / 2)] };
}

export function reverseRamp(sym) {
  const key = sym.mode === 'categorised' ? 'categories' : 'classes';
  const list = sym[key] ?? [];
  const colors = list.map((c) => c.color).reverse();
  return { ...sym, [key]: list.map((c, i) => ({ ...c, color: colors[i] })) };
}
