/**
 * Layers pane — one list of everything drawn over the basemap, whatever
 * it came from. Selecting a layer opens its styling in the right panel.
 */

import { $, el, fill } from '../../core/dom.js';
import { state, set, subscribe } from '../../core/store.js';
import { toggleLayer, removeLayer, reorderLayer } from '../../layers/registry.js';
import { flyToBounds } from '../../core/map.js';
import { boundsFromBbox, formatNumber } from '../../core/geo.js';
import { renderElements } from '../artboard.js';
import { setTool } from '../tool.js';
import { head, section, row, empty, miniBtn, button } from '../controls.js';
import { uiIcon } from '../ui-icons.js';
import { iconSvg } from '../../layers/icons.js';
import { dashArray, isTransparent } from '../../layers/symbology.js';

let pane;

const SOURCE_LABEL = {
  osm: 'OpenStreetMap',
  overture: 'Overture Maps',
  upload: 'Your file',
  boundary: 'Study area',
  analysis: 'Analysis',
  sample: 'Sample data',
};

/**
 * The layer's own first legend mark, at row size.
 *
 * A column of identical coloured squares tells you almost nothing when half
 * the layers are point symbols and the rest are dashed lines, so this row
 * shows the same mark the map and the legend show.
 */
function layerMark(layer) {
  const row = layer.legend?.[0];
  const color = row?.color ?? (typeof layer.style?.fill === 'string' ? layer.style.fill : '#0369a1');

  if (layer.type === 'raster') {
    return el('span.layer-mark', { style: { background: 'linear-gradient(135deg,#334155,#94a3b8)', borderRadius: '3px' } });
  }
  if (isTransparent(color)) {
    return el('span.layer-mark', {
      title: 'Outline only — no fill',
      style: { border: '1px solid var(--ink-faint)', borderRadius: layer.kind === 'point' ? '50%' : '3px' },
    });
  }
  if (layer.kind === 'point' && row?.icon) {
    return el('span.layer-mark', { html: iconSvg(row.icon, color, 14), style: { border: '0' } });
  }
  if (layer.kind === 'line') {
    const node = el('span.layer-mark', { style: { height: '3px', borderRadius: '99px', background: color } });
    const pattern = dashArray(row?.dash);
    if (pattern) {
      const stops = [];
      let at = 0;
      pattern.forEach((seg, i) => {
        const end = at + seg * 3;
        stops.push(`${i % 2 ? 'transparent' : color} ${at}px ${end}px`);
        at = end;
      });
      node.style.background = `repeating-linear-gradient(90deg,${stops.join(',')})`;
      node.style.borderRadius = '0';
    }
    return node;
  }
  return el('span.layer-mark', { style: { background: color, borderRadius: layer.kind === 'point' ? '50%' : '3px' } });
}

function layerRow(layer) {
  // The same drawn set the Elements list uses — these two panels are the same
  // widget doing the same job, and two different icon vocabularies for "hide"
  // in one sidebar is how an interface stops looking designed.
  const actions = [
    miniBtn(uiIcon(layer.visible ? 'show' : 'hide'), layer.visible ? 'Hide this layer' : 'Show this layer', () => {
      toggleLayer(layer.id);
      renderElements();
    }, { pressed: !layer.visible }),
    miniBtn(uiIcon('forward'), 'Move up', () => reorderLayer(layer.id, 1)),
    miniBtn(uiIcon('backward'), 'Move down', () => reorderLayer(layer.id, -1)),
    miniBtn(uiIcon('target'), 'Zoom to this layer', () => layer.bbox && flyToBounds(boundsFromBbox(layer.bbox))),
    miniBtn(uiIcon('trash'), 'Remove', () => { removeLayer(layer.id); renderElements(); }, { danger: true }),
  ];

  const count = layer.meta?.count;
  const merged = layer.meta?.merged;
  const sub = [
    // A merged layer names both, with what Overture actually contributed —
    // "OpenStreetMap" alone would be a quarter of the truth for buildings.
    merged?.overtureAdded
      ? `OSM + ${formatNumber(merged.overtureAdded, 0)} from Overture`
      : SOURCE_LABEL[layer.source] ?? layer.source,
    Number.isFinite(count) ? `${formatNumber(count, 0)} features` : null,
    layer.visible ? null : 'hidden',
  ].filter(Boolean).join(' · ');

  return row({
    icon: layerMark(layer),
    title: layer.name,
    sub,
    active: layer.id === state.selectedLayerId,
    onClick: () => set({ selectedLayerId: layer.id, selectedElementId: null }, { history: false }),
    actions,
  });
}

export function render() {
  pane = pane ?? $('#pane-layers');
  if (!pane) return;

  // Top of the list = top of the map.
  const list = [...state.layers].reverse();

  fill(pane, [
    head('Layers', 'Draw order, visibility and styling. The topmost row draws last.'),
    list.length
      ? el('div', { style: { padding: '10px 14px' } }, list.map(layerRow))
      : el('div.panel-section', {}, [
          empty('Nothing on the map yet.<br />Add open data, upload a file, or run an analysis.'),
          button('Browse open data', () => setTool('data'), 'soft', { style: { width: '100%', marginTop: '10px' } }),
        ]),
    list.length ? section('', el('p', {
      style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: '#94a3b8' },
      text: 'Click a layer to change its colours, line weight and labels in the right-hand panel.',
    })) : null,
  ]);
}

export function initLayersPane() {
  pane = $('#pane-layers');
  render();
  subscribe(['layers', 'selectedLayerId'], () => { if (state.activeTool === 'layers') render(); });
}

export { render as renderLayersPane };
