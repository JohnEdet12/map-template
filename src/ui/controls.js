/**
 * Small control builders shared by every panel.
 *
 * These exist so the panels read as a description of their content rather
 * than a wall of createElement calls, and so one class-name change here
 * restyles the whole studio.
 */

import { el } from '../core/dom.js';
import { TRANSPARENT, isTransparent } from '../layers/symbology.js';
import { LINE_UNITS, lineUnit, toMm, fromMm } from '../core/constants.js';

export const head = (title, sub) =>
  el('div.panel-head', {}, [el('h2', { text: title }), sub ? el('p', { text: sub }) : null]);

export const section = (title, children, opts = {}) =>
  el('div.panel-section', {}, [
    title ? el('div.panel-title', { text: title, style: { marginBottom: '8px' } }) : null,
    ...[].concat(children).filter(Boolean),
  ].filter(Boolean));

export const empty = (text) => el('div.panel-empty', { html: text });

export const labelled = (text, control, hint) =>
  el('label.block', { style: { display: 'block', marginBottom: '9px' } }, [
    el('span.field-label', { text }),
    control,
    hint ? el('span', { text: hint, style: { display: 'block', marginTop: '3px', fontSize: '10px', color: '#94a3b8', lineHeight: '1.35' } }) : null,
  ]);

/**
 * A <select> built from [{value,label}] or plain strings.
 *
 * An option may carry a `group`, which puts it under an <optgroup> — the
 * difference between a flat list of fourteen paper sizes and a list that
 * separates what an office printer takes from what needs a plotter.
 */
export function select(options, value, onChange, props = {}) {
  const node = el('select.field', { ...props });
  const groups = new Map();

  for (const opt of options) {
    const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    const option = el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) });
    if (!o.group) { node.append(option); continue; }
    if (!groups.has(o.group)) {
      const g = el('optgroup', { label: o.group });
      groups.set(o.group, g);
      node.append(g);
    }
    groups.get(o.group).append(option);
  }

  node.value = value ?? '';
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function textInput(value, onChange, props = {}) {
  const node = el('input.field', { type: 'text', value: value ?? '', ...props });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

export function textArea(value, onChange, rows = 3) {
  const node = el('textarea.field', { rows, style: { resize: 'vertical', lineHeight: '1.4' } });
  node.value = value ?? '';
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

export function numberInput(value, onChange, props = {}) {
  const node = el('input.field', { type: 'number', value, ...props });
  node.addEventListener('change', () => onChange(Number(node.value)));
  return node;
}

/** Range slider with a live value read-out. */
export function slider(opts, onInput) {
  const { min = 0, max = 100, step = 1, value = 0, suffix = '' } = opts;
  const out = el('span', { text: `${value}${suffix}`, style: { fontSize: '11px', fontWeight: '700', color: '#0369a1', minWidth: '34px', textAlign: 'right' } });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = `${input.value}${suffix}`;
    onInput(Number(input.value));
  });
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [input, out]);
}

/** Segmented control. `options` is [{value,label}]. */
export function seg(options, value, onChange) {
  const node = el('div.seg');
  for (const opt of options) {
    const btn = el('button.seg-btn', { type: 'button', text: opt.label, title: opt.title ?? opt.label });
    btn.classList.toggle('is-active', String(opt.value) === String(value));
    btn.addEventListener('click', () => {
      node.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      onChange(opt.value);
    });
    node.append(btn);
  }
  return node;
}

/**
 * Colour picker, optionally able to say "no colour at all".
 *
 * `<input type="color">` has no way to express empty — it always hands back
 * six hex digits. So when transparency is allowed the input is paired with a
 * toggle, and an empty value is shown as a hollow chequered swatch sitting on
 * top of it, the way every GIS draws "no brush".
 *
 * @param {string} value  a hex colour, or TRANSPARENT
 * @param {(value:string)=>void} onChange
 * @param {{transparent?:boolean, title?:string}} [opts]
 */
