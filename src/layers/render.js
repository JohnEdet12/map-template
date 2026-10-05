/**
 * Projects the layer registry onto MapLibre.
 *
 * Strategy: rebuild the *layers* on every sync — they are cheap, purely
 * client-side, and rebuilding them removes a whole category of "the map and
 * the panel disagree" bugs — but *reconcile* the sources: keep the ones that
 * are still wanted, drop the ones that are not, and push new data into the
 * rest.
 *
 * Sources must not be torn down and re-added under the same id, which is what
 * this module used to do. `removeSource` tells the worker to drop its tile
 * index asynchronously; re-adding the same id in the same tick means the
 * worker can process the removal *after* the new source's data, leaving a
 * source that exists on the main thread, reports `loaded()`, holds every
 * feature — and tiles none of them. That is invisible from the outside: no
 * error, correct paint, correct data, nothing drawn.
 */

import { getMap, onStyleReady } from '../core/map.js';
import { state, subscribe } from '../core/store.js';
import { pagePxPerMm } from '../ui/artboard.js';
import { debounce } from '../core/dom.js';
import { dashArray, dashGroups, iconImage, hasCategoryIcons, cssColor, lineWidth, baseWidthOf } from './symbology.js';
import { ensureIconImage, isIcon } from './icons.js';

const PREFIX = 'gds-ov-';

/** Drop every overlay *layer*. Sources are handled separately, on purpose. */
function removeOverlayLayers(map) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith(PREFIX) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  }
}

/**
 * What each live source was last given, so a sync that only changed a colour
 * does not re-tile thousands of features. Cleared for an id whenever that
 * source stops existing — including after a basemap swap, which wipes them all.
 */
const sourceData = new Map();

/**
 * Make the map's sources match the registry, reusing whatever is already
 * there. Runs after the layers are removed, so nothing references a source
 * we are about to drop.
 */
function reconcileSources(map, wanted) {
  for (const id of Object.keys(map.getStyle()?.sources ?? {})) {
    if (!id.startsWith(PREFIX) || wanted.has(id)) continue;
    if (map.getSource(id)) map.removeSource(id);
    sourceData.delete(id);
  }

  for (const [id, spec] of wanted) {
    const existing = map.getSource(id);
    if (!existing) {
      map.addSource(id, spec.definition);
      sourceData.set(id, spec.key);
      continue;
    }
    // Same source, new data — `setData` re-tiles in place, which is the one
    // safe way to change a GeoJSON source's contents.
    if (spec.definition.type === 'geojson' && sourceData.get(id) !== spec.key) {
      existing.setData(spec.key);
      sourceData.set(id, spec.key);
    }
  }
}

/** The source each registry layer needs, keyed by source id. */
function wantedSources(layers) {
  const wanted = new Map();
  for (const layer of layers) {
    const id = `${PREFIX}${layer.id}`;
    if (layer.type === 'raster') {
      if (!layer.tileUrl) continue;
      wanted.set(id, {
        key: layer.tileUrl,
        definition: { type: 'raster', tiles: [layer.tileUrl], tileSize: 256 },
      });
    } else if (layer.geojson) {
      wanted.set(id, {
        key: layer.geojson,
        definition: { type: 'geojson', data: layer.geojson, generateId: true },
      });
    }
  }
  return wanted;
}

/**
 * A font stack the basemap's glyph server actually serves.
 *
 * MapLibre's built-in default is "Open Sans Regular", which OpenFreeMap does
 * not host — it serves Noto. Asking for a missing font is not a cosmetic
 * failure: the worker builds every layer of a GeoJSON tile in one pass, so a
 * symbol layer that cannot get its glyphs fails the whole tile and takes the
 * *lines and fills* of the same source down with it. The layer looks perfect
 * from the outside — right paint, right data, no error — and draws nothing.
 *
 * So the font is read from the basemap itself, which by definition can serve it.
 */
