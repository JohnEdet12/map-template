/**
 * The dataset catalogue — one row per subject, two providers behind each.
 *
 * A person looking for hospitals wants hospitals, not a decision about data
 * providers first. So there is no Overture section: adding "Health
 * facilities" fetches OpenStreetMap and Overture together and returns one
 * layer, segmented by the OpenStreetMap rules and clipped to the study area
 * exactly as an OpenStreetMap-only layer would be.
 *
 * What makes that possible is that Overture is translated into OpenStreetMap
 * tags before it reaches anything else — see overture-merge.js. Everything
 * downstream (segments, symbols, line patterns, legend rows, analysis) works
 * on one vocabulary and never learns that two sources were involved.
 */

import { OSM_DATASETS, OSM_GROUPS } from './osm-catalog.js';
import { supplementFor } from './overture-merge.js';

export const PROVIDERS = {
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    short: 'OSM',
    blurb: 'Community-mapped and richly tagged, but uneven in coverage.',
  },
  overture: {
    id: 'overture',
    label: 'Overture Maps',
    short: 'Overture',
    blurb: 'OpenStreetMap conflated with Google, Microsoft, Meta and Esri data.',
  },
};

export const GROUPS = OSM_GROUPS;

/**
 * Every dataset, each with its Overture supplement attached where one exists.
 * `overture` being present is also what puts the "+ Overture" badge on a row.
 */
export const DATASETS = OSM_DATASETS.map((d) => ({
  ...d,
  provider: 'osm',
  overture: supplementFor(d.slug),
}));

export const datasetBySlug = (slug) => DATASETS.find((d) => d.slug === slug) ?? null;

export const datasetsInGroup = (group) => DATASETS.filter((d) => d.group === group);

/** Does this dataset pull from both providers? */
export const isMerged = (dataset) => Boolean(dataset?.overture);

/**
 * Tag a feature with its class. Returns the segment label, or '' when the
 * dataset is not segmented or nothing matches.
 *
 * This runs identically over OpenStreetMap and Overture features, because by
 * the time it sees them they carry the same tags.
 * @param {object} dataset
 * @param {object} properties
 */
export function classify(dataset, properties = {}) {
  for (const seg of dataset.segments ?? []) {
    for (const [key, pattern] of Object.entries(seg.match ?? {})) {
      const value = properties[key];
      if (value === undefined || value === null) continue;
      if (pattern === true) return seg.label;
      if (new RegExp(pattern, 'i').test(String(value))) return seg.label;
    }
  }
  return dataset.segments?.length ? 'Other' : '';
}

/** Category list for a dataset's symbology, in declared order. */
export const segmentsOf = (dataset) =>
  (dataset.segments ?? []).map((s) => ({
    value: s.label,
    label: s.label,
    color: s.color,
    width: s.width,
    // A segment falls back to the dataset's own symbol, so "shown by type"
    // means different colours of one recognisable mark unless a type earns
    // its own.
    icon: s.symbol ?? dataset.symbol,
    dash: s.dash,
  }));
