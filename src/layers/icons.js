/**
 * Point symbols — one description, three renderers.
 *
 * A hospital and a school are both "a dot" until you give them a shape, so
 * every point layer can carry an icon instead of a circle. Each icon is a
 * single SVG path in a 24×24 box, which is the one description that all
 * three consumers can read:
 *
 *   iconSvg()    the legend on screen, and the pickers in the inspector
 *   drawIcon()   the export canvas — same path through Path2D
 *   iconImage()  a MapLibre sprite image, rasterised at the device ratio
 *
 * Keeping the three off one path is what stops the map, the legend and the
 * printed PDF from disagreeing about what a hospital looks like.
 *
 * Paths are filled with the *non-zero* rule in both SVG and Canvas, so a
 * sub-path wound the opposite way (arc sweep flag flipped) punches a hole
 * identically in all three renderers.
 */

/** @typedef {{id:string, label:string, group:string, path:string}} Icon */

const G = {
  basic: 'Shapes',
  health: 'Health',
  learn: 'Education',
  move: 'Transport',
  civic: 'Civic & safety',
  trade: 'Shops & services',
  util: 'Utilities & industry',
  land: 'Nature & leisure',
};

/** @type {Icon[]} */
export const ICONS = [
  /* ---- shapes ----------------------------------------------------- */
  { id: 'circle', label: 'Dot', group: G.basic, path: 'M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 1 1 0-15.2Z' },
  { id: 'ring', label: 'Ring', group: G.basic, path: 'M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18Zm0 4.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 1 0 0-9.2Z' },
  { id: 'square', label: 'Square', group: G.basic, path: 'M4.8 4.8h14.4v14.4H4.8Z' },
  { id: 'triangle', label: 'Triangle', group: G.basic, path: 'M12 3.4 20.9 19.6H3.1Z' },
  { id: 'diamond', label: 'Diamond', group: G.basic, path: 'M12 2.6 21.4 12 12 21.4 2.6 12Z' },
  { id: 'star', label: 'Star', group: G.basic, path: 'M12 2.4 14.8 9l7.2.6-5.5 4.7 1.7 7-6.2-3.8-6.2 3.8 1.7-7L2 9.6 9.2 9Z' },
  { id: 'pin', label: 'Map pin', group: G.basic, path: 'M12 2.2a6.9 6.9 0 0 0-6.9 6.9c0 5.1 6.9 12.7 6.9 12.7s6.9-7.6 6.9-12.7A6.9 6.9 0 0 0 12 2.2Z' },
  { id: 'flag', label: 'Flag', group: G.basic, path: 'M4.6 2.4h2.2v19.2H4.6Zm3.4 1h11.6l-2.6 4.4 2.6 4.4H8Z' },

  /* ---- health ----------------------------------------------------- */
  { id: 'cross', label: 'Cross', group: G.health, path: 'M9.6 3h4.8v6.6H21v4.8h-6.6V21H9.6v-6.6H3V9.6h6.6Z' },
  { id: 'hospital', label: 'Hospital', group: G.health, path: 'M4 9.6h16V21H4Zm6.9-7.6h2.2v2.6h2.6v2.2h-2.6v2.6h-2.2V6.8H8.3V4.6h2.6Z' },
  { id: 'pill', label: 'Pharmacy', group: G.health, path: 'M6.6 13.8 13.8 6.6a3.9 3.9 0 0 1 5.6 5.6l-7.2 7.2a3.9 3.9 0 0 1-5.6-5.6Z' },
  { id: 'heart', label: 'Care', group: G.health, path: 'M12 20.8 4.4 13.2a4.7 4.7 0 0 1 6.6-6.6l1 1 1-1a4.7 4.7 0 0 1 6.6 6.6Z' },

  /* ---- education -------------------------------------------------- */
  { id: 'school', label: 'School', group: G.learn, path: 'M4 10.6h16V21H4Zm7.2-8.6h1.6v3.2l5 1.6-5 1.6v1.8h-1.6Z' },
  { id: 'graduation', label: 'University', group: G.learn, path: 'M12 3 23 8.4 12 13.8 1 8.4Zm-6.4 8.4L12 14.6l6.4-3.2v4.5c0 1.9-2.9 3.4-6.4 3.4s-6.4-1.5-6.4-3.4Z' },
  { id: 'book', label: 'Library', group: G.learn, path: 'M3.4 4.6c2.5-1.2 5.2-1.2 7.8.3v14.6c-2.6-1.5-5.3-1.5-7.8-.3Zm17.2 0v14.6c-2.5-1.2-5.2-1.2-7.8.3V4.9c2.6-1.5 5.3-1.5 7.8-.3Z' },

  /* ---- transport -------------------------------------------------- */
  { id: 'plane', label: 'Airport', group: G.move, path: 'M12 2c.9 0 1.7 1.4 1.7 3.1v3.3l7.3 4.3v2.1l-7.3-2.2v4.2l2.5 1.9v1.7L12 19.3l-4.2 1.1v-1.7l2.5-1.9v-4.2L3 14.8v-2.1l7.3-4.3V5.1C10.3 3.4 11.1 2 12 2Z' },
  { id: 'helipad', label: 'Helipad', group: G.move, path: 'M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18Zm0 2.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 1 0 0-13.6Zm-3 2.4h1.9v3.3h2.2V7.6H15v8.8h-1.9V13h-2.2v3.4H9Z' },
  { id: 'bus', label: 'Bus stop', group: G.move, path: 'M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2v1.6a1.4 1.4 0 0 1-2.8 0V18H8.8v1.6a1.4 1.4 0 0 1-2.8 0V18a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z' },
  { id: 'train', label: 'Rail station', group: G.move, path: 'M7.4 2.6h9.2a2.6 2.6 0 0 1 2.6 2.6v9.6a2.6 2.6 0 0 1-2.6 2.6l2.4 3.4h-2.6l-2.2-3.4h-4.4l-2.2 3.4H5l2.4-3.4a2.6 2.6 0 0 1-2.6-2.6V5.2a2.6 2.6 0 0 1 2.6-2.6Z' },
  { id: 'anchor', label: 'Port & ferry', group: G.move, path: 'M10.9 2.6h2.2v3.2h2.6V8h-2.6v11.1a7.4 7.4 0 0 0 5.5-5.6h-2.3L20 9.2l3.7 4.3h-2.4A9.9 9.9 0 0 1 12 21.8 9.9 9.9 0 0 1 2.7 13.5H.3L4 9.2l3.7 4.3H5.4a7.4 7.4 0 0 0 5.5 5.6V8H8.3V5.8h2.6Z' },
  { id: 'fuel', label: 'Fuel station', group: G.move, path: 'M4 3.4h9.4a1.4 1.4 0 0 1 1.4 1.4V21H2.6V4.8A1.4 1.4 0 0 1 4 3.4Zm2 2.4v4.4h6.2V5.8Zm10.2.6 3.2 3.2a2 2 0 0 1 .6 1.4v6.2a1.6 1.6 0 0 1-3.2 0v-4.6h-1.6V6.4Z' },
  { id: 'car', label: 'Parking', group: G.move, path: 'M3.6 3.2h16.8v17.6H3.6Zm4.2 3.4v11h2.8v-3.4h2.2a3.8 3.8 0 0 0 0-7.6Zm2.8 2.3h2.2a1.5 1.5 0 0 1 0 3h-2.2Z' },

  /* ---- civic & safety --------------------------------------------- */
  { id: 'shield', label: 'Police', group: G.civic, path: 'M12 2.2 20.6 5v7c0 4.6-3.5 8.2-8.6 9.8C6.9 20.2 3.4 16.6 3.4 12V5Z' },
  { id: 'flame', label: 'Fire station', group: G.civic, path: 'M12.6 2c.6 4 4 5.2 5.3 8.4a7 7 0 0 1-3.4 9.2c1-2 .8-4-1.1-5.9-.4 2.4-1.6 3.8-3.4 5 .5-2.6-.6-4-2-5.3a6.9 6.9 0 0 0 .3 8.1 7 7 0 0 1-1.5-10.9C9 8 12.3 6 12.6 2Z' },
  { id: 'bank', label: 'Government', group: G.civic, path: 'M12 2.4 22 8v2.2H2V8Zm-7.6 9.8h2.4v6.2H4.4Zm4.8 0h2.4v6.2H9.2Zm4.8 0h2.4v6.2H14Zm4.8 0h2.4v6.2h-2.4ZM2.6 19.6h18.8V22H2.6Z' },
  { id: 'post', label: 'Post office', group: G.civic, path: 'M2.6 5h18.8v14H2.6Zm2.2 2.2 7.2 5.2 7.2-5.2Z' },
  { id: 'worship', label: 'Place of worship', group: G.civic, path: 'M11 2h2v2.2h2v2h-2v2.9c2.7 1 4.6 3.3 4.6 6V21H6.4v-5.9c0-2.7 1.9-5 4.6-6V6.2H9v-2h2Z' },
  { id: 'tower', label: 'Mast & tower', group: G.civic, path: 'M11 8.4h2L16.6 22h-2.3l-.8-3.4h-3l-.8 3.4H7.4Zm.9 8.2h.2l-.1-.5ZM6.6 2.4 8.2 4A5.4 5.4 0 0 0 8.2 11l-1.6 1.6a7.6 7.6 0 0 1 0-10.2Zm10.8 0a7.6 7.6 0 0 1 0 10.2L15.8 11a5.4 5.4 0 0 0 0-7Z' },

  /* ---- shops & services -------------------------------------------- */
  { id: 'shop', label: 'Shop', group: G.trade, path: 'M5.4 2.6h13.2l1.8 5.2H3.6Zm-1 6.8h15.2V21H4.4Zm4.4 2.6v4.4h6.4V12Z' },
  { id: 'market', label: 'Market', group: G.trade, path: 'M3 3.4h18l1.6 5.2H1.4Zm1.6 6.6h2.6V21H4.6Zm12.2 0h2.6V21h-2.6Zm-8.4 0h6.2v5.6H8.4Z' },
  { id: 'coins', label: 'Bank & ATM', group: G.trade, path: 'M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 1 1 0-19.2Zm.9 3h-1.8v1.4c-2 .3-3.2 1.5-3.2 3.2 0 2 1.6 2.9 3.6 3.4 1.5.4 2 .8 2 1.5s-.6 1.2-1.7 1.2c-1.3 0-2-.5-2.1-1.6H7.6c.1 1.9 1.3 3.1 3.5 3.4V19h1.8v-1.5c2.2-.3 3.4-1.6 3.4-3.4 0-2-1.4-2.9-3.6-3.5-1.5-.4-2-.8-2-1.4s.5-1.1 1.5-1.1c1.1 0 1.7.5 1.8 1.5h2.1c-.1-1.8-1.2-3-3.2-3.3Z' },
  { id: 'bed', label: 'Hotel', group: G.trade, path: 'M2.4 5.4h2.4v8.2h7V7.6h7.4a2.8 2.8 0 0 1 2.4 2.8v8.2h-2.4v-2.8H4.8v2.8H2.4ZM7.4 8.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 1 1 0-4.8Z' },
  { id: 'cutlery', label: 'Restaurant', group: G.trade, path: 'M4.4 2.4h1.8v6.4h1.2V2.4h1.8v6.4h1.2V2.4h1.8v7.2a3 3 0 0 1-2.4 2.9V22H6.8V12.5a3 3 0 0 1-2.4-2.9Zm12.4 0h2.8V22h-2.6v-8.4h-2.6V7.4a5 5 0 0 1 2.4-5Z' },
  { id: 'cup', label: 'Café', group: G.trade, path: 'M3 6.4h13.6v3h2.2a3 3 0 0 1 0 6h-2.4A6.6 6.6 0 0 1 3 14Zm13.6 5v2h1.8a1 1 0 0 0 0-2ZM3.4 19.4h16v2.2h-16Z' },

  /* ---- utilities & industry ---------------------------------------- */
  { id: 'bolt', label: 'Power', group: G.util, path: 'M13.6 2 5.4 13.4h4.8L9.2 22l8.6-11.8h-5Z' },
  { id: 'factory', label: 'Factory', group: G.util, path: 'M2.6 21V9.6l5.6 3.2V9.6l5.6 3.2V9.6l5.6 3.2V2.6h2V21ZM5 14.6v4h3v-4Zm5.6 0v4h3v-4Zm5.6 0v4h3v-4Z' },
  { id: 'droplet', label: 'Water point', group: G.util, path: 'M12 2.2c4 5 6.4 8.4 6.4 11.6A6.4 6.4 0 0 1 5.6 13.8C5.6 10.6 8 7.2 12 2.2Z' },
  { id: 'well', label: 'Borehole', group: G.util, path: 'M4 8.4h16V21H4Zm2.4 2.4v7.8h11.2v-7.8ZM10.9 2h2.2v3.4h2.6v2.2H8.3V5.4h2.6Z' },
  { id: 'bin', label: 'Waste site', group: G.util, path: 'M9 2.4h6v1.8h5.2v2.2H3.8V4.2H9Zm-4 6.4h14L17.6 22H6.4Z' },
  { id: 'oil', label: 'Oil & gas', group: G.util, path: 'M6.6 2.4h2.2l9.6 12.4h1.6V21H10v-6.2h2.2l-4-5.2V21H5.4V6.4h1.2Z' },

  /* ---- nature & leisure -------------------------------------------- */
  { id: 'tree', label: 'Forest & park', group: G.land, path: 'M12 2 19 12h-3.4l4.4 6.4H13V22h-2v-3.6H4l4.4-6.4H5Z' },
  { id: 'ball', label: 'Sports', group: G.land, path: 'M12 2.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 1 1 0-19.2Zm0 3.4-4 2.9 1.5 4.7h5l1.5-4.7Z' },
  { id: 'tent', label: 'Camp site', group: G.land, path: 'M12 3 22.4 20.4h-8.2L12 16.6l-2.2 3.8H1.6Z' },
  { id: 'mountain', label: 'Peak', group: G.land, path: 'M12 3.4 22.6 20.4H1.4Zm0 4.8-3.6 5.8h1.9l1.7-2.6 1.7 2.6h1.9Z' },
];

