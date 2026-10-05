/**
 * Study area pane — "where am I mapping?".
 *
 * The boundary that comes back from Nominatim is the real administrative
 * outline, and it becomes both a drawn layer and the clipping region every
 * analysis job runs inside.
 *
 * A map can be about more than one place. Adding a second area does not
 * replace the first: both outlines stay on the map, data is fetched for each
 * of them and merged, and every figure the page prints covers the whole set.
 * The list is owned by data/study-areas.js — this panel only edits it.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import {
  ADMIN_LEVELS, COUNTRIES, NIGERIA_STATES, NIGERIA_ZONES, adminLevelsFor, zoneById,
} from '../../core/constants.js';
import { lookupBoundary } from '../../data/boundaries.js';
import { fetchAdminChildren, buildZoneArea } from '../../data/admin.js';
import {
  addStudyArea, removeStudyArea, clearStudyAreas, studyAreas, areaKey,
} from '../../data/study-areas.js';
import { flyToBounds } from '../../core/map.js';
import { boundsFromBbox, formatArea } from '../../core/geo.js';
import { syncAutoText } from '../../templates/apply.js';
import { renderElements, hint } from '../artboard.js';
import { head, section, labelled, select, textInput, button, stack, empty, miniBtn } from '../controls.js';
import { uiIcon } from '../ui-icons.js';

let pane;
let form = { level: 'state', country: 'ng', name: 'Rivers', zone: 'ss', parentState: 'Rivers', lga: '' };
let busy = false;

/**
 * The LGAs of one state, as fetched from OpenStreetMap.
 *
 * Kept per state rather than as one current list, so flicking between two
 * states does not refetch either. Only the names and outlines are held; the
 * fetch itself is cached a layer below, in this browser and in the shared
 * database, so even a first look at a state someone else has opened is instant.
 */
const lgaCache = new Map();     // state name → { units: [...], error?: string }
let lgaLoading = null;          // the state name currently being fetched

const countryName = () => COUNTRIES.find((c) => c.code === form.country)?.name ?? '';

/* ------------------------------------------------------------------ */
/* the LGAs of a state                                                 */
/* ------------------------------------------------------------------ */

/**
 * Load the list of LGAs for a state, so the picker can be a list rather than
 * a text box you have to already know the answer to type into.
 *
 * The state's own outline is looked up first because it is what decides
 * membership: Overpass can only be asked for a rectangle, and the rectangle
 * around Kaduna clips into six neighbours.
 */
async function loadLgaList(stateName) {
  if (!stateName || lgaCache.has(stateName) || lgaLoading === stateName) return;
  lgaLoading = stateName;
  render();
  const status = notify.busy(`Finding the LGAs of ${stateName}…`);

  try {
    const parent = await lookupBoundary({
      level: 'state', name: stateName, countryCode: form.country, countryName: countryName(),
    });
    const units = await fetchAdminChildren(parent, 'lga', {
      onProgress: (msg) => status.update(`${msg}<br />${stateName}`),
    });
    if (!units.length) throw new Error(`OpenStreetMap has no LGA boundaries mapped inside ${stateName} yet.`);

    lgaCache.set(stateName, { units, parent });
    if (!units.some((u) => u.name === form.lga)) form.lga = units[0].name;
    status.update(`<b>${units.length}</b> LGAs found in ${stateName}.`, { tone: 'ok', duration: 3500 });
  } catch (err) {
    lgaCache.set(stateName, { units: [], error: err.message });
    status.update(err.message ?? 'Could not list the LGAs.', { tone: 'error', duration: 7000 });
  } finally {
    lgaLoading = null;
    render();
  }
}

/** Put the chosen LGA on the map, using the polygon already in hand. */
async function loadLga({ replace = false } = {}) {
  const entry = lgaCache.get(form.parentState);
  const unit = entry?.units.find((u) => u.name === form.lga);
  if (!unit) {
    notify.warn('Pick a state, then choose an LGA from the list.');
    return;
  }
  // No lookup needed — the outline came back with the list, which is why the
  // list is worth fetching whole rather than one name at a time.
  finish(unit, { replace });
}

