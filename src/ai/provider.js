/**
 * Assistant transport.
 *
 * The browser never holds an API key. It talks to a small backend of your
 * own, which is the only thing that sees credentials — the same shape the
 * rest of this app uses for anything that cannot be done safely client-side.
 * A reference implementation ships in `server/ai-backend.mjs`; running it is
 * two commands and it is about sixty lines.
 *
 * ── Request ────────────────────────────────────────────────────────
 *   POST {endpoint}/chat
 *   {
 *     "context":  { …mapContext() },
 *     "messages": [ { "role": "user", "content": "…" }, … ]
 *   }
 *
 * ── Response ───────────────────────────────────────────────────────
 *   { "reply": "…" }              on success
 *   { "error": "…" }              with a 4xx/5xx status
 */

const STORAGE_KEY = 'gds.ai.endpoint';
const DEFAULT_ENDPOINT = import.meta.env?.VITE_AI_ENDPOINT ?? '';

export function aiEndpoint() {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_ENDPOINT; } catch { return DEFAULT_ENDPOINT; }
}

export function setAiEndpoint(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode */ }
}

export const aiConfigured = () => Boolean(aiEndpoint());

/**
 * Ask the assistant.
 * @param {{messages: Array, context: object, signal?: AbortSignal}} req
 * @returns {Promise<string>} the reply text
 */
export async function askAssistant({ messages, context, signal }) {
  const endpoint = aiEndpoint();
  if (!endpoint) throw new Error('No assistant backend configured yet.');

  let res;
  try {
    res = await fetch(`${endpoint}/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, messages }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Could not reach the assistant at ${endpoint}. Is it running?`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail.slice(0, 200);
    try { message = JSON.parse(detail).error ?? message; } catch { /* plain text */ }
    throw new Error(`Assistant returned ${res.status}. ${message}`);
  }

  const data = await res.json();
  if (!data.reply) throw new Error('The assistant sent an empty reply.');
  return data.reply;
}
