/**
 * Right-hand panel.
 *
 * Shows whichever thing is selected: a page element, a data layer, or —
 * when nothing is selected — the page setup. Each element type declares
 * which control groups it wants via `inspect` in layout/elements.js, so
 * adding an element type never means editing a switch statement here.
 */

import { $, el, fill } from '../core/dom.js';
import { state, set, subscribe, checkpoint, touch } from '../core/store.js';
import { FONTS, PAPER_SIZES, EXPORT_RESOLUTIONS, effectiveDpi, paperDimsLabel } from '../core/constants.js';
import { ELEMENT_TYPES, elementLabel, SHAPE_VARIANTS } from '../layout/elements.js';
import { updateElement, removeElement, duplicateElement, renderElements, layoutArtboard } from './artboard.js';
import { alignElements, placeElement, fillPage, PLACEMENT_SPOTS } from '../layout/align.js';
import { updateLayer, removeLayer, applySymbology } from '../layers/registry.js';
import {
  SYMBOLOGY_MODES, RAMP_PRESETS, singleSymbology, categorisedSymbology,
  graduatedSymbology, valuesIn, applyRamp, reverseRamp, baseWidthOf,
} from '../layers/symbology.js';
import { legendEditor, layerLegendRows, iconPicker, dashPicker } from './legend-editor.js';
import { numericKeys, propertyKeys } from '../data/upload.js';
import { CONTEXT_MODES, contextLabel } from '../data/inset-context.js';
import { flyToBounds } from '../core/map.js';
import { boundsFromBbox } from '../core/geo.js';
import { notify } from '../core/toast.js';
import {
  head, section, labelled, select, textArea, textInput, slider, seg,
  colorInput, checkRow, button, stack, inline, inspectorRow, widthInput,
} from './controls.js';

let panel;

/* ================================================================== */
/* element inspector                                                   */
/* ================================================================== */
const styleSetter = (elm, history = false) => (patch) => {
  if (history) checkpoint();
  updateElement(elm.id, { style: patch }, { history: false });
  renderElements();
};

