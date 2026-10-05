/**
 * Template catalogue — the "pick a style, get a finished map" part.
 *
 * A template is a complete opening position: which basemap, which look
 * filter, which basemap layers are on, the page size, and the full set of
 * page elements with their positions and styling. Applying one replaces
 * the current furniture; everything stays editable afterwards.
 *
 * Every `id` here has a matching `.pv-<id>` thumbnail in
 * src/styles/previews.css — the two lists must stay in step.
 */

/** Groups used by the filter pills on the landing page and in the panel. */
export const TEMPLATE_CATEGORIES = [
  { id: 'all',          label: 'All styles' },
  { id: 'cartographic', label: 'Cartographic' },
  { id: 'report',       label: 'Report' },
  { id: 'analysis',     label: 'Analysis' },
  { id: 'artistic',     label: 'Artistic' },
  { id: 'vintage',      label: 'Vintage' },
  { id: 'topographic',  label: 'Topographic' },
  { id: 'three-d',      label: '3-D' },
  { id: 'editorial',    label: 'Editorial' },
  { id: 'geoinfotech',  label: 'GIS department' },
];

const ALL_ON = { roads: true, water: true, buildings: true, boundaries: true, labels: true, landcover: true };
const QUIET = { roads: true, water: true, buildings: false, boundaries: true, labels: true, landcover: true };
const BARE = { roads: false, water: true, buildings: false, boundaries: true, labels: false, landcover: true };

/** Shorthand for an element spec. */
const E = (type, x, y, w, h, extra = {}) => ({ type, x, y, w, h, ...extra });

/* ------------------------------------------------------------------ */
/* the templates                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} Template
 * @property {string} id            matches `.pv-<id>` in previews.css
 * @property {string} name
 * @property {string} category      TEMPLATE_CATEGORIES id
 * @property {string} blurb         one line, plain English
 * @property {string[]} tags
 * @property {string[]} preview     furniture layered on the CSS thumbnail
 * @property {string} basemap       BASEMAPS key
 * @property {object} look          { filter, texture, vignette }
 * @property {object} groups        basemap layer-group toggles
 * @property {object} page          { size, orientation }
 * @property {object} [camera]      { pitch, bearing }
 * @property {boolean} [terrain]
 * @property {boolean} [buildings3d]
 * @property {object} [suggest]     { tool, datasets } — what this style is for
 * @property {object[]} elements
 */

