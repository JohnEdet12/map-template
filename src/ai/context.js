/**
 * What the assistant knows about your map.
 *
 * Composes a compact, factual description of the current document — study
 * area, layers, analysis results, page setup — that can be sent to a model
 * or, with no model configured at all, rendered directly as a written
 * briefing. Nothing here invents numbers: every figure comes from the same
 * derived helpers the printed page uses.
 */

import { state } from '../core/store.js';
import { formatArea, formatNumber } from '../core/geo.js';
import { templateById } from '../templates/catalog.js';
import { paperDims } from '../ui/artboard.js';

const SOURCE_LABEL = {
  osm: 'OpenStreetMap',
  upload: 'your own file',
  boundary: 'boundary lookup',
  analysis: 'analysis result',
};

/** A structured snapshot of the map, safe to serialise and send. */
export function mapContext() {
  const area = state.studyArea;
  const paper = paperDims();
  const tpl = templateById(state.templateId);

  return {
    project: state.projectName,
    template: tpl ? { name: tpl.name, category: tpl.category } : null,
    page: `${paper.label} ${paper.orientation} at ${state.page.dpi} dpi`,
    studyArea: area
      ? {
          name: area.name,
          level: area.level,
          areaKm2: Number(area.areaKm2?.toFixed(1)),
          fullName: area.displayName,
          // Named individually when there are several, so a written summary
          // can say which places it is describing rather than "3 areas".
          ...(area.parts?.length > 1 ? { areas: area.parts.map((p) => p.name) } : {}),
        }
      : null,
    mapView: {
      centre: state.mapView.center.map((n) => Number(n.toFixed(4))),
      zoom: Number(state.mapView.zoom.toFixed(1)),
      basemap: state.basemap,
    },
    layers: state.layers.map((l) => ({
      name: l.name,
      from: SOURCE_LABEL[l.source] ?? l.source,
      geometry: l.kind,
      features: l.meta?.count ?? null,
      visible: l.visible,
      colouredBy: l.symbology?.mode === 'single'
        ? 'one colour'
        : `${l.symbology?.mode} on “${l.symbology?.field}”`,
      categories: l.symbology?.mode === 'categorised'
        ? l.symbology.categories.map((c) => c.label)
        : undefined,
    })),
    analysis: state.analysisRuns.map((r) => ({
      tool: r.tool.name,
      question: r.tool.question,
      settings: r.params,
      findings: r.result.stats.map((s) => `${s.label}: ${s.value}`),
      summary: r.result.summary,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* offline briefing — no model involved                                */
/* ------------------------------------------------------------------ */

/**
 * A written summary composed locally from the document. This is what the
 * panel shows when no assistant backend is configured — it is not a
 * substitute for discussion, but it is accurate and needs nothing.
 */
export function localBriefing() {
  const ctx = mapContext();
  const lines = [];

  if (ctx.studyArea) {
    lines.push(`**${ctx.studyArea.name}** — ${formatArea(ctx.studyArea.areaKm2)}, mapped at ${ctx.page}.`);
    if (ctx.studyArea.areas) {
      lines.push(`Covering ${ctx.studyArea.areas.join(', ')} — every figure below is the total across all of them.`);
    }
  } else {
    lines.push(`**${ctx.project}** — no study area loaded yet, mapped at ${ctx.page}.`);
  }

  const data = ctx.layers.filter((l) => l.from !== 'analysis result' && l.from !== 'boundary lookup');
  if (data.length) {
    const total = data.reduce((sum, l) => sum + (l.features ?? 0), 0);
    lines.push('');
    lines.push(`**Data on the map** — ${formatNumber(total, 0)} features across ${data.length} layer${data.length === 1 ? '' : 's'}:`);
    for (const l of data) {
      const cats = l.categories?.length ? ` (${l.categories.join(', ')})` : '';
      lines.push(`- ${l.name}: ${formatNumber(l.features ?? 0, 0)} ${l.geometry} features from ${l.from}${cats}`);
    }
  }

  if (ctx.analysis.length) {
    lines.push('');
    lines.push('**What the analysis found**');
    for (const a of ctx.analysis) {
      lines.push(`- *${a.tool}* — ${a.summary}`);
    }
  }

  if (!data.length && !ctx.analysis.length) {
    lines.push('');
    lines.push('Nothing has been added to the map yet. Load a study area, then add data from the Data panel.');
  }

  return lines.join('\n');
}
