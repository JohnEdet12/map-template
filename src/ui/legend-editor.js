/**
 * The legend editor — one row per thing on the map, each editable in place.
 *
 * The legend is derived, never stored: rows come out of each layer's
 * symbology, which is also what paints the map. So editing a legend row
 * cannot mean "write something into the legend" — it means writing back into
 * the symbology the row came from, and letting both regenerate. Change the
 * colour of *Primary* here and the primary roads on the map change with it.
 *
 * Routing an edit back to its bucket is the only fiddly part, and it lives in
 * `handlersFor()`:
 *
 *   colour, label   always a property of the bucket (patchBucket)
 *   icon, dash      per class when the layer is categorised, otherwise a
 *                   layer-wide style property — a graduated ramp of points is
 *                   five colours of one symbol, not five different symbols
 */

import { el } from '../core/dom.js';
import { state } from '../core/store.js';
import { updateLayer, applySymbology, shade } from '../layers/registry.js';
import {
  patchBucket, legendRowsFor, LINE_STYLES, dashArray, isTransparent,
  baseWidthOf, swatchStroke, DEFAULT_LINE_WIDTH_MM,
} from '../layers/symbology.js';
import { fromMm } from '../core/constants.js';
import { ICONS, iconGroups, iconSvg } from '../layers/icons.js';
import { textInput, colorInput, stack, widthInput } from './controls.js';

/* ------------------------------------------------------------------ */
/* pickers                                                             */
/* ------------------------------------------------------------------ */

const ICON_LABEL = new Map(ICONS.map((i) => [i.id, i.label]));

/** Preview of a line pattern, at the proportions the map draws it. */
function dashPreview(styleId, color, width = 34, height = 3) {
  const pattern = dashArray(styleId);
  const node = el('i', {
    style: {
      display: 'block', width: `${width}px`, height: `${height}px`, flex: 'none',
      borderRadius: pattern ? '0' : '99px', background: color,
    },
  });
  if (pattern) {
    const stops = [];
    let at = 0;
    pattern.forEach((seg, i) => {
      const end = at + seg * height;
      stops.push(`${i % 2 ? 'transparent' : color} ${at}px ${end}px`);
      at = end;
    });
    node.style.background = `repeating-linear-gradient(90deg,${stops.join(',')})`;
  }
  return node;
}

const swatchButton = (children, title, onClick) => {
  const btn = el('button', {
    type: 'button', title, 'aria-label': title,
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
      height: '26px', minWidth: '30px', padding: '0 5px', cursor: 'pointer',
      border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--surface)',
    },
  }, [].concat(children).filter(Boolean));
  btn.addEventListener('click', onClick);
  return btn;
};

/**
 * A grid of icons that opens under the row.
 *
 * `<details>` rather than a floating popover on purpose — the inspector is a
 * narrow scrolling column, and an absolutely-positioned menu in it would
 * spend its life clipped by the panel edge.
 */
function iconPicker(current, color, onPick) {
  const box = el('details.group', { style: { border: 'none', background: 'transparent' } });
  const summary = el('summary', {
    title: current ? `Symbol: ${ICON_LABEL.get(current) ?? current}` : 'Choose a symbol',
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '26px', width: '30px', padding: '0', cursor: 'pointer', listStyle: 'none',
      border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--surface)',
    },
  });
  summary.innerHTML = current
    ? iconSvg(current, color, 15)
    : `<i style="display:block;width:11px;height:11px;border-radius:50%;background:${color}"></i>`;

  const cell = (id, label) => {
    const btn = el('button', {
      type: 'button', title: label, 'aria-label': label,
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '28px', cursor: 'pointer', padding: '0',
        border: `1px solid ${id === current ? 'var(--accent-bright)' : 'var(--line)'}`,
        borderRadius: '7px',
        background: id === current ? 'var(--accent-soft)' : 'var(--surface)',
      },
    });
    btn.innerHTML = id
      ? iconSvg(id, color, 16)
      : `<i style="display:block;width:10px;height:10px;border-radius:50%;background:${color}"></i>`;
    btn.addEventListener('click', () => { box.open = false; onPick(id); });
    return btn;
  };

  const grid = (icons) => el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', marginBottom: '7px' },
  }, icons);

  const body = el('div.group-body', { style: { padding: '8px 2px 2px' } }, [
    el('div.field-label', { text: 'Plain dot' }),
    grid([cell('', 'Plain dot')]),
    ...iconGroups().flatMap((g) => [
      el('div.field-label', { text: g.label }),
      grid(g.icons.map((i) => cell(i.id, i.label))),
    ]),
  ]);

  box.append(summary, body);
  return box;
}