/* ------------------------------------------------------------------ */
/* geopolitical zones                                                  */
/* ------------------------------------------------------------------ */
async function loadZone({ replace = false } = {}) {
  if (busy) return;
  busy = true;
  render();
  const zone = zoneById(form.zone);
  const status = notify.busy(`Assembling ${zone?.name ?? 'the zone'}…`);

  try {
    const { area, missing } = await buildZoneArea(form.zone, {
      onProgress: (msg) => status.update(msg),
    });
    const { added, reason } = addStudyArea(area, { replace });
    if (!added) {
      status.update(reason, { tone: 'warn', duration: 5000 });
      return;
    }

    syncAutoText();
    renderElements();
    flyToBounds(boundsFromBbox(state.studyArea.bbox));

    const note = missing.length
      ? ` ${missing.length} state${missing.length === 1 ? '' : 's'} could not be loaded (${missing.join(', ')}), so the figures cover the rest.`
      : '';
    status.update(
      `<b>${area.name}</b> — ${area.parts.length} states, ${formatArea(area.areaKm2)}.${note}`,
      { tone: missing.length ? 'warn' : 'ok', duration: missing.length ? 9000 : 5000 },
    );
    hint('Data is fetched for each state in the zone separately, then merged — so a zone works exactly like any other study area.');
  } catch (err) {
    status.update(err.message ?? 'Could not assemble that zone.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

/* ------------------------------------------------------------------ */
/** Everything that happens once an area object exists, whatever found it. */
function finish(area, { replace = false } = {}) {
  const { added, reason } = addStudyArea(area, { replace });
  if (!added) {
    notify.warn(reason);
    return false;
  }
  syncAutoText();
  renderElements();
  flyToBounds(boundsFromBbox(state.studyArea.bbox));

  const n = studyAreas().length;
  notify.ok(n > 1
    ? `<b>${area.name}</b> added — ${n} study areas, ${formatArea(state.studyArea.areaKm2)} in total.`
    : `<b>${area.name}</b> loaded — ${formatArea(area.areaKm2)}`, { duration: 4200 });
  render();
  return true;
}

/**
 * Look a place up and put it on the map.
 * @param {{replace?: boolean}} [opts]  replace:true swaps out everything
 *        already there — what "map somewhere else" means, as opposed to
 *        "map here as well".
 */
async function loadBoundary({ replace = false } = {}) {
  if (busy) return;
  // Zones are assembled from several lookups and LGAs are already in hand, so
  // each has its own path; only the plain single-name lookup runs below.
  if (form.level === 'zone') return loadZone({ replace });
  if (form.level === 'lga') return loadLga({ replace });

  busy = true;
  render();
  const status = notify.busy('Looking up the boundary…');

  try {
    const area = await lookupBoundary({
      level: form.level,
      name: form.name,
      countryCode: form.country,
      countryName: countryName(),
    });

    const { added, reason } = addStudyArea(area, { replace });
    if (!added) {
      status.update(reason, { tone: 'warn', duration: 5000 });
      return;
    }

    syncAutoText();
    renderElements();
    // Zoom to everything, not just the new part — otherwise adding a second
    // area appears to throw the first one away.
    flyToBounds(boundsFromBbox(state.studyArea.bbox));

    const n = studyAreas().length;
    status.update(
      n > 1
        ? `<b>${area.name}</b> added — ${n} study areas, ${formatArea(state.studyArea.areaKm2)} in total.`
        : `<b>${area.name}</b> loaded — ${formatArea(area.areaKm2)}`,
      { tone: 'ok', duration: 4200 },
    );
    hint(n > 1
      ? 'Data and analysis now cover every area on this list. Each one is fetched separately, then merged.'
      : 'Now open <b>Data</b> to add roads, rivers or buildings inside this area.');
  } catch (err) {
    status.update(err.message ?? 'Boundary lookup failed.', { tone: 'error', duration: 7000 });
  } finally {
    busy = false;
    render();
  }
}

function dropArea(key) {
  removeStudyArea(key);
  syncAutoText();
  renderElements();
  render();
}

function clearAll() {
  clearStudyAreas();
  syncAutoText();
  renderElements();
  render();
}

/* ------------------------------------------------------------------ */
/* the "what am I picking" controls, one set per level                 */
/* ------------------------------------------------------------------ */

/** Zone → the six states groupings, with what each one contains. */
function zoneControls() {
  const zone = zoneById(form.zone);
  return [
    labelled('Zone', select(
      NIGERIA_ZONES.map((z) => ({ value: z.id, label: `${z.name} — ${z.states.length} states` })),
      form.zone,
      (value) => { form.zone = value; render(); },
    ), zone ? zone.states.join(' · ') : ''),
    el('p', {
      style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
      html: 'A zone is not an administrative unit — OpenStreetMap has no boundary for one — so it is assembled from its states\' real outlines and dissolved into a single region.',
    }),
  ];
}

/**
 * LGA → pick the state, then pick from the LGAs actually inside it.
 *
 * This replaced a text box. Typing "Ikeja" worked; typing it for a state whose
 * 23 LGA names you do not have to hand did not, and neither did knowing
 * whether the one you wanted was spelled "Ogun Waterside" or "Ogun-Waterside".
 * The list is the state's real second tier, fetched from OpenStreetMap with
 * the outlines attached.
 */
function lgaControls() {
  const states = form.country === 'ng' ? NIGERIA_STATES : null;
  const entry = lgaCache.get(form.parentState);
  const loading = lgaLoading === form.parentState;

  const stateField = states
    ? select(states, form.parentState, (value) => {
        form.parentState = value;
        form.lga = '';
        render();
        loadLgaList(value);
      })
    : textInput(form.parentState, (value) => { form.parentState = value; }, {
        placeholder: 'e.g. Ashanti',
      });

  const rows = [labelled('State', stateField, 'The LGA list is read from this state\'s boundaries.')];

  if (loading) {
    rows.push(el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--ink-soft)' },
    }, [el('span.spinner.spinner--ink'), el('span', { text: `Reading the LGAs of ${form.parentState}…` })]));
  } else if (entry?.units?.length) {
    rows.push(labelled('LGA', select(
      entry.units.map((u) => ({ value: u.name, label: u.name })),
      form.lga || entry.units[0].name,
      (value) => { form.lga = value; render(); },
    ), (() => {
      const unit = entry.units.find((u) => u.name === (form.lga || entry.units[0].name));
      return `${entry.units.length} LGAs in ${form.parentState}${unit ? ` · ${unit.name} is ${formatArea(unit.areaKm2)}` : ''}`;
    })()));
  } else if (entry?.error) {
    rows.push(el('p', {
      style: { margin: 0, fontSize: '10.5px', color: 'var(--ember)', lineHeight: '1.45' },
      text: entry.error,
    }));
    rows.push(button('Try again', () => { lgaCache.delete(form.parentState); loadLgaList(form.parentState); }, 'ghost', {
      style: { width: '100%' },
    }));
  } else {
    rows.push(button(`List the LGAs of ${form.parentState}`, () => loadLgaList(form.parentState), 'soft', {
      style: { width: '100%' },
    }));
  }

  return rows;
}