/** @type {Template[]} */
export const TEMPLATES = [
  /* ================= CARTOGRAPHIC ================================= */
  {
    id: 'quiet-canvas',
    name: 'Quiet Canvas',
    category: 'cartographic',
    blurb: 'Pale basemap, plenty of white space. The safe default for any subject.',
    tags: ['Clean', 'A4'],
    preview: ['north', 'scale'],
    basemap: 'positron',
    look: { filter: 'soft', texture: 'none', vignette: 0 },
    groups: QUIET,
    page: { size: 'a4', orientation: 'portrait' },
    suggest: { datasets: ['roads-major', 'rivers'] },
    elements: [
      E('title', 6, 5, 62, 7.5, { text: 'Map title' }),
      E('subtitle', 6, 12.8, 62, 4.5, { text: 'Study area · prepared by Geoinfotech' }),
      E('legend', 6, 71, 30, 22, { text: 'Legend' }),
      E('stats', 68, 71, 26, 22, { text: 'Key figures' }),
      E('north', 88, 5, 7, 9),
      E('scale', 6, 95, 26, 4, { style: { align: 'left' } }),
      E('credits', 36, 95.6, 58, 3.2, { style: { align: 'right' } }),
    ],
  },

  {
    id: 'district-atlas',
    name: 'District Atlas',
    category: 'cartographic',
    blurb: 'Framed atlas plate with a locator inset and full map information.',
    tags: ['Neatline', 'Inset'],
    preview: ['neatline', 'north', 'scale', 'inset', 'grid'],
    basemap: 'bright',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: ALL_ON,
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { datasets: ['admin-wards', 'settlements', 'roads-major'] },
    elements: [
      E('neatline', 2.4, 2.4, 95.2, 95.2),
      E('title', 5.5, 5, 52, 7, { text: 'Administrative Atlas', style: { size: 30 } }),
      E('subtitle', 5.5, 12, 52, 4, { text: 'Ward boundaries and settlements' }),
      E('inset', 75, 6, 19, 18),
      E('metadata', 75, 26, 19, 26, { text: 'Map information' }),
      E('legend', 75, 54, 19, 26, { text: 'Legend' }),
      E('north', 68.5, 6, 5, 8, { style: { variant: 'compass' } }),
      E('scale', 5.5, 92, 22, 4),
      E('credits', 30, 93, 42, 3, { style: { align: 'center' } }),
    ],
  },

  /* ================= REPORT ======================================= */
  {
    id: 'field-report',
    name: 'Field Report',
    category: 'report',
    blurb: 'Working document look — heavy on figures, light on decoration.',
    tags: ['Figures', 'Print'],
    preview: ['neatline', 'north', 'scale', 'coords'],
    basemap: 'positron',
    look: { filter: 'mono', texture: 'paper', vignette: 0 },
    groups: QUIET,
    page: { size: 'a4', orientation: 'portrait' },
    suggest: { datasets: ['health', 'education', 'water-points'] },
    elements: [
      E('neatline', 3, 3, 94, 94, { style: { borderWidth: 2.6, inner: true, gap: 1.6 } }),
      E('title', 6.5, 6, 60, 6.5, { text: 'Field Assessment', style: { font: 'sans', weight: 800, size: 26 } }),
      E('subtitle', 6.5, 12.4, 60, 4, { text: 'Rapid survey · sheet 1 of 1', style: { font: 'mono', size: 11 } }),
      E('stats', 6.5, 68, 40, 24, { text: 'Findings' }),
      E('legend', 49, 68, 26, 24, { text: 'Legend' }),
      E('metadata', 77, 68, 17, 24, { text: 'Sheet data', style: { size: 8 } }),
      E('north', 88, 6, 6, 8, { style: { variant: 'needle' } }),
      E('scale', 68, 60, 26, 4, { style: { variant: 'line' } }),
      E('credits', 6.5, 94, 87, 2.6, { style: { size: 7 } }),
    ],
  },

  {
    id: 'dark-dashboard',
    name: 'Dark Dashboard',
    category: 'report',
    blurb: 'Night-mode briefing panel — the look of the Flood Watch console.',
    tags: ['Dark', 'Screen'],
    preview: ['label', 'north', 'scale'],
    basemap: 'liberty',
    // See the note on "Incident Watch": analysis-carrying templates keep a
    // hue-preserving filter so results stay the colour of their legend.
    look: { filter: 'soft', texture: 'none', vignette: 0.42 },
    groups: QUIET,
    page: { size: 'slide', orientation: 'landscape' },
    suggest: { tool: 'buffer', datasets: ['rivers', 'settlements'] },
    elements: [
      E('title', 4, 6, 46, 9, { text: 'Situation Overview', style: { color: '#0f172a', size: 30, weight: 700 } }),
      E('subtitle', 4, 15.5, 46, 5, { text: 'Live monitoring extract', style: { color: '#0369a1', size: 13 } }),
      E('stats', 4, 60, 26, 32, {
        text: 'Key figures',
        style: { bg: '#0f172a', bgOpacity: 0.82, border: '#334155', borderWidth: 1, color: '#e2e8f0', radius: 10, size: 11 },
      }),
      E('legend', 32, 60, 24, 32, {
        text: 'Legend',
        style: { bg: '#0f172a', bgOpacity: 0.82, border: '#334155', borderWidth: 1, color: '#e2e8f0', radius: 10, size: 11 },
      }),
      E('north', 92, 6, 5, 8, { style: { color: '#0f172a', variant: 'compass' } }),
      E('scale', 82, 90, 15, 5, { style: { color: '#0f172a' } }),
      E('credits', 4, 94.5, 76, 3, { style: { color: '#475569', size: 7 } }),
    ],
  },

  /* ================= ARTISTIC ===================================== */
  {
    id: 'luminous-risk',
    name: 'Luminous',
    category: 'artistic',
    blurb: 'Glowing points on deep navy. Made for presentations and posters.',
    tags: ['Poster', 'Glow'],
    preview: ['label', 'north'],
    basemap: 'liberty',
    look: { filter: 'night', texture: 'none', vignette: 0.6 },
    groups: BARE,
    page: { size: 'a3', orientation: 'portrait' },
    suggest: { datasets: ['settlements', 'power'] },
    elements: [
      E('title', 8, 72, 60, 8, { text: 'Luminous', style: { font: 'display', color: '#f8fafc', size: 44, weight: 700 } }),
      E('subtitle', 8, 81, 60, 5, { text: 'A portrait of the network', style: { color: '#7dd3fc', size: 14, italic: true } }),
      E('legend', 8, 8, 22, 22, {
        text: 'Legend',
        style: { bg: '#020617', bgOpacity: 0.6, border: '#1e293b', borderWidth: 1, color: '#e2e8f0', radius: 12, size: 10 },
      }),
      E('north', 89, 8, 6, 8, { style: { color: '#e2e8f0', variant: 'needle' } }),
      E('scale', 8, 89, 22, 4.5, { style: { color: '#cbd5e1', variant: 'bar' } }),
      E('credits', 40, 94, 54, 3, { style: { color: '#64748b', size: 6.5, align: 'right' } }),
    ],
  },

  {
    id: 'watercolour',
    name: 'Watercolour',
    category: 'artistic',
    blurb: 'Soft washes on warm paper — a hand-painted feel with real data.',
    tags: ['Warm', 'Soft'],
    preview: ['neatline', 'north', 'scale'],
    basemap: 'bright',
    look: { filter: 'soft', texture: 'paper', vignette: 0.18 },
    groups: QUIET,
    page: { size: 'a4', orientation: 'landscape' },
    suggest: { datasets: ['rivers', 'forests', 'waterbodies'] },
    elements: [
      E('title', 6, 7, 52, 9, { text: 'Watercolour Study', style: { font: 'display', size: 34, weight: 500, color: '#334155' } }),
      E('subtitle', 6, 16.5, 52, 5, { text: 'Rivers, woodland and open water', style: { italic: true, size: 13, color: '#57534e' } }),
      E('legend', 6, 66, 24, 26, {
        text: 'Legend',
        style: { bg: '#fdfaf3', bgOpacity: 0.86, border: '#d6cebc', borderWidth: 1, radius: 12, color: '#44403c', size: 10 },
      }),
      E('north', 90, 7, 6, 9, { style: { color: '#57534e', variant: 'compass' } }),
      E('scale', 74, 90, 20, 5, { style: { color: '#57534e', variant: 'line' } }),
      E('credits', 6, 94.5, 62, 3, { style: { size: 6.8, color: '#78716c' } }),
    ],
  },

  /* ================= VINTAGE ====================================== */
  {
    id: 'naturalist-atlas',
    name: 'Naturalist Atlas',
    category: 'vintage',
    blurb: 'Nineteenth-century survey plate: sepia paper, serif type, double frame.',
    tags: ['Sepia', 'Serif'],
    preview: ['neatline', 'north', 'scale', 'coords'],
    basemap: 'bright',
    look: { filter: 'vintage', texture: 'paper', vignette: 0.32 },
    groups: QUIET,
    page: { size: 'a3', orientation: 'portrait' },
    suggest: { datasets: ['rivers', 'settlements', 'protected'] },
    elements: [
      E('neatline', 3, 3, 94, 94, { style: { color: '#5b4526', borderWidth: 3, inner: true, gap: 1.8, innerWidth: 0.8 } }),
      E('title', 8, 7, 84, 8, { text: 'A Survey of the District', style: { font: 'serif', size: 34, weight: 600, align: 'center', color: '#4a3620' } }),
      E('subtitle', 8, 15.5, 84, 4.5, { text: 'Drawn from field observation', style: { font: 'serif', italic: true, align: 'center', size: 13, color: '#6b573c' } }),
      E('legend', 7.5, 72, 26, 20, {
        text: 'Explanation',
        style: { font: 'serif', bg: '#f5ecd8', bgOpacity: 0.9, border: '#8a7350', borderWidth: 1, radius: 2, color: '#4a3620', size: 10, shadow: false },
      }),
      E('metadata', 66.5, 72, 26, 20, {
        text: 'Particulars',
        style: { font: 'serif', bg: '#f5ecd8', bgOpacity: 0.9, border: '#8a7350', borderWidth: 1, radius: 2, color: '#4a3620', size: 8, shadow: false },
      }),
      E('north', 89, 20, 6, 9, { style: { color: '#4a3620', variant: 'compass' } }),
      E('scale', 37, 74, 26, 5, { style: { color: '#4a3620', align: 'center', variant: 'checker' } }),
      E('credits', 8, 94.6, 84, 2.6, { style: { font: 'serif', size: 6.6, align: 'center', color: '#6b573c' } }),
    ],
  },

  {
    id: 'heritage-sepia',
    name: 'Heritage Sepia',
    category: 'vintage',
    blurb: 'Aged, softly vignetted plate for archival and heritage subjects.',
    tags: ['Aged', 'Frame'],
    preview: ['neatline', 'north'],
    basemap: 'positron',
    look: { filter: 'heritage', texture: 'linen', vignette: 0.5 },
    groups: BARE,
    page: { size: 'a4', orientation: 'portrait' },
    suggest: { datasets: ['admin-wards', 'rivers'] },
    elements: [
      E('neatline', 4, 4, 92, 92, { style: { color: '#6b4f2a', borderWidth: 2.2, inner: true, gap: 1.4 } }),
      E('title', 9, 8, 82, 7, { text: 'Heritage Sheet', style: { font: 'serif', size: 30, align: 'center', weight: 600, color: '#54401f' } }),
      E('subtitle', 9, 15.4, 82, 4, { text: 'Compiled from open records', style: { font: 'serif', italic: true, align: 'center', size: 12, color: '#7a6440' } }),
      E('legend', 9, 74, 26, 18, {
        text: 'Key',
        style: { font: 'serif', bg: '#f3e8cf', bgOpacity: 0.88, border: '#a08a63', borderWidth: 1, radius: 2, color: '#54401f', size: 10, shadow: false },
      }),
      E('north', 88, 8, 6, 8, { style: { color: '#54401f', variant: 'needle' } }),
      E('scale', 65, 74, 26, 5, { style: { color: '#54401f', variant: 'checker' } }),
      E('credits', 9, 94, 82, 2.6, { style: { font: 'serif', size: 6.6, align: 'center', color: '#7a6440' } }),
    ],
  },

  /* ================= TOPOGRAPHIC ================================== */
  {
    id: 'relief-habitat',
    name: 'Relief & Habitat',
    category: 'topographic',
    blurb: 'Hillshaded terrain under land cover — good for ecology and planning.',
    tags: ['Terrain', 'Hillshade'],
    preview: ['neatline', 'north', 'scale'],
    basemap: 'bright',
    look: { filter: 'soft', texture: 'none', vignette: 0.12 },
    groups: { ...QUIET, labels: false },
    terrain: true,
    camera: { pitch: 0, bearing: 0 },
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'area', datasets: ['forests', 'rivers', 'protected'] },
    elements: [
      E('title', 5, 5, 50, 7, { text: 'Relief and Habitat', style: { size: 28, weight: 700 } }),
      E('subtitle', 5, 12, 50, 4, { text: 'Terrain, water and vegetation cover' }),
      E('legend', 5, 66, 22, 26, { text: 'Land cover' }),
      E('stats', 29, 66, 20, 26, { text: 'Key figures' }),
      E('north', 91, 5, 5, 8, { style: { variant: 'compass' } }),
      E('scale', 76, 90, 20, 5),
      E('credits', 5, 94.6, 68, 2.8, { style: { size: 6.8 } }),
    ],
  },

  {
    id: 'elevation-poster',
    name: 'Elevation Poster',
    category: 'topographic',
    blurb: 'Bold hypsometric bands. A wall poster that still carries a legend.',
    tags: ['Poster', 'Bold'],
    preview: ['north', 'scale', 'label'],
    basemap: 'positron',
    look: { filter: 'vivid', texture: 'none', vignette: 0.2 },
    groups: BARE,
    terrain: true,
    page: { size: 'a2', orientation: 'portrait' },
    suggest: { tool: 'area' },
    elements: [
      E('title', 8, 76, 62, 9, { text: 'Elevation', style: { font: 'display', size: 52, weight: 700 } }),
      E('subtitle', 8, 86, 62, 4.5, { text: 'Height above sea level', style: { size: 14, color: '#475569' } }),
      E('legend', 74, 74, 20, 18, {
        text: 'Bands',
        style: { bg: '#ffffff', bgOpacity: 0.9, radius: 10, size: 9, border: '#cbd5e1', borderWidth: 1 },
      }),
      E('north', 88, 6, 6, 8),
      E('scale', 8, 92, 20, 4.5, { style: { variant: 'bar' } }),
      E('credits', 40, 94, 54, 2.6, { style: { size: 6.4, align: 'right' } }),
    ],
  },

  {
    id: 'highland-story',
    name: 'Highland Story',
    category: 'topographic',
    blurb: 'Map on the right, a column of explanation on the left.',
    tags: ['Narrative', 'Sidebar'],
    preview: ['neatline', 'north', 'scale', 'grid'],
    basemap: 'bright',
    look: { filter: 'soft', texture: 'paper', vignette: 0.1 },
    groups: QUIET,
    terrain: true,
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'length', datasets: ['forests', 'farmland'] },
    elements: [
      E('title', 4.5, 6, 26, 9, { text: 'Highland Story', style: { font: 'display', size: 30, weight: 600 } }),
      E('subtitle', 4.5, 15.5, 26, 6, { text: 'Terrain, farming and forest cover across the uplands', style: { size: 12, lineHeight: 1.4 } }),
      E('text', 4.5, 23, 26, 26, {
        text: 'Replace this paragraph with your own commentary. Anything you type here prints exactly as you see it, at the position you drag it to.',
        style: { size: 10.5, color: '#475569', lineHeight: 1.5 },
      }),
      E('stats', 4.5, 51, 26, 20, { text: 'Key figures', style: { bgOpacity: 0.9 } }),
      E('legend', 4.5, 73, 26, 19, { text: 'Legend', style: { bgOpacity: 0.9 } }),
      E('north', 92, 6, 5, 8, { style: { variant: 'needle' } }),
      E('scale', 78, 91, 19, 5),
      E('credits', 34, 95, 42, 2.6, { style: { size: 6.4 } }),
    ],
  },

  /* ================= 3-D ========================================== */
  {
    id: 'terrain-3d',
    name: 'Terrain 3-D',
    category: 'three-d',
    blurb: 'Tilted, exaggerated terrain view. Drag the map with right-click to orbit.',
    tags: ['3-D', 'Tilted'],
    preview: ['label', 'north'],
    basemap: 'bright',
    look: { filter: 'vivid', texture: 'none', vignette: 0.24 },
    groups: { ...BARE, labels: true },
    terrain: true,
    camera: { pitch: 62, bearing: -22 },
    page: { size: 'slide', orientation: 'landscape' },
    suggest: { tool: 'hotspot' },
    elements: [
      E('title', 4, 74, 52, 9, { text: 'Terrain Perspective', style: { font: 'display', size: 32, weight: 600, color: '#0f172a' } }),
      E('subtitle', 4, 84, 52, 5, { text: 'Vertical exaggeration ×1.4', style: { size: 12, color: '#334155' } }),
      E('legend', 78, 8, 18, 26, {
        text: 'Legend',
        style: { bg: '#ffffff', bgOpacity: 0.88, radius: 12, size: 10, border: '#e2e8f0', borderWidth: 1 },
      }),
      E('north', 90, 78, 6, 10, { style: { variant: 'compass' } }),
      E('scale', 4, 92, 20, 5),
      E('credits', 40, 95, 54, 3, { style: { size: 6.6, align: 'right' } }),
    ],
  },

  {
    id: 'city-3d',
    name: 'City 3-D',
    category: 'three-d',
    blurb: 'Extruded building footprints — an urban skyline from OpenStreetMap.',
    tags: ['Urban', 'Extruded'],
    preview: ['label', 'north', 'scale'],
    basemap: 'positron',
    look: { filter: 'soft', texture: 'none', vignette: 0.2 },
    groups: { ...ALL_ON, buildings: false },
    buildings3d: true,
    camera: { pitch: 58, bearing: -18 },
    page: { size: 'a4', orientation: 'landscape' },
    suggest: { tool: 'count-in', datasets: ['buildings', 'roads-major'] },
    elements: [
      E('title', 5, 7, 48, 8, { text: 'City in Three Dimensions', style: { size: 27, weight: 700 } }),
      E('subtitle', 5, 15, 48, 4.5, { text: 'Building heights from OpenStreetMap', style: { size: 12 } }),
      E('stats', 76, 8, 19, 24, { text: 'Key figures', style: { radius: 12 } }),
      E('legend', 76, 34, 19, 24, { text: 'Legend', style: { radius: 12 } }),
      E('north', 68, 8, 5, 8),
      E('scale', 5, 91, 20, 5, { style: { variant: 'bar' } }),
      E('credits', 30, 94.5, 64, 3, { style: { size: 6.6, align: 'right' } }),
    ],
  },

  /* ================= ANALYSIS ===================================== */
  {
    id: 'land-cover',
    name: 'Thematic Zones',
    category: 'analysis',
    blurb: 'Built for categorised data: a big legend, room for figures, a clean base.',
    tags: ['Categories', 'Legend'],
    preview: ['neatline', 'north', 'scale'],
    basemap: 'positron',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: { ...BARE, labels: true },
    page: { size: 'a3', orientation: 'portrait' },
    suggest: { tool: 'count-in', datasets: ['admin-wards'] },
    elements: [
      E('title', 6, 5, 62, 7, { text: 'Thematic Map', style: { size: 28, weight: 700 } }),
      E('subtitle', 6, 12.2, 62, 4.5, { text: 'Mapped by category' }),
      E('legend', 6, 68, 30, 26, { text: 'Categories' }),
      E('stats', 38, 68, 28, 26, { text: 'Key figures' }),
      E('metadata', 68, 68, 26, 26, { text: 'Map information', style: { size: 8 } }),
      E('north', 88, 5, 6, 8),
      E('scale', 6, 62, 24, 4.5),
      E('credits', 6, 95.5, 88, 3, { style: { size: 6.6 } }),
    ],
  },

  {
    id: 'indicator-poster',
    name: 'Indicator Poster',
    category: 'analysis',
    blurb: 'One measure, one map. For density, distance or a single key figure.',
    tags: ['Density', 'Single metric'],
    preview: ['label', 'scale', 'north'],
    basemap: 'positron',
    look: { filter: 'none', texture: 'none', vignette: 0.1 },
    groups: BARE,
    page: { size: 'a3', orientation: 'portrait' },
    suggest: { tool: 'hotspot' },
    elements: [
      E('title', 6, 6, 46, 8, { text: 'Where It Concentrates', style: { font: 'display', size: 34, weight: 600 } }),
      E('subtitle', 6, 14.6, 46, 5, { text: 'Density across the study area', style: { size: 13, color: '#475569' } }),
      E('stats', 6, 21, 24, 22, { text: 'Result', style: { size: 12, radius: 12 } }),
      E('legend', 6, 74, 24, 20, { text: 'Index', style: { radius: 12 } }),
      E('text', 34, 88, 40, 8, {
        text: 'Darker cells hold more of what was mapped.',
        style: { size: 10, color: '#475569' },
      }),
      E('north', 89, 6, 6, 8, { style: { variant: 'needle' } }),
      E('scale', 76, 74, 18, 5),
      E('credits', 6, 96, 88, 2.6, { style: { size: 6.4 } }),
    ],
  },

  {
    id: 'oil-spill',
    name: 'Incident Watch',
    category: 'analysis',
    blurb: 'Pale water, bright zones, a caution note. Built for spill and hazard work.',
    tags: ['Hazard', 'Zones'],
    preview: ['label', 'north', 'scale'],
    basemap: 'positron',
    // Deliberately a gentle filter: the look is a CSS filter over the whole
    // map canvas, so anything stronger would recolour the detections too and
    // the legend would stop matching the map. The dark cards carry the mood.
    look: { filter: 'soft', texture: 'none', vignette: 0.3 },
    groups: { roads: false, water: true, buildings: false, boundaries: true, labels: true, landcover: false },
    page: { size: 'a4', orientation: 'landscape' },
    suggest: { tool: 'buffer', datasets: ['oil-gas', 'rivers', 'waterbodies'] },
    elements: [
      E('title', 5, 6, 48, 8, { text: 'Incident Watch', style: { size: 28, weight: 800, color: '#0f172a' } }),
      E('subtitle', 5, 14.2, 48, 4.5, { text: 'Affected zones and infrastructure at risk', style: { size: 12, color: '#0369a1' } }),
      E('legend', 5, 60, 22, 30, {
        text: 'Zones',
        style: { bg: '#0f172a', bgOpacity: 0.84, border: '#334155', borderWidth: 1, color: '#e2e8f0', radius: 10, size: 10 },
      }),
      E('stats', 29, 60, 22, 30, {
        text: 'Extent',
        style: { bg: '#0f172a', bgOpacity: 0.84, border: '#334155', borderWidth: 1, color: '#e2e8f0', radius: 10, size: 10 },
      }),
      E('text', 53, 78, 42, 12, {
        text: 'Caution: zones drawn here are straight-line distances from mapped infrastructure. Treat every one as a lead to verify in the field, not a confirmed impact.',
        style: {
          size: 9.5, color: '#7c2d12', lineHeight: 1.45,
          bg: '#fffbeb', bgOpacity: 0.94, border: '#fcd34d', borderWidth: 1, radius: 8, padding: 7,
        },
      }),
      E('north', 91, 6, 5, 8, { style: { color: '#0f172a' } }),
      E('scale', 53, 92, 20, 5, { style: { color: '#0f172a' } }),
      E('credits', 5, 94, 46, 3, { style: { color: '#475569', size: 6.4 } }),
    ],
  },

  /* ================= EDITORIAL ==================================== */
  {
    id: 'climate-bulletin',
    name: 'Climate Bulletin',
    category: 'editorial',
    blurb: 'Newspaper masthead over a map. For briefs, newsletters and handouts.',
    tags: ['Editorial', 'Masthead'],
    preview: ['neatline', 'north', 'coords'],
    basemap: 'positron',
    look: { filter: 'mono', texture: 'paper', vignette: 0.15 },
    groups: QUIET,
    page: { size: 'a4', orientation: 'portrait' },
    suggest: { tool: 'hotspot' },
    elements: [
      E('neatline', 3.5, 3.5, 93, 93, { style: { color: '#292524', borderWidth: 2, inner: false } }),
      E('title', 7, 6.5, 86, 7, { text: 'CLIMATE BULLETIN', style: { font: 'serif', size: 36, weight: 700, align: 'center', color: '#1c1917' } }),
      E('subtitle', 7, 14.2, 86, 3.6, { text: 'Issue 01 · Prepared for public circulation', style: { font: 'serif', italic: true, align: 'center', size: 10.5, color: '#57534e' } }),
      E('text', 7, 66, 40, 22, {
        text: 'Lead paragraph goes here. Explain in two or three sentences what the map shows and what a reader should take away from it.',
        style: { font: 'serif', size: 11, lineHeight: 1.5, color: '#292524' },
      }),
      E('legend', 49, 66, 22, 22, { text: 'Legend', style: { font: 'serif', radius: 0, border: '#292524', borderWidth: 1, shadow: false, size: 9.5 } }),
      E('stats', 73, 66, 20, 22, { text: 'By the numbers', style: { font: 'serif', radius: 0, border: '#292524', borderWidth: 1, shadow: false, size: 9.5 } }),
      E('north', 87, 20, 5, 7, { style: { color: '#292524' } }),
      E('scale', 7, 90, 20, 4.5, { style: { color: '#292524', variant: 'line' } }),
      E('credits', 33, 91.5, 60, 3, { style: { font: 'serif', size: 6.4, align: 'right', color: '#57534e' } }),
    ],
  },

  /* ================= GEOINFOTECH GIS DEPARTMENT =================== */
  /*
   * Traced from real sheets produced by the Geoinfotech GIS department.
   * Each one keeps the original's *layout* — where the title sits, how the
   * furniture is grouped, what the margins do — and drops the subject matter,
   * so the same arrangement can carry anybody's study area.
   *
   * `photo` names the sheet in src/assets/contributors/ that the layout came
   * from; those templates show the real map as their thumbnail instead of a
   * CSS mock-up.
   */

  {
    id: 'gid-hazard-plate',
    name: 'Hazard Plate',
    category: 'geoinfotech',
    photo: 'flood-susceptibility.jpg',
    blurb: 'Wide risk plate: engraved title, tall colour key, figures in the corner.',
    tags: ['Risk', 'A3'],
    preview: ['neatline', 'north', 'scale'],
    basemap: 'positron',
    look: { filter: 'soft', texture: 'none', vignette: 0.16 },
    groups: { ...QUIET, buildings: false },
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'hotspot', datasets: ['rivers', 'waterbodies'] },
    elements: [
      E('neatline', 2.2, 2.6, 95.6, 94.8, { style: { color: '#8a9199', borderWidth: 1, inner: true, gap: 1.5, innerWidth: 0.6 } }),
      E('logo', 5.5, 6.5, 8, 12),
      // The original sets the place name over the map type, both hard right.
      E('title', 48, 7, 46, 8, { text: 'RIVERS STATE', style: { font: 'display', size: 44, weight: 700, align: 'right', color: '#4d7f92', lineHeight: 1 } }),
      E('subtitle', 48, 15.6, 46, 6, { text: 'FLOOD SUSCEPTIBILITY MAP', style: { font: 'display', size: 26, weight: 500, align: 'right', color: '#7fa9b6', lineHeight: 1 } }),
      E('legend', 4.5, 66, 25, 28, {
        text: '',
        style: { size: 13, gap: 4.6, swatch: 22, bg: '#ffffff', bgOpacity: 0, border: '#ffffff', borderWidth: 0, shadow: false, color: '#2f3a42' },
      }),
      E('stats', 70, 74, 26, 20, {
        text: 'By area',
        style: { size: 10, bg: '#ffffff', bgOpacity: 0, border: '#ffffff', borderWidth: 0, shadow: false, color: '#2f3a42' },
      }),
      E('north', 86, 36, 8, 11, { style: { variant: 'compass', color: '#2f7d95' } }),
      E('scale', 30, 90.5, 26, 4.5, { style: { variant: 'checker', color: '#2f7d95', align: 'center', size: 8.5 } }),
      E('credits', 4.5, 96, 62, 2.4, { style: { size: 6.4, color: '#8a9199' } }),
    ],
  },

  {
    id: 'gid-analyst-sheet',
    name: 'Analyst Sheet',
    category: 'geoinfotech',
    photo: 'isochrone-ikeja.jpg',
    blurb: 'Full-bleed working sheet — heading top right, key down the side.',
    tags: ['Analysis', 'Key panel'],
    preview: ['neatline', 'north', 'scale', 'grid'],
    basemap: 'bright',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: ALL_ON,
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'buffer', datasets: ['roads-major', 'health'] },
    elements: [
      E('neatline', 2.5, 2.5, 95, 95, { style: { color: '#0f172a', borderWidth: 1.4, inner: false } }),
      E('title', 52, 6, 43, 8, {
        text: 'MAP SHOWING THE TRAVEL TIME FROM MAJOR LANDMARKS',
        style: { font: 'sans', size: 15, weight: 800, align: 'right', color: '#0f172a', lineHeight: 1.28 },
      }),
      E('legend', 72, 21, 24, 34, {
        text: 'Legend',
        style: { size: 10, gap: 2.8, swatch: 13, bg: '#ffffff', bgOpacity: 0.92, border: '#94a3b8', borderWidth: 0.8, radius: 0, shadow: false },
      }),
      E('north', 5.5, 7, 4.5, 9, { style: { variant: 'needle', color: '#1f2937' } }),
      E('logo', 4.5, 79, 11, 13),
      E('scale', 40, 90, 28, 5, { style: { variant: 'checker', color: '#0f172a', align: 'center', thickness: 5 } }),
      E('credits', 4.5, 95.4, 62, 2.4, { style: { size: 6.4, color: '#475569' } }),
    ],
  },

  {
    id: 'gid-index-poster',
    name: 'Index Poster',
    category: 'geoinfotech',
    photo: 'security-pressure-index.jpg',
    blurb: 'Edge-to-edge poster: huge name, loose key, a written summary in the corner.',
    tags: ['Poster', 'Narrative'],
    preview: ['label', 'scale'],
    basemap: 'positron',
    look: { filter: 'soft', texture: 'none', vignette: 0.3 },
    groups: { ...BARE, labels: true },
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'hotspot' },
    elements: [
      E('title', 3, 2.5, 40, 9.6, { text: 'Nigeria', style: { font: 'sans', size: 62, weight: 800, color: '#111827', lineHeight: 1 } }),
      E('subtitle', 3.6, 12.4, 40, 5, { text: 'Security Pressure Index Map', style: { size: 18, weight: 400, color: '#374151' } }),
      // No card behind the key — on a full-bleed poster the swatches sit
      // straight on the map, as they do on the original.
      E('legend', 3.2, 39, 22, 24, {
        text: '',
        style: { size: 12.5, gap: 4.4, swatch: 18, bg: '#ffffff', bgOpacity: 0, border: '#ffffff', borderWidth: 0, shadow: false, color: '#1f2937' },
      }),
      E('text', 66, 76, 31, 17, {
        text: 'Replace this with two or three sentences on what the index combines, what the high and low ends mean, and what a reader should do with it.',
        style: { size: 10, lineHeight: 1.5, color: '#1f2937', align: 'justify' },
      }),
      E('scale', 2.5, 93, 30, 4.5, { style: { variant: 'checker', color: '#1f2937', size: 8 } }),
      E('logo', 77, 94, 9, 4.5),
      E('credits', 87, 95.2, 11, 2.4, { style: { size: 5.6, align: 'right', color: '#6b7280' } }),
    ],
  },

  {
    id: 'gid-survey-sheet',
    name: 'Survey Sheet',
    category: 'geoinfotech',
    photo: 'emerging-hotspots.jpg',
    blurb: 'The full professional sheet — map left, a stacked column of panels right.',
    tags: ['Sidebar', 'Insets', 'Complete'],
    preview: ['neatline', 'north', 'scale', 'inset', 'coords'],
    basemap: 'positron',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: QUIET,
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { tool: 'hotspot', datasets: ['settlements', 'roads-major'] },
    elements: [
      E('neatline', 2, 2, 96, 96, { style: { color: '#0f172a', borderWidth: 1.4, inner: false } }),
      // An opaque backing so the column reads as paper, not as map. It is
      // first in the list, which puts it behind every panel that follows.
      E('shape', 60.5, 2, 37.5, 96, {
        style: { variant: 'rectangle', fill: '#ffffff', fillOpacity: 1, stroke: '#0f172a', strokeWidth: 1.2, radius: 0 },
      }),
      E('title', 4.5, 4, 54, 5.5, {
        text: 'URBAN EXPANSION EMERGING HOT SPOT ANALYSIS',
        style: { size: 17, weight: 800, align: 'center', color: '#0f172a' },
      }),
      E('inset', 62, 4, 17.4, 22, { style: { size: 7, border: '#0f172a', borderWidth: 0.9, radius: 0, shadow: false, bgOpacity: 1 } }),
      E('metadata', 80, 4, 16.5, 22, { text: 'Location', style: { size: 7, border: '#0f172a', borderWidth: 0.9, radius: 0, shadow: false } }),
      E('legend', 62, 27.5, 34.5, 24, {
        text: 'KEY',
        style: { size: 8.4, gap: 2, swatch: 11, border: '#0f172a', borderWidth: 0.9, radius: 0, shadow: false, align: 'center' },
      }),
      E('text', 62, 53, 34.5, 4, { text: 'Scale 1 : 175,000', style: { size: 11, weight: 700, align: 'center', color: '#0f172a' } }),
      E('scale', 65, 58, 28.5, 5, { style: { variant: 'checker', align: 'center', color: '#0f172a', thickness: 5 } }),
      E('text', 62, 66, 18.5, 20, {
        text: 'Say what the analysis does in a short paragraph: the technique, the period it covers, and what a reader can conclude from it.',
        style: { size: 8.2, lineHeight: 1.45, color: '#1f2937', align: 'justify' },
      }),
      E('logo', 81.5, 66, 15, 12),
      E('credits', 81.5, 79, 15, 6, { style: { size: 6.2, align: 'center', color: '#334155' } }),
      E('north', 74, 87.5, 4.5, 8.5, { style: { variant: 'needle', color: '#0f172a' } }),
      E('metadata', 80, 87, 16.5, 9.5, { text: 'Spatial reference', style: { size: 6.6, border: '#0f172a', borderWidth: 0.9, radius: 0, shadow: false } }),
      E('stats', 62, 87, 11, 9.5, { text: 'Figures', style: { size: 6.6, border: '#0f172a', borderWidth: 0.9, radius: 0, shadow: false } }),
      E('text', 4.5, 95.4, 24, 2.6, { text: 'Edition of 2026', style: { size: 7, italic: true, weight: 700, color: '#0f172a' } }),
    ],
  },

  {
    id: 'gid-study-area',
    name: 'Study Area Sheet',
    category: 'geoinfotech',
    photo: 'lagos-study-area.jpg',
    blurb: 'Reference sheet: map on top, a banded strip of panels underneath.',
    tags: ['Reference', 'Banded'],
    preview: ['neatline', 'north', 'scale', 'inset', 'coords'],
    basemap: 'bright',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: ALL_ON,
    page: { size: 'a3', orientation: 'landscape' },
    suggest: { datasets: ['admin-wards', 'settlements'] },
    elements: [
      E('neatline', 2.5, 3, 95, 57, { style: { color: '#0f172a', borderWidth: 1.6, inner: false } }),
      // The lower third is paper, not map — one opaque band, panels on top.
      E('shape', 2.5, 62, 95, 35, {
        style: { variant: 'rectangle', fill: '#ffffff', fillOpacity: 1, stroke: '#0f172a', strokeWidth: 1.6, radius: 0 },
      }),
      E('title', 15, 5, 70, 6, {
        text: 'Study Area Map of Lagos State, Nigeria',
        style: { size: 24, weight: 800, align: 'center', color: '#0f172a' },
      }),
      E('inset', 3.5, 63, 17, 33, { style: { size: 7, border: '#0f172a', borderWidth: 1.2, radius: 0, shadow: false, bgOpacity: 1 } }),
      E('text', 22, 64.5, 45, 4, { text: 'SCALE', style: { size: 13, weight: 700, align: 'center', color: '#0f172a' } }),
      E('scale', 24, 70, 41, 6, { style: { variant: 'checker', align: 'center', color: '#0f172a', thickness: 6, size: 10 } }),
      E('metadata', 68.5, 63, 28, 17.5, { text: 'Spatial Reference', style: { size: 8.4, border: '#0f172a', borderWidth: 1.2, radius: 0, shadow: false } }),
      E('legend', 22, 79, 45, 17.5, {
        text: '',
        style: { size: 8, gap: 1.8, swatch: 11, border: '#0f172a', borderWidth: 1.2, radius: 0, shadow: false },
      }),
      E('north', 71, 82, 5, 12, { style: { variant: 'needle', color: '#0f172a' } }),
      E('logo', 80, 82, 15, 12),
      E('credits', 68.5, 95.4, 28, 2.4, { style: { size: 6, align: 'center', color: '#475569' } }),
    ],
  },

  {
    id: 'gid-night-atlas',
    name: 'Night Atlas',
    category: 'geoinfotech',
    photo: 'africa-hydrography.jpg',
    blurb: 'Data glowing on black, with the whole story stacked down one margin.',
    tags: ['Dark', 'Portrait', 'Poster'],
    preview: ['label', 'north'],
    basemap: 'liberty',
    look: { filter: 'night', texture: 'none', vignette: 0.55 },
    groups: { roads: false, water: true, buildings: false, boundaries: false, labels: false, landcover: false },
    page: { size: 'a3', orientation: 'portrait' },
    suggest: { datasets: ['rivers', 'waterbodies'] },
    elements: [
      E('north', 83, 9.5, 9, 9, { style: { variant: 'needle', color: '#38bdf8' } }),
      E('logo', 13.5, 48.5, 8, 6),
      E('legend', 7.5, 55, 23, 19, {
        text: 'River network',
        style: {
          size: 9, gap: 2.1, swatch: 12,
          bg: '#000000', bgOpacity: 0.55, border: '#e2e8f0', borderWidth: 0.8, radius: 0,
          color: '#f1f5f9', shadow: false,
        },
      }),
      // Two-tone masthead: the plain line sits above the accent word.
      E('subtitle', 6.5, 74.6, 28, 3.4, { text: 'THE RIVERS OF', style: { size: 22, weight: 700, color: '#f8fafc' } }),
      E('title', 6.5, 78.4, 28, 6, { text: 'AFRICA', style: { size: 34, weight: 800, color: '#6ee7b7', lineHeight: 1 } }),
      E('scale', 6.5, 85, 25, 4, { style: { variant: 'line', color: '#f1f5f9', size: 9.5 } }),
      E('text', 5.5, 89.5, 30, 2.7, { text: 'Map made by the GIS Department', style: { size: 10, weight: 700, align: 'center', color: '#f8fafc' } }),
      E('metadata', 5.5, 92.4, 30, 5, {
        text: '',
        style: { size: 8, align: 'center', color: '#cbd5e1', bg: '#000000', bgOpacity: 0, border: '#000000', borderWidth: 0, shadow: false },
      }),
      E('credits', 66, 96.4, 29, 2.4, { style: { size: 7, weight: 700, align: 'right', color: '#7dd3fc' } }),
    ],
  },

  /* ================= BLANK ======================================== */
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'cartographic',
    blurb: 'Nothing but the page. Add only the elements you want.',
    tags: ['Empty', 'Freeform'],
    preview: [],
    basemap: 'positron',
    look: { filter: 'none', texture: 'none', vignette: 0 },
    groups: ALL_ON,
    page: { size: 'a4', orientation: 'portrait' },
    elements: [
      E('title', 6, 5, 60, 7, { text: 'Untitled map' }),
      E('credits', 6, 95.5, 88, 3, { style: { size: 6.6 } }),
    ],
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

export const templatesInCategory = (cat) =>
  (!cat || cat === 'all' ? TEMPLATES : TEMPLATES.filter((t) => t.category === cat));

/* ------------------------------------------------------------------ */
/* The landing gallery                                                 */
/*                                                                     */
/* The GIS department layouts are shown by the contributor section,     */
/* beside the sheet each was traced from — which is the whole point of  */
/* them. Repeating them in "Start from a style" would say the same      */
/* thing twice and worse. They stay fully available inside the studio's */
/* Templates pane.                                                     */
/* ------------------------------------------------------------------ */
const IN_GALLERY = (t) => t.category !== 'geoinfotech';

export const GALLERY_CATEGORIES = TEMPLATE_CATEGORIES.filter((c) => c.id !== 'geoinfotech');

export const galleryTemplates = (cat) => templatesInCategory(cat).filter(IN_GALLERY);

/** Human label for a category id. */
export const categoryLabel = (id) =>
  TEMPLATE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