/**
 * Line thickness for one class: a measured field, opened from a preview of
 * the weight it currently draws.
 *
 * The preview is the summary rather than the whole control because a legend
 * row is already a colour, a pattern and a label wide — but the value itself
 * is a number in millimetres, not a name, because "heavy" is not something
 * you can hand to a printer or match to a house style.
 */
function widthPicker(currentMm, color, dash, onPick, rerender) {
  const mm = Number(currentMm) || DEFAULT_LINE_WIDTH_MM;

  const box = el('details.group', { style: { border: 'none', background: 'transparent' } });
  const summary = el('summary', {
    title: `Thickness: ${fromMm(mm, 'mm')} mm`,
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '26px', width: '30px', padding: '0', cursor: 'pointer', listStyle: 'none',
      border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--surface)',
    },
  }, [dashPreview(dash || 'solid', color, 20, swatchStroke(13, mm))]);

  const body = el('div.group-body', { style: { padding: '8px 2px 2px', display: 'grid', gap: '6px' } }, [
    el('div.field-label', { text: 'Thickness on the printed page' }),
    widthInput(mm, (next) => { box.open = false; onPick(next); }, { compact: true, rerender }),
  ]);

  box.append(summary, body);
  return box;
}

/** Six line patterns as previews, chosen in place. */
function dashPicker(current, color, onPick) {
  const box = el('details.group', { style: { border: 'none', background: 'transparent' } });
  const summary = el('summary', {
    title: `Line style: ${LINE_STYLES.find((s) => s.id === (current || 'solid'))?.label ?? 'Solid'}`,
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '26px', width: '34px', padding: '0', cursor: 'pointer', listStyle: 'none',
      border: '1px solid var(--line)', borderRadius: '7px', background: 'var(--surface)',
    },
  }, [dashPreview(current || 'solid', color, 22)]);

  const rows = LINE_STYLES.map((s) => {
    const active = (current || 'solid') === s.id;
    const btn = el('button', {
      type: 'button', title: s.label,
      style: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', cursor: 'pointer',
        padding: '5px 7px', borderRadius: '7px',
        border: `1px solid ${active ? 'var(--accent-bright)' : 'var(--line)'}`,
        background: active ? 'var(--accent-soft)' : 'var(--surface)',
      },
    }, [
      dashPreview(s.id, color, 40),
      el('span', { text: s.label, style: { fontSize: '10.5px', color: 'var(--ink-soft)' } }),
    ]);
    btn.addEventListener('click', () => { box.open = false; onPick(s.id); });
    return btn;
  });

  box.append(summary, el('div.group-body', { style: { padding: '8px 2px 2px', display: 'grid', gap: '4px' } }, rows));
  return box;
}

/* ------------------------------------------------------------------ */
/* routing an edit back to the symbology it came from                  */
/* ------------------------------------------------------------------ */

/**
 * The four write paths for one legend row of one layer.
 *
 * `after(rebuild)` repaints; only the pickers ask for `rebuild`, because a
 * colour picker and a text field both fire on every frame of input and
 * rebuilding then would pull the control out from under the pointer.
 *
 * Every write re-reads the layer's *current* symbology rather than the one
 * this row was built from. Without that, two edits to the same row — pick a
 * colour, then retype the label — would each patch the same stale object and
 * the second would quietly undo the first, because the panel deliberately
 * does not rebuild between them.
 * @param {object} layer
 * @param {number} index  which bucket the row came from
 */
function handlersFor(layer, index, after) {
  const live = () => {
    const current = state.layers.find((l) => l.id === layer.id) ?? layer;
    return current.symbology ?? { mode: 'single', color: current.style?.fill ?? '#0369a1' };
  };
  const perClass = () => live().mode === 'categorised';

  const writeSym = (patch, rebuild) => { applySymbology(layer.id, patchBucket(live(), index, patch)); after(rebuild); };
  const writeStyle = (patch) => { updateLayer(layer.id, { style: patch }); after(true); };

  return {
    setColor: (color) => {
      // A single-colour polygon reads as a fill with a darker edge; the edge
      // has to follow the fill or the shape stops looking deliberate. Emptying
      // the fill is the exception — that is the outline-only case, and taking
      // the outline with it would leave nothing on the map at all.
      if (live().mode === 'single' && layer.kind === 'polygon' && !isTransparent(color)) {
        updateLayer(layer.id, { style: { stroke: shade(color, -0.25) } });
      }
      writeSym({ color }, false);
    },
    setLabel: (label) => writeSym({ label }, false),
    setIcon: (icon) => (perClass() ? writeSym({ icon }, true) : writeStyle({ icon })),
    setDash: (dash) => (perClass() ? writeSym({ dash }, true) : writeStyle({ dash })),
    // Same split as the pattern above: one class of a categorised layer gets
    // its own weight, while a single-colour layer has only the one line to
    // set, which is the layer's own thickness. Millimetres, both ways.
    setWidth: (width) => (perClass() ? writeSym({ width }, true) : writeStyle({ widthMm: width })),
  };
}

