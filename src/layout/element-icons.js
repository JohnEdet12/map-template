/**
 * Icons for the page elements.
 *
 * These used to be typographic stand-ins — a capital T for the title, a
 * pilcrow for a text box, ⊞ for the locator inset. They carried the right
 * idea and looked like whatever font happened to be installed: different
 * weights, different baselines, several of them missing outright on Windows
 * and falling back to a box.
 *
 * Each is drawn on a 24×24 grid with a 1.6 stroke, `currentColor`, and round
 * caps, so they inherit the panel's text colour and sit on one optical
 * weight. The shapes describe what the element *is on the page* — the legend
 * is a keyed list, the neatline is a frame, the scale bar is a measured
 * rule — rather than being a letter that stands for its name.
 */

/** Shared drawing attributes — one weight and one join across the whole set. */
const ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // Three lines, the first heavy: a headline over body text.
  title: '<path d="M4 6h16" stroke-width="2.6"/><path d="M4 13h16"/><path d="M4 18h10"/>',
  // A lighter heading with text beneath it.
  subtitle: '<path d="M4 7h12" stroke-width="2.2"/><path d="M4 13h16"/><path d="M4 18h13"/>',
  // A paragraph: full measure, ragged last line.
  text: '<path d="M4 6h16"/><path d="M4 11h16"/><path d="M4 16h16"/><path d="M4 21h9"/>',
  // Keyed rows — a swatch beside each label, which is what a legend is.
  legend: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6" y="8" width="3.5" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><path d="M12.5 9.75h5.5"/><rect x="6" y="14" width="3.5" height="3.5" rx="0.8" fill="currentColor" stroke="none"/><path d="M12.5 15.75h5.5"/>',
  // Panel of figures: a large number over its caption, twice.
  stats: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6.5 10.5h4" stroke-width="2.4"/><path d="M6.5 14h5.5"/><path d="M14.5 10.5h3" stroke-width="2.4"/><path d="M14.5 14h3"/>',
  // Information: the conventional i in a circle.
  metadata: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.75v.5"/>',
  // Attribution: the copyright mark.
  credits: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.7a3.4 3.4 0 1 0 0 4.6"/>',
  // A compass needle, north half filled — how it is drawn on the page.
  north: '<path d="M12 3.5 16 20l-4-3.2L8 20z" fill="currentColor" stroke="none" opacity="0.9"/><path d="M12 3.5 16 20l-4-3.2L8 20z"/>',
  // A measured rule with end ticks and a division, like a real scale bar.
  scale: '<path d="M3 13h18"/><path d="M3 9.5v7"/><path d="M12 10.5v5"/><path d="M21 9.5v7"/>',
  // A frame inside a frame: a border drawn around the page.
  neatline: '<rect x="2.5" y="3.5" width="19" height="17" rx="1.5"/><rect x="6" y="7" width="12" height="10" rx="1" opacity="0.55"/>',
  // A small map with an inset box in its corner.
  inset: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><rect x="13.5" y="11.5" width="6" height="6" rx="1" fill="currentColor" stroke="none" opacity="0.85"/><path d="M5.5 15l3-3.5 2.5 2.5"/>',
  // Overlapping primitives — the shape tool draws more than one thing.
  shape: '<circle cx="9.5" cy="14.5" r="5.2"/><rect x="10.5" y="4.5" width="9" height="9" rx="1.4"/>',
  // A picture: frame, horizon and sun, the universal image mark.
  logo: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M3.5 17l5-4.5 3.5 3 3-2.5 5 4"/>',
};

/** Fallback: a neutral dot, so an unknown type never renders as a tofu box. */
const UNKNOWN = '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>';

/** The SVG source for one element type. */
export function elementIconSvg(type, size = 18) {
  const body = PATHS[type] ?? UNKNOWN;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${ATTRS} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The same, as a detached node ready to append. */
export function elementIcon(type, size = 18) {
  const span = document.createElement('span');
  span.className = 'el-ico';
  span.innerHTML = elementIconSvg(type, size);
  return span;
}

export const hasElementIcon = (type) => Object.hasOwn(PATHS, type);