function groupText(elm) {
  return section('Text', stack([
    textArea(elm.text ?? '', (value) => {
      updateElement(elm.id, { text: value, auto: false }, { history: false });
      renderElements();
    }, 4),
    el('p', {
      style: { margin: 0, fontSize: '10px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'Line breaks are kept exactly as you type them.',
    }),
  ]));
}

function groupHeading(elm) {
  return section('Heading', textInput(elm.text ?? '', (value) => {
    updateElement(elm.id, { text: value, auto: false }, { history: false });
    renderElements();
  }, { placeholder: 'Leave empty to hide the heading' }));
}

function groupType(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Type', stack([
    labelled('Typeface', select(
      Object.entries(FONTS).map(([value, f]) => ({ value, label: f.label })),
      s.font, (value) => setStyle({ font: value }),
    )),
    inspectorRow('Size', slider({ min: 5, max: 70, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
    labelled('Weight', seg(
      [{ value: 400, label: 'Regular' }, { value: 600, label: 'Medium' }, { value: 800, label: 'Bold' }],
      s.weight, (value) => setStyle({ weight: Number(value) }),
    )),
    labelled('Alignment', seg(
      [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
      s.align, (value) => setStyle({ align: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Line spacing', slider({ min: 1, max: 2.2, step: 0.05, value: s.lineHeight ?? 1.3 }, (v) => setStyle({ lineHeight: v }))),
    checkRow('Italic', Boolean(s.italic), (on) => setStyle({ italic: on })),
  ]));
}

function groupChrome(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Card', stack([
    inline([
      colorInput(s.bg, (value) => setStyle({ bg: value })),
      el('span', { text: 'Background', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
    ]),
    inspectorRow('Opacity', slider({ min: 0, max: 1, step: 0.02, value: s.bgOpacity ?? 0 }, (v) => setStyle({ bgOpacity: v }))),
    inline([
      colorInput(s.border, (value) => setStyle({ border: value })),
      el('span', { text: 'Border', style: { fontSize: '11.5px', color: '#475569', flex: '1' } }),
    ]),
    inspectorRow('Border width', slider({ min: 0, max: 6, step: 0.1, value: s.borderWidth ?? 0 }, (v) => setStyle({ borderWidth: v }))),
    inspectorRow('Corner radius', slider({ min: 0, max: 30, step: 0.5, value: s.radius ?? 0 }, (v) => setStyle({ radius: v }))),
    inspectorRow('Padding', slider({ min: 0, max: 30, step: 0.5, value: s.padding ?? 0 }, (v) => setStyle({ padding: v }))),
    checkRow('Drop shadow', Boolean(s.shadow), (on) => setStyle({ shadow: on })),
  ]));
}

function groupNorth(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('North arrow', stack([
    labelled('Style', seg(
      [{ value: 'arrow', label: 'Arrow' }, { value: 'needle', label: 'Needle' }, { value: 'compass', label: 'Compass' }],
      s.variant, (value) => setStyle({ variant: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Label size', slider({ min: 4, max: 30, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
    checkRow('Show the letter N', s.showLabel !== false, (on) => setStyle({ showLabel: on })),
    el('p', {
      style: { margin: 0, fontSize: '10px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'The arrow turns with the map, so it stays honest if you rotate the view.',
    }),
  ]));
}

function groupScale(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Scale bar', stack([
    labelled('Style', seg(
      [{ value: 'checker', label: 'Checker' }, { value: 'bar', label: 'Solid' }, { value: 'line', label: 'Bracket' }],
      s.variant, (value) => setStyle({ variant: value }),
    )),
    labelled('Alignment', seg(
      [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
      s.align, (value) => setStyle({ align: value }),
    )),
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Thickness', slider({ min: 1, max: 14, step: 0.5, value: s.thickness ?? 4 }, (v) => setStyle({ thickness: v }))),
    inspectorRow('Label size', slider({ min: 4, max: 24, step: 0.5, value: s.size }, (v) => setStyle({ size: v }))),
  ]));
}

function groupNeatline(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Frame', stack([
    inspectorRow('Colour', colorInput(s.color, (value) => setStyle({ color: value }))),
    inspectorRow('Line width', slider({ min: 0.2, max: 8, step: 0.1, value: s.borderWidth }, (v) => setStyle({ borderWidth: v }))),
    checkRow('Double line', Boolean(s.inner), (on) => setStyle({ inner: on })),
    inspectorRow('Inner gap', slider({ min: 0.5, max: 12, step: 0.1, value: s.gap ?? 2 }, (v) => setStyle({ gap: v }))),
  ]));
}

function groupInset(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  const mode = s.context ?? 'auto';
  const showsContext = mode !== 'none';

  return section('Locator', stack([
    // The whole job of a locator is to place the study area inside something
    // the reader recognises, so what that something is comes first.
    labelled('Show inside', select(
      CONTEXT_MODES.map((m) => ({ value: m.id, label: m.label })),
      mode,
      (value) => { setStyle({ context: value }, false); renderElements(); renderInspector(); },
    ), state.studyArea
      ? `${CONTEXT_MODES.find((m) => m.id === mode)?.hint} — ${contextLabel(state.studyArea, mode)}`
      : CONTEXT_MODES.find((m) => m.id === mode)?.hint),

    checkRow('Mark the map view', Boolean(s.extent), (on) => setStyle({ extent: on }),
      'Draws a rectangle where the main map is currently looking.'),

    el('div.panel-title', { text: 'Study area', style: { marginTop: '4px' } }),
    inspectorRow('Fill', colorInput(s.fill, (value) => setStyle({ fill: value }), { transparent: true })),
    inspectorRow('Fill opacity', slider({ min: 0, max: 1, step: 0.05, value: s.fillOpacity ?? 0.55 }, (v) => setStyle({ fillOpacity: v }))),
    inspectorRow('Outline', colorInput(s.stroke, (value) => setStyle({ stroke: value }))),

    showsContext ? el('div.panel-title', { text: 'Surrounding region', style: { marginTop: '4px' } }) : null,
    showsContext ? inspectorRow('Fill', colorInput(s.contextFill ?? '#e2e8f0', (value) => setStyle({ contextFill: value }), { transparent: true })) : null,
    showsContext ? inspectorRow('Outline', colorInput(s.contextStroke ?? '#94a3b8', (value) => setStyle({ contextStroke: value }))) : null,

    s.extent ? inspectorRow('View marker', colorInput(s.extentStroke ?? '#dc2626', (value) => setStyle({ extentStroke: value }))) : null,

    state.studyArea ? null : el('p', {
      style: { margin: 0, fontSize: '10.5px', color: '#b45309', lineHeight: '1.4' },
      text: 'Load a study area and its outline appears here.',
    }),
  ]));
}

function groupLegend(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);

  // Editing a row rewrites the symbology it came from, so the map changes
  // with the legend rather than drifting from it.
  const after = (rebuild) => { renderElements(); if (rebuild) renderInspector(); };

  return el('div', {}, [
    section('Legend', stack([
      inspectorRow('Swatch size', slider({ min: 5, max: 30, step: 0.5, value: s.swatch ?? 13 }, (v) => setStyle({ swatch: v }))),
      inspectorRow('Row spacing', slider({ min: 0, max: 12, step: 0.2, value: s.gap ?? 2.6 }, (v) => setStyle({ gap: v }))),
      el('p', {
        style: { margin: 0, fontSize: '10px', color: 'var(--ink-faint)', lineHeight: '1.4' },
        text: 'Rows come from the visible layers — turn a layer off and it leaves the legend.',
      }),
    ])),
    section('Edit the rows', stack([
      legendEditor(after),
      el('p', {
        style: { margin: 0, fontSize: '10px', color: 'var(--ink-faint)', lineHeight: '1.4' },
        text: 'Colour, symbol, line style and wording. Every change here also changes the map — the legend is drawn from the same settings, so the two can never disagree.',
      }),
    ])),
  ]);
}

function groupLogo(elm) {
  const setStyle = styleSetter(elm);
  const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setStyle({ src: String(reader.result) }); };
    reader.readAsDataURL(file);
    input.value = '';
  });

  return section('Image', stack([
    button(elm.style.src ? 'Replace image' : 'Choose an image', () => input.click(), 'soft', { style: { width: '100%' } }),
    input,
    elm.style.src ? button('Remove image', () => setStyle({ src: '' }), 'ghost', { style: { width: '100%' } }) : null,
    labelled('Fit', seg(
      [{ value: 'contain', label: 'Fit inside' }, { value: 'cover', label: 'Fill box' }],
      elm.style.fit, (value) => setStyle({ fit: value }),
    )),
  ]));
}

function groupShape(elm) {
  const s = elm.style;
  const setStyle = styleSetter(elm);
  return section('Shape', stack([
    labelled('Shape', select(
      SHAPE_VARIANTS.map((v) => ({ value: v.id, label: v.label })),
      s.variant, (value) => { setStyle({ variant: value }); renderInspector(); },
    )),
    s.variant === 'line' ? null : inline([
      colorInput(s.fill, (value) => { setStyle({ fill: value }); renderInspector(); }, { transparent: true, title: 'Fill colour' }),
      el('span', { text: 'Fill', style: { fontSize: '11.5px', color: 'var(--ink-soft)', flex: '1' } }),
    ]),
    s.variant === 'line' ? null : inspectorRow('Fill opacity', slider({ min: 0, max: 1, step: 0.02, value: s.fillOpacity ?? 0 }, (v) => setStyle({ fillOpacity: v }))),
    inline([
      colorInput(s.stroke, (value) => { setStyle({ stroke: value }); renderInspector(); }, { transparent: true, title: 'Outline colour' }),
      el('span', { text: 'Outline', style: { fontSize: '11.5px', color: 'var(--ink-soft)', flex: '1' } }),
    ]),
    inspectorRow('Outline width', slider({ min: 0, max: 12, step: 0.2, value: s.strokeWidth ?? 1.6 }, (v) => setStyle({ strokeWidth: v }))),
    labelled('Outline style', seg(
      [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }],
      s.dash ?? 'solid', (value) => setStyle({ dash: value }),
    )),
    s.variant === 'rectangle'
      ? inspectorRow('Corner radius', slider({ min: 0, max: 40, step: 1, value: s.radius ?? 0 }, (v) => setStyle({ radius: v })))
      : null,
    inspectorRow('Rotation', slider({ min: -180, max: 180, step: 1, value: s.rotation ?? 0, suffix: '°' }, (v) => setStyle({ rotation: v }))),
  ]));
}