/**
 * One editable legend row: swatch controls, then the label.
 * @param {object} layer
 * @param {object} row    a row from legendRowsFor()
 * @param {number} index
 * @param {Function} after  re-render callback
 * @param {{rename?:boolean}} [opts]
 */
export function legendRow(layer, row, index, after, opts = {}) {
  const h = handlersFor(layer, index, after);
  const isPoint = layer.kind === 'point';
  // An emptied row still needs a visible symbol and line-pattern preview, so
  // the pickers borrow a neutral ink rather than drawing themselves in nothing.
  const preview = isTransparent(row.color) ? 'var(--ink-faint)' : row.color;

  const label = opts.rename === false
    ? el('span', {
        text: row.label,
        style: {
          fontSize: '11.5px', color: 'var(--ink-soft)', flex: '1', minWidth: '0',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      })
    : textInput(row.label, (value) => h.setLabel(value), {
        title: 'What this row says on the printed legend',
        style: { flex: '1', minWidth: '0', height: '26px', fontSize: '11.5px', padding: '0 7px' },
      });

  return el('div', { style: { display: 'flex', gap: '5px', alignItems: 'center' } }, [
    colorInput(row.color, (value) => h.setColor(value), {
      transparent: true,
      title: layer.kind === 'polygon' ? 'Fill colour' : 'Colour',
    }),
    isPoint ? iconPicker(row.icon ?? '', preview, (id) => h.setIcon(id)) : null,
    layer.kind === 'line' || layer.kind === 'polygon'
      ? dashPicker(row.dash ?? 'solid', preview, (id) => h.setDash(id))
      : null,
    // Only line work: the thickness of a polygon's outline is one property of
    // the whole layer, not something each legend row can differ on.
    layer.kind === 'line'
      ? widthPicker(row.width ?? baseWidthOf(layer.style), preview, row.dash, (w) => h.setWidth(w), () => after(true))
      : null,
    label,
  ]);
}

/** Every editable row for one layer. */
export function layerLegendRows(layer, after, opts = {}) {
  return el('div', { style: { display: 'grid', gap: '5px' } },
    legendRowsFor(layer).map((row, i) => legendRow(layer, row, i, after, opts)));
}

/* ------------------------------------------------------------------ */
/* the whole legend, grouped by layer                                  */
/* ------------------------------------------------------------------ */

/**
 * The editor shown on the Legend element: every layer currently in the
 * legend, with its rows. Hidden layers are named but not listed — they are
 * not in the legend, and pretending otherwise would be the one thing this
 * legend is built never to do.
 */
export function legendEditor(after) {
  const shown = state.layers.filter((l) => l.visible && l.type !== 'raster' && l.legend?.length);
  const hidden = state.layers.filter((l) => !l.visible && l.type !== 'raster');

  if (!shown.length) {
    return el('p', {
      style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
      text: 'Nothing is on the map yet. Add a layer and its rows appear here, ready to edit.',
    });
  }

  const blocks = shown.map((layer) => el('div', { style: { display: 'grid', gap: '5px' } }, [
    el('div', {
      style: {
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '6px', marginTop: '2px',
      },
    }, [
      el('span', {
        text: layer.name,
        title: layer.name,
        style: {
          fontSize: '10px', fontWeight: '800', letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'var(--ink-faint)', minWidth: '0', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      }),
      el('span', {
        text: layer.symbology?.mode === 'categorised' ? 'by category'
          : layer.symbology?.mode === 'graduated' ? 'by value' : 'single',
        style: { fontSize: '9.5px', color: 'var(--ink-faint)', flex: 'none' },
      }),
    ]),
    layerLegendRows(layer, after),
  ]));

  return stack([
    ...blocks,
    hidden.length ? el('p', {
      style: { margin: '2px 0 0', fontSize: '10px', color: 'var(--ink-faint)', lineHeight: '1.4' },
      text: `${hidden.length} hidden layer${hidden.length === 1 ? '' : 's'} — turn one on in Layers and its rows join the legend.`,
    }) : null,
  ], '9px');
}

export { iconPicker, dashPicker };
