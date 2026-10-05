/**
 * Export pipeline.
 *
 * Re-renders the map at the export's own resolution, crops that to exactly
 * the artboard rectangle, re-applies the template's look filter and texture,
 * then paints every element on top using the canvas renderers in
 * layout/elements.js.
 *
 * The screen canvas is the fallback, not the plan — see renderMapAt().
 */

import { state } from '../core/store.js';
import { getMap, lookFilter, maplibregl } from '../core/map.js';
import { APP, effectiveDpi } from '../core/constants.js';
import { buildRenderContext } from '../layout/derive.js';
import { paintElement, preloadElementAssets } from '../layout/elements.js';
import { paperDims, artboardRect } from '../ui/artboard.js';

/** Wait for the map to finish drawing, but never hang the export. */
function mapIdle(timeout = 2500) {
  const map = getMap();
  if (!map) return Promise.resolve();
  if (map.loaded() && !map.isMoving()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); map.off('idle', done); resolve(); };
    const timer = setTimeout(done, timeout);
    map.on('idle', done);
  });
}

/* ------------------------------------------------------------------ */
/* the map, at export resolution                                       */
/* ------------------------------------------------------------------ */

/**
 * WebGL will not allocate a drawing buffer wider than the driver's maximum
 * texture size, and a request over it fails by returning a *blank* canvas
 * rather than by throwing. So the limit is read from the machine actually
 * doing the export instead of being assumed.
 */
let maxDrawingBuffer = null;
function maxBufferSide() {
  if (maxDrawingBuffer) return maxDrawingBuffer;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    maxDrawingBuffer = Math.min(gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 8192, 16384);
  } catch {
    maxDrawingBuffer = 8192;
  }
  return maxDrawingBuffer;
}

/**
 * The ceiling on the *GPU* buffer, which is a tighter budget than the export
 * canvas: this one is live video memory, four bytes a pixel, and MapLibre
 * needs room for its own render targets on top. A0 asks for a scale that
 * would want half a gigabyte, so it is clamped and the last step becomes a
 * small enlargement — from a far sharper source than the screen, which is the
 * whole point.
 */
const MAX_SHADOW_PIXELS = 64e6;

/**
 * Draw the map into an off-screen canvas at `scale` device pixels per CSS
 * pixel, and hand back that canvas plus the scale actually achieved.
 *
 * This is the difference between a printed map that holds up and one that
 * does not. The on-screen canvas is drawn at the screen's pixel ratio — call
 * it 800 device pixels across the page frame — and an A4 export at 300 dpi is
 * 2480 pixels wide. Blowing the first up into the second is a 3× enlargement
 * of a raster, and it looks it: soft coastlines, mushy labels, roads with
 * stepped edges. Turning the dpi up made the file bigger and the map no
 * sharper, because the extra pixels were interpolated rather than drawn.
 *
 * A second map, off-screen, at the same CSS size and the same camera but a
 * higher `pixelRatio`, draws the same view for real at the resolution the
 * paper wants — vector tiles re-tessellated, glyphs re-rasterised, sprites
 * re-sampled. Same CSS size is the important half: it keeps the projection,
 * and therefore the ground shown and the artboard crop, identical to the
 * screen. Only the pixel density changes.
 *
 * Everything here is best-effort. A machine that will not give us a second
 * WebGL context, a style that will not re-load, a drawing buffer over the
 * driver's limit — each falls back to the screen canvas, which is exactly
 * what this pipeline used to do in every case.
 *
 * @param {number} scale
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{canvas: HTMLCanvasElement, scale: number} | null>}
 */