const GROUPS = {
  text: groupText, heading: groupHeading, type: groupType, chrome: groupChrome,
  north: groupNorth, scale: groupScale, neatline: groupNeatline,
  inset: groupInset, legend: groupLegend, logo: groupLogo, shape: groupShape,
};

/* ------------------------------------------------------------------ */
/* arrange — placement grid, alignment, fill                           */
/* ------------------------------------------------------------------ */

/** Page margin used by the placement grid and the align buttons. */
let pageMargin = 4;

const SPOT_TITLES = {
  'top-left': 'Top left', 'top-centre': 'Top centre', 'top-right': 'Top right',
  'middle-left': 'Left', centre: 'Centre of page', 'middle-right': 'Right',
  'bottom-left': 'Bottom left', 'bottom-centre': 'Bottom centre', 'bottom-right': 'Bottom right',
};

/** Which of the nine spots the element is currently sitting on, if any. */
function currentSpot(elm) {
  const near = (a, b) => Math.abs(a - b) < 0.6;
  const h = near(elm.x, pageMargin) ? 'left'
    : near(elm.x + elm.w, 100 - pageMargin) ? 'right'
      : near(elm.x + elm.w / 2, 50) ? 'centre' : null;
  const v = near(elm.y, pageMargin) ? 'top'
    : near(elm.y + elm.h, 100 - pageMargin) ? 'bottom'
      : near(elm.y + elm.h / 2, 50) ? 'middle' : null;
  if (!h || !v) return null;
  return h === 'centre' && v === 'middle' ? 'centre' : `${v}-${h}`;
}

