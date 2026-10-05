/**
 * Reference assistant backend for GIS Design Studio.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node server/ai-backend.mjs
 *
 * Then paste http://localhost:8787 into Analysis → Assistant → Backend URL.
 *
 * The point of this file is that the API key lives here, in your process
 * environment, and never reaches the browser. The studio sends only the
 * map description it already displays; this server adds the credential and
 * talks to Claude.
 */

import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.ALLOW_ORIGIN ?? 'http://localhost:5173';

/**
 * The server runs with or without credentials.
 *
 * Without a key it still binds, still answers, and still exercises the whole
 * browser → backend → reply path — but it composes the reply itself from the
 * map description and labels it plainly, so a stub can never be mistaken for
 * the model. Add a key and the same endpoint starts talking to Claude.
 */
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = HAS_KEY ? new Anthropic() : null;

const SYSTEM = `You are a cartography and GIS assistant built into a map design studio.
The user is usually not a GIS specialist, so explain in plain language and avoid jargon
unless they use it first.

You are given a JSON description of the map they are currently looking at: its study
area, the data layers on it, how each layer is coloured, and the results of any analysis
they have run. Ground every statement in that description.

Rules:
- Never invent figures. If a number is not in the map description, say you cannot see it.
- Distances from the "Nearest facility" tool are straight-line, not along roads. Volumes
  are area x an assumed depth. Say so whenever you quote them.
- Feature counts come from OpenStreetMap, which is community-mapped and uneven in
  coverage; absence of features is not evidence of absence on the ground.
- When asked to summarise, lead with the single most useful finding, then supporting
  detail. Keep it to a few short paragraphs.
- When asked what to do next, suggest concrete steps available in this app: loading a
  study area, adding a dataset, running one of the analysis tools, or restyling a layer.`;

const send = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
};

/** A factual reply composed here, for when no credential is configured. */
function stubReply(context = {}) {
  const lines = ['**Running without an API key** — this reply is composed by the backend from your map, not by Claude. Restart with `ANTHROPIC_API_KEY=…` for real discussion.', ''];

  const area = context.studyArea;
  lines.push(area
    ? `Your map covers **${area.name}** (${area.areaKm2} km²), on ${context.page}.`
    : `**${context.project ?? 'Untitled map'}** — no study area loaded yet, on ${context.page}.`);

  const data = (context.layers ?? []).filter((l) => l.from !== 'analysis result');
  if (data.length) {
    lines.push('', `**${data.length} layer${data.length === 1 ? '' : 's'} on the map**`);
    for (const l of data) {
      lines.push(`- ${l.name} — ${l.features ?? 0} ${l.geometry} features from ${l.from}, ${l.colouredBy}`);
    }
  }

  for (const a of context.analysis ?? []) {
    lines.push('', `**${a.tool}** — ${a.summary}`);
    for (const f of a.findings ?? []) lines.push(`- ${f}`);
  }

  return lines.join('\n');
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && req.url.startsWith('/health')) {
    return send(res, 200, {
      ok: true,
      mode: HAS_KEY ? 'claude' : 'no-key',
      model: HAS_KEY ? 'claude-opus-5' : null,
      origin: ORIGIN,
    });
  }

  if (req.method !== 'POST' || !req.url.startsWith('/chat')) {
    return send(res, 404, { error: 'POST /chat, or GET /health' });
  }

  let payload;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(res, 400, { error: 'Body must be JSON.' });
  }

  const { context, messages } = payload;
  if (!Array.isArray(messages) || !messages.length) {
    return send(res, 400, { error: '`messages` must be a non-empty array.' });
  }

  if (!HAS_KEY) return send(res, 200, { reply: stubReply(context), mode: 'no-key' });

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      // Replies are a few paragraphs; this leaves ample room for thinking
      // plus the answer without risking an HTTP timeout on a non-streaming call.
      max_tokens: 8000,
      // Claude Opus 5 thinks by default. Low effort keeps a short explanatory
      // task quick and cheap rather than turning thinking off, which on this
      // model can leak internal tags into the visible reply.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Here is the map I am looking at:\n\n${JSON.stringify(context, null, 2)}`,
        },
        { role: 'assistant', content: 'Understood — I have the map in front of me. What would you like to know?' },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content ?? ''),
        })),
      ],
    });

    // Safety classifiers can decline a request; that arrives as a normal 200.
    if (response.stop_reason === 'refusal') {
      return send(res, 200, {
        reply: 'I was not able to answer that one. Try rephrasing, or ask about the map itself.',
      });
    }

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return send(res, 200, { reply: reply || 'No reply was produced.' });
  } catch (err) {
    console.error('[ai-backend]', err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    return send(res, status, { error: err?.message ?? 'Upstream failure.' });
  }
}).listen(PORT, () => {
  console.log(`Assistant backend on http://localhost:${PORT}  (allowing ${ORIGIN})`);
  console.log(HAS_KEY
    ? 'Credential found — replies come from claude-opus-5.'
    : 'No ANTHROPIC_API_KEY — serving composed summaries. Restart with a key for real discussion.');
});
