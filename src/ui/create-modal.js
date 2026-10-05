/**
 * "Create a new map" dialog — six starting points, phrased as jobs rather
 * than file types.
 */

import { $, el, fill } from '../core/dom.js';

const CHOICES = [
  {
    icon: '◫', title: 'From a template',
    body: 'Browse eighteen finished looks and pick the one that fits.',
    open: (api, close) => { close(); document.querySelector('#home-templates')?.scrollIntoView({ behavior: 'smooth' }); },
  },
  {
    icon: '◎', title: 'Map a place',
    body: 'Start with a country, state or district boundary drawn for you.',
    open: (api) => api.openStudio({ templateId: 'quiet-canvas', tool: 'area' }),
  },
  {
    icon: '▩', title: 'Thematic map',
    body: 'Show districts, land use or facilities coloured by category.',
    open: (api) => api.openStudio({ templateId: 'land-cover', tool: 'data' }),
  },
  {
    icon: '≋', title: 'Hazard or impact map',
    body: 'Draw buffer zones around rivers or infrastructure at risk.',
    open: (api) => api.openStudio({ templateId: 'oil-spill', tool: 'analysis' }),
  },
  {
    icon: '⇪', title: 'Use my own data',
    body: 'Bring a Shapefile, GeoJSON, KML, GPX or CSV of coordinates.',
    open: (api) => api.openStudio({ templateId: 'quiet-canvas', tool: 'data' }),
  },
  {
    icon: '＋', title: 'Blank canvas',
    body: 'Just the page. Add only the elements you want.',
    open: (api) => api.openStudio({ templateId: 'blank', tool: 'elements' }),
  },
];

export function openCreateModal(api) {
  const modal = $('#create-modal');
  if (!modal) return;

  const close = () => modal.classList.remove('is-open');

  const dialog = el('div.modal-dialog', {}, [
    (() => {
      const btn = el('button.modal-close', { type: 'button', text: '×', 'aria-label': 'Close' });
      btn.addEventListener('click', close);
      return btn;
    })(),
    el('h2#create-title', { text: 'Create a new map', style: { margin: 0, fontSize: '26px', letterSpacing: '-0.025em' } }),
    el('p', {
      text: 'Pick a starting point — you can change everything afterwards.',
      style: { margin: '6px 0 0', color: 'var(--ink-soft)', fontSize: '14px' },
    }),
    el('div.create-grid', {}, CHOICES.map((choice) => {
      const card = el('button.create-choice', { type: 'button' }, [
        el('span.choice-ico', { text: choice.icon }),
        el('span.choice-text', {}, [
          el('strong', { text: choice.title }),
          el('small', { text: choice.body }),
        ]),
      ]);
      card.addEventListener('click', () => { close(); choice.open(api, close); });
      return card;
    })),
  ]);

  fill(modal, [dialog]);
  modal.classList.add('is-open');

  modal.onclick = (event) => { if (event.target === modal) close(); };
  window.addEventListener('keydown', function onEsc(event) {
    if (event.key !== 'Escape') return;
    close();
    window.removeEventListener('keydown', onEsc);
  });
}