function placementGrid(elm) {
  const grid = el('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px',
      width: '96px', aspectRatio: '1 / 1.28', padding: '4px',
      border: '1px dashed #cbd5e1', borderRadius: '8px', background: '#f8fafc',
    },
  });
  const active = currentSpot(elm);

  for (const rowSpots of PLACEMENT_SPOTS) {
    for (const spot of rowSpots) {
      const cell = el('button', {
        type: 'button',
        title: SPOT_TITLES[spot],
        'aria-label': SPOT_TITLES[spot],
        style: {
          border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
          background: spot === active ? '#0369a1' : '#ffffff', padding: '0',
        },
      });
      cell.addEventListener('click', () => {
        placeElement(elm.id, spot, pageMargin);
        renderElements();
        renderInspector();
      });
      grid.append(cell);
    }
  }
  return grid;
}

function alignButtons(elm) {
  const make = (mode, label) => {
    const btn = el('button.btn-ghost', {
      type: 'button', text: label,
      style: { padding: '4px 0', fontSize: '11px', flex: '1' },
    });
    btn.addEventListener('click', () => {
      alignElements([elm.id], mode, { margin: pageMargin });
      renderElements();
      renderInspector();
    });
    return btn;
  };
  return stack([
    inline([make('left', 'Left'), make('centre', 'Centre'), make('right', 'Right')], '4px'),
    inline([make('top', 'Top'), make('middle', 'Middle'), make('bottom', 'Bottom')], '4px'),
  ], '4px');
}

