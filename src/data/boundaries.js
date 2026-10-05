/**
 * Study-area boundary lookup via OpenStreetMap Nominatim.
 *
 * Nominatim's usage policy allows about one request per second from an
 * identified client, so calls are throttled and cached here. A production
 * deployment should point ENDPOINTS.nominatim at a self-hosted instance
 * or a commercial geocoder.
 */

import { ENDPOINTS } from '../core/constants.js';
import { areaKm2, bboxOf, centroidOf } from '../core/geo.js';

const cache = new Map();
let lastCall = 0;

async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Compose a search string from the picker's level + name. */
export function buildQuery({ level, name, countryName }) {
  const place = (name ?? '').trim();
  switch (level) {
    case 'country': return countryName || place;
    case 'state':   return [place, countryName].filter(Boolean).join(', ');
    case 'lga':     return [place, countryName].filter(Boolean).join(', ');
    case 'city':    return [place, countryName].filter(Boolean).join(', ');
    default:        return [place, countryName].filter(Boolean).join(', ');
  }
}

/**
 * Find a boundary and return it as a study area.
 * @param {{level:string, name:string, countryCode?:string, countryName?:string, signal?:AbortSignal}} opts
 * @returns {Promise<{name:string, displayName:string, level:string, geojson:object,
 *                    bbox:number[], areaKm2:number, center:number[], osmType:string}>}
 */
export async function lookupBoundary(opts) {
  const query = buildQuery(opts);
  if (!query) throw new Error('Type a place name first.');

  const key = `${query}|${opts.countryCode ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  const params = new URLSearchParams({
    format: 'geojson',
    polygon_geojson: '1',
    addressdetails: '1',
    limit: '5',
    q: query,
  });
  if (opts.countryCode) params.set('countrycodes', opts.countryCode);

  await throttle();
  const res = await fetch(`${ENDPOINTS.nominatim}?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error(`Boundary service responded ${res.status}`);
  const data = await res.json();

  const features = (data.features ?? []).filter((f) =>
    f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

  if (!features.length) {
    throw new Error(`No mapped boundary found for “${query}”. Try the full official name, or pick a different level.`);
  }

  // Prefer the largest polygon result — avoids picking a same-named
  // suburb when the user asked for the state.
  const feature = features
    .map((f) => ({ f, a: areaKm2(f) }))
    .sort((x, y) => y.a - x.a)[0].f;

  const geojson = { type: 'FeatureCollection', features: [feature] };
  const result = {
    name: (feature.properties?.name || feature.properties?.display_name || query).split(',')[0].trim(),
    displayName: feature.properties?.display_name ?? query,
    level: opts.level,
    geojson,
    bbox: feature.bbox ?? bboxOf(geojson),
    areaKm2: areaKm2(geojson),
    center: centroidOf(geojson),
    // Carried so the locator inset knows which country to draw this inside
    // without having to guess it back out of the display name.
    countryCode: opts.countryCode || '',
    osmType: feature.properties?.osm_type ?? 'relation',
    // OpenStreetMap's own id for the boundary, which is what tells two study
    // areas apart when a map has several. Two places can share a name — Niger
    // the state and Niger the country — and nothing else here is unique.
    osmId: feature.properties?.osm_id ?? null,
  };

  cache.set(key, result);
  return result;
}

/** Free-text place suggestions for the search box (no polygons — fast). */
export async function suggestPlaces(text, countryCode, signal) {
  const q = (text ?? '').trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ format: 'json', limit: '6', q });
  if (countryCode) params.set('countrycodes', countryCode);
  await throttle();
  const res = await fetch(`${ENDPOINTS.nominatim}?${params}`, { signal });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r) => ({ label: r.display_name, type: r.type, className: r.class }));
}
