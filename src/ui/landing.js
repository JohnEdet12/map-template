/**
 * Home.
 *
 * Deliberately restrained: a masthead, a sentence, a place search, the
 * styles, your saved work. The job of this page is to get you into the
 * studio in one click, not to sell you anything.
 */

import { $, el, fill } from '../core/dom.js';
import { listProjects, deleteProject, MAX_PROJECTS } from '../core/store.js';
import { APP } from '../core/constants.js';
import { GALLERY_CATEGORIES, galleryTemplates, templateById, categoryLabel } from '../templates/catalog.js';
import { templatePreview } from './preview.js';
import { openCreateModal } from './create-modal.js';
import { themeToggle } from './theme.js';

let filter = 'all';
let showAllContributions = false;
let api = {};

const MARK = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;

/* ------------------------------------------------------------------ */
function masthead() {
  return el('header.home-bar', {}, [
    el('span.home-mark', { html: MARK }),
    el('span.home-wordmark', { html: `${APP.name}<span>${APP.org}</span>` }),
    el('span.home-bar-spacer'),
    (() => {
      const btn = el('button.btn-ghost', { type: 'button', text: 'New map' });
      btn.addEventListener('click', () => openCreateModal(api));
      return btn;
    })(),
    themeToggle(),
  ]);
}

