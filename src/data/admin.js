/**
 * Administrative units below the level Nominatim is good at.
 *
 * Nominatim answers "find me a named place" well and "list what is inside
 * this place" not at all — there is no query for *the LGAs of Kaduna*. But
 * OpenStreetMap holds every one of them as a boundary relation with an
 * `admin_level`, so the list and the polygons come from Overpass instead, and
 * they are the same boundaries a shapefile of Nigerian LGAs would carry
 * because they are the same source most such shapefiles are derived from.
 *
 * Going through `fetchDataset` rather than calling Overpass directly is not
 * incidental: it buys the mirror race, the bounded queue and all three cache
 * layers. The LGA list for a state is fetched once and is instant from then
 * on, including for the next person if the shared database is running.
 */

import { fetchDataset } from './overpass.js';
import { lookupBoundary } from './boundaries.js';
import { areaKm2, bboxOf, centroidOf, pointInGeoJson, combinedAreaKm2 } from '../core/geo.js';
import { zoneById } from '../core/constants.js';

/**
 * OpenStreetMap's admin levels, as Nigeria and most of West Africa use them.
 *
 * Level 4 is the state, level 6 the LGA. Level 5 exists in some countries as
 * a senatorial or provincial tier and is asked for alongside 6 so a country
 * that numbers its second tier differently still returns something — whichever
 * level actually comes back with units is the one used.
 */
const CHILD_LEVELS = { state: '4', lga: '6|5' };

/**
 * A synthetic catalogue entry, so the ordinary fetch pipeline can run it.
 *
 * `slug` and `body` are what the cache keys on — the body is hashed into the
 * key — so a change to this query retires the stored copies rather than
 * serving units selected by a rule that no longer applies.
 */
const boundaryDataset = (level) => ({
  slug: `admin-${level}`,
  name: level === 'lga' ? 'LGA boundaries' : 'State boundaries',
  kind: 'polygon',
  body: `relation["boundary"="administrative"]["admin_level"~"^(${CHILD_LEVELS[level]})$"]($bbox);`,
});

const cleanName = (tags = {}) =>
  (tags['name:en'] || tags.name || tags.official_name || '').replace(/\s+/g, ' ').trim();

/**
 * The administrative units of one level that lie inside `parent`.
 *
 * Overpass can only be asked for a rectangle, and the rectangle around Kaduna
 * clips into six of its neighbours. Membership is decided on each unit's
 * **centroid**, not on whether it touches the parent: an LGA that shares a
 * border with Kaduna overlaps its bounding box and even its outline, and
 * listing it under Kaduna would be wrong in a way the user cannot see.
 *
 * @param {object} parent  a study area from lookupBoundary()
 * @param {'lga'|'state'} level
 * @param {{signal?: AbortSignal, onProgress?: (msg: string) => void}} [opts]
 * @returns {Promise<Array<{name, geojson, bbox, areaKm2, level, osmId, displayName}>>}
 */
export async function fetchAdminChildren(parent, level = 'lga', opts = {}) {
  if (!parent?.bbox) throw new Error('Load the parent area first.');

  const dataset = boundaryDataset(level);
  const geojson = await fetchDataset(dataset, parent.bbox, opts);

  const byLevel = new Map();
  for (const f of geojson.features ?? []) {
    const name = cleanName(f.properties);
    if (!name) continue;
    if (!/Polygon$/.test(f.geometry?.type ?? '')) continue;

    const centre = centroidOf(f);
    if (!centre || !pointInGeoJson(centre, parent.geojson)) continue;

    const lvl = String(f.properties?.admin_level ?? '');
    if (!byLevel.has(lvl)) byLevel.set(lvl, new Map());
    const bucket = byLevel.get(lvl);

    // A relation can come back more than once across a tiled or assembled
    // cache hit; the name is the identity a user picks by, so it is the one
    // that has to be unique in the list.
    if (bucket.has(name)) continue;

    const fc = { type: 'FeatureCollection', features: [f] };
    bucket.set(name, {
      name,
      displayName: `${name}, ${parent.name}`,
      level,
      geojson: fc,
      bbox: bboxOf(fc),
      areaKm2: areaKm2(fc),
      center: centre,
      osmId: f.properties?.['@id'] ?? f.id ?? null,
      parentName: parent.name,
    });
  }

  // Whichever level actually populated is the real second tier here. Asking
  // for "6 or 5" and then taking both would mix two tiers into one list.
  const best = [...byLevel.values()].sort((a, b) => b.size - a.size)[0];
  return best ? [...best.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
}

/* ------------------------------------------------------------------ */
/* geopolitical zones                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build one study area for a geopolitical zone.
 *
 * A zone has no boundary of its own to look up — it is a grouping of states —
 * so its outline is assembled from theirs. Each state is fetched by name and
 * the results are carried as `parts`, which is what makes the region behave
 * exactly like several study areas everywhere downstream: data is fetched per
 * state on its own bounding box rather than over one rectangle spanning the
 * whole zone, and the area figure is the dissolved union rather than a sum.
 *
 * States are fetched one at a time. Nominatim asks for about a request a
 * second and this is seven of them; racing them is how a shared service
 * starts refusing.
 *
 * @param {string} zoneId
 * @param {{onProgress?: (msg: string) => void, signal?: AbortSignal}} [opts]
 */
export async function buildZoneArea(zoneId, opts = {}) {
  const zone = zoneById(zoneId);
  if (!zone) throw new Error('Unknown zone.');

  const parts = [];
  const missing = [];

  for (const [i, stateName] of zone.states.entries()) {
    opts.signal?.throwIfAborted?.();
    opts.onProgress?.(`${zone.name} — ${stateName} (${i + 1} of ${zone.states.length})`);
    try {
      const area = await lookupBoundary({
        level: 'state',
        name: stateName,
        countryCode: 'ng',
        countryName: 'Nigeria',
        signal: opts.signal,
      });
      parts.push({ ...area, level: 'state' });
    } catch {
      // One state that will not resolve should not cost the other six. It is
      // named in the result so the map's own figures stay honest about what
      // the region actually covers.
      missing.push(stateName);
    }
  }

  if (!parts.length) throw new Error(`Could not load any state in ${zone.name}.`);

  const features = parts.flatMap((p) => p.geojson?.features ?? []);
  const geojson = { type: 'FeatureCollection', features };

  return {
    area: {
      name: zone.name,
      displayName: `${zone.name} geopolitical zone, Nigeria`,
      level: 'zone',
      zoneId: zone.id,
      geojson,
      bbox: bboxOf(geojson),
      areaKm2: combinedAreaKm2(parts.map((p) => p.geojson)),
      center: centroidOf(geojson),
      osmId: `zone/${zone.id}`,
      parts,
    },
    missing,
  };
}
