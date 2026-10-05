/**
 * Browsable OpenStreetMap dataset catalogue.
 *
 * Every entry is written in plain English for the panel and carries the
 * Overpass QL fragment that fetches it. `$bbox` is substituted with the
 * study area's south,west,north,east string at query time.
 *
 * Datasets that come in meaningful types — road classes, kinds of health
 * facility, airport parts — declare `segments`. On import each feature is
 * tagged with a `gds_class` property from those rules, which drives a
 * categorised symbology and a legend with one row per type instead of a
 * single undifferentiated blob.
 *
 * Two visual keys travel with a dataset and, where it matters, with each of
 * its segments:
 *
 *   symbol   a point icon id from layers/icons.js — a cross on hospitals, a
 *            pill on pharmacies. Not the same as `icon`, which is the text
 *            glyph shown beside the dataset's name in the panel.
 *   dash     a LINE_STYLES id for line work, so a ferry route arrives dashed
 *            because it is not a road and never was.
 *   width    a line weight in **millimetres on the printed page**, the way a
 *            desktop GIS states one. Trunk at 0.8 mm over service at 0.25 mm
 *            is the hierarchy a road map is built on; the thickness control
 *            scales the whole set and keeps the order.
 *
 * Both are only a starting position; everything stays editable on the layer
 * and on the legend afterwards.
 */

// `classify()` and `segmentsOf()` used to live here. They now sit in
// catalog.js, because Overture datasets are segmented by exactly the same
// rules and the logic was never OpenStreetMap-specific.

export const OSM_GROUPS = [
  { id: 'transport', label: 'Roads & transport' },
  { id: 'water',     label: 'Water & nature' },
  { id: 'built',     label: 'Buildings & places' },
  { id: 'services',  label: 'Services & facilities' },
  { id: 'land',      label: 'Land use' },
  { id: 'risk',      label: 'Industry & hazard' },
];

/**
 * @typedef {object} OsmDataset
 * @property {string}  slug     stable id, also the de-duplication key
 * @property {string}  name     shown to the user
 * @property {string}  group    OSM_GROUPS id
 * @property {string}  icon
 * @property {string}  hint     one line of plain English
 * @property {'point'|'line'|'polygon'} kind
 * @property {string}  color
 * @property {string}  body     Overpass QL statements, `$bbox` templated
 * @property {string} [labelField]
 * @property {boolean}[heavy]   warn the user this can be a big download
 */