function intro() {
  const input = el('input', {
    type: 'search',
    placeholder: 'Search a place — Rivers State, Lagos, Yankari National Park…',
    'aria-label': 'Search for a place to map',
  });
  const go = () => {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    api.openStudio({ templateId: 'quiet-canvas', tool: 'area', place: query });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  const search = el('div.home-search', {}, [
    el('span', { text: '⌕', style: { fontSize: '16px', color: 'var(--ink-faint)' } }),
    input,
    (() => {
      const btn = el('button.btn-primary', { type: 'button', text: 'Start' });
      btn.addEventListener('click', go);
      return btn;
    })(),
  ]);

  const facts = el('div.home-facts', {}, [
    [String(galleryTemplates('all').length), 'cartographic styles'],
    ['21', 'open datasets'],
    ['8', 'analysis tools'],
    ['300 dpi', 'print-ready export'],
  ].map(([n, label]) => el('div.home-fact', {}, [
    el('b', { text: n }),
    el('span', { text: label }),
  ])));

  return el('div.home-hero', {}, [
    el('div.home-wrap', {}, [
      el('section.home-intro', {}, [
        el('span.home-eyebrow', { text: 'Cartography for everyone' }),
        el('h1', { text: 'Make a map worth printing.' }),
        el('p', { text: 'Choose a cartographic style, pick your area, bring in open data, measure what matters, and export a print-ready sheet. No GIS training required.' }),
        search,
        facts,
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
function templatesSection() {
  const grid = el('div.showcase', {}, galleryTemplates(filter).map((tpl) => {
    const card = el('button.showcase-card', { type: 'button', title: tpl.blurb }, [
      templatePreview(tpl),
      el('div.showcase-body', {}, [
        el('span.showcase-kicker', { text: categoryLabel(tpl.category) }),
        el('h3', { text: tpl.name }),
        el('p', { text: tpl.blurb }),
        el('div.showcase-tags', {}, tpl.tags.map((t) => el('span', { text: t }))),
      ]),
    ]);
    card.addEventListener('click', () => api.openStudio({ templateId: tpl.id, tool: 'area' }));
    return card;
  }));

  const pills = el('div.filter-row', {}, GALLERY_CATEGORIES.map((cat) => {
    const btn = el('button.filter-btn', { type: 'button', text: cat.label });
    btn.classList.toggle('is-active', cat.id === filter);
    btn.addEventListener('click', () => { filter = cat.id; render(); });
    return btn;
  }));

  return el('section.home-section#home-templates', {}, [
    el('div.home-section-head', {}, [
      el('h2', { text: 'Start from a style' }),
      el('p', { text: `${galleryTemplates('all').length} finished designs — every element stays editable` }),
    ]),
    pills,
    grid,
  ]);
}

/* ------------------------------------------------------------------ */
/**
 * Sheets produced by the Geoinfotech GIS department, each paired with the
 * studio template that reproduces its layout.
 *
 * Six of these were traced element by element into `gid-*` templates and are
 * flagged `traced` — their card says so, and their template's thumbnail is
 * this very sheet. The rest are matched to whichever of those six layouts
 * they were drawn on.
 */
const CONTRIBUTIONS = [
  ['flood-susceptibility.jpg', 'Flood Susceptibility', 'Hazard', 'Rivers State, Nigeria', 'gid-hazard-plate', true],
  ['emerging-hotspots.jpg', 'Urban Expansion Hotspots', 'Urban analysis', 'Ondo State, Nigeria', 'gid-survey-sheet', true],
  ['lagos-study-area.jpg', 'Lagos State Study Area', 'Reference map', 'Lagos State, Nigeria', 'gid-study-area', true],
  ['africa-hydrography.jpg', 'The Rivers of Africa', 'Hydrography', 'Africa', 'gid-night-atlas', true],
  ['security-pressure-index.jpg', 'Security Pressure Index', 'Risk analysis', 'Nigeria', 'gid-index-poster', true],
  ['isochrone-ikeja.jpg', 'Travel Time from Major Landmarks', 'Accessibility', 'Ikeja, Lagos', 'gid-analyst-sheet', true],

  ['road-degradation-risk.jpg', 'Road Degradation Risk Index', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['lagos-study-area-reference.jpg', 'Lagos State & 20 LGAs', 'Reference map', 'Lagos State, Nigeria', 'gid-study-area'],
  ['isochrone-landmarks.jpg', 'Landmark Travel-time Isochrones', 'Accessibility', 'Ikeja, Lagos', 'gid-analyst-sheet'],
  ['viewshed-amuwo-odofin.jpg', 'Viewshed / Visibility', 'Network analysis', 'Amuwo Odofin, Lagos', 'gid-analyst-sheet'],
  ['urban-heat-hotspot.jpg', 'Urban Heat Hotspot Intensity', 'Climate', 'Kano State, Nigeria', 'gid-hazard-plate'],
  ['continuous-rdri.jpg', 'Continuous Road Degradation Risk', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['water-proximity.jpg', 'Water Proximity', 'Infrastructure', 'Lagos State, Nigeria', 'gid-study-area'],
  ['soil-moisture-index.jpg', 'Soil Moisture Index', 'Environment', 'Lagos State, Nigeria', 'gid-study-area'],
  ['terrain-slope.jpg', 'Terrain Slope', 'Topography', 'Lagos State, Nigeria', 'gid-study-area'],
  ['sar-backscatter.jpg', 'SAR Backscatter Change', 'Remote sensing', 'Lagos State, Nigeria', 'gid-study-area'],
  ['rainfall.jpg', 'Mean Annual Rainfall', 'Climate', 'Lagos State, Nigeria', 'gid-study-area'],
  ['africa-river-temperature.jpg', "Africa's River Lines", 'Climate', 'Africa', 'gid-night-atlas'],
  ['atlantic-bathymetry.jpg', 'Bathymetric Slices of the Atlantic', 'Bathymetry', 'Atlantic Ocean', 'gid-night-atlas'],
  ['ebola-distribution.jpg', 'Distribution of Ebola Virus Disease', 'Public health', 'Africa', 'gid-index-poster'],
  ['drought-monitoring.jpg', 'Weather Stations & Drought Monitoring', 'Climate', 'Nigeria', 'gid-index-poster'],
  ['deforestation-ekiti.jpg', 'Deforestation Comparison', 'Land cover', 'Ekiti State, Nigeria', 'gid-hazard-plate'],
].map(([image, title, topic, place, templateId, traced = false]) =>
  ({ image, title, topic, place, templateId, traced }));

function contributorCard(item) {
  const image = new URL(`../assets/contributors/${item.image}`, import.meta.url).href;
  const card = el('article.contributor-card', {}, [
    el('button.contributor-image', {
      type: 'button',
      title: `View ${item.title}`,
      'aria-label': `View ${item.title}`,
    }, [el('img', { src: image, alt: `${item.title} map by Geoinfotech GIS department`, loading: 'lazy' })]),
    el('div.contributor-body', {}, [
      el('span.showcase-kicker', { text: item.topic }),
      el('h3', { text: item.title }),
      el('p', { text: item.place }),
      // The point of the section: every sheet names the layout you get.
      el('div.contributor-tpl', {}, [
        el('span.contributor-tpl-label', { text: item.traced ? 'Layout traced into' : 'Built on' }),
        el('b', { text: templateById(item.templateId)?.name ?? 'Template' }),
      ]),
      (() => {
        const use = el('button.contributor-use', { type: 'button', text: 'Use this layout' });
        use.addEventListener('click', () => api.openStudio({ templateId: item.templateId, tool: 'area' }));
        return use;
      })(),
    ]),
  ]);
  card.querySelector('.contributor-image').addEventListener('click', () => {
    const dialog = el('dialog.contributor-lightbox', {}, [
      el('button.lightbox-close', { type: 'button', text: '×', 'aria-label': 'Close preview' }),
      el('img', { src: image, alt: `${item.title} map by Geoinfotech GIS department` }),
      el('div.lightbox-caption', {}, [el('strong', { text: item.title }), el('span', { text: `${item.topic} · ${item.place}` })]),
    ]);
    dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  });
  return card;
}

function contributorsSection() {
  const visible = showAllContributions ? CONTRIBUTIONS : CONTRIBUTIONS.slice(0, 8);
  const more = el('button.btn-ghost.contributor-more', {
    type: 'button',
    text: showAllContributions ? 'Show fewer maps' : `Explore all ${CONTRIBUTIONS.length} maps`,
  });
  more.addEventListener('click', () => { showAllContributions = !showAllContributions; render(); });

  return el('section.home-section.contributors#home-contributors', {}, [
    el('div.contributor-heading', {}, [
      el('div', {}, [
        el('span.contributor-badge', { text: 'Contributor' }),
        el('h2', { text: 'Geoinfotech GIS department' }),
        el('p', { text: 'Real sheets from our GIS team. Six of their layouts have been rebuilt as studio templates — same margins, same furniture, same places for the title, key and scale.' }),
      ]),
      el('div.contributor-note', {}, [
        el('b', { text: 'Make it yours' }),
        el('span', { text: 'Open a layout, load your own study area and data, then move or restyle any element on the page.' }),
      ]),
    ]),
    el('div.contributor-grid', {}, visible.map(contributorCard)),
    el('div.contributor-actions', {}, [more]),
  ]);
}

/* ------------------------------------------------------------------ */
function projectThumb(entry) {
  if (entry.thumb) {
    return el('div.project-thumb', {}, [
      el('img', { src: entry.thumb, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
    ]);
  }
  const tpl = templateById(entry.templateId) ?? galleryTemplates('all')[0];
  return el('div.project-thumb', {}, [templatePreview(tpl)]);
}

function projectCard(entry) {
  const tpl = templateById(entry.templateId);
  const thumb = projectThumb(entry);

  const remove = el('button', {
    type: 'button',
    title: `Delete “${entry.name}”`,
    'aria-label': `Delete ${entry.name}`,
    text: '✕',
    style: {
      position: 'absolute', right: '6px', top: '6px', zIndex: '4',
      height: '24px', width: '24px', borderRadius: '6px', cursor: 'pointer',
      border: '1px solid var(--line)', background: 'var(--glass)',
      color: 'var(--danger)', fontSize: '12px', lineHeight: '1',
    },
  });
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!window.confirm(`Delete “${entry.name}”? This cannot be undone.`)) return;
    deleteProject(entry.id);
    render();
  });
  thumb.append(remove);

  const card = el('div.project-card', { role: 'button', tabindex: '0', title: `Open ${entry.name}` }, [
    thumb,
    el('h3', { text: entry.name || 'Untitled map' }),
    el('p', { text: `${tpl?.name ?? 'Custom'} · ${new Date(entry.savedAt).toLocaleDateString()}` }),
  ]);
  const open = () => api.openProject(entry.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

function projectsSection() {
  const projects = listProjects();

  const newCard = el('button.project-card', { type: 'button' }, [
    el('div.project-thumb', {
      style: { display: 'grid', placeItems: 'center', borderStyle: 'dashed', color: 'var(--ink-faint)', fontSize: '22px' },
      text: '＋',
    }),
    el('h3', { text: 'New map' }),
    el('p', { text: 'From a style or a blank page' }),
  ]);
  newCard.addEventListener('click', () => openCreateModal(api));

  return el('section.home-section#home-projects', {}, [
    el('div.home-section-head', {}, [
      el('h2', { text: 'Your projects' }),
      el('p', {
        text: projects.length
          ? `${projects.length} saved in this browser · keeps the ${MAX_PROJECTS} most recent`
          : 'Saved in this browser only',
      }),
    ]),
    el('div.project-grid', { style: { marginTop: '16px' } }, [newCard, ...projects.map(projectCard)]),
  ]);
}


/* ------------------------------------------------------------------ */
const STEPS = [
  ['01', 'Pick a style', 'Every style is a finished design — page size, colours, legend and all.'],
  ['02', 'Choose your area', 'Search any country, state, LGA or named place; the real boundary is drawn for you.'],
  ['03', 'Add data', 'Roads, rivers, hospitals, land use — straight from OpenStreetMap, or your own file.'],
  ['04', 'Analyse', 'Buffers, clipping, hotspots, nearest facility, area, length and volume — measured, not guessed.'],
  ['05', 'Arrange & export', 'Drag the title, legend and arrow where you want, then export a print-ready PDF.'],
];

function stepsSection() {
  return el('section.home-section#home-learn', {}, [
    el('div.home-section-head', {}, [
      el('h2', { text: 'How it works' }),
      el('p', { text: 'Five steps' }),
    ]),
    el('div.step-grid', { style: { marginTop: '18px' } }, STEPS.map(([n, title, body]) =>
      el('div.step-item', {}, [
        el('b', { text: n }),
        el('h3', { text: title }),
        el('p', { text: body }),
      ]))),
    el('p.home-foot', {
      html: `${APP.name} ${APP.version} · ${APP.org}<br />Basemaps © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors · Boundaries via Nominatim · Feature data © OpenStreetMap contributors`,
    }),
  ]);
}

/* ------------------------------------------------------------------ */
export function render() {
  const root = $('#landing');
  if (!root) return;
  fill(root, [
    masthead(),
    intro(),
    el('div.home-wrap', {}, [templatesSection(), contributorsSection(), projectsSection(), stepsSection()]),
  ]);
}

export function initLanding(hooks) {
  api = hooks;
  render();
}

export function showLanding() {
  $('#landing')?.classList.remove('is-hidden');
  $('#studio')?.classList.add('is-hidden');
  render();
}

export { render as renderLanding };