function groupArrange(elm) {
  const fillBtn = (axis, label) => {
    const btn = el('button.btn-ghost', { type: 'button', text: label, style: { padding: '4px 0', fontSize: '11px', flex: '1' } });
    btn.addEventListener('click', () => { fillPage(elm.id, axis, pageMargin); renderElements(); renderInspector(); });
    return btn;
  };

  return section('Arrange', stack([
    el('p', {
      style: { margin: '0 0 2px', fontSize: '10.5px', color: '#94a3b8', lineHeight: '1.4' },
      text: 'Click a square to drop this element onto that corner or edge of the page.',
    }),
    inline([placementGrid(elm), el('div', { style: { flex: '1' } }, [alignButtons(elm)])], '10px'),
    inspectorRow('Page margin', slider({ min: 0, max: 18, step: 0.5, value: pageMargin, suffix: '%' }, (v) => { pageMargin = v; })),
    inline([fillBtn('x', 'Fill width'), fillBtn('y', 'Fill height')], '4px'),
  ]));
}

function groupPosition(elm) {
  const num = (key, label, max) => {
    const input = el('input.field', { type: 'number', step: '0.5', value: elm[key], min: -20, max });
    input.addEventListener('change', () => {
      updateElement(elm.id, { [key]: Number(input.value) });
      renderElements();
    });
    return labelled(label, input);
  };
  return section('Position & size', el('div.insp-grid', {}, [
    num('x', 'Left %', 110), num('y', 'Top %', 110),
    num('w', 'Width %', 120), num('h', 'Height %', 120),
  ]));
}

function elementInspector(elm) {
  const def = ELEMENT_TYPES[elm.type];
  const groups = (def?.inspect ?? []).map((key) => GROUPS[key]?.(elm)).filter(Boolean);

  return [
    head(elementLabel(elm), def?.hint),
    section('', inline([
      button(elm.hidden ? 'Show' : 'Hide', () => {
        checkpoint(); elm.hidden = !elm.hidden; touch('elements'); renderElements(); renderInspector();
      }, 'ghost'),
      button(elm.locked ? 'Unlock' : 'Lock', () => {
        checkpoint(); elm.locked = !elm.locked; touch('elements'); renderElements(); renderInspector();
      }, 'ghost'),
      button('Duplicate', () => { duplicateElement(elm.id); renderElements(); }, 'ghost'),
      button('Delete', () => { removeElement(elm.id); renderElements(); }, 'ghost'),
    ], '5px')),
    ...groups,
    groupArrange(elm),
    groupPosition(elm),
  ];
}