/** @type {OsmDataset[]} */
export const OSM_DATASETS = [
  /* ---- Roads & transport ---------------------------------------- */
  {
    slug: 'roads-major', name: 'Major roads', group: 'transport', icon: '═',
    hint: 'Trunk, primary and secondary — each drawn in its own colour',
    kind: 'line', color: '#c92a2a', labelField: 'name',
    body: 'way["highway"~"^(trunk|primary|secondary)$"]($bbox);',
    // Strong, well-separated hues on purpose. A road layer drawn in mid-grey
    // on a pale basemap is technically present and practically invisible.
    // Widths are millimetres on the printed page, and follow the class
    // hierarchy the way a printed road map does.
    segments: [
      { label: 'Trunk',     color: '#c92a2a', width: 0.8,  match: { highway: '^trunk' } },
      { label: 'Primary',   color: '#e8590c', width: 0.65, match: { highway: '^primary' } },
      { label: 'Secondary', color: '#1971c2', width: 0.5,  match: { highway: '^secondary' } },
    ],
  },
  {
    slug: 'roads-local', name: 'Local roads & tracks', group: 'transport', icon: '╌',
    hint: 'Tertiary, residential, service roads and tracks — the street level',
    kind: 'line', color: '#64748b', labelField: 'name', heavy: true,
    body: 'way["highway"~"^(tertiary|residential|unclassified|service|track)$"]($bbox);',
    segments: [
      { label: 'Tertiary',    color: '#0f766e', width: 0.45, match: { highway: '^tertiary' } },
      { label: 'Residential', color: '#64748b', width: 0.32, match: { highway: '^(residential|unclassified)' } },
      { label: 'Service',     color: '#94a3b8', width: 0.25, match: { highway: '^service' } },
      // An unsurfaced track is not a street, and a dashed line is how every
      // printed map has said so for a century.
      { label: 'Track',       color: '#a16207', width: 0.25, dash: 'dashed', match: { highway: '^track' } },
    ],
  },
  {
    slug: 'railways', name: 'Railways', group: 'transport', icon: '⌸',
    hint: 'Rail lines and tram tracks',
    kind: 'line', color: '#1f2937', dash: 'dash-dot',
    body: 'way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge)$"]($bbox);',
  },
  {
    slug: 'airports', name: 'Airports & airstrips', group: 'transport', icon: '✦',
    hint: 'Aerodromes, terminals, runways and helipads — shown by part',
    kind: 'polygon', color: '#7c3aed', labelField: 'name', symbol: 'plane',
    body: 'nwr["aeroway"~"^(aerodrome|terminal|runway|apron|helipad|hangar)$"]($bbox);',
    segments: [
      { label: 'Aerodrome', color: '#7c3aed', symbol: 'plane', match: { aeroway: '^aerodrome' } },
      { label: 'Terminal',  color: '#a855f7', symbol: 'square', match: { aeroway: '^terminal' } },
      { label: 'Runway',    color: '#1f2937', symbol: 'plane', match: { aeroway: '^runway' } },
      { label: 'Apron',     color: '#94a3b8', symbol: 'square', match: { aeroway: '^(apron|hangar)' } },
      { label: 'Helipad',   color: '#0891b2', symbol: 'helipad', match: { aeroway: '^helipad' } },
    ],
  },
  {
    slug: 'bus-stops', name: 'Bus stops & terminals', group: 'transport', icon: '⊟',
    hint: 'Where public transport picks up — stations and stops',
    kind: 'point', color: '#0d9488', labelField: 'name', symbol: 'bus',
    body: 'nwr["amenity"~"^(bus_station|taxi)$"]($bbox);\nnode["highway"="bus_stop"]($bbox);\nnwr["public_transport"="station"]($bbox);',
    segments: [
      { label: 'Bus station', color: '#0f766e', symbol: 'bus', match: { amenity: '^bus_station' } },
      { label: 'Station',     color: '#1d4ed8', symbol: 'train', match: { public_transport: '^station' } },
      { label: 'Bus stop',    color: '#0d9488', symbol: 'circle', match: { highway: '^bus_stop' } },
      { label: 'Taxi rank',   color: '#f59e0b', symbol: 'car', match: { amenity: '^taxi' } },
    ],
  },
  {
    slug: 'fuel', name: 'Fuel stations', group: 'transport', icon: '⛽',
    hint: 'Petrol, diesel and gas filling stations',
    kind: 'point', color: '#ea580c', labelField: 'name', symbol: 'fuel',
    body: 'nwr["amenity"="fuel"]($bbox);\nnwr["shop"="gas"]($bbox);',
  },
  {
    slug: 'parking', name: 'Car parks', group: 'transport', icon: '⊞',
    hint: 'Public and private parking areas',
    kind: 'polygon', color: '#475569', symbol: 'car',
    body: 'nwr["amenity"="parking"]($bbox);',
  },
  {
    slug: 'ports', name: 'Ports & harbours', group: 'transport', icon: '⚓',
    hint: 'Docks, harbours, quays and port land',
    kind: 'polygon', color: '#0e7490', labelField: 'name', symbol: 'anchor',
    body: 'nwr["landuse"~"^(port|harbour)$"]($bbox);\nnwr["harbour"]($bbox);\nnwr["waterway"~"^(dock|boatyard)$"]($bbox);\nnwr["man_made"="pier"]($bbox);',
  },
  {
    slug: 'bridges', name: 'Bridges', group: 'transport', icon: '⌇',
    hint: 'Road and rail crossings over water or other roads',
    kind: 'line', color: '#7c2d12', labelField: 'name',
    body: 'way["bridge"]["highway"]($bbox);\nway["bridge"]["railway"]($bbox);\nway["man_made"="bridge"]($bbox);',
  },
  {
    slug: 'ferry', name: 'Ferry routes & jetties', group: 'transport', icon: '⌁',
    hint: 'Water transport routes and landing points',
    // A ferry route is a scheduled crossing, not a built thing — dashed, the
    // way a chart draws it.
    kind: 'line', color: '#0e7490', dash: 'dashed', symbol: 'anchor',
    body: 'nwr["route"="ferry"]($bbox);\nnwr["amenity"="ferry_terminal"]($bbox);',
  },

  /* ---- Water & nature -------------------------------------------- */
  {
    slug: 'rivers', name: 'Rivers & streams', group: 'water', icon: '≋',
    hint: 'Flowing water — rivers, streams and canals',
    kind: 'line', color: '#0284c7', labelField: 'name',
    body: 'way["waterway"~"^(river|stream|canal|drain)$"]($bbox);',
  },
  {
    slug: 'waterbodies', name: 'Lakes & reservoirs', group: 'water', icon: '◉',
    hint: 'Standing water bodies and wetlands',
    kind: 'polygon', color: '#38bdf8', labelField: 'name',
    body: 'nwr["natural"="water"]($bbox);\nnwr["landuse"="reservoir"]($bbox);\nnwr["natural"="wetland"]($bbox);',
  },
  {
    slug: 'forests', name: 'Forests & woodland', group: 'water', icon: '▲',
    hint: 'Tree cover mapped in OSM',
    kind: 'polygon', color: '#15803d', symbol: 'tree',
    body: 'nwr["natural"="wood"]($bbox);\nnwr["landuse"="forest"]($bbox);',
  },
  {
    slug: 'protected', name: 'Protected areas', group: 'water', icon: '⬡',
    hint: 'Reserves, national parks and conservation zones',
    // A designation is a line on paper, not a fence — long dashes read as
    // "this is a boundary, not a wall".
    kind: 'polygon', color: '#047857', labelField: 'name', dash: 'long-dash',
    body: 'nwr["boundary"="protected_area"]($bbox);\nnwr["leisure"="nature_reserve"]($bbox);',
  },
  {
    slug: 'coastline', name: 'Coastline', group: 'water', icon: '⌒',
    hint: 'Where the land meets the sea',
    kind: 'line', color: '#0369a1',
    body: 'way["natural"="coastline"]($bbox);',
  },
  {
    slug: 'dams', name: 'Dams & weirs', group: 'water', icon: '⌷',
    hint: 'Water control structures on rivers and reservoirs',
    kind: 'line', color: '#334155', labelField: 'name',
    body: 'nwr["waterway"~"^(dam|weir)$"]($bbox);',
  },

  /* ---- Buildings & places ---------------------------------------- */
  {
    slug: 'buildings', name: 'Building footprints', group: 'built', icon: '▦',
    hint: 'Every mapped building outline — heavy in dense cities',
    kind: 'polygon', color: '#94a3b8', heavy: true,
    body: 'way["building"]($bbox);',
  },
  {
    slug: 'settlements', name: 'Towns & villages', group: 'built', icon: '⌂',
    hint: 'Named settlements, sized by what kind of place they are',
    kind: 'point', color: '#0f172a', labelField: 'name', symbol: 'circle',
    body: 'node["place"~"^(city|town|village|hamlet|suburb)$"]($bbox);',
    segments: [
      { label: 'City',    color: '#0f172a', symbol: 'square', match: { place: '^city' } },
      { label: 'Town',    color: '#334155', symbol: 'circle', match: { place: '^town' } },
      { label: 'Suburb',  color: '#64748b', symbol: 'ring', match: { place: '^suburb' } },
      { label: 'Village', color: '#94a3b8', symbol: 'circle', match: { place: '^(village|hamlet)' } },
    ],
  },
  {
    slug: 'admin-wards', name: 'Local admin borders', group: 'built', icon: '▤',
    hint: 'Ward / district boundary relations inside the area',
    kind: 'polygon', color: '#475569', labelField: 'name', dash: 'dashed',
    body: 'relation["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"]($bbox);',
  },
  {
    slug: 'cemeteries', name: 'Cemeteries', group: 'built', icon: '✝',
    hint: 'Burial grounds and graveyards',
    kind: 'polygon', color: '#6b7280', labelField: 'name',
    body: 'nwr["landuse"="cemetery"]($bbox);\nnwr["amenity"="grave_yard"]($bbox);',
  },

  /* ---- Services & facilities ------------------------------------- */
  {
    slug: 'health', name: 'Health facilities', group: 'services', icon: '✚',
    hint: 'Hospitals, clinics, doctors, pharmacies — shown by type',
    kind: 'point', color: '#dc2626', labelField: 'name', symbol: 'cross',
    body: 'nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|health_post|dentist)$"]($bbox);\nnwr["healthcare"]($bbox);',
    segments: [
      { label: 'Hospital',   color: '#b91c1c', symbol: 'hospital', match: { amenity: '^hospital', healthcare: '^hospital' } },
      { label: 'Clinic',     color: '#f97316', symbol: 'cross', match: { amenity: '^(clinic|health_post)', healthcare: '^(clinic|centre)' } },
      { label: 'Doctor',     color: '#0891b2', symbol: 'heart', match: { amenity: '^doctors', healthcare: '^doctor' } },
      { label: 'Pharmacy',   color: '#16a34a', symbol: 'pill', match: { amenity: '^pharmacy', healthcare: '^pharmacy' } },
      { label: 'Dentist',    color: '#7c3aed', symbol: 'circle', match: { amenity: '^dentist', healthcare: '^dentist' } },
    ],
  },
  {
    slug: 'education', name: 'Schools & universities', group: 'services', icon: '✎',
    hint: 'Kindergarten through university — shown by level',
    kind: 'point', color: '#2563eb', labelField: 'name', symbol: 'school',
    body: 'nwr["amenity"~"^(school|college|university|kindergarten)$"]($bbox);',
    segments: [
      { label: 'University',   color: '#1d4ed8', symbol: 'graduation', match: { amenity: '^university' } },
      { label: 'College',      color: '#0891b2', symbol: 'book', match: { amenity: '^college' } },
      { label: 'School',       color: '#22c55e', symbol: 'school', match: { amenity: '^school' } },
      { label: 'Kindergarten', color: '#f59e0b', symbol: 'circle', match: { amenity: '^kindergarten' } },
    ],
  },
  {
    slug: 'water-points', name: 'Water points & boreholes', group: 'services', icon: '⊕',
    hint: 'Drinking water, wells, boreholes and hand pumps',
    kind: 'point', color: '#0891b2', labelField: 'name', symbol: 'droplet',
    body: 'nwr["amenity"="drinking_water"]($bbox);\nnwr["man_made"~"^(water_well|borehole|water_tower)$"]($bbox);',
    segments: [
      { label: 'Borehole',      color: '#0e7490', symbol: 'well', match: { man_made: '^(water_well|borehole)' } },
      { label: 'Water tower',   color: '#7c3aed', symbol: 'tower', match: { man_made: '^water_tower' } },
      { label: 'Drinking water', color: '#0891b2', symbol: 'droplet', match: { amenity: '^drinking_water' } },
    ],
  },
  {
    slug: 'markets', name: 'Markets & commerce', group: 'services', icon: '◈',
    hint: 'Marketplaces, supermarkets and shopping centres',
    kind: 'point', color: '#c2410c', labelField: 'name', symbol: 'shop',
    body: 'nwr["amenity"="marketplace"]($bbox);\nnwr["shop"~"^(supermarket|mall|department_store)$"]($bbox);',
    segments: [
      { label: 'Marketplace',  color: '#c2410c', symbol: 'market', match: { amenity: '^marketplace' } },
      { label: 'Supermarket',  color: '#0891b2', symbol: 'shop', match: { shop: '^supermarket' } },
      { label: 'Shopping mall', color: '#7c3aed', symbol: 'shop', match: { shop: '^(mall|department_store)' } },
    ],
  },
  {
    slug: 'emergency', name: 'Police, fire & emergency', group: 'services', icon: '★',
    hint: 'Emergency response points — shown by service',
    kind: 'point', color: '#b91c1c', labelField: 'name', symbol: 'shield',
    body: 'nwr["amenity"~"^(police|fire_station)$"]($bbox);\nnwr["emergency"="assembly_point"]($bbox);',
    segments: [
      { label: 'Police',         color: '#1d4ed8', symbol: 'shield', match: { amenity: '^police' } },
      { label: 'Fire station',   color: '#dc2626', symbol: 'flame', match: { amenity: '^fire_station' } },
      { label: 'Assembly point', color: '#16a34a', symbol: 'flag', match: { emergency: '^assembly_point' } },
    ],
  },
  {
    slug: 'worship', name: 'Places of worship', group: 'services', icon: '☩',
    hint: 'Churches, mosques, temples and shrines — shown by religion',
    kind: 'point', color: '#7c3aed', labelField: 'name', symbol: 'worship',
    body: 'nwr["amenity"="place_of_worship"]($bbox);',
    segments: [
      { label: 'Church',   color: '#7c3aed', symbol: 'worship', match: { religion: '^christian' } },
      { label: 'Mosque',   color: '#15803d', symbol: 'worship', match: { religion: '^muslim' } },
      { label: 'Temple',   color: '#c2410c', symbol: 'worship', match: { religion: '^(hindu|buddhist|sikh|jain)' } },
      { label: 'Synagogue', color: '#1d4ed8', symbol: 'worship', match: { religion: '^jewish' } },
    ],
  },
  {
    slug: 'banks', name: 'Banks & ATMs', group: 'services', icon: '⊜',
    hint: 'Branches, cash machines and bureaux de change',
    kind: 'point', color: '#0f766e', labelField: 'name', symbol: 'coins',
    body: 'nwr["amenity"~"^(bank|atm|bureau_de_change)$"]($bbox);',
    segments: [
      { label: 'Bank',            color: '#0f766e', symbol: 'bank', match: { amenity: '^bank' } },
      { label: 'ATM',             color: '#0891b2', symbol: 'coins', match: { amenity: '^atm' } },
      { label: 'Bureau de change', color: '#f59e0b', symbol: 'coins', match: { amenity: '^bureau_de_change' } },
    ],
  },
  {
    slug: 'government', name: 'Government & public offices', group: 'services', icon: '⌘',
    hint: 'Town halls, ministries, courts and embassies',
    kind: 'point', color: '#334155', labelField: 'name', symbol: 'bank',
    body: 'nwr["amenity"~"^(townhall|courthouse|embassy|prison)$"]($bbox);\nnwr["office"="government"]($bbox);',
    segments: [
      { label: 'Town hall',         color: '#1d4ed8', symbol: 'bank', match: { amenity: '^townhall' } },
      { label: 'Government office', color: '#334155', symbol: 'bank', match: { office: '^government' } },
      { label: 'Court',             color: '#7c3aed', symbol: 'bank', match: { amenity: '^courthouse' } },
      { label: 'Embassy',           color: '#0891b2', symbol: 'flag', match: { amenity: '^embassy' } },
      { label: 'Prison',            color: '#b91c1c', symbol: 'square', match: { amenity: '^prison' } },
    ],
  },
  {
    slug: 'post-telecom', name: 'Post & telecom', group: 'services', icon: '✉',
    hint: 'Post offices, post boxes and communication masts',
    kind: 'point', color: '#b45309', labelField: 'name', symbol: 'post',
    body: 'nwr["amenity"~"^(post_office|post_box|telephone)$"]($bbox);\nnwr["man_made"="mast"]($bbox);\nnwr["tower:type"="communication"]($bbox);',
    segments: [
      { label: 'Post office', color: '#b45309', symbol: 'post', match: { amenity: '^post_office' } },
      { label: 'Post box',    color: '#f59e0b', symbol: 'post', match: { amenity: '^(post_box|telephone)' } },
      { label: 'Mast',        color: '#334155', symbol: 'tower', match: { man_made: '^mast', 'tower:type': '^communication' } },
    ],
  },
  {
    slug: 'hotels', name: 'Hotels & lodging', group: 'services', icon: '⌸',
    hint: 'Hotels, guest houses, motels and hostels',
    kind: 'point', color: '#9333ea', labelField: 'name', symbol: 'bed',
    body: 'nwr["tourism"~"^(hotel|guest_house|motel|hostel|apartment)$"]($bbox);',
    segments: [
      { label: 'Hotel',       color: '#9333ea', symbol: 'bed', match: { tourism: '^hotel' } },
      { label: 'Guest house', color: '#0891b2', symbol: 'bed', match: { tourism: '^(guest_house|apartment)' } },
      { label: 'Motel',       color: '#f59e0b', symbol: 'bed', match: { tourism: '^motel' } },
      { label: 'Hostel',      color: '#16a34a', symbol: 'bed', match: { tourism: '^hostel' } },
    ],
  },
  {
    slug: 'food', name: 'Restaurants & cafés', group: 'services', icon: '◔',
    hint: 'Places to eat and drink — shown by kind',
    kind: 'point', color: '#c2410c', labelField: 'name', symbol: 'cutlery',
    body: 'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"]($bbox);',
    segments: [
      { label: 'Restaurant', color: '#c2410c', symbol: 'cutlery', match: { amenity: '^restaurant' } },
      { label: 'Café',       color: '#b45309', symbol: 'cup', match: { amenity: '^cafe' } },
      { label: 'Fast food',  color: '#f59e0b', symbol: 'cutlery', match: { amenity: '^fast_food' } },
      { label: 'Bar & pub',  color: '#7c3aed', symbol: 'cup', match: { amenity: '^(bar|pub)' } },
    ],
  },
  {
    slug: 'sports', name: 'Sports & recreation', group: 'services', icon: '◎',
    hint: 'Stadiums, pitches, sports centres and parks',
    kind: 'polygon', color: '#16a34a', labelField: 'name', symbol: 'ball',
    body: 'nwr["leisure"~"^(stadium|pitch|sports_centre|track|park|playground)$"]($bbox);',
    segments: [
      { label: 'Stadium',       color: '#1d4ed8', symbol: 'ball', match: { leisure: '^stadium' } },
      { label: 'Sports centre', color: '#0891b2', symbol: 'ball', match: { leisure: '^(sports_centre|track)' } },
      { label: 'Pitch',         color: '#16a34a', symbol: 'ball', match: { leisure: '^pitch' } },
      { label: 'Park',          color: '#84cc16', symbol: 'tree', match: { leisure: '^(park|playground)' } },
    ],
  },
  {
    slug: 'culture', name: 'Libraries & culture', group: 'services', icon: '❦',
    hint: 'Libraries, museums, theatres and community centres',
    kind: 'point', color: '#0891b2', labelField: 'name', symbol: 'book',
    body: 'nwr["amenity"~"^(library|theatre|arts_centre|community_centre)$"]($bbox);\nnwr["tourism"~"^(museum|gallery)$"]($bbox);',
    segments: [
      { label: 'Library',          color: '#0891b2', symbol: 'book', match: { amenity: '^library' } },
      { label: 'Museum & gallery', color: '#7c3aed', symbol: 'bank', match: { tourism: '^(museum|gallery)' } },
      { label: 'Theatre',          color: '#c2410c', symbol: 'star', match: { amenity: '^(theatre|arts_centre)' } },
      { label: 'Community centre', color: '#16a34a', symbol: 'flag', match: { amenity: '^community_centre' } },
    ],
  },
  {
    slug: 'waste', name: 'Waste & sanitation', group: 'services', icon: '⊘',
    hint: 'Recycling, waste transfer, landfill and public toilets',
    kind: 'point', color: '#65a30d', labelField: 'name', symbol: 'bin',
    body: 'nwr["amenity"~"^(recycling|waste_transfer_station|waste_disposal|toilets)$"]($bbox);\nnwr["landuse"="landfill"]($bbox);',
    segments: [
      { label: 'Recycling',      color: '#65a30d', symbol: 'bin', match: { amenity: '^recycling' } },
      { label: 'Waste disposal', color: '#78716c', symbol: 'bin', match: { amenity: '^(waste_transfer_station|waste_disposal)' } },
      { label: 'Landfill',       color: '#a16207', symbol: 'bin', match: { landuse: '^landfill' } },
      { label: 'Public toilets', color: '#0891b2', symbol: 'droplet', match: { amenity: '^toilets' } },
    ],
  },

  /* ---- Land use --------------------------------------------------- */
  // "Land use zones" — a bare `nwr["landuse"]` — used to sit here and was
  // removed. It matched every tagged polygon in the query box with no
  // discrimination at all, which on anything larger than a ward is tens of
  // thousands of overlapping shapes: slow to fetch, slow to draw, and a map
  // nobody could read underneath it. The specific land-use datasets below and
  // in the other groups (farmland, forest, industrial sites, cemeteries)
  // answer the questions people actually had, and answer them at a size the
  // browser can hold.
  {
    slug: 'farmland', name: 'Farmland & agriculture', group: 'land', icon: '⌗',
    hint: 'Cropland, orchards and plantations',
    kind: 'polygon', color: '#ca8a04',
    body: 'nwr["landuse"~"^(farmland|farmyard|orchard|vineyard|plant_nursery)$"]($bbox);',
  },

  /* ---- Industry & hazard ------------------------------------------ */
  {
    slug: 'oil-gas', name: 'Oil & gas infrastructure', group: 'risk', icon: '⛁',
    hint: 'Pipelines, wells, refineries and tanks — shown by type',
    kind: 'line', color: '#0f172a', labelField: 'name', symbol: 'oil',
    body: 'nwr["man_made"="pipeline"]($bbox);\nnwr["man_made"~"^(petroleum_well|storage_tank)$"]($bbox);\nnwr["industrial"="oil"]($bbox);\nnwr["landuse"="industrial"]["industrial"~"oil|petroleum|refinery"]($bbox);',
    segments: [
      // Buried infrastructure, drawn the way engineering drawings draw it.
      { label: 'Pipeline',      color: '#0f172a', dash: 'long-dash', symbol: 'oil', match: { man_made: '^pipeline' } },
      { label: 'Well',          color: '#b91c1c', symbol: 'oil', match: { man_made: '^petroleum_well' } },
      { label: 'Storage tank',  color: '#f59e0b', symbol: 'ring', match: { man_made: '^storage_tank' } },
      { label: 'Refinery site', color: '#7c3aed', symbol: 'factory', match: { industrial: 'oil|petroleum|refinery' } },
    ],
  },
  {
    slug: 'power', name: 'Power grid', group: 'risk', icon: '⚡',
    hint: 'Transmission lines, substations and generators',
    kind: 'line', color: '#a21caf', symbol: 'bolt',
    body: 'way["power"~"^(line|minor_line)$"]($bbox);\nnwr["power"~"^(substation|plant|generator)$"]($bbox);',
    segments: [
      { label: 'Transmission line', color: '#a21caf', width: 0.55, symbol: 'bolt', match: { power: '^line$' } },
      { label: 'Distribution line', color: '#c026d3', width: 0.35, dash: 'dashed', symbol: 'bolt', match: { power: '^minor_line' } },
      { label: 'Substation',        color: '#7c3aed', symbol: 'square', match: { power: '^substation' } },
      { label: 'Power station',     color: '#b91c1c', symbol: 'factory', match: { power: '^(plant|generator)' } },
    ],
  },
  {
    slug: 'industrial', name: 'Industrial sites', group: 'risk', icon: '▣',
    hint: 'Factories, works, quarries and waste sites',
    kind: 'polygon', color: '#57534e', labelField: 'name', symbol: 'factory',
    body: 'nwr["landuse"~"^(industrial|quarry|landfill)$"]($bbox);\nnwr["man_made"="works"]($bbox);',
    segments: [
      { label: 'Industrial estate', color: '#57534e', symbol: 'factory', match: { landuse: '^industrial' } },
      { label: 'Works & factory',   color: '#7c3aed', symbol: 'factory', match: { man_made: '^works' } },
      { label: 'Quarry',            color: '#a16207', symbol: 'mountain', match: { landuse: '^quarry' } },
      { label: 'Landfill',          color: '#65a30d', symbol: 'bin', match: { landuse: '^landfill' } },
    ],
  },
];

// Lookups live in catalog.js, which searches both providers' entries.