function labelFont(map) {
  const stacks = [];
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol' || layer.id.startsWith(PREFIX)) continue;
    const font = layer.layout?.['text-font'];
    if (Array.isArray(font) && typeof font[0] === 'string') stacks.push(font);
  }
  // Upright first — a basemap's italic stack is usually its watercourse
  // labels, and it should not become the default for every overlay.
  return stacks.find((f) => /regular/i.test(f[0])) ?? stacks[0] ?? ['Noto Sans Regular'];
}

/**
 * The first symbol layer of the base style. Overlays flagged `underLabels`
 * are inserted before it so place names stay legible on top of a filled
 * analysis result.
 */
function labelAnchor(map) {
  const layers = map.getStyle()?.layers ?? [];
  const symbol = layers.find((l) => l.type === 'symbol' && !l.id.startsWith('gds-'));
  return symbol?.id;
}

/** Features whose class is (or is not) one of `values`. */
const classFilter = (field, values, negate) => {
  const test = ['in', ['to-string', ['coalesce', ['get', field], '']], ['literal', values]];
  return negate ? ['!', test] : test;
};

/**
 * The line layers for one vector layer.
 *
 * Normally that is exactly one. It is more only when the classes want
 * different patterns, which `line-dasharray` cannot express per feature —
 * see dashGroups().
 */
function addLines(map, layer, srcId, before) {
  const s = layer.style;
  const sym = layer.symbology;
  const groups = dashGroups(sym, s.dash ?? 'solid');
  const covered = groups.flatMap((g) => g.values ?? []);

  /**
   * Line work gets the class-weighted width in millimetres of paper, turned
   * into pixels here; a polygon's outline gets the plain number it has always
   * had.
   *
   * Converted here rather than stored so that `style.widthMm` can stay a
   * number the thickness field reads back and the user can type into. A
   * stored pixel count is write-only twice over — the panel cannot tell 1.8
   * from ['interpolate', …], so it could only replace it, which is what used
   * to flatten a road layer's class hierarchy the first time anyone touched
   * the width; and a pixel count silently means something different on the
   * next screen or paper size.
   */
  const width = layer.kind === 'line'
    ? lineWidth(sym, baseWidthOf(s), pagePxPerMm())
    : (typeof s.strokeWidth === 'number' ? s.strokeWidth : 1.4);

  groups.forEach((group, i) => {
    const dash = dashArray(group.dash);
    const filter = group.rest ? classFilter(sym.field, covered, true)
      : group.values ? classFilter(sym.field, group.values, false)
        : null;

    map.addLayer({
      id: `${srcId}-line${i ? `-${i}` : ''}`,
      type: 'line',
      source: srcId,
      ...(filter ? { filter } : {}),
      layout: {
        visibility: layer.visible ? 'visible' : 'none',
        // A dashed line drawn with round caps smears its gaps shut.
        'line-cap': dash ? 'butt' : 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': cssColor(s.stroke),
        'line-width': width,
        'line-opacity': (s.strokeOpacity ?? 1) * (layer.opacity ?? 1),
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    }, before);
  });
}

/**
 * Points draw as an icon when one is chosen, and as a circle otherwise.
 *
 * The sprite images have to exist before the layer references them, so
 * `iconImage` is handed a registrar rather than a name — it adds each
 * icon+colour pair to the style as it builds the expression.
 */
function addPoints(map, layer, srcId, before) {
  const s = layer.style;
  const sym = layer.symbology;
  const visibility = layer.visible ? 'visible' : 'none';
  const alpha = layer.opacity ?? 1;
  const base = isIcon(s.icon) ? s.icon : '';

  if (base || hasCategoryIcons(sym)) {
    const image = iconImage(sym, (id, color) => ensureIconImage(map, id, color), base);
    if (image) {
      // Icons are authored in a 24 px box; a radius-5 point should read at
      // about 20 px, so the size factor tracks the same slider a circle uses.
      const scale = ((s.radius ?? 4) * 4) / 24;
      map.addLayer({
        id: `${srcId}-icon`, type: 'symbol', source: srcId,
        layout: {
          visibility,
          'icon-image': image,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, scale * 0.65, 14, scale],
          // Facilities cluster; hiding the overlaps would under-report them.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': alpha },
      }, before);
      return;
    }
  }

  map.addLayer({
    id: `${srcId}-point`, type: 'circle', source: srcId, layout: { visibility },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, (s.radius ?? 4) * 0.6, 14, s.radius ?? 4],
      'circle-color': cssColor(s.fill),
      'circle-opacity': alpha,
      'circle-stroke-width': typeof s.strokeWidth === 'number' ? s.strokeWidth : 1.2,
      'circle-stroke-color': cssColor(s.stroke ?? '#ffffff'),
    },
  }, before);
}

