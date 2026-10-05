# GIS Design Studio — v3

Template-based map design for people who are not GIS specialists. Pick a
cartographic style, choose your study area, drop in open data, run the
analysis you need, drag the title and legend where you want them, and export
a print-ready PDF or PNG.

Design system carried over from the team's Flood Watch interface
(<https://gfw.ggis.africa>): sky/slate palette, glass surfaces, Source Sans 3
+ Fraunces.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. `npm run build` produces a static `dist/`
that can be served from anywhere.

Needs an internet connection: basemap tiles come from
[OpenFreeMap](https://openfreemap.org), boundaries from
[Nominatim](https://nominatim.org), feature data from the
[Overpass API](https://overpass-api.de). All three are free and key-less.

Optionally, alongside it:

```bash
npm run cache
```

That starts the [geodata cache](#the-geodata-cache) — a local database that
remembers every OpenStreetMap and Overture download so the same area is never
fetched twice. It is not required; without it the studio works exactly as
before, just slower on repeat areas.

## What it does

**18 templates**, in seven families — cartographic, report, analysis,
artistic, vintage, topographic, 3-D and editorial. A template is a complete
opening position: basemap, look filter, page size, and every element already
placed. Everything stays editable afterwards.

**Twelve basemaps**, in four families — *Vector* (Liberty, Bright, Minimal),
*Imagery* (Satellite, Satellite with labels, Streets), *Terrain*
(Topographic, OpenTopoMap, Shaded relief) and *Canvas* (Light, Dark, Ocean).
The basemap is its own section in the Templates panel rather than a line
inside "Map look", because it is the largest single decision about what the
map shows, and satellite imagery is what most people open a cartography tool
looking for.

The two kinds behave differently and the panel says so. A **vector** basemap
is real layers, so the plain-English toggles — roads, water, buildings,
labels — can hide families of them. A **raster** basemap is finished pictures,
so nothing inside a tile can be switched off; the toggles are replaced by a
note explaining that, instead of sitting there doing nothing as they used to.
Each basemap carries its own credit, and that credit is what prints: a
satellite map crediting OpenFreeMap is a false statement, and it is the kind
that gets a printed map into trouble.

**Study areas — one, or several.** Search a country, state, LGA, city or any
named place. The real administrative outline is fetched from OpenStreetMap,
drawn on the map, and becomes the region every data fetch and analysis job
works inside.

**Geopolitical zones.** Nigeria's six — North Central, North East, North
West, South East, South South, South West — as a level of their own. A zone is
not an administrative unit and OpenStreetMap has no boundary relation for one,
so it is assembled from its states' real outlines and dissolved into a single
region: South East comes out as 28,765 km², measured from the geometry rather
than quoted. The states ride along as `parts`, which means a zone behaves like
any other multi-area study region — data is fetched per state on its own
bounding box rather than over one rectangle spanning the whole zone.

**LGAs, picked from a list.** Choosing *LGA / District* now asks for the state
first and then offers the LGAs actually inside it — Lagos returns its 20, with
real polygons and real areas attached. This replaced a text box, which worked
if you already knew the answer and did not otherwise: not everyone has 774
LGA names to hand, or knows whether the one they want is spelled "Ogun
Waterside" or "Ogun-Waterside".

Nominatim can find a named place but cannot list what is inside one, so the
list comes from OpenStreetMap's boundary relations through Overpass — the same
boundaries most published Nigerian LGA shapefiles are derived from. Membership
is decided on each unit's **centroid**, not on whether it touches the state:
the bounding box around Kaduna clips into six of its neighbours, and listing
them under Kaduna would be wrong in a way you cannot see. The whole list is
fetched once, with outlines attached, and goes through the same cache as
everything else — so the second look at a state is instant, and so is the
first if someone else has already opened it.

A map is often not about one administrative unit — a catchment crosses three
LGAs, a corridor study covers the states along it — so *Add this area* puts
another one alongside rather than replacing it. Every outline stays on the
map, and the title, the figures, the analysis and the clipping all cover the
whole set.

Each area is fetched **separately**, on its own bounding box, and the results
are merged. That matters: one box drawn around Lagos and Kano is most of
southern Nigeria, which no public Overpass will answer and none of which the
map is about. Areas may overlap — an LGA inside a state you also added is a
reasonable thing to want — so a feature returned by two of them is dropped
once, by its OpenStreetMap id, and the total area is the **union** of the
outlines rather than the sum: adding Ikeja to Lagos State leaves the printed
figure at 3,723 km², not 3,772.

**Open data, segmented.** Thirty-eight datasets described in plain English,
across roads and transport, water and nature, buildings and places, services
and facilities, land use, and industry and hazard.

**Two providers, one layer.** Thirty-four of those datasets pull from
**OpenStreetMap and Overture Maps together** and return a single layer. There
is no Overture section to browse, because someone looking for hospitals wants
hospitals, not a decision about data providers first. Adding *Health
facilities* to Ikeja fetches both, and OpenStreetMap's 15 facilities become
244 after Overture's contribution is merged and clipped. Adding *Building
footprints* to a ward-sized area turns OpenStreetMap's 1,389 buildings into
9,254 — 7,685 of them Google footprints that OpenStreetMap has never mapped.

This works because Overture is translated into OpenStreetMap's tag vocabulary
before anything else sees it — an Overture road with `class: "motorway"`
becomes `highway: "motorway"`, an Overture place categorised "dental clinic"
becomes `amenity: "dentist"`. By the time a feature reaches the classifier it
is indistinguishable from an Overpass one, so **the existing OpenStreetMap
segment rules, colours, symbols and legend rows apply to it unchanged**, and
it is clipped to the study area exactly as an OpenStreetMap-only layer is.

Overture *contains* OpenStreetMap, so a plain concatenation would show most
features twice. Duplicates go in two passes, most certain first: Overture
records which project each feature's geometry came from, so anything credited
to OpenStreetMap is dropped outright — 11,327 of them in that buildings
example, exactly, not heuristically. Then a same-named point within 40 m of an
OpenStreetMap one is treated as the same place, and the OpenStreetMap version
kept, because it has the richer tags. Both providers keep a `gds_source`
property, so *Colour by category → gds_source* gives you the
Google / Microsoft / OpenStreetMap split whenever you want to see it.

Overture publishes releases as GeoParquet, which a browser cannot query, so
supplements are read from Overture's own PMTiles archives over HTTP range
requests — a few hundred kilobytes at a time, decoded in the page and stitched
back into whole features. Two honest consequences: geometry is tile-clipped
(pieces are re-joined by their stable Overture id, and the copies that tile
buffers produce are discarded), and it is generalised for the zoom it was cut
at. Each supplement declares the lowest zoom at which its data is still
complete — measured, not guessed, because the places layer does not exist
below zoom 14 and buildings lose 95% of themselves by zoom 12. Overture is
always a supplement, never a requirement: if it is unavailable or the area is
too large for it, the dataset is still the dataset, from OpenStreetMap alone.

Thirty of them come in meaningful types and arrive already split: roads
by class (trunk, primary, secondary, then tertiary,
residential, service and track), health facilities by kind (hospital, clinic,
doctor, pharmacy, dentist), schools by level, airports by part, places of
worship by religion, banks, government offices, hotels, food, sport, culture,
waste, power and oil & gas. Each arrives with a categorised symbology and one
legend row per type instead of a single undifferentiated colour.

Point types arrive with a **symbol**, not a dot: a cross on hospitals, a pill
on pharmacies, a mortar-board on universities, a plane on aerodromes. Line
types arrive with the **pattern** the subject deserves — a track dashed, a
ferry route dashed because it is a crossing rather than a road, a pipeline in
long dashes, a distribution line lighter than a transmission line. All of it
is a starting position; everything stays editable.

Or bring your own GeoJSON, KML, KMZ, GPX, CSV or zipped Shapefile; files are
parsed in the browser and never uploaded.

**Analysis that actually computes.** Eight tools, chosen by the question they
answer, all running locally on the layers already on your map — no engine to
configure, no credentials, no simulated numbers:

| Distance & proximity | Overlay & selection | Measurement | Patterns |
|---|---|---|---|
| Buffer zone | Clip to boundary | Calculate area | Hotspot map |
| Nearest facility | Count inside areas | Measure network | |
| | | Estimate volume | |

Areas and lengths are measured on the ellipsoid, distances are straight-line,
and volume is area × a depth you supply. Each tool says so in its own summary
and on the printed credits line.

**Editable map elements.** Title, subtitle, free text, legend, key figures,
map information, credits, north arrow, scale bar, locator inset, logo and
neatline. Drag them anywhere inside the page frame, with snap guides to the
page and to each other. The legend, key figures, map information and scale
bar read the live document, so they stay correct as data and analysis change.

**A locator inset that locates something.** It used to draw the study area's
outline alone, which answers nothing: the shape of Eti Osa means nothing to
anyone who does not already know where Eti Osa is, and that is exactly the
reader an inset is for. It now draws the study area *inside* the next
recognisable thing up — an LGA in its state, a state in its geopolitical zone,
a zone in the country — with one shared projection, so the study area sits
where it really sits rather than being re-centred to fill the box. Set it to
*Country* or *None* if you want something else, tick **Mark the map view** to
add a rectangle showing where the main map is currently looking, and colour
the region and the study area separately.

Two bugs went with the rewrite. The preview used a square viewBox stretched
with `preserveAspectRatio="none"`, so every outline on screen was squashed by
exactly the amount the element was off square — and then printed correctly, so
preview and print disagreed. The element is now measured with
`getBoundingClientRect` (not `clientWidth`, which rounds to whole pixels and
was leaving the aspect 1.5% out) and both renderers work from one geometry
pass, so they cannot diverge again.

**Alignment.** Two ways, depending on whether you are placing one thing or
tidying several:

- *Arrange* (right-hand panel, with an element selected) — a nine-square
  placement grid drops the element onto any corner, edge or the centre of the
  page; six align buttons do the same one axis at a time; fill width/height
  stretches it across the page. A margin slider sets how far in from the edge
  "left" and "right" mean.
- *Align* (Elements panel) — tick two or more elements to line them up left,
  centre, right, top, middle or bottom, either against the page or against
  each other. Three or more can be spread with equal gaps or matched in size.

**Symbology.** Every vector layer can be coloured three ways — a single
colour, by category (a text field, one colour per value), or graduated (a
numeric field split into classes by even counts or even steps). Seven preset
ramps, reversible, with a colour picker per bucket.

**44 point symbols**, in eight groups — health, education, transport, civic
and safety, shops and services, utilities and industry, nature and leisure,
plus plain shapes. Pick one for a whole layer, or a different one for each
class, so hospitals and pharmacies are told apart by shape and not only by
colour. Each symbol is one SVG path rendered three ways — as a map sprite, as
a legend swatch, and into the export canvas — so the printed key is the mark
the map is drawing.

**Six line patterns** — solid, dashed, dotted, dash-dot, long dash, fine dash
— per layer or per class. `line-dasharray` is the one line property MapLibre
will not evaluate per feature, so a layer whose classes want different
patterns quietly becomes several filtered map layers; the panel just shows
one line per class.

**Line thickness in millimetres**, the way a desktop GIS states one. Roads,
rivers, railways and pipelines get a *Line thickness* field of their own — not
the outline-width control a polygon uses, because on a line layer the stroke
is the subject rather than an edge around one. Type a number, pick the unit:
**mm, cm, inches or points**. Changing the unit re-expresses the same line
rather than changing it, so 0.45 mm becomes 1.3 pt and stays the same road.

All four are units of the **printed page**, and screen pixels are deliberately
not on the list: a pixel is not a size, it is a count. A "2 pixel" road is a
different road on a laptop, on a phone and on an A0 plot, whereas 0.5 mm is
half a millimetre on all three. The artboard knows how many screen pixels a
millimetre of paper currently occupies, so the preview is drawn at the weight
that prints, and the export at 96 or 600 dpi puts down exactly the millimetres
you asked for.

One consequence worth stating plainly: **thickness no longer changes with
zoom.** A 0.5 mm road is 0.5 mm zoomed in and 0.5 mm zoomed out, which is what
a cartographer means by a line weight. Zooming out shows more roads, not
thinner ones.

Datasets arrive with the hierarchy a printed road map has — trunk 0.8 mm,
primary 0.65, secondary 0.5, down to service and track at 0.25 — and changing
the layer thickness scales the whole set **in proportion**, so the order
survives instead of every class flattening onto one number. Any single class
can then be set on its own from its legend row.

The width is stored as millimetres and converted to pixels at draw time. It
used to be stored the other way round — as a baked MapLibre expression — which
is why the width control used to erase a road layer's whole hierarchy the
first time anyone touched it: a stored expression is write-only, since the
panel cannot tell `1.8` from `['interpolate', …]` and could only replace it.
The legend follows the same weights, so a trunk road is heavier than a service
road in the printed key as well.

**An editable legend.** Select the legend on the page and every row is there
to edit: its colour, its symbol, its line pattern, and the words beside it.
Rename *Primary* to "Primary highway", give hospitals a different colour, put
a dashed line on proposed roads.

**No colour at all**, as a colour. Every swatch in the legend, the layer
styling and the shape tools can be emptied — the cartographic "no brush", not
a colour that happens to be invisible. Emptying a polygon's fill leaves its
outline alone, which is how you draw a boundary you want to see through, and
the legend answers with a hollow swatch on screen and in the PDF.

**Legends that cannot lie.** Editing a legend row is not writing into the
legend — there is nothing there to write into. The rows are generated from
each layer's symbology, which is also what paints the map, so an edit goes
back to the symbology and both regenerate together. Change the colour of
*Primary* on the legend and the primary roads change with it, in the same
frame. A legend can never show a colour, symbol or pattern the map is not
using.

**Light and dark.** Every colour in the interface resolves through one set of
CSS custom properties, so the theme is a token swap rather than a second
stylesheet. Toggle in the header or on the home page; with no stored choice the
app follows your operating system.

**Row actions that do not squeeze the name.** The Elements and Layers lists
carry six actions a row — show, lock, duplicate, forward, backward, delete —
and the side panel is a fixed ~280 px at every desktop width. In the flow
those buttons left about 25 px for the name, which is the one part of a row
that says which element it is. They now float over the end of the row and
appear on hover or keyboard focus, so the name gets the full width while you
are reading and the buttons are there when you reach for them. A pointer that
cannot hover has nothing to reveal them, so on touch they come back into the
flow on a line of their own — keyed on hover rather than on window width,
because a touchscreen laptop has a wide window and no hover.

Names are truncated by the browser with an ellipsis at whatever width the
panel happens to be, and the full text stays in the tooltip. They used to be
cut in JavaScript at 32 characters, which is a guess about the panel width
that is wrong at every width.

The action icons are drawn, not typed. They were emoji — 👁 🔒 ⧉ ▲ ▼ — which
are colour glyphs from a font the operating system picks: a different size and
weight on every machine, unable to take the row's ink colour, and ⧉ simply
missing on Windows. They are now one SVG set on a 24×24 grid at a single
stroke weight in `currentColor`, so hover and active states need no second
asset. A hidden element keeps a struck-through eye and a locked one a closed
padlock, lit and `aria-pressed`, so the button reports which state the element
is in rather than only what clicking does.

**Three shapes, not one that squeezes.** On a wide screen the tool rail, the
left panel, the map and the inspector sit side by side. Narrower, the
inspector floats over the map when it is needed. On a phone the rail moves to
the bottom where a thumb is, and both panels become sheets over the map —
because on a small screen the map *is* the interface. Tapping the tool you are
already in puts the map back, and touching the map dismisses whatever is over
it. Anyone who has asked their system for less motion gets none.

**Shapes.** Rectangle, ellipse, triangle, diamond, star, line and arrow, with
fill, outline, dash style, corner radius and rotation — drawn by the same pair
of renderers as every other element, so they print exactly as previewed.

**An assistant.** Discuss the map or turn it into words for a report. A written
summary is composed locally from your layers and analysis figures and needs no
backend at all. For actual conversation, point it at a small server you run:

```bash
ANTHROPIC_API_KEY=sk-ant-... node server/ai-backend.mjs
```

Then paste `http://localhost:8787` into Assistant → Backend URL. **The browser
never holds an API key** — that process does, and it is the only thing that
talks to Claude. The studio sends only the map description it already shows you;
your data files are never uploaded. The reference backend is ~60 lines in
[`server/ai-backend.mjs`](server/ai-backend.mjs).

**Seventeen paper sizes**, grouped so an expensive mistake is hard to make:
*Sheet* (A6–A3, Letter, Legal, Tabloid) is what an office printer takes;
*Large format* (A2, A1, **A0**, B1, ARCH D, ARCH E, Poster 24×36) needs a
plotter; *Screen* covers social and presentation shapes.

**Export.** PNG or single-page PDF at the exact paper size, at **96, 150, 300,
450 or 600 dpi** — Screen, Standard, Print, Fine or Very fine. Page setup
names each one by what it is for and shows the pixel dimensions you will get
before you commit to them.

**The map is redrawn at the export's own resolution.** This is the difference
between a printed map that holds up and one that does not, and it is what
used to make a 300 dpi export look no sharper than a screenshot. The
on-screen canvas is drawn at the screen's pixel density — perhaps 800 device
pixels across the page frame — while an A4 export at 300 dpi is 2,480 pixels
wide. Scaling the first up to the second is a 3× enlargement of a raster, and
it looks like one: soft coastlines, mushy labels, stepped road edges. Turning
the dpi up made the file bigger and the map no sharper, because the extra
pixels were interpolated rather than drawn.

So the export builds a second map off-screen, at the same CSS size and the
same camera but a higher pixel ratio, and draws the view again for real —
vector tiles re-tessellated, glyphs re-rasterised, sprites re-sampled. Same
CSS size is the important half: it keeps the projection, and therefore the
ground shown and the page crop, identical to what you were looking at. Only
the pixel density changes. If the machine will not give up a second WebGL
context, or the drawing buffer would exceed the driver's maximum texture
size, it falls back to the screen canvas — which is exactly what this
pipeline did in every case before.

PDFs embed the page losslessly up to 40 megapixels. JPEG subsampling is kind
to photographs and unkind to maps — it is the colour channels it discards,
and a map is thin coloured lines on a pale ground — so it is only used above
that, where a lossless plotter-sized page would run to hundreds of megabytes.

At plotter sizes the requested resolution is not always achievable — a
browser cannot allocate the 139-megapixel canvas that A0 at 300 dpi needs — so
page setup tells you the resolution you will actually get *before* you export,
rather than silently downscaling: "A0 is too big for 600 dpi in a browser —
the export will be 278 dpi (9,205 × 13,013 px)". A1 and below print at the
full 300; A4 and A3 take 600 comfortably.

**A project library.** Maps accumulate rather than overwrite. Save (⤓ in the
header, or Ctrl+S) files the current map into your projects with a thumbnail
rendered from the real page; leaving via the home button saves too, and an
autosave runs in the background once a map has a study area or a data layer —
so browsing templates never leaves stubs behind. The home page lists every
saved project newest first, opens one on click and deletes one from the ✕ on
its thumbnail. The 24 most recent are kept. Everything lives in this browser's
local storage; nothing is uploaded. If storage runs out the save sheds
thumbnails before it sheds projects, and tells you.

## What is measured, and what is assumed

Every number in this app is computed from geometry you can see. There is no
simulated data anywhere.

- **Areas and lengths** are geodesic, measured on the ellipsoid by Turf.
- **Distances** from *Nearest facility* are straight-line, not along roads.
- **Volume** is measured area × the depth you type. That is a planning
  estimate, not a survey, and it is labelled as such in the result, the
  summary and the printed credits.
- **Study-area figures** come from the mapped administrative outline, not
  from a cadastral source. With several areas the figure is their dissolved
  union, so shared ground is counted once.
- **Feature counts** come from OpenStreetMap, which is community-mapped and
  uneven in coverage — absence of features is not evidence of absence.

## How the code is arranged

```
src/
├── main.js              entry point; landing ⇄ studio, boot order
├── core/                constants, DOM helpers, geo maths, map controller,
│                        store (state + pub/sub + undo + project library), toasts
├── data/                Nominatim boundaries, admin children (LGAs) and
│                        geopolitical zones, the study-area list and its
│                        combined view, locator-inset context, the dataset
│                        catalogue, the Overture→OSM supplement table,
│                        Overpass client, Overture PMTiles client,
│                        browser-side file parsing
├── layers/              registry (one ordered list of everything drawn),
│                        render (projects the registry onto MapLibre),
│                        symbology (mode → paint expression + legend),
│                        icons (one SVG path → map sprite, legend, canvas)
├── analysis/            the 8 geoprocessing tools (turf-backed)
├── ai/                  map context, local briefing, assistant transport
├── templates/           the 18-template catalogue and applyTemplate()
├── layout/              element catalogue (screen + canvas renderers),
│                        derived content, alignment, canvas drawing primitives
├── export/              crop, filter, texture and element compositing
├── ui/                  landing, studio chrome, theme, artboard interaction,
│                        inspector, legend editor (rows → symbology writes),
│                        interface icons, and one module per left-hand panel
└── styles/              light/dark tokens, landing, studio, CSS thumbnails

src/data/cache/          the layered geodata cache (see below)

server/ai-backend.mjs    optional Node service; holds the Anthropic API key
server/cache-server.mjs  optional Node service; serves the shared database
server/db.mjs            SQLite schema and queries
server/prefetch.mjs      CLI that fills the database ahead of time
```

Two rules hold the thing together:

1. **Modules never call each other directly.** They `set()` state and
   `subscribe()` to the keys they care about. That is what keeps the panels,
   the map and the export from drifting apart the way they did in the v2
   prototype (kept for reference in [`legacy/`](legacy/v2-prototype.html)).

   The study-area list is the one place this needed care. `studyAreas` is the
   source of truth and `studyArea` is its combined view, and the two are
   written together in a single `set()` by
   [`src/data/study-areas.js`](src/data/study-areas.js) — so a subscriber
   watching either one never sees them disagree, and the dozen modules that
   only ever wanted "the study area" did not have to learn there are now
   several.
2. **Every element type is defined once**, in
   [`src/layout/elements.js`](src/layout/elements.js), with its screen
   renderer and its canvas renderer side by side. What you drag is what
   prints.

## The geodata cache

Overpass is a shared community service, and on a bad afternoon the same query
that took four seconds takes forty. Overture means pulling tiles over the
network every time. Neither is something to do twice for the same area.

So every open-data download now goes through a cache with three layers, asked
in order of how fast each can answer:

| | Where | Survives | Typical |
|---|---|---|---|
| **L1** | IndexedDB, in the browser | reloads, restarts, going offline | ~5 ms |
| **L2** | SQLite, via `cache-server.mjs` | everything; shared by everyone | ~15 ms |
| **L3** | Overpass / Overture | — | 5–40 s |

A hit at either cached layer is filled forward, so anything the shared
database serves is local from then on, and anything fetched live lands in
both. **Every layer is optional.** With no cache server running the app
behaves exactly as it did before — the client treats a refused connection as
a miss, trips a short circuit-breaker so it stops asking, and goes live.

Two things make it hit far more often than exact-match keying would:

- **Containment.** A stored download answers any request whose extent it
  fully covers, so an LGA inside a state you already fetched is already
  cached, and so is the same area after you pan. Features outside the
  caller's bbox are filtered off on the way back, so a hit is
  indistinguishable from a live fetch. Where no single download covers a
  request, a set of them can — see
  [areas larger than Overpass will answer](#areas-larger-than-overpass-will-answer).
- **Variants, not timestamps.** The cache key includes a hash of the Overpass
  query itself, and Overture's release id. Edit a catalogue entry and every
  download made under the old definition simply stops matching, instead of
  being served as data that no longer means what it says.

OpenStreetMap is edited continuously, so an entry older than 30 days is
*served immediately and refreshed in the background* — you see data at most
one interval old, and the next session sees today's.

### Running it

```bash
npm run cache
```

That is all: `vite.config.js` proxies `/api/cache` to it, so the browser
makes a same-origin request and CORS never arises. The database lands in
`server/data/geodata.db` (gitignored) and uses `node:sqlite`, so there is no
native module to build and nothing to install.

### Filling it ahead of time

On-demand caching only helps the *second* person to open an area. To stop the
first one waiting too, prefetch the places your team actually maps:

```bash
node server/prefetch.mjs --areas "Lagos, Nigeria" "Ogun, Nigeria"
```

```bash
node server/prefetch.mjs --nigeria --group services
```

`--list` prints the dataset slugs, `--dry-run` shows what would be fetched,
`--force` refetches areas already stored, and `--no-overture` skips the
supplements. It resumes: anything already in the database is skipped.

The two providers are paced differently, and deliberately:

- **Overpass** is asked for one thing at a time with a pause between each and
  exponential backoff on refusal. It is donated infrastructure, and a script
  that hammers it is why mirrors start saying no.
- **Overture** cells go in parallel (`--concurrency`, default 6, no delay).
  These are static PMTiles archives on S3 read by range request — there is no
  shared query engine to congest, and the studio itself already pulls them in
  a loop. Queueing them behind a courtesy delay bought nothing and cost most
  of the run.

A full national run still takes hours; start it and walk away.

`--status` prints coverage by region, which is the practical way to see where
a long run got to.

### Running the database in Docker

The data cannot live in git. The built database is ~140 MB and the extract it
comes from is ~700 MB, so both are gitignored — which leaves the question of
how anyone else gets them. The answer is a container: the repository carries
the code that *builds* the database, and the database itself travels as a
Docker volume or an image.

```bash
docker compose up -d cache
```

That serves the cache on `:8788`, exactly where the dev server's `/api/cache`
proxy already points — so `npm run dev` needs no change and cannot tell
whether the cache is running in Docker or on the host.

Everything else is a one-shot command against the same volume:

```bash
docker compose run --rm fetch                        # download the extract
docker compose run --rm import --nigeria --no-heavy  # build the database
docker compose run --rm backup                       # copy it out to ./server/data
docker compose run --rm restore                      # load a copy someone sent you
```

Use `EXTRACT_FILE=somewhere-latest.osm.pbf` to point the importer at a
different extract. It is set as an environment variable rather than passed as
`--pbf /extracts/...` because Git Bash rewrites arguments that look like Unix
paths into Windows ones before Docker sees them.

**Handing the database to someone else.** `backup` writes a single verified
file via `VACUUM INTO` — which folds in the write-ahead log, so unlike `cp` it
cannot hand over a database that is quietly missing recent writes. Send them
that file; they drop it in `./server/data` and run `restore`. For a team,
push the image to a registry instead — GitHub Container Registry takes what
the repository will not:

```bash
docker build -t ghcr.io/<you>/gis-geodata:latest .
docker push ghcr.io/<you>/gis-geodata:latest
```

The image holds only the server and the catalogue; the data stays on the
volume, so rebuilding the image never disturbs it.

### Importing a whole country at once

Prefetching through Overpass works, but it is the slow road: thousands of
queries, tiled workarounds for anything state-sized, and a run that stalls
whenever the mirrors are busy. For a whole country, read the data locally
instead.

Geofabrik publishes each country as one file. Nigeria is a single ~700 MB
download containing every node, way and relation in it:

```bash
curl -L -o server/data/nigeria-latest.osm.pbf https://download.geofabrik.de/africa/nigeria-latest.osm.pbf
```

```bash
npm run import -- --nigeria --no-heavy
```

That populated all 37 states — 1,245 downloads, 375,855 features, 105 MB
compressed — in about **14 minutes**, against several hours for five regions
over Overpass. No rate limits, no mirror races, and no tiling: a state is just
a bounding-box filter over data already on disk, so each state and dataset is
stored as **one** entry and the studio gets a direct hit rather than an
assembled one.

The filtering is driven by the catalogue's own Overpass queries, compiled to
local predicates by [`server/ql.js`](server/ql.js) — so there is no second
definition of "what counts as a hospital" to drift out of step. Rows are
written under the same cache keys the live client uses, so the browser cannot
tell where they came from.

A PBF stores nodes, then ways, then relations, so what a way needs is always
behind it. Rather than hold a country's nodes in memory, the import makes
three streaming passes — ways and relations, then member ways, then node
locations — keeping ids and coordinates in sorted typed arrays.

**The heavy datasets are excluded above and that is deliberate.** Building
footprints and local roads together match more ways than a V8 `Map` can hold
(~16.7M entries), and a state's worth of building polygons is more than the
map can draw in any case. Import them per city or LGA instead:

```bash
npm run import -- --areas "Kano, Nigeria" --datasets buildings
```

### Areas larger than Overpass will answer

The studio refuses a study area over 2,500 km² for heavy datasets, and 60,000
km² for the rest. That limit is about not asking a free public service for a
whole state in one query — so with `--tile` the prefetch script asks for the
same ground in pieces, which is a perfectly ordinary thing to do.

Those pieces are then put back together on read. When a request matches no
single stored download, the server looks for a *set* of cells that together
cover it, merges them, and drops the features that appear in more than one —
Overpass returns a road whole whenever it touches a query box, so anything
crossing a cell edge arrives twice. The merged result is stored under the
requested extent, so this happens once and every later request is an ordinary
single-row hit.

The effect is that a prefetched state loads data the live API would refuse
outright:

```
roads-local · Lagos State · 6,640 km² (limit 2,500 km²)
  assembled from 4 cells → 107,651 features, 503 duplicates dropped, 4.4 s
```

Coverage is tested by sweeping the requested rectangle along every stored
edge and checking each resulting piece, so cells may overlap, arrive in any
order, and come from different runs. A request reaching even slightly beyond
the prefetched grid is *not* covered and falls through to the live provider —
partial data is never passed off as complete.

### What this is not

It is not a mirror of OpenStreetMap or Overture. The OSM planet file is ~80 GB
compressed and Overture's release is around a terabyte of GeoParquet; neither
is reachable through the interfaces this app uses, and neither belongs in a
project database. This stores *the downloads this studio makes*, which is what
actually determines how fast it feels. If you ever do need the whole planet,
that is a different tool — a local Overpass instance from a planet PBF, or
DuckDB over Overture's S3 parquet.

## Attribution

Boundaries via Nominatim · Feature data © OpenStreetMap contributors ·
Overture Maps data © Overture Maps Foundation, drawn from OpenStreetMap
(ODbL), Google Open Buildings, Microsoft and Esri.

The basemap credit is composed per basemap and printed on the map — the
vector styles are © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors,
the imagery, terrain and canvas tiles are © Esri and its data partners, and
OpenTopoMap is CC-BY-SA over OpenStreetMap data (ODbL).

**On the Esri tiles.** They are served without a key and are what the Esri
Leaflet examples point at, which makes them right for demo, evaluation and
internal work. They are not unconditional: Esri's terms govern their use, and
a commercial or high-volume deployment should hold an ArcGIS subscription or
point `BASEMAPS` in [`src/core/constants.js`](src/core/constants.js) at its
own tile service. OpenTopoMap likewise asks that heavy users run their own
instance. The vector styles have no such condition.

The Overture credit is added to the printed map only when a map actually
carries an Overture layer.

The public Nominatim and Overpass endpoints are shared community services.
Calls are throttled, cached and size-capped here, which is fine for demo and
internal use; a production deployment should point `ENDPOINTS` in
[`src/core/constants.js`](src/core/constants.js) at self-hosted instances or a
commercial provider.
