/** App-wide constants: basemaps, paper, fonts, palettes, geography presets. */

export const APP = {
  name: 'GIS Design Studio',
  org: 'Geoinfotech Resources Limited',
  version: '3.0.0',
};

/* ------------------------------------------------------------------ */
/* Basemaps                                                            */
/* ------------------------------------------------------------------ */

/**
 * Two kinds of basemap, and the difference matters to more than the picture.
 *
 *   vector   an OpenFreeMap style URL. Every feature is a real layer, so the
 *            plain-English layer toggles (roads, water, labels…) can hide
 *            families of them, labels stay sharp at any zoom, and the look
 *            filters recolour clean geometry.
 *   raster   pre-rendered image tiles, assembled into a style here. Nothing
 *            inside a tile can be switched off, and the labels are painted
 *            into the picture — which is exactly the trade you want for
 *            satellite imagery, and exactly the trade you do not want under a
 *            dense data layer.
 *
 * The layer toggles disable themselves on a raster basemap rather than
 * silently doing nothing, which is what they used to do.
 *
 * `attribution` is per basemap and reaches the printed credits, because these
 * are not all OpenStreetMap and a map that says they are is wrong.
 */
const ESRI = (path) => [`https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`];
const ESRI_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community';

export const BASEMAPS = {
  /* ---- vector: the ones with switchable layers -------------------- */
  liberty: {
    label: 'Liberty', group: 'Vector', type: 'vector', hint: 'Full detail, colourful',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: 'Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors',
  },
  bright: {
    label: 'Bright', group: 'Vector', type: 'vector', hint: 'Clean and legible',
    url: 'https://tiles.openfreemap.org/styles/bright',
    attribution: 'Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors',
  },
  positron: {
    label: 'Minimal', group: 'Vector', type: 'vector', hint: 'Pale — best under data',
    url: 'https://tiles.openfreemap.org/styles/positron',
    attribution: 'Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors',
  },

  /* ---- imagery ----------------------------------------------------- */
  satellite: {
    label: 'Satellite', group: 'Imagery', type: 'raster', hint: 'Aerial imagery, no labels',
    rasters: [{ tiles: ESRI('World_Imagery'), maxzoom: 19 }],
    attribution: ESRI_CREDIT,
    // Imagery is dark and busy; a pale overlay on top of it disappears, so
    // templates that switch to it want their data drawn brighter.
    dark: true,
  },
  'satellite-labels': {
    label: 'Satellite with labels', group: 'Imagery', type: 'raster',
    hint: 'Imagery, with place names and roads over it',
    rasters: [
      { tiles: ESRI('World_Imagery'), maxzoom: 19 },
      { tiles: ESRI('Reference/World_Boundaries_and_Places'), maxzoom: 19 },
    ],
    attribution: ESRI_CREDIT,
    dark: true,
  },
  hybrid: {
    label: 'Streets', group: 'Imagery', type: 'raster', hint: 'Esri street map',
    rasters: [{ tiles: ESRI('World_Street_Map'), maxzoom: 19 }],
    attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors',
  },

  /* ---- terrain ----------------------------------------------------- */
  topo: {
    label: 'Topographic', group: 'Terrain', type: 'raster', hint: 'Contours, relief and place names',
    rasters: [{ tiles: ESRI('World_Topo_Map'), maxzoom: 19 }],
    attribution: 'Basemap © Esri, HERE, Garmin, USGS, NGA',
  },
  opentopo: {
    label: 'OpenTopoMap', group: 'Terrain', type: 'raster', hint: 'Contour lines, hiking style',
    rasters: [{ tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'], maxzoom: 17 }],
    attribution: 'Basemap © OpenTopoMap (CC-BY-SA), data © OpenStreetMap contributors (ODbL)',
  },
  relief: {
    label: 'Shaded relief', group: 'Terrain', type: 'raster', hint: 'Landform only — good under data',
    rasters: [{ tiles: ESRI('World_Shaded_Relief'), maxzoom: 13 }],
    attribution: 'Relief © Esri',
  },

  /* ---- quiet canvases, for maps that are about the data ------------ */
  'canvas-light': {
    label: 'Light canvas', group: 'Canvas', type: 'raster', hint: 'Almost blank — maximum contrast for data',
    rasters: [{ tiles: ESRI('Canvas/World_Light_Gray_Base'), maxzoom: 16 }],
    attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors',
  },
  'canvas-dark': {
    label: 'Dark canvas', group: 'Canvas', type: 'raster', hint: 'Night-mode ground for bright data',
    rasters: [{ tiles: ESRI('Canvas/World_Dark_Gray_Base'), maxzoom: 16 }],
    attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors',
    dark: true,
  },
  ocean: {
    label: 'Ocean', group: 'Canvas', type: 'raster', hint: 'Bathymetry — for coastal and marine maps',
    rasters: [{ tiles: ESRI('Ocean/World_Ocean_Base'), maxzoom: 13 }],
    attribution: 'Basemap © Esri, GEBCO, NOAA, National Geographic',
  },
};

/** The basemaps a `<select>` should offer, already grouped. */
export const basemapOptions = () =>
  Object.entries(BASEMAPS).map(([value, b]) => ({ value, label: b.label, group: b.group, hint: b.hint }));

export const basemapSpec = (key) => BASEMAPS[key] ?? BASEMAPS.liberty;

/** Only a vector style has layers to switch off. */
export const isVectorBasemap = (key) => basemapSpec(key).type !== 'raster';

/**
 * "Looks" are CSS/canvas filters applied to the rendered basemap. They are
 * what turns one vector basemap into vintage, night, blueprint, etc., and
 * they are reproduced exactly at export time via ctx.filter.
 */
export const MAP_LOOKS = {
  none:      { label: 'True colour', filter: 'none' },
  soft:      { label: 'Soft print',  filter: 'saturate(0.72) contrast(0.96) brightness(1.03)' },
  vintage:   { label: 'Vintage',     filter: 'sepia(0.55) saturate(0.75) contrast(1.08) brightness(1.02)' },
  heritage:  { label: 'Heritage',    filter: 'sepia(0.85) saturate(0.6) contrast(1.12) brightness(0.98)' },
  night:     { label: 'Night',       filter: 'invert(0.92) hue-rotate(185deg) saturate(0.72) brightness(0.92)' },
  blueprint: { label: 'Blueprint',   filter: 'invert(0.9) sepia(1) hue-rotate(175deg) saturate(4) brightness(0.78)' },
  mono:      { label: 'Greyscale',   filter: 'grayscale(1) contrast(1.08)' },
  vivid:     { label: 'Vivid',       filter: 'saturate(1.45) contrast(1.06)' },
};

/** Paper / print textures drawn over the map at export time. */
export const MAP_TEXTURES = {
  none:  { label: 'None' },
  paper: { label: 'Paper grain' },
  linen: { label: 'Linen' },
  halftone: { label: 'Halftone dots' },
};

/** Free global DEM (Terrarium encoding) used for 3-D terrain templates. */
export const TERRAIN_SOURCE = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 13,
  attribution: 'Elevation: Mapzen / AWS Terrain Tiles',
};

/** Basemap layer-id substrings, grouped so users see plain-English toggles. */
export const BASEMAP_GROUPS = {
  roads:      { label: 'Roads & streets', match: ['road', 'transportation', 'bridge', 'tunnel', 'highway'] },
  water:      { label: 'Rivers & water',  match: ['water', 'waterway'] },
  buildings:  { label: 'Buildings',       match: ['building'] },
  boundaries: { label: 'Admin borders',   match: ['boundary', 'admin'] },
  labels:     { label: 'Place names',     match: ['label', 'place', 'poi', 'text'] },
  landcover:  { label: 'Parks & landuse', match: ['landcover', 'landuse', 'park', 'wood', 'forest'] },
};

/* ------------------------------------------------------------------ */
/* Paper                                                               */
/* ------------------------------------------------------------------ */
/**
 * Paper, smallest to largest, then the non-ISO sizes.
 *
 * `group` is only there so the picker can put a rule between wall-sized
 * plotter paper and the sheet sizes an office printer can actually take —
 * choosing A0 by mistake is an expensive surprise otherwise.
 */
const MM_PER_IN = 25.4;

/**
 * ISO paper is *defined* in millimetres, so that is what is stored and the
 * inches are derived. Writing A4 as 8.27 × 11.69 looks harmless and is not:
 * at 300 dpi it exports 2481 × 3507 pixels where the sheet is 2480 × 3508,
 * and jsPDF is handed a page a fraction of a millimetre off. Deriving from
 * the definition costs nothing and is exact at every resolution.
 */
const iso = (label, wMm, hMm, group) => ({
  label, group, metric: true,
  wMm, hMm, wIn: wMm / MM_PER_IN, hIn: hMm / MM_PER_IN,
});

/** Sizes that really are defined in inches keep their exact inch values. */
const imperial = (label, wIn, hIn, group, extra = {}) => ({
  label, group, metric: false,
  wIn, hIn, wMm: wIn * MM_PER_IN, hMm: hIn * MM_PER_IN,
  ...extra,
});

export const PAPER_SIZES = {
  a6:     iso('A6', 105, 148, 'Sheet'),
  a5:     iso('A5', 148, 210, 'Sheet'),
  a4:     iso('A4', 210, 297, 'Sheet'),
  a3:     iso('A3', 297, 420, 'Sheet'),
  letter: imperial('US Letter', 8.5, 11, 'Sheet'),
  legal:  imperial('US Legal',  8.5, 14, 'Sheet'),
  tabloid:imperial('Tabloid',   11,  17, 'Sheet'),

  a2:     iso('A2', 420, 594,  'Large format'),
  a1:     iso('A1', 594, 841,  'Large format'),
  a0:     iso('A0', 841, 1189, 'Large format'),
  b1:     iso('B1', 707, 1000, 'Large format'),
  arch_d: imperial('ARCH D', 24, 36, 'Large format'),
  arch_e: imperial('ARCH E', 36, 48, 'Large format'),
  poster: imperial('Poster 24×36', 24, 36, 'Large format'),

  square: imperial('Social square', 8,     8,   'Screen'),
  story:  imperial('Social story',  6.75,  12,  'Screen'),
  slide:  imperial('Presentation',  13.333, 7.5, 'Screen', { fixedOrientation: 'landscape' }),
};

/** Drop trailing zeros: 8.5 stays 8.5, 11.0 becomes 11. */
const trim = (n) => String(Math.round(n * 100) / 100);

/**
 * A paper size in the units it is actually specified in — millimetres for the
 * ISO sheets, inches for the American and architectural ones. Quoting A4 as
 * "8.3 × 11.7 in" is a rounded translation of an exact number, and it reads
 * as an approximation to anyone who prints.
 */
export function paperDimsLabel(paper, portrait = true) {
  // A size that can only be used one way round should be quoted that way,
  // whatever the caller asked for — a 16:9 slide listed as 7.5 × 13.33 reads
  // as a mistake.
  if (paper.fixedOrientation) portrait = paper.fixedOrientation !== 'landscape';
  const long = paper.metric ? Math.max(paper.wMm, paper.hMm) : Math.max(paper.wIn, paper.hIn);
  const short = paper.metric ? Math.min(paper.wMm, paper.hMm) : Math.min(paper.wIn, paper.hIn);
  const w = portrait ? short : long;
  const h = portrait ? long : short;
  return paper.metric ? `${trim(w)} × ${trim(h)} mm` : `${trim(w)}″ × ${trim(h)}″`;
}

/**
 * Export resolutions offered in page setup.
 *
 * `label` is what the choice is *for*, because "300" means nothing to someone
 * who has never prepared a file for a printer. The two above 300 exist because
 * a map is line work and small type, which is the one kind of image that keeps
 * getting visibly better past the resolution photographs stop at.
 */
export const EXPORT_RESOLUTIONS = [
  { dpi: 96,  label: 'Screen',    hint: 'For a slide or a web page' },
  { dpi: 150, label: 'Standard',  hint: 'Office printer, draft plots' },
  { dpi: 300, label: 'Print',     hint: 'The usual choice for a printed map' },
  { dpi: 450, label: 'Fine',      hint: 'Small type and dense line work stay sharp' },
  { dpi: 600, label: 'Very fine', hint: 'Plate quality — large files, slow export' },
];

/** Legacy shorthand kept for anything still asking by name. */
export const EXPORT_DPI = { screen: 96, standard: 150, print: 300, fine: 450, ultra: 600 };

/**
 * The ceiling on one exported image, in pixels.
 *
 * Browsers refuse to allocate a canvas beyond a few hundred megapixels, and
 * long before that the tab runs out of memory mid-export. A0 at 300 dpi is
 * 139 megapixels of map, so on the large-format sizes this limit is reached
 * routinely rather than exceptionally — which is why the page setup panel
 * shows the resolution you will actually get instead of the one you asked
 * for.
 */
export const MAX_EXPORT_PIXELS = 120e6;

/** The dpi an export will really achieve at this paper size. */
export function effectiveDpi(wIn, hIn, dpi) {
  const px = wIn * dpi * hIn * dpi;
  if (px <= MAX_EXPORT_PIXELS) return dpi;
  return Math.floor(dpi * Math.sqrt(MAX_EXPORT_PIXELS / px));
}

/* ------------------------------------------------------------------ */
/* Typography available to end users                                   */
/* ------------------------------------------------------------------ */
export const FONTS = {
  sans:    { label: 'Sans (Source Sans 3)', stack: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif' },
  display: { label: 'Display (Fraunces)',   stack: 'Fraunces, Georgia, serif' },
  serif:   { label: 'Serif (Georgia)',      stack: 'Georgia, "Times New Roman", serif' },
  mono:    { label: 'Mono (IBM Plex)',      stack: '"IBM Plex Mono", ui-monospace, monospace' },
};

/**
 * Element sizes are stored as a percentage of the artboard *width* so a
 * layout looks identical on screen and in a 300 dpi export.
 * The inspector shows friendly "pt" numbers: 1 pt = 0.1 % of page width.
 */
export const PT_TO_PCT = 0.1;

/* ------------------------------------------------------------------ */
/* Line widths, in units you can hold a ruler to                       */
/* ------------------------------------------------------------------ */

/**
 * The units a line thickness can be given in, the way a desktop GIS does it.
 *
 * All four are units of the *printed page*, not of the screen — "0.5 mm" means
 * half a millimetre on the paper that comes out of the plotter, at whatever
 * resolution you export. That is the only definition that survives the trip
 * from a preview at one zoom to a sheet at 600 dpi, and it is why screen
 * pixels are not on this list: a pixel is not a size, it is a count.
 *
 * Millimetres are stored; the rest are conversions for typing in.
 */
export const LINE_UNITS = [
  { id: 'mm', label: 'mm',     mm: 1,        step: 0.05, max: 20 },
  { id: 'cm', label: 'cm',     mm: 10,       step: 0.01, max: 2 },
  { id: 'in', label: 'inches', mm: 25.4,     step: 0.005, max: 0.8 },
  { id: 'pt', label: 'points', mm: 25.4 / 72, step: 0.1,  max: 56 },
];

const UNIT_BY_ID = new Map(LINE_UNITS.map((u) => [u.id, u]));

export const lineUnit = (id) => UNIT_BY_ID.get(id) ?? UNIT_BY_ID.get('mm');

/** A width typed in `unit` → millimetres, which is what gets stored. */
export const toMm = (value, unit = 'mm') => (Number(value) || 0) * lineUnit(unit).mm;

/** Millimetres → a number to show in `unit`, rounded to that unit's step. */
export function fromMm(mm, unit = 'mm') {
  const u = lineUnit(unit);
  const value = (Number(mm) || 0) / u.mm;
  const places = Math.max(0, Math.ceil(-Math.log10(u.step)));
  return Number(value.toFixed(places));
}

/* ------------------------------------------------------------------ */
/* Colour ramps offered to end users (colour-blind safe where noted)   */
/* ------------------------------------------------------------------ */
export const RAMPS = {
  risk:      { label: 'Risk (yellow → red)', colors: ['#fde68a', '#fbbf24', '#f97316', '#ea580c', '#b91c1c'] },
  water:     { label: 'Water (light → deep)', colors: ['#e0f2fe', '#7dd3fc', '#38bdf8', '#0284c7', '#075985'] },
  vegetation:{ label: 'Vegetation',           colors: ['#f7fcb9', '#addd8e', '#41ab5d', '#238443', '#005a32'] },
  earth:     { label: 'Earth tones',          colors: ['#f6e8c3', '#dfc27d', '#bf812d', '#8c510a', '#543005'] },
  viridis:   { label: 'Viridis (safe)',       colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  diverging: { label: 'Diverging (safe)',     colors: ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'] },
  mono:      { label: 'Greyscale (print)',    colors: ['#f1f5f9', '#cbd5e1', '#94a3b8', '#475569', '#0f172a'] },
};

/* ------------------------------------------------------------------ */
/* Study-area presets. Nigeria first because that is the team's focus, */
/* but the Nominatim lookup itself is global.                          */
/* ------------------------------------------------------------------ */
export const COUNTRIES = [
  { code: 'ng', name: 'Nigeria' },
  { code: 'gh', name: 'Ghana' },
  { code: 'ke', name: 'Kenya' },
  { code: 'za', name: 'South Africa' },
  { code: 'cm', name: 'Cameroon' },
  { code: 'bj', name: 'Benin' },
  { code: 'ne', name: 'Niger' },
  { code: 'td', name: 'Chad' },
  { code: '',   name: 'Anywhere in the world' },
];

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

/**
 * Nigeria's six geopolitical zones.
 *
 * Not an administrative tier — there is no zonal government and OpenStreetMap
 * has no boundary relation for one — but the unit almost every national
 * report, budget allocation and health survey is broken down by. So a zone is
 * defined here the way it is defined in practice: as its list of states,
 * whose real outlines are fetched and dissolved into one region.
 *
 * Thirty-six states plus the Federal Capital Territory, which sits in North
 * Central.
 */
export const NIGERIA_ZONES = [
  {
    id: 'nc', name: 'North Central',
    states: ['Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau', 'Federal Capital Territory'],
  },
  {
    id: 'ne', name: 'North East',
    states: ['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'],
  },
  {
    id: 'nw', name: 'North West',
    states: ['Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara'],
  },
  {
    id: 'se', name: 'South East',
    states: ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'],
  },
  {
    id: 'ss', name: 'South South',
    states: ['Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'],
  },
  {
    id: 'sw', name: 'South West',
    states: ['Ekiti', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo'],
  },
];

export const zoneById = (id) => NIGERIA_ZONES.find((z) => z.id === id) ?? null;

/**
 * Which zone a state belongs to.
 *
 * Matched on a normalised name because the two sources spell states
 * differently: this table says "Ekiti" and Nominatim answers "Ekiti State",
 * and the FCT arrives as anything from "Federal Capital Territory" to "Abuja
 * Federal Capital Territory". Comparing raw strings quietly found nothing and
 * fell back to the country, which looks like a design decision rather than a
 * missed match.
 */
const normaliseState = (name) => String(name ?? '')
  .toLowerCase()
  .replace(/\b(state|province|region)\b/g, '')
  .replace(/[^a-z]+/g, '');

export const zoneOfState = (stateName) => {
  const key = normaliseState(stateName);
  if (!key) return null;
  return NIGERIA_ZONES.find((z) => z.states.some((s) => {
    const target = normaliseState(s);
    // "abujafederalcapitalterritory" contains "federalcapitalterritory".
    return target === key || key.includes(target) || target.includes(key);
  })) ?? null;
};

export const ADMIN_LEVELS = [
  { id: 'country', label: 'Country',            hint: 'National outline' },
  { id: 'zone',    label: 'Geopolitical zone',  hint: 'Nigeria only — the six states groupings, dissolved into one region', countries: ['ng'] },
  { id: 'state',   label: 'State / Province',   hint: 'First-level admin unit' },
  { id: 'lga',     label: 'LGA / District',     hint: 'Second-level admin unit — pick the state first' },
  { id: 'city',    label: 'City / Town',        hint: 'Populated place' },
  { id: 'custom',  label: 'Search any place',   hint: 'Type anything — a park, a river, a campus' },
];

/** The levels that make sense for a country — zones are Nigeria-only. */
export const adminLevelsFor = (countryCode) =>
  ADMIN_LEVELS.filter((l) => !l.countries || l.countries.includes(countryCode));

/** Public endpoints. Swap these for self-hosted instances in production. */
export const ENDPOINTS = {
  nominatim: 'https://nominatim.openstreetmap.org/search',
  // Raced, not tried in order — see data/overpass.js. More mirrors means a
  // congested one costs seconds rather than the whole request.
  //
  // Every entry MUST carry the full planet. Regional instances (overpass.osm.ch
  // is Switzerland-only, for example) answer fast with a valid *empty* result
  // outside their extract, which a race would happily accept as the winner.
  overpass: [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ],
};

/** Everything that is true of every map, whatever basemap it is drawn on. */
export const ATTRIBUTION_TEXT =
  'Boundaries via Nominatim · Feature data © OpenStreetMap contributors';

/**
 * The credit line for a map on this basemap.
 *
 * Composed rather than fixed, because the basemaps are no longer all
 * OpenStreetMap: a satellite map credited to OpenFreeMap is simply a false
 * statement, and it is the kind that gets a printed map into trouble.
 */
export const attributionFor = (basemapKey) =>
  `${basemapSpec(basemapKey).attribution} · ${ATTRIBUTION_TEXT}`;