/** Everything else: one name, typed or picked. */
function nameControl() {
  if (form.level === 'state' && form.country === 'ng') {
    return select(NIGERIA_STATES, form.name, (value) => { form.name = value; });
  }
  const placeholder = {
    country: 'Picked from the country list',
    city: 'e.g. Warri',
    state: 'e.g. Ashanti',
    custom: 'e.g. Yankari National Park',
  }[form.level] ?? 'Place name';

  const input = textInput(form.name, (value) => { form.name = value; }, {
    placeholder,
    disabled: form.level === 'country' ? true : null,
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBoundary(); });
  return input;
}

/** One row of the list: what it is, how big, and how to get rid of it. */
function areaCard(area, removable) {
  const key = areaKey(area);
  return el('div.card', { style: { padding: '10px 11px' } }, [
    el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '6px' } }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', {
          text: area.name,
          style: { fontSize: '13.5px', fontWeight: '700', lineHeight: '1.2' },
        }),
        el('div', {
          text: area.displayName,
          style: {
            fontSize: '10.5px', color: 'var(--ink-faint)', margin: '3px 0 7px',
            lineHeight: '1.35', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }),
      ]),
      removable ? miniBtn(uiIcon('trash'), `Remove ${area.name}`, () => dropArea(key), { danger: true }) : null,
    ]),
    el('div', {
      style: { display: 'flex', gap: '12px', fontSize: '11.5px', color: 'var(--ink-soft)', marginBottom: '8px' },
    }, [
      el('span', { html: `<b>${formatArea(area.areaKm2)}</b> approx.` }),
      el('span', { text: ADMIN_LEVELS.find((l) => l.id === area.level)?.label ?? area.level }),
    ]),
    button('Zoom to', () => flyToBounds(boundsFromBbox(area.bbox)), 'soft', { style: { width: '100%' } }),
  ]);
}

