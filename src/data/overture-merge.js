/**
 * Overture supplements, one per OpenStreetMap dataset.
 *
 * The catalogue has one row per subject, not one per provider. Adding
 * "Health facilities" fetches OpenStreetMap *and* Overture, and what comes
 * back is a single layer, segmented by the OpenStreetMap rules and clipped to
 * the study area exactly as before. Overture is a supplement, never a
 * separate thing to choose.
 *
 * That works because each supplement translates Overture into OpenStreetMap's
 * tag vocabulary before anything else sees it. An Overture road with
 * `class: "motorway"` becomes `highway: "motorway"`; an Overture place with
 * category "dental clinic" becomes `amenity: "dentist"`. By the time the
 * feature reaches `classify()` it is indistinguishable from an Overpass one,
 * so the existing segment rules, colours, symbols and legend rows apply to it
 * without knowing it exists.
 *
 * Every value matched here was read off the tiles rather than guessed, which
 * matters more than it sounds: places of worship live under the taxonomy
 * group "cultural and historic", not a religion group; land use carries the
 * OSM-ish value in `class` while `subtype` is much coarser; and the water
 * layer describes a stream in `class` but a canal in `subtype`.
 *
 * `tags(info)` returns the OSM tags for a feature, or null to reject it —
 * which is how one Overture theme is narrowed to one subject.
 */

/** First matching rule wins; `null` means "not this dataset's business". */
const pick = (value, rules, fallback = null) => {
  const v = String(value ?? '');
  for (const [re, tags] of rules) if (re.test(v)) return tags;
  return fallback;
};

/* ------------------------------------------------------------------ */
/* shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** Roads, taken from the transportation theme and filtered by class. */
const roads = (id, keep) => ({
  id,
  theme: 'transportation',
  layer: 'segment',
  maxZoom: 14,
  minZoom: 11,
  tags: (info) => (info.subtype === 'road' && keep.test(info.class) ? { highway: info.class } : null),
});

/** Points of interest, matched on Overture's own category taxonomy. */
const places = (id, group, rules, fallback) => ({
  id,
  theme: 'places',
  layer: 'place',
  maxZoom: 14,
  minZoom: 14,
  tags: (info) => {
    if (group && !group.test(info.group)) return null;
    return pick(info.category, rules, fallback);
  },
});

const landUse = (id, tags) => ({
  id, theme: 'base', layer: 'land_use', maxZoom: 13, minZoom: 9, tags,
});