const BY_ID = new Map(ICONS.map((i) => [i.id, i]));

/** Icons grouped for a picker, in declared order. */
export function iconGroups() {
  const out = [];
  for (const icon of ICONS) {
    const last = out[out.length - 1];
    if (last?.label === icon.group) last.icons.push(icon);
    else out.push({ label: icon.group, icons: [icon] });
  }
  return out;
}

export const iconById = (id) => BY_ID.get(id) ?? null;
export const isIcon = (id) => Boolean(id) && BY_ID.has(id);

/* ------------------------------------------------------------------ */
/* renderer 1 — inline SVG, for the legend on screen and the pickers   */
/* ------------------------------------------------------------------ */

/**
 * @param {string} id
 * @param {string} color
 * @param {number} px   rendered size in CSS pixels
 * @param {{halo?:boolean, style?:string}} [opts]
 */
export function iconSvg(id, color, px, opts = {}) {
  const icon = BY_ID.get(id);
  if (!icon) return '';
  // The halo is what keeps a dark symbol readable on a dark basemap, and it
  // is drawn the same way in all three renderers.
  const halo = opts.halo === false ? '' :
    `<path d="${icon.path}" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" style="display:block;flex:none;${opts.style ?? ''}" aria-hidden="true">${halo}<path d="${icon.path}" fill="${color}"/></svg>`;
}