function addVector(map, layer, before) {
  const srcId = `${PREFIX}${layer.id}`;
  if (!map.getSource(srcId)) return;

  const s = layer.style;
  const visibility = layer.visible ? 'visible' : 'none';
  const alpha = layer.opacity ?? 1;

  if (layer.kind === 'polygon') {
    map.addLayer({
      id: `${srcId}-fill`, type: 'fill', source: srcId, layout: { visibility },
      paint: { 'fill-color': cssColor(s.fill), 'fill-opacity': (s.fillOpacity ?? 0.35) * alpha },
    }, before);
  }

  if (layer.kind === 'polygon' || layer.kind === 'line') addLines(map, layer, srcId, before);
  if (layer.kind === 'point') addPoints(map, layer, srcId, before);

  if (s.labelField) {
    map.addLayer({
      id: `${srcId}-label`, type: 'symbol', source: srcId,
      layout: {
        visibility,
        'text-field': ['coalesce', ['get', s.labelField], ''],
        'text-font': labelFont(map),
        'text-size': s.labelSize ?? 11,
        // An icon stands taller than a dot, so its label has to clear more.
        'text-offset': layer.kind === 'point' ? [0, isIcon(s.icon) ? 1.5 : 1.1] : [0, 0],
        'text-anchor': layer.kind === 'point' ? 'top' : 'center',
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
    });
  }
}

function addRaster(map, layer, before) {
  const srcId = `${PREFIX}${layer.id}`;
  if (!map.getSource(srcId)) return;
  map.addLayer({
    id: `${srcId}-raster`, type: 'raster', source: srcId,
    layout: { visibility: layer.visible ? 'visible' : 'none' },
    paint: { 'raster-opacity': layer.opacity ?? 0.85 },
  }, before);
}

let retryQueued = false;

/**
 * Rebuild every overlay from the registry.
 *
 * `isStyleLoaded()` is false during any style mutation and while tiles are
 * still arriving — which is exactly the moment a layer usually gets added,
 * since fetching data is normally followed by a camera move. Returning early
 * used to drop that redraw on the floor and the layer never appeared. Now the
 * request is deferred to the next idle frame instead.
 */
export function syncLayers() {
  const map = getMap();
  if (!map) return;

  if (!map.isStyleLoaded()) {
    if (!retryQueued) {
      retryQueued = true;
      map.once('idle', () => { retryQueued = false; syncLayers(); });
    }
    return;
  }

  removeOverlayLayers(map);
  reconcileSources(map, wantedSources(state.layers));

  const anchor = labelAnchor(map);
  for (const layer of state.layers) {
    const before = layer.underLabels ? anchor : undefined;
    try {
      if (layer.type === 'raster') addRaster(map, layer, before);
      else addVector(map, layer, before);
    } catch (err) {
      console.error(`[layers] could not render "${layer.name}"`, err);
    }
  }
}

/** Wire the registry to the map. Call once at boot. */
export function initLayerRendering() {
  onStyleReady(syncLayers);
  // `page` as well as `layers`: a line width is millimetres of paper, so
  // changing the paper size changes how many pixels that is. Without this a
  // 0.5 mm road stays the pixel count it was on A4 after you switch to A0.
  subscribe(['layers', 'page'], syncLayers);

  // And so does resizing the window, which rescales the artboard without any
  // state changing. Listened for here rather than called from artboard.js so
  // the dependency stays one-way: this module reads the artboard, never the
  // other way round.
  window.addEventListener('resize', debounce(syncLayers, 220));
}