export function colorInput(value, onChange, opts = {}) {
  const empty = isTransparent(value);
  const node = el('input.color-input', {
    type: 'color',
    // Keep the last real colour under the picker so turning transparency off
    // returns to where the user was, not to black.
    value: empty ? (opts.lastColor ?? '#94a3b8') : (value ?? '#000000'),
    title: opts.title ?? 'Pick a colour',
  });
  node.addEventListener('input', () => onChange(node.value));
  if (!opts.transparent) return node;

  const wrap = el('span', { style: { position: 'relative', display: 'inline-flex', flex: 'none' } }, [node]);

  if (empty) {
    // Sits over the input so the control still opens the picker on click.
    wrap.append(el('span', {
      'aria-hidden': 'true',
      style: {
        position: 'absolute', inset: '0', borderRadius: '7px', pointerEvents: 'none',
        border: '1px solid var(--line-strong)',
        background:
          'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface) 0% 50%) 50% / 7px 7px',
      },
    }));
  }

  const toggle = el('button', {
    type: 'button',
    text: empty ? '◧' : '∅',
    title: empty ? 'Give this a colour again' : 'No colour — outline only',
    'aria-label': empty ? 'Give this a colour again' : 'No colour',
    style: {
      flex: 'none', height: '26px', width: '22px', cursor: 'pointer', padding: '0',
      fontSize: '11px', lineHeight: '1',
      border: `1px solid ${empty ? 'var(--accent-bright)' : 'var(--line)'}`,
      borderRadius: '7px',
      background: empty ? 'var(--accent-soft)' : 'var(--surface)',
      color: 'var(--ink-soft)',
    },
  });
  toggle.addEventListener('click', () => onChange(empty ? node.value : TRANSPARENT));

  return el('span', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center', flex: 'none' } }, [wrap, toggle]);
}

/** A label + control on one line — the inspector's workhorse. */
export const inspectorRow = (text, control) =>
  el('div.insp-row', {}, [el('span', { text }), control]);

/** Checkbox styled as a small switch row. */
export function checkRow(text, checked, onChange, sub) {
  const box = el('input', { type: 'checkbox', checked, style: { accentColor: '#0369a1', width: '14px', height: '14px', flex: 'none' } });
  box.addEventListener('change', () => onChange(box.checked));
  return el('label.row', { style: { cursor: 'pointer' } }, [
    box,
    el('div.row-main', {}, [
      el('div.row-title', { text }),
      sub ? el('div.row-sub', { text: sub }) : null,
    ]),
  ]);
}

/**
 * Generic list row.
 * @param {{icon?:string|Node, title:string, sub?:string, active?:boolean,
 *          onClick?:Function, actions?:Node[], swatch?:string}} opts
 */
export function row(opts) {
  const node = el(opts.onClick ? 'button.row' : 'div.row', { type: opts.onClick ? 'button' : undefined });
  node.classList.toggle('is-active', Boolean(opts.active));
  if (opts.swatch) node.append(el('span.swatch', { style: { background: opts.swatch } }));
  else if (opts.icon !== undefined) node.append(el('span.row-ico', typeof opts.icon === 'string' ? { text: opts.icon } : {}, typeof opts.icon === 'string' ? [] : [opts.icon]));
  node.append(el('span.row-main', {}, [
    el('span.row-title', { text: opts.title, style: { display: 'block' } }),
    opts.sub ? el('span.row-sub', { text: opts.sub, style: { display: 'block' } }) : null,
  ]));
  if (opts.actions?.length) node.append(el('span.row-act', {}, opts.actions));
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  if (opts.title) node.title = opts.sub ? `${opts.title} — ${opts.sub}` : opts.title;
  return node;
}

/**
 * Tiny square action button used inside rows.
 *
 * `glyph` may be a character or a node, so a button can carry a drawn icon
 * instead of whichever character the installed font happens to have.
 *
 * @param {{pressed?: boolean, danger?: boolean}} [opts]
 *        pressed marks a toggle that is currently *on* — it sets
 *        `aria-pressed`, so a screen reader says "hidden, pressed" rather than
 *        reading the same label whichever state the element is in.
 *        danger tints destructive actions on hover only, so a list of rows
 *        does not read as a row of warnings.
 */
export function miniBtn(glyph, title, onClick, opts = {}) {
  const isNode = glyph instanceof Node;
  const btn = el('button.icon-btn', {
    type: 'button', title, 'aria-label': title,
    ...(isNode ? {} : { text: glyph }),
    ...(opts.pressed === undefined ? {} : { 'aria-pressed': String(Boolean(opts.pressed)) }),
  }, isNode ? [glyph] : []);
  if (opts.pressed) btn.classList.add('is-pressed');
  if (opts.danger) btn.classList.add('is-danger');
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return btn;
}

/**
 * A measured line thickness: a number you type, and the unit it is in.
 *
 * Millimetres are what gets stored and what the map draws with, but nobody
 * should have to convert — a plan drawn to a printer's spec is quoted in
 * points, an architectural sheet in inches, and most cartography in
 * millimetres. Changing the unit re-expresses the same line rather than
 * changing it, which is the behaviour that makes the picker safe to poke at.
 *
 * `onChange` is always handed **millimetres**.
 *
 * @param {number} mm            current width, in millimetres
 * @param {(mm:number) => void} onChange
 * @param {{unit?: string, onUnit?: (id:string) => void, compact?: boolean}} [opts]
 */
export function widthField(mm, onChange, opts = {}) {
  const unitId = opts.unit ?? 'mm';
  const u = lineUnit(unitId);

  const input = el('input', {
    type: 'number',
    min: 0,
    max: u.max,
    step: u.step,
    value: String(fromMm(mm, unitId)),
    title: 'Line thickness on the printed page',
    style: {
      flex: '1', minWidth: '0', height: '26px', fontSize: '11.5px',
      padding: '0 6px', textAlign: 'right',
    },
  });
  // `change`, not `input`: typing "0.05" passes through "0" and "0.0", and
  // repainting the map for each keystroke makes the field fight the typing.
  const commit = () => {
    const next = Math.max(0, Math.min(u.max, Number(input.value) || 0));
    input.value = String(next);
    onChange(toMm(next, unitId));
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

  const units = el('select', {
    title: 'Unit',
    style: { flex: 'none', width: opts.compact ? '54px' : '76px', height: '26px', fontSize: '11px' },
  }, LINE_UNITS.map((item) => el('option', {
    value: item.id,
    text: opts.compact ? item.id : item.label,
    selected: item.id === unitId ? true : null,
  })));
  units.value = unitId;
  units.addEventListener('change', () => opts.onUnit?.(units.value));

  const box = el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [input, units]);
  if (!opts.onUnit) units.disabled = false;   // still switchable; see widthFieldStateful
  return box;
}

/**
 * The same field, remembering which unit you last chose.
 *
 * The unit is a preference about reading, not a property of the layer — it
 * would be wrong to save "this road layer is in points" into the document —
 * so it lives here, for as long as the tab is open.
 */
let preferredUnit = 'mm';
export function widthInput(mm, onChange, opts = {}) {
  return widthField(mm, onChange, {
    ...opts,
    unit: preferredUnit,
    onUnit: (id) => { preferredUnit = id; opts.rerender?.(); },
  });
}

/**
 * A chevron that points down when closed and up when open.
 *
 * One drawn shape rotated, rather than two different characters — ▾ and ▴
 * are not the same optical size in most fonts, so the button used to twitch
 * as it toggled.
 */
export function chevron(open = false, size = 14) {
  const span = el('span.chev');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5"/></svg>`;
  span.style.transition = 'transform 0.15s ease';
  span.style.display = 'grid';
  span.style.placeItems = 'center';
  if (open) span.style.transform = 'rotate(180deg)';
  return span;
}

/** Row of filter pills. */
export function pillRow(items, activeId, onPick) {
  const node = el('div.pill-row');
  for (const item of items) {
    const btn = el('button.pill', { type: 'button', text: item.label });
    btn.classList.toggle('is-active', item.id === activeId);
    btn.addEventListener('click', () => onPick(item.id));
    node.append(btn);
  }
  return node;
}

/** Collapsible <details> group. */
export const group = (title, children, open = false) =>
  el('details.group', { open }, [
    el('summary', { text: title }),
    el('div.group-body', {}, [].concat(children).filter(Boolean)),
  ]);

export const button = (text, onClick, variant = 'primary', props = {}) => {
  const node = el(`button.btn-${variant}`, { type: 'button', text, ...props });
  node.addEventListener('click', onClick);
  return node;
};

export const stack = (children, gap = '8px') =>
  el('div', { style: { display: 'flex', flexDirection: 'column', gap } }, [].concat(children).filter(Boolean));

export const inline = (children, gap = '6px') =>
  el('div', { style: { display: 'flex', gap, alignItems: 'center' } }, [].concat(children).filter(Boolean));