/* ------------------------------------------------------------------ */
/* renderer 2 — canvas, for the export and the map sprite              */
/* ------------------------------------------------------------------ */

// Path2D objects are immutable descriptions, so one per icon is enough for
// the life of the page.
const paths = new Map();
const pathFor = (icon) => {
  let p = paths.get(icon.id);
  if (!p) { p = new Path2D(icon.path); paths.set(icon.id, p); }
  return p;
};

/**
 * Draw an icon into a canvas context, fitted to a `size` box at (x, y).
 * Mirrors iconSvg() exactly — same path, same halo.
 */
export function drawIcon(ctx, id, x, y, size, color, opts = {}) {
  const icon = BY_ID.get(id);
  if (!icon) return false;
  const path = pathFor(icon);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  if (opts.halo !== false) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
  return true;
}

/* ------------------------------------------------------------------ */
/* renderer 3 — MapLibre sprite images                                 */
/* ------------------------------------------------------------------ */

/** Sprite id for one icon in one colour. */
export const iconImageId = (id, color) => `gds-icon-${id}-${String(color).replace('#', '')}`;

/**
 * Register an icon+colour as a map image, if it is not already there.
 *
 * Images live on the style, so a basemap swap wipes them — hence the
 * `hasImage` guard on every sync rather than a module-level cache.
 * @returns {string} the sprite id to use in `icon-image`
 */
export function ensureIconImage(map, id, color) {
  const name = iconImageId(id, color);
  if (map.hasImage(name)) return name;

  const ratio = 2;               // enough for retina without bloating the atlas
  const px = 24 * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  drawIcon(ctx, id, 0, 0, px, color);

  map.addImage(name, ctx.getImageData(0, 0, px, px), { pixelRatio: ratio });
  return name;
}
