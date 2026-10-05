/**
 * Assistant pane — discuss the map and get a written summary.
 *
 * With no backend configured this still works: the briefing is composed
 * locally from the same figures the printed page uses. Point it at a
 * backend and the same context becomes a conversation.
 */

import { $, el, fill, esc } from '../../core/dom.js';
import { state, subscribe } from '../../core/store.js';
import { notify } from '../../core/toast.js';
import { mapContext, localBriefing } from '../../ai/context.js';
import { askAssistant, aiEndpoint, setAiEndpoint, aiConfigured } from '../../ai/provider.js';
import { head, section, group, button, stack, labelled, textInput, empty, inline } from '../controls.js';

let pane;
let thread = [];           // { role, content }
let busy = false;
let draft = '';

const PROMPTS = [
  'Summarise this map for a report',
  'What stands out in the data?',
  'Explain this to someone with no GIS background',
  'What should I map next?',
];

/* ------------------------------------------------------------------ */
/** Very small markdown: **bold**, *italic*, `code`, - bullets. */
function renderRich(text) {
  const html = esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code style="font-family:ui-monospace,monospace;font-size:.92em">$1</code>')
    .split('\n')
    .map((line) => (line.startsWith('- ')
      ? `<div style="display:flex;gap:6px"><span style="opacity:.5">•</span><span>${line.slice(2)}</span></div>`
      : line ? `<div>${line}</div>` : '<div style="height:6px"></div>'))
    .join('');
  return html;
}

function bubble(entry) {
  const mine = entry.role === 'user';
  return el('div', {
    style: {
      alignSelf: mine ? 'flex-end' : 'flex-start',
      maxWidth: '92%',
      borderRadius: mine ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
      padding: '8px 10px',
      background: mine ? 'var(--accent-wash)' : 'var(--surface-2)',
      border: `1px solid ${mine ? 'var(--accent-soft)' : 'var(--line)'}`,
      color: 'var(--ink)',
      fontSize: '12px',
      lineHeight: '1.55',
    },
    html: renderRich(entry.content),
  });
}

/* ------------------------------------------------------------------ */
async function ask(question) {
  if (busy || !question.trim()) return;

  if (!aiConfigured()) {
    notify.warn('Add an assistant backend URL below to discuss the map.');
    return;
  }

  thread.push({ role: 'user', content: question.trim() });
  draft = '';
  busy = true;
  render();

  try {
    const reply = await askAssistant({
      messages: thread,
      context: mapContext(),
    });
    thread.push({ role: 'assistant', content: reply });
  } catch (err) {
    thread.push({ role: 'assistant', content: `**Could not answer.** ${err.message}` });
  } finally {
    busy = false;
    render();
    const log = $('#ai-thread');
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function summariseLocally() {
  thread.push({ role: 'user', content: 'Summarise this map' });
  thread.push({ role: 'assistant', content: localBriefing() });
  render();
}

/* ------------------------------------------------------------------ */
function composer() {
  const input = el('textarea.field', {
    rows: 2,
    placeholder: aiConfigured() ? 'Ask about your map…' : 'Add a backend URL below to chat',
    style: { resize: 'vertical', lineHeight: '1.45' },
  });
  input.value = draft;
  input.addEventListener('input', () => { draft = input.value; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
  });

  return stack([
    input,
    inline([
      button(busy ? 'Thinking…' : 'Send', () => ask(input.value), 'primary', {
        style: { flex: '1' }, disabled: busy || !aiConfigured() ? true : null,
      }),
      thread.length ? button('Clear', () => { thread = []; render(); }, 'ghost') : null,
    ], '5px'),
  ], '6px');
}

function settings() {
  return group('Assistant settings', stack([
    labelled('Backend URL', textInput(aiEndpoint(), (value) => setAiEndpoint(value.trim()), {
      placeholder: 'http://localhost:8787',
    }), 'The small server that holds your API key.'),
  ]), !aiConfigured());
}

export function render() {
  pane = pane ?? $('#pane-ai');
  if (!pane) return;

  const log = el('div#ai-thread', {
    style: {
      display: 'flex', flexDirection: 'column', gap: '8px',
      maxHeight: '46vh', overflowY: 'auto', padding: '2px',
    },
  }, thread.length
    ? thread.map(bubble)
    : [empty('Ask anything about the map you have built —<br />or get a written summary for your report.')]);

  const quick = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } },
    PROMPTS.map((p) => {
      const btn = el('button.pill', { type: 'button', text: p });
      btn.addEventListener('click', () => ask(p));
      return btn;
    }));

  fill(pane, [
    head('Assistant', 'Discuss your map, or turn it into words for a report.'),
    section('', stack([
      log,
      busy ? inline([el('span.spinner.spinner--ink'), el('span', { text: 'Reading your map…', style: { fontSize: '11.5px', color: 'var(--ink-soft)' } })]) : null,
    ])),
    section('Summary', stack([
      button('Write a summary of this map', summariseLocally, 'soft', { style: { width: '100%' } }),
      el('p', {
        style: { margin: 0, fontSize: '10.5px', color: 'var(--ink-faint)', lineHeight: '1.45' },
        text: 'Composed here from your layers and analysis results — accurate, and works with no backend at all.',
      }),
    ])),
    section('Ask', stack([quick, composer()])),
    settings(),
    el('div.panel-section', {}, [
      el('p', {
        style: { margin: 0, fontSize: '10.5px', lineHeight: '1.5', color: 'var(--ink-faint)' },
        text: 'The assistant only sees the description of your map — layer names, counts, analysis figures. Your data files are never uploaded.',
      }),
    ]),
  ]);
}

export function initAiPane() {
  pane = $('#pane-ai');
  render();
  subscribe(['layers', 'studyArea', 'analysisRuns'], () => { if (state.activeTool === 'ai') render(); });
}

export { render as renderAiPane };
