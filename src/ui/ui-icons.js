/**
 * Interface icons — the small actions that sit inside a row.
 *
 * These were emoji: 👁 for show, 🔒 for lock, ⧉ for duplicate, ▲▼ for order.
 * Emoji are the wrong tool for a toolbar. They are colour glyphs from a font
 * the operating system chooses, so they arrive at a different size and weight
 * on every machine, they refuse to take the row's ink colour, several of them
 * (⧉ especially) are simply missing on Windows and fall back to a box, and a
 * cartoon padlock next to a drawn map looks like a different application.
 *
 * Same contract as the element icons in layout/element-icons.js: a 24×24
 * grid, `currentColor`, one stroke weight, round caps. They inherit the
 * button's colour, so hover and active states work without a second asset.
 *
 * This set is deliberately separate from layers/icons.js (marks that go on
 * the map and into the printed legend) and from layout/element-icons.js
 * (what a page element *is*). These are chrome, and they are never printed.
 */

const ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // Visible: the conventional eye.
  show: '<path d="M2.2 12S6 5.5 12 5.5 21.8 12 21.8 12 18 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  // Hidden: the same eye, struck through — one mark that reads as its own
  // opposite, rather than a second unrelated symbol.
  hide: '<path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.8 6.5 9.8 6.5a17 17 0 0 1-3 3.7"/><path d="M6.3 7.8A17.4 17.4 0 0 0 2.2 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.6-.7"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.1 4.1"/><path d="M3.5 3.5l17 17"/>',
  // Locked: shackle closed onto the body.
  lock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  // Unlocked: the same body, shackle swung open to the right.
  unlock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 7.8-1.2"/>',
  // Duplicate: one sheet offset behind another.
  duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
  // Order: a bar with an arrow leaving it, so "forward" and "backward" are
  // about the stack rather than about the page.
  forward: '<path d="M12 19.5V5"/><path d="M6 10.5 12 4.5l6 6"/>',
  backward: '<path d="M12 4.5V19"/><path d="M6 13.5 12 19.5l6-6"/>',
  // Delete: a waste bin, which says "gone" where a bare ✕ says "close".
  trash: '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5"/><path d="M10.5 10v7"/><path d="M13.5 10v7"/>',
  // Dismiss: a plain cross, for anything that closes rather than destroys.
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  // Zoom to: a reticle, the standard "take me there" mark.
  target: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3"/><path d="M12 18.5v3"/><path d="M2.5 12h3"/><path d="M18.5 12h3"/>',
  // Drag handle: the six-dot grip every list uses.
  grip: '<circle cx="9.5" cy="6" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.5" cy="6" r="1.15" fill="currentColor" stroke="none"/><circle cx="9.5" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="9.5" cy="18" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.5" cy="18" r="1.15" fill="currentColor" stroke="none"/>',
};

/** The SVG source for one interface icon. */
export function uiIconSvg(name, size = 15) {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${ATTRS} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The same, as a detached node ready to hand to miniBtn(). */
export function uiIcon(name, size = 15) {
  const span = document.createElement('span');
  span.className = 'ui-ico';
  span.innerHTML = uiIconSvg(name, size);
  return span;
}

export const hasUiIcon = (name) => Object.hasOwn(PATHS, name);