/* ------------------------------------------------------------------ */
/* the table, keyed by OpenStreetMap dataset slug                      */
/* ------------------------------------------------------------------ */
export const SUPPLEMENTS = {
  /* ---- roads & transport ------------------------------------------ */
  // Deliberately no motorway: the OpenStreetMap side of this dataset asks
  // for trunk, primary and secondary, and a supplement that reached wider
  // would add a class the layer has no colour, legend row or description for.
  'roads-major': roads('roads-major', /^(trunk|primary|secondary)$/),
  'roads-local': roads('roads-local', /^(tertiary|residential|unclassified|living_street|service|driveway|parking_aisle|track)$/),

  railways: {
    id: 'railways', theme: 'transportation', layer: 'segment', maxZoom: 14, minZoom: 11,
    tags: (info) => (info.subtype === 'rail' ? { railway: 'rail' } : null),
  },

  'bus-stops': {
    id: 'bus-stops', theme: 'base', layer: 'infrastructure', maxZoom: 13, minZoom: 9,
    tags: (info) => pick(info.class, [
      [/^bus_stop/, { highway: 'bus_stop' }],
      [/^bus_station/, { amenity: 'bus_station' }],
      [/^(railway_(halt|station)|transit_station)/, { public_transport: 'station' }],
    ]),
  },

  fuel: places('fuel', /^travel/, [[/gas station|fuel|petrol/, { amenity: 'fuel' }]]),

  parking: {
    id: 'parking', theme: 'base', layer: 'infrastructure', maxZoom: 13, minZoom: 9,
    tags: (info) => (/^parking/.test(info.class) ? { amenity: 'parking' } : null),
  },

  airports: places('airports', /^travel/, [[/^airport|airfield|aerodrome/, { aeroway: 'aerodrome' }]]),

  bridges: {
    id: 'bridges', theme: 'base', layer: 'infrastructure', maxZoom: 13, minZoom: 9,
    tags: (info) => (info.subtype === 'bridge' ? { man_made: 'bridge', bridge: 'yes' } : null),
  },

  ports: places('ports', /^travel/, [[/port|harbou?r|marina|ferry/, { harbour: 'yes' }]]),

  /* ---- water & nature ---------------------------------------------- */
  rivers: {
    id: 'rivers', theme: 'base', layer: 'water', maxZoom: 13, minZoom: 9,
    // A stream is described in `class`, a canal in `subtype`; check both.
    tags: (info) => pick(`${info.class} ${info.subtype}`, [
      [/\briver\b/, { waterway: 'river' }],
      [/\bcanal\b/, { waterway: 'canal' }],
      [/\bstream\b/, { waterway: 'stream' }],
      [/\b(drain|ditch)\b/, { waterway: 'drain' }],
    ]),
  },

  waterbodies: {
    id: 'waterbodies', theme: 'base', layer: 'water', maxZoom: 13, minZoom: 9,
    tags: (info) => pick(`${info.subtype} ${info.class}`, [
      [/\bwetland|swamp|mangrove\b/, { natural: 'wetland' }],
      [/\b(lake|pond|reservoir|lagoon|water|human_made|basin)\b/, { natural: 'water' }],
    ]),
  },

  forests: {
    id: 'forests', theme: 'base', layer: 'land_cover', maxZoom: 13, minZoom: 9,
    tags: (info) => (/^(forest|tree)/.test(info.subtype) ? { natural: 'wood' } : null),
  },

  protected: landUse('protected', (info) =>
    (/^park$/.test(info.subtype) || /^(park|nature_reserve|protected)/.test(info.class)
      ? { leisure: 'nature_reserve' } : null)),

  /* ---- buildings & places ------------------------------------------ */
  buildings: {
    id: 'buildings', theme: 'buildings', layer: 'building',
    maxZoom: 14, minZoom: 14, tileBudget: 12,
    tags: () => ({ building: 'yes' }),
  },

  settlements: {
    id: 'settlements', theme: 'divisions', layer: 'division', maxZoom: 12, minZoom: 8,
    tags: (info) => pick(`${info.class} ${info.subtype}`, [
      [/\bcity\b/, { place: 'city' }],
      [/\btown\b/, { place: 'town' }],
      [/\b(village|hamlet)\b/, { place: 'village' }],
      [/\b(neighborhood|macrohood|locality)\b/, { place: 'suburb' }],
    ]),
  },

  'admin-wards': {
    id: 'admin-wards', theme: 'divisions', layer: 'division_area', maxZoom: 12, minZoom: 8,
    tags: (info) => (/^(county|region|locality|localadmin|neighborhood|macrohood)$/.test(info.subtype)
      ? { boundary: 'administrative' } : null),
  },

  cemeteries: places('cemeteries', null, [[/cemetery|graveyard|funeral/, { landuse: 'cemetery' }]]),

  /* ---- services & facilities ---------------------------------------- */
  health: places('health', /^health/, [
    [/^hospital|medical cent|emergency room/, { amenity: 'hospital' }],
    [/dental|dentist|orthodont/, { amenity: 'dentist' }],
    [/pharmac|drugstore|chemist/, { amenity: 'pharmacy' }],
    [/clinic|outpatient|health cent|medical service|diagnostic|laborator/, { amenity: 'clinic' }],
    [/doctor|physician|psycholog|therap|optometr|midwif|naturopath|medicine/, { amenity: 'doctors' }],
  ], { amenity: 'clinic' }),

  education: places('education', /^education/, [
    [/college|universit|polytechnic/, { amenity: 'university' }],
    [/preschool|kindergarten|nursery|creche|day ?care/, { amenity: 'kindergarten' }],
    [/school|academy/, { amenity: 'school' }],
    [/librar/, { amenity: 'library' }],
  ], { amenity: 'school' }),

  markets: places('markets', /^shopping/, [
    [/market(place)?\b|farmers/, { amenity: 'marketplace' }],
    [/grocery|supermarket|food store/, { shop: 'supermarket' }],
    [/shopping mall|department store/, { shop: 'mall' }],
  ]),

  emergency: places('emergency', null, [
    [/police/, { amenity: 'police' }],
    [/fire (station|department|brigade)/, { amenity: 'fire_station' }],
  ]),

  worship: places('worship', /^cultural/, [
    [/christian|church|catholic|pentecostal|baptist|anglican|methodist/, { amenity: 'place_of_worship', religion: 'christian' }],
    [/muslim|mosque|islam/, { amenity: 'place_of_worship', religion: 'muslim' }],
    [/hindu|buddhist|sikh|jain|temple/, { amenity: 'place_of_worship', religion: 'hindu' }],
    [/jewish|synagogue/, { amenity: 'place_of_worship', religion: 'jewish' }],
    [/religious organization|place of worship|shrine/, { amenity: 'place_of_worship', religion: 'christian' }],
  ]),

  banks: places('banks', null, [
    [/^bank\b|banking|credit union/, { amenity: 'bank' }],
    [/\batm\b|cash machine/, { amenity: 'atm' }],
    [/bureau de change|currency exchange|money transfer/, { amenity: 'bureau_de_change' }],
  ]),

  government: places('government', /^community/, [
    [/town hall|city hall|municipal/, { amenity: 'townhall' }],
    [/court/, { amenity: 'courthouse' }],
    [/embassy|consulate/, { amenity: 'embassy' }],
    [/prison|correctional/, { amenity: 'prison' }],
    [/government|public service|health department|political/, { office: 'government' }],
  ], { office: 'government' }),

  'post-telecom': places('post-telecom', null, [
    [/post office|postal/, { amenity: 'post_office' }],
    [/courier|shipping|parcel/, { amenity: 'post_office' }],
  ]),

  hotels: places('hotels', /^lodging/, [
    [/^hotel|resort/, { tourism: 'hotel' }],
    [/hostel/, { tourism: 'hostel' }],
    [/motel/, { tourism: 'motel' }],
    [/guest ?house|holiday rental|service apartment|bed and breakfast|lodging/, { tourism: 'guest_house' }],
  ], { tourism: 'hotel' }),

  food: places('food', /^food/, [
    [/fast food|takeaway|takeout/, { amenity: 'fast_food' }],
    [/cafe|coffee|bakery|patisserie|tea ?house/, { amenity: 'cafe' }],
    [/\bbar\b|lounge|pub|nightclub|brewery|juice/, { amenity: 'bar' }],
    [/restaurant|eatery|diner|buffet|grill/, { amenity: 'restaurant' }],
  ], { amenity: 'restaurant' }),

  sports: places('sports', /^sports/, [
    [/stadium|arena/, { leisure: 'stadium' }],
    [/gym|fitness|boxing|boot camp|martial|swim/, { leisure: 'sports_centre' }],
    [/\bpark\b|playground/, { leisure: 'park' }],
    [/pitch|court|field/, { leisure: 'pitch' }],
  ], { leisure: 'sports_centre' }),

  culture: places('culture', /^(arts|cultural)/, [
    [/librar/, { amenity: 'library' }],
    [/museum|art gallery|historic site/, { tourism: 'museum' }],
    [/theater|theatre|music venue|auditorium|movie|comedy|dance club|casino/, { amenity: 'theatre' }],
    [/community|social or community service/, { amenity: 'community_centre' }],
  ]),

  waste: places('waste', null, [
    [/recycl/, { amenity: 'recycling' }],
    [/waste|refuse|garbage|dump|landfill/, { amenity: 'waste_disposal' }],
    [/public (toilet|restroom)|restroom/, { amenity: 'toilets' }],
  ]),

  /* ---- land use ------------------------------------------------------ */
  // The `landuse` supplement went with the "Land use zones" dataset it
  // supplemented — see the note in osm-catalog.js. A supplement with no
  // dataset to attach to is never asked for.

  farmland: landUse('farmland', (info) =>
    (/\b(agriculture|farmland|farmyard|orchard|vineyard)\b/.test(`${info.class} ${info.subtype}`)
      ? { landuse: 'farmland' } : null)),

  /* ---- industry & hazard --------------------------------------------- */
  power: {
    id: 'power', theme: 'base', layer: 'infrastructure', maxZoom: 13, minZoom: 9,
    tags: (info) => (info.subtype === 'power'
      ? pick(info.class, [
          [/substation/, { power: 'substation' }],
          [/plant|generator/, { power: 'plant' }],
          [/minor_line/, { power: 'minor_line' }],
          [/line|tower|pole/, { power: 'line' }],
        ], { power: 'line' })
      : null),
  },

  industrial: landUse('industrial', (info) =>
    (/\b(industrial|works|brownfield|quarry|landfill)\b/.test(`${info.class} ${info.subtype}`)
      ? { landuse: 'industrial' } : null)),
};

export const supplementFor = (slug) => SUPPLEMENTS[slug] ?? null;