/* ================================================================== */
/* layer inspector                                                     */
/* ================================================================== */
function layerInspector(layer) {
  const s = layer.style ?? {};
  const setStyle = (patch, redraw = true) => {
    updateLayer(layer.id, { style: patch });
    if (redraw) renderElements();
  };
  /** Repaint; rebuild the panel too when a control's own preview changed. */
  const refresh = (rebuild) => { renderElements(); if (rebuild) renderInspector(); };
  const single = (layer.symbology?.mode ?? 'single') === 'single';

  const labelFields = layer.geojson ? ['', ...propertyKeys(layer.geojson, 30)] : [''];

  return [
    head(layer.name, layer.meta?.description || 'Layer styling'),
    section('', inline([
      button('Zoom to', () => layer.bbox && flyToBounds(boundsFromBbox(layer.bbox)), 'ghost'),
      button('Remove', () => { removeLayer(layer.id); set({ selectedLayerId: null }, { history: false }); renderElements(); }, 'ghost'),
    ], '5px')),

    section('Name', textInput(layer.name, (value) => { updateLayer(layer.id, { name: value }); })),

    layer.type === 'raster'
      ? section('Raster', inspectorRow('Opacity', slider({ min: 0, max: 1, step: 0.05, value: layer.opacity ?? 0.85 }, (v) => {
          updateLayer(layer.id, { opacity: v });
        })))
      : section('Appearance', stack([
          // One row: the colour, the symbol or line pattern, and the words
          // that go on the legend beside them.
          single
            ? layerLegendRows(layer, refresh)
            : el('p', {
                style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
                text: 'Each class has its own colour and symbol — set them under Symbology below, or on the legend itself.',
              }),
          // With several classes in play, these are the fallback for any
          // class that has not been given one of its own.
          !single && layer.kind === 'point'
            ? inspectorRow('Default symbol', iconPicker(s.icon ?? '', s.fill, (id) => { setStyle({ icon: id }, false); refresh(true); }))
            : null,
          !single && layer.kind !== 'point'
            ? inspectorRow('Default line style', dashPicker(s.dash ?? 'solid', s.stroke ?? '#0369a1', (id) => { setStyle({ dash: id }, false); refresh(true); }))
            : null,
          layer.kind === 'polygon'
            ? inspectorRow('Fill opacity', slider({ min: 0, max: 1, step: 0.05, value: s.fillOpacity ?? 0.35 }, (v) => setStyle({ fillOpacity: v })))
            : null,
          single && layer.kind === 'polygon' ? inline([
            colorInput(s.stroke, (value) => { setStyle({ stroke: value }, false); refresh(true); }, { transparent: true, title: 'Outline colour' }),
            el('span', { text: 'Outline colour', style: { fontSize: '11.5px', color: 'var(--ink-soft)', flex: '1' } }),
          ]) : null,
          // Line work is the layer itself, not an edge around something else,
          // so it gets its own control and its own words. Roads, rivers,
          // railways and pipelines all land here.
          layer.kind === 'line'
            ? labelled('Line thickness', widthInput(baseWidthOf(s), (mm) => setStyle({ widthMm: mm }), { rerender: renderInspector }),
                'Millimetres on the printed page, whatever the zoom or the paper size.')
            : inspectorRow('Outline width', slider({ min: 0, max: 8, step: 0.2, value: s.strokeWidth ?? 1.2 }, (v) => setStyle({ strokeWidth: v }))),
          // Classes that arrived with their own weight keep it, scaled by the
          // field above — so this says what typing in it actually does.
          layer.kind === 'line' && layer.symbology?.categories?.some((c) => c.width)
            ? el('p', {
                style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
                text: 'Each class keeps its own relative weight — set one on its own below.',
              })
            : null,
          layer.kind === 'point'
            ? inspectorRow('Point size', slider({ min: 1, max: 16, step: 0.5, value: s.radius ?? 4 }, (v) => setStyle({ radius: v })))
            : null,
          inspectorRow('Layer opacity', slider({ min: 0, max: 1, step: 0.05, value: layer.opacity ?? 1 }, (v) => {
            updateLayer(layer.id, { opacity: v });
          })),
        ])),

    layer.geojson ? section('Labels', stack([
      labelled('Label features with', select(
        labelFields.map((k) => ({ value: k, label: k || 'No labels' })),
        s.labelField ?? '', (value) => setStyle({ labelField: value }),
      )),
      s.labelField ? inspectorRow('Label size', slider({ min: 6, max: 24, step: 1, value: s.labelSize ?? 11 }, (v) => setStyle({ labelSize: v }))) : null,
    ])) : null,

    groupSymbology(layer),
  ];
}

/* ------------------------------------------------------------------ */
/* symbology editor                                                    */
/* ------------------------------------------------------------------ */
const rampBar = (colors, height = '14px') => el('div', {
  style: {
    height, borderRadius: '4px', flex: '1',
    background: colors.length > 1 ? `linear-gradient(90deg, ${colors.join(',')})` : colors[0],
    border: '1px solid var(--line)',
  },
});

/**
 * How a layer is coloured. Changing anything here regenerates the map paint
 * AND the legend from the same object, so the two cannot disagree.
 */