/** The whole list, with its total — the figure the page itself will print. */
function areaList() {
  const areas = studyAreas();
  if (!areas.length) {
    return empty('No study area yet.<br />Pick a level and a name, then <b>Load boundary</b>.');
  }

  const many = areas.length > 1;
  return stack([
    ...areas.map((a) => areaCard(a, many)),
    many ? el('div', {
      style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: '8px', fontSize: '11.5px', color: 'var(--ink-soft)', padding: '2px 2px 0',
      },
    }, [
      el('span', { html: `<b>${areas.length}</b> areas` }),
      // Measured from the merged outlines, so two areas that overlap are not
      // counted twice here or on the printed map.
      el('span', { html: `<b>${formatArea(state.studyArea?.areaKm2 ?? 0)}</b> together` }),
    ]) : null,
    many ? button('Remove all', clearAll, 'ghost', { style: { width: '100%' } }) : null,
  ], '8px');
}

/* ------------------------------------------------------------------ */
export function render() {
  pane = pane ?? $('#pane-area');
  if (!pane) return;

  const has = studyAreas().length > 0;
  const levels = adminLevelsFor(form.country);

  // Zones and LGAs are not one lookup, so the button says what it will do.
  const verb = has ? 'Add' : 'Load';
  const label = busy || lgaLoading
    ? 'Working…'
    : form.level === 'zone' ? `${verb} this zone`
      : form.level === 'lga' ? `${verb} this LGA`
        : has ? 'Add this area' : 'Load boundary';

  const ready = form.level !== 'lga' || Boolean(lgaCache.get(form.parentState)?.units?.length);
  const loadBtn = button(label, () => loadBoundary(), 'primary', {
    style: { width: '100%' },
    disabled: busy || lgaLoading || !ready ? true : null,
  });

  fill(pane, [
    head('Study area', 'The place your map is about. Everything else works inside it.'),
    section('Find a place', stack([
      labelled('Level', select(
        levels.map((l) => ({ value: l.id, label: l.label })),
        form.level,
        (value) => {
          form.level = value;
          if (value === 'country') form.name = '';
          render();
          // The LGA picker is useless empty, so it fills itself the moment it
          // is asked for rather than waiting for a second click.
          if (value === 'lga') loadLgaList(form.parentState);
        },
      ), levels.find((l) => l.id === form.level)?.hint),
      labelled('Country', select(
        COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
        form.country,
        (value) => {
          form.country = value;
          // Zones are Nigeria's; leaving the country has to leave the level too.
          if (!adminLevelsFor(value).some((l) => l.id === form.level)) form.level = 'state';
          render();
        },
      )),
      ...(form.level === 'zone' ? zoneControls()
        : form.level === 'lga' ? lgaControls()
          : form.level === 'country' ? []
            : [labelled('Name', nameControl())]),
      loadBtn,
      // Only worth offering once there is something to add to, and worth
      // saying plainly then: the button above no longer replaces anything.
      has ? el('p', {
        style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
        text: 'Added alongside the areas below. Data, analysis and every printed figure cover all of them.',
      }) : null,
      has ? button('Replace instead', () => loadBoundary({ replace: true }), 'ghost', {
        style: { width: '100%' },
        disabled: busy ? true : null,
      }) : null,
    ])),
    section(studyAreas().length > 1 ? 'Study areas' : 'Current study area', areaList()),
  ]);
}

/**
 * Load a place typed anywhere in the app (the landing search box, for
 * instance) and mirror it into this panel's form.
 *
 * This one replaces: searching from the home page is how a map starts, not
 * how a second area is added to one.
 */
export function loadPlace(query, country = '') {
  form = { level: 'custom', country, name: query };
  render();
  return loadBoundary({ replace: true });
}

export function initAreaPane() {
  pane = $('#pane-area');
  render();
  subscribe(['studyArea', 'studyAreas'], () => { if (state.activeTool === 'area') render(); });
}

export { render as renderAreaPane };