async function renderMapAt(scale, onProgress) {
  const live = getMap();
  if (!live) return null;

  const cssW = live.getCanvas().clientWidth;
  const cssH = live.getCanvas().clientHeight;
  if (!cssW || !cssH) return null;

  // Never ask for less than the screen already gives us, and never ask for
  // more than the driver will allocate — by either measure.
  const sideCap = maxBufferSide() / Math.max(cssW, cssH);
  const areaCap = Math.sqrt(MAX_SHADOW_PIXELS / (cssW * cssH));
  const want = Math.min(Math.max(scale, 1), sideCap, areaCap);
  if (want <= (window.devicePixelRatio || 1) * 1.05) return null;   // no gain worth a second map

  const holder = document.createElement('div');
  Object.assign(holder.style, {
    position: 'fixed', left: '-20000px', top: '0',
    width: `${cssW}px`, height: `${cssH}px`, pointerEvents: 'none',
  });
  document.body.append(holder);

  let shadow = null;
  try {
    onProgress?.('Redrawing the map at export resolution…');
    // The live style carries the basemap, the terrain, and every overlay this
    // registry has added — so the copy is the same map, not a rebuild of it
    // that could drift.
    const style = live.getStyle();

    shadow = new maplibregl.Map({
      container: holder,
      style,
      center: live.getCenter(),
      zoom: live.getZoom(),
      bearing: live.getBearing(),
      pitch: live.getPitch(),
      pixelRatio: want,
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
      fadeDuration: 0,          // no half-faded labels caught mid-transition
      trackResize: false,
    });

    await new Promise((resolve, reject) => {
      // Tiles for this view are already in the browser's cache, but glyphs and
      // sprites at the new ratio are not, so this is not instant.
      const timer = setTimeout(() => reject(new Error('timed out')), 20000);
      const done = () => { clearTimeout(timer); resolve(); };
      let styleLoaded = false;

      shadow.once('style.load', () => { styleLoaded = true; });
      shadow.once('idle', done);
      shadow.on('error', (e) => {
        // MapLibre reports a single 404 tile through the same channel as a
        // style that will not parse. Once the style is up, a missing tile is
        // cosmetic and the same one is missing on screen too — aborting over
        // it would throw away the whole high-resolution render for nothing.
        if (styleLoaded) { console.warn('[export] tile error in the export render', e?.error ?? e); return; }
        clearTimeout(timer);
        reject(e?.error ?? new Error('the export map could not load its style'));
      });
    });

    if (shadow.getTerrain()) {
      // Terrain keeps loading DEM tiles after the first idle, and a half-loaded
      // one exports as a flat patch in the middle of a hillshaded map.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 4000);
        shadow.once('idle', () => { clearTimeout(timer); resolve(); });
      });
    }

    const canvas = shadow.getCanvas();
    // A drawing buffer the driver refused comes back at the wrong size or
    // empty; either way it is not what we asked for, so it is not used.
    if (!canvas.width || !canvas.height) throw new Error('empty drawing buffer');

    // Copied out because the shadow map's own canvas dies with it.
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext('2d').drawImage(canvas, 0, 0);
    return { canvas: out, scale: canvas.width / cssW };
  } catch (err) {
    console.warn('[export] high-resolution map render unavailable, using the screen canvas', err);
    return null;
  } finally {
    try { shadow?.remove(); } catch { /* already gone */ }
    holder.remove();
  }
}

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */
function textureTile(kind, scale) {
  const size = 128;
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const c = tile.getContext('2d');

  if (kind === 'paper') {
    // Deterministic speckle — a paper grain that survives scaling.
    for (let i = 0; i < 2600; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * size;
      const y = (Math.sin(i * 78.233) * 12345.6789 % 1 + 1) % 1 * size;
      const a = 0.03 + ((i % 7) / 7) * 0.05;
      c.fillStyle = i % 3 === 0 ? `rgba(255,255,255,${a})` : `rgba(90,74,52,${a})`;
      c.fillRect(x, y, 1.2, 1.2);
    }
  } else if (kind === 'linen') {
    c.strokeStyle = 'rgba(80,70,55,0.07)';
    c.lineWidth = Math.max(0.6, scale * 0.6);
    for (let i = 0; i < size; i += 4) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, size); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(size, i); c.stroke();
    }
  } else if (kind === 'halftone') {
    c.fillStyle = 'rgba(15,23,42,0.07)';
    for (let y = 3; y < size; y += 7) {
      for (let x = 3; x < size; x += 7) {
        c.beginPath();
        c.arc(x + (y % 14 === 3 ? 0 : 3.5), y, 1.5, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else {
    return null;
  }
  return tile;
}

function paintTexture(c, kind, W, H, scale) {
  const tile = textureTile(kind, scale);
  if (!tile) return;
  const pattern = c.createPattern(tile, 'repeat');
  if (!pattern) return;
  c.save();
  c.scale(scale, scale);
  c.fillStyle = pattern;
  c.fillRect(0, 0, W / scale, H / scale);
  c.restore();
}

function paintVignette(c, W, H, amount) {
  if (!amount) return;
  const inner = Math.max(0.2, 0.7 - amount * 0.45);
  c.save();
  c.translate(W / 2, H / 2);
  c.scale(1, H / W);
  const r = W * 0.72;
  const grad = c.createRadialGradient(0, 0, r * inner, 0, 0, r);
  grad.addColorStop(0, 'rgba(15,23,42,0)');
  grad.addColorStop(1, `rgba(15,23,42,${(amount * 0.55).toFixed(3)})`);
  c.fillStyle = grad;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/* ------------------------------------------------------------------ */
/* composition                                                         */
/* ------------------------------------------------------------------ */

/**
 * Render the current page to an off-screen canvas.
 * @param {{ dpi?: number, fast?: boolean, onProgress?: (msg: string) => void }} [opts]
 *        fast:true skips the high-resolution map re-render — used by the
 *        project thumbnail, which is 420 px wide and saved on every edit.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function composeExport(opts = {}) {
  const dpi = opts.dpi ?? state.page.dpi ?? 150;
  const { wIn, hIn } = paperDims();

  // Large-format paper hits this routinely — A0 at 300 dpi is 139 megapixels
  // — so the cap is shared with the page setup panel, which shows the
  // resolution the export will really achieve before you ask for it.
  const real = effectiveDpi(wIn, hIn, dpi);
  const W = Math.round(wIn * real);
  const H = Math.round(hIn * real);

  opts.onProgress?.('Waiting for the map to finish drawing…');
  await Promise.all([mapIdle(), document.fonts?.ready ?? Promise.resolve(), preloadElementAssets(state.elements)]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');

  c.fillStyle = state.page.background ?? '#ffffff';
  c.fillRect(0, 0, W, H);

  /* --- the map, cropped to the artboard --------------------------- */
  const map = getMap();
  const rect = artboardRect();
  if (map && rect.w > 0) {
    const mapCanvas = map.getCanvas();

    // What the export needs from the map: W output pixels across a page frame
    // that is rect.w CSS pixels wide. Asking the map for exactly that is the
    // whole point — anything less is enlarged afterwards.
    const hiRes = opts.fast ? null : await renderMapAt(W / rect.w, opts.onProgress);
    const source = hiRes?.canvas ?? mapCanvas;
    const ratio = hiRes?.scale ?? mapCanvas.width / mapCanvas.clientWidth;

    opts.onProgress?.('Cropping the page area…');
    const filter = lookFilter(state.mapLook);
    c.save();
    if (filter && filter !== 'none') c.filter = filter;
    // Only matters when we did fall back to the screen canvas; at that point
    // this is an enlargement, and a smooth one beats a blocky one.
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    try {
      c.drawImage(
        source,
        rect.x * ratio, rect.y * ratio, rect.w * ratio, rect.h * ratio,
        0, 0, W, H,
      );
    } catch (err) {
      console.error('[export] could not read the map canvas', err);
    }
    c.restore();
  }

  paintVignette(c, W, H, Number(state.mapLook?.vignette ?? 0));
  if (state.mapLook?.texture && state.mapLook.texture !== 'none') {
    paintTexture(c, state.mapLook.texture, W, H, Math.max(1, W / 1400));
  }

  /* --- elements ---------------------------------------------------- */
  opts.onProgress?.('Drawing map elements…');
  const ctx = buildRenderContext({ W, H, artWScreen: rect.w || W, media: 'export' });
  for (const elm of state.elements) {
    if (elm.hidden) continue;
    const box = {
      x: (elm.x / 100) * W,
      y: (elm.y / 100) * H,
      w: (elm.w / 100) * W,
      h: (elm.h / 100) * H,
    };
    try {
      paintElement(c, elm, box, ctx);
    } catch (err) {
      console.error(`[export] element "${elm.type}" failed to draw`, err);
    }
  }

  return canvas;
}

/* ------------------------------------------------------------------ */
/* outputs                                                             */
/* ------------------------------------------------------------------ */
const safeName = () => (state.projectName || 'map').replace(/[^\w\-. ]+/g, '').trim() || 'map';

function download(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Export a PNG at the page's dpi. */
export async function exportPng(opts = {}) {
  const canvas = await composeExport(opts);
  opts.onProgress?.('Encoding PNG…');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  download(url, `${safeName()}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { width: canvas.width, height: canvas.height, bytes: blob.size };
}

/** Export a single-page PDF at the exact paper size. */
export async function exportPdf(opts = {}) {
  const canvas = await composeExport(opts);
  opts.onProgress?.('Building PDF…');
  const { jsPDF } = await import('jspdf');
  const { wIn, hIn, orientation } = paperDims();

  const doc = new jsPDF({
    orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
    unit: 'in',
    format: [wIn, hIn],
    compress: true,
  });

  // JPEG subsampling is kind to photographs and unkind to maps: it is the
  // colour channels it throws away, and a map is thin coloured lines on a pale
  // ground. PNG keeps every one of them, so it is used wherever the file size
  // is bearable, and JPEG takes over only on the plotter sizes where a lossless
  // page would run to hundreds of megabytes.
  const megapixels = (canvas.width * canvas.height) / 1e6;
  if (megapixels <= 40) {
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, wIn, hIn, undefined, 'NONE');
  } else {
    doc.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, wIn, hIn, undefined, 'NONE');
  }
  doc.setProperties({
    title: state.projectName || 'Map',
    creator: `${APP.name} ${APP.version}`,
    author: APP.org,
  });
  doc.save(`${safeName()}.pdf`);
  return { width: canvas.width, height: canvas.height };
}

/** A small preview data URL — used for the "recent projects" thumbnail. */
export async function thumbnailDataUrl(maxWidth = 420) {
  // `fast` because this runs on autosave: a thumbnail is 420 px wide and has
  // nothing to gain from a second map render, which the user would feel.
  const canvas = await composeExport({ dpi: 72, fast: true });
  const scale = Math.min(1, maxWidth / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.72);
}