function groupSymbology(layer) {
  if (layer.type === 'raster' || !layer.geojson) return null;
  const sym = layer.symbology ?? singleSymbology('#0369a1');

  const apply = (next, rebuild = false) => {
    applySymbology(layer.id, next);
    renderElements();
    if (rebuild) renderInspector();
  };

  const textFields = propertyKeys(layer.geojson, 40).filter((k) => !k.startsWith('_'));
  const numFields = numericKeys(layer.geojson);

  const modeSeg = labelled('Colour features', seg(
    SYMBOLOGY_MODES.map((m) => ({ value: m.id, label: m.label.replace('Single colour', 'Single') })),
    sym.mode,
    (mode) => {
      if (mode === sym.mode) return;
      if (mode === 'single') return apply(singleSymbology(sym.categories?.[0]?.color ?? sym.classes?.[0]?.color ?? '#0369a1'), true);
      if (mode === 'categorised') {
        const field = textFields.includes('gds_class') ? 'gds_class' : textFields[0];
        if (!field) return notify.warn('This layer has no text field to group by.');
        return apply(categorisedSymbology(field, valuesIn(layer.geojson, field)), true);
      }
      const field = numFields[0];
      if (!field) return notify.warn('This layer has no numeric field to shade by.');
      return apply(graduatedSymbology(layer.geojson, field), true);
    },
  ), SYMBOLOGY_MODES.find((m) => m.id === sym.mode)?.hint);

  if (sym.mode === 'single') return section('Symbology', modeSeg);

  const fields = sym.mode === 'categorised' ? textFields : numFields;
  const fieldPicker = labelled(sym.mode === 'categorised' ? 'Group by' : 'Shade by', select(
    fields.map((f) => ({ value: f, label: f })),
    sym.field,
    (field) => apply(
      sym.mode === 'categorised'
        ? categorisedSymbology(field, valuesIn(layer.geojson, field), sym.ramp)
        : graduatedSymbology(layer.geojson, field, { ramp: sym.ramp, method: sym.method }),
      true,
    ),
  ));

  const buckets = sym.mode === 'categorised' ? sym.categories : sym.classes;
  // The same editable row the Legend element shows — colour, symbol, line
  // style and wording, writing back into this symbology.
  const rows = layerLegendRows(layer, (rebuild) => { renderElements(); if (rebuild) renderInspector(); });

  const presets = el('div', { style: { display: 'grid', gap: '5px' } }, RAMP_PRESETS.map((preset) => {
    const btn = el('button', {
      type: 'button', title: preset.label,
      style: {
        display: 'flex', alignItems: 'center', gap: '7px', width: '100%', cursor: 'pointer',
        border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--surface)', padding: '5px 7px',
      },
    }, [
      rampBar(preset.colors, '12px'),
      el('span', { text: preset.label, style: { fontSize: '10.5px', color: 'var(--ink-soft)', flex: 'none', width: '96px', textAlign: 'right' } }),
    ]);
    btn.addEventListener('click', () => apply(applyRamp(sym, preset.id), true));
    return btn;
  }));

  return section('Symbology', stack([
    modeSeg,
    fieldPicker,
    sym.mode === 'graduated' ? labelled('Break values at', seg(
      [{ value: 'quantile', label: 'Even counts' }, { value: 'equal', label: 'Even steps' }],
      sym.method ?? 'quantile',
      (method) => apply(graduatedSymbology(layer.geojson, sym.field, { ramp: sym.ramp, method, unit: sym.unit }), true),
    ), 'Even counts puts the same number of features in each colour; even steps splits the range.') : null,
    rampBar(buckets.map((b) => b.color), '18px'),
    inline([button('Reverse colours', () => apply(reverseRamp(sym), true), 'ghost')], '5px'),
    el('div.field-label', { text: 'Preset ramps', style: { marginTop: '4px' } }),
    presets,
    el('div.field-label', { text: sym.mode === 'categorised' ? 'Categories' : 'Classes', style: { marginTop: '4px' } }),
    rows,
    el('p', {
      style: { margin: 0, fontSize: '10px', color: 'var(--ink-faint)', lineHeight: '1.4' },
      text: 'The legend on your page rebuilds from these colours every time you change one.',
    }),
  ]));
}


