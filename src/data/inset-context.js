/**
 * The surrounding region a locator inset draws the study area *inside*.
 *
 * A locator inset exists to answer one question — "where in the world is
 * this?" — and it can only answer it by showing something the reader already
 * recognises. An outline on its own answers nothing: the shape of Eti Osa
 * means nothing to anyone who does not already know where Eti Osa is, which
 * is precisely the reader the inset is for.
 *
 * So the context is the next recognisable thing up: an LGA sits inside its
 * state, a state inside its geopolitical zone, a zone inside the country.
 * Each is fetched once and kept, because an inset is redrawn on every pan of
 * the main map and must never be the reason a frame is dropped.
 */

import { state, set } from '../core/store.js';
import { lookupBoundary } from './boundaries.js';
import { zoneOfState, COUNTRIES } from '../core/constants.js';
import { buildZoneArea } from './admin.js';

/** Fetched contexts, keyed by their own descriptor. Never evicted; tiny. */
const cache = new Map();
const inFlight = new Set();

export const CONTEXT_MODES = [
  { id: 'auto',    label: 'Automatic',  hint: 'The next unit up — LGA in its state, state in its zone' },
  { id: 'country', label: 'Country',    hint: 'The national outline' },
  { id: 'none',    label: 'None',       hint: 'The study area on its own' },
];

const countryNameOf = (code) => COUNTRIES.find((c) => c.code === code)?.name ?? '';

/**
 * Which surrounding region this study area wants, as a descriptor.
 *
 * Returns null when there is nothing sensible to draw around it — a country
 * study area is already the biggest thing the inset knows how to show, and
 * drawing a country inside itself is a grey rectangle.
 */
function descriptorFor(area, mode) {
  if (!area || mode === 'none') return null;

  const country = area.countryCode ?? 'ng';
  const countryDescriptor = area.level === 'country'
    ? null
    : { kind: 'country', key: `country:${country}`, country, name: countryNameOf(country) };

  if (mode === 'country') return countryDescriptor;

  // Automatic: the smallest containing unit that is bigger than this one.
  if (area.level === 'lga' && area.parentName) {
    return { kind: 'state', key: `state:${country}:${area.parentName}`, country, name: area.parentName };
  }
  if (area.level === 'state') {
    const zone = zoneOfState(area.name);
    if (zone) return { kind: 'zone', key: `zone:${zone.id}`, zoneId: zone.id, name: zone.name };
  }
  return countryDescriptor;
}

/** Fetch one context descriptor into the cache. */
async function resolve(descriptor) {
  if (descriptor.kind === 'zone') {
    const { area } = await buildZoneArea(descriptor.zoneId);
    return { name: area.name, geojson: area.geojson };
  }
  const area = await lookupBoundary({
    level: descriptor.kind === 'country' ? 'country' : 'state',
    name: descriptor.kind === 'country' ? '' : descriptor.name,
    countryCode: descriptor.country,
    countryName: countryNameOf(descriptor.country),
  });
  return { name: area.name, geojson: area.geojson };
}

/**
 * The context outline for the current study area, or null.
 *
 * Synchronous by design: an element renderer runs inside a paint and cannot
 * await anything. A miss starts the fetch in the background and returns null,
 * and the `insetContext` state key it writes on arrival re-renders the page —
 * so the inset fills itself in a moment later rather than blocking the frame
 * or spinning up a fetch on every one.
 */
export function contextFor(area, mode = 'auto') {
  const descriptor = descriptorFor(area, mode);
  if (!descriptor) return null;
  if (cache.has(descriptor.key)) return cache.get(descriptor.key);

  if (!inFlight.has(descriptor.key)) {
    inFlight.add(descriptor.key);
    resolve(descriptor)
      .then((ctx) => {
        cache.set(descriptor.key, ctx);
        // Nudges every subscriber that draws the page; the value is a counter
        // rather than the context itself, because several insets may want
        // different ones and each looks its own up from this cache.
        set({ insetContext: (state.insetContext ?? 0) + 1 }, { history: false });
      })
      .catch(() => cache.set(descriptor.key, null))   // asked once, not every frame
      .finally(() => inFlight.delete(descriptor.key));
  }
  return null;
}

/** What the inspector should say the inset is currently showing. */
export function contextLabel(area, mode = 'auto') {
  const descriptor = descriptorFor(area, mode);
  if (!descriptor) return mode === 'none' ? 'Study area only' : 'Nothing larger to show';
  const ctx = cache.get(descriptor.key);
  if (ctx) return `Inside ${ctx.name}`;
  return cache.has(descriptor.key) ? `${descriptor.name} could not be loaded` : `Loading ${descriptor.name}…`;
}