/* ================================================================== */
/* page setup (nothing selected)                                       */
/* ================================================================== */
function pageInspector() {
  const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
  const fixed = Boolean(paper.fixedOrientation);
  const update = (patch) => {
    set({ page: { ...state.page, ...patch } });
    layoutArtboard();
    renderElements();
    renderInspector();
  };

  // What the export will really produce. On A0 and the other plotter sizes
  // the requested dpi is not achievable in a browser canvas, and finding that
  // out after a five-minute export is not the moment to learn it.
  const wide = fixed ? paper.hIn : (state.page.orientation === 'landscape' ? paper.hIn : paper.wIn);
  const tall = fixed ? paper.wIn : (state.page.orientation === 'landscape' ? paper.wIn : paper.hIn);
  const real = effectiveDpi(wide, tall, state.page.dpi);
  const megapixels = ((wide * real * tall * real) / 1e6).toFixed(0);

  return [
    head('Page setup', 'Nothing selected — click an element on the page to edit it.'),
    section('Paper', stack([
      labelled('Size', select(
        Object.entries(PAPER_SIZES).map(([value, p]) => ({
          value, label: `${p.label} · ${paperDimsLabel(p)}`, group: p.group,
        })),
        state.page.size, (value) => update({ size: value }),
      )),
      labelled('Orientation', seg(
        [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
        fixed ? paper.fixedOrientation : state.page.orientation,
        (value) => update({ orientation: value }),
      ), fixed ? `${paper.label} is always ${paper.fixedOrientation}.` : ''),
      labelled('Export resolution', select(
        EXPORT_RESOLUTIONS.map((r) => ({ value: r.dpi, label: `${r.label} · ${r.dpi} dpi` })),
        state.page.dpi, (value) => update({ dpi: Number(value) }),
      ), real < state.page.dpi
        ? `${paper.label} is too big for ${state.page.dpi} dpi in a browser — the export will be ${real} dpi (${megapixels} megapixels), which is still ${real >= 150 ? 'fine for large-format printing at normal viewing distance' : 'best treated as a draft'}.`
        : `${Math.round(wide * real)} × ${Math.round(tall * real)} px at ${real} dpi — ${megapixels} megapixels.`),
      inspectorRow('Page background', colorInput(state.page.background ?? '#ffffff', (value) => {
        set({ page: { ...state.page, background: value } }, { history: false });
      })),
    ])),
    section('Tips', el('div', { style: { fontSize: '11.5px', color: '#475569', lineHeight: '1.55' } }, [
      el('p', { style: { margin: '0 0 6px' }, html: 'Drag any element inside the dashed page frame. Pink lines show when it lines up with the page or another element.' }),
      el('p', { style: { margin: '0 0 6px' }, html: 'Hold <b>Alt</b> while dragging to ignore snapping, <b>Shift</b> + arrow keys to nudge further.' }),
      el('p', { style: { margin: 0 }, html: 'Whatever sits inside the frame is exactly what gets exported.' }),
    ])),
  ];
}

/* ================================================================== */
export function renderInspector() {
  panel = panel ?? $('#right-panel');
  if (!panel) return;

  const elm = state.elements.find((e) => e.id === state.selectedElementId);
  if (elm) return void fill(panel, elementInspector(elm));

  const layer = state.layers.find((l) => l.id === state.selectedLayerId);
  if (layer) return void fill(panel, layerInspector(layer));

  fill(panel, pageInspector());
}

export function initInspector() {
  panel = $('#right-panel');
  renderInspector();
  // Only the selection rebuilds this panel. Style edits made *inside* it
  // fire `elements`/`layers` on every slider frame — rebuilding then would
  // yank the control out from under the pointer, so those paths call
  // renderInspector() explicitly when they actually need to.
  // `elements` and `layers` are deliberately absent: style edits made in
  // this panel fire them on every slider frame, and rebuilding then would
  // yank the control out from under the pointer. Those paths call
  // renderInspector() explicitly when the panel's shape actually changes.
  subscribe(['selectedElementId', 'selectedLayerId', 'page', 'templateId', 'studyArea'], renderInspector);
}
