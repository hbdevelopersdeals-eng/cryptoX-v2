import { supabase, supabaseConfigured } from './supabase.js';

/* Asking the server-side assistant, from the browser.
 *
 * Two answers exist in this product and they are NOT the same thing:
 *   · `analyst.js` — a deterministic intent router. No model, no cost, no
 *     network, and it says so. It is the fallback and it always works.
 *   · the `ai-assistant` Edge Function — a real model answer, key held server-side.
 *
 * Everything here is written so the caller can say which one answered. A silent
 * fallback would be the dishonest option: the user would read a model answer
 * where a template was rendered, or vice versa.
 *
 * The body carries a question and a small context object, nothing else. The
 * system prompt lives on the server: if the client could send one, the endpoint
 * would be a general-purpose text generator billed to us.
 */

export const AI_FUNCTION = 'ai-assistant';

export function assistantEndpoint(projectUrl = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '') {
  if (!projectUrl) return null;
  return `${String(projectUrl).replace(/\/+$/, '')}/functions/v1/${AI_FUNCTION}`;
}

/**
 * @returns {Promise<{ok: true, text: string, provider: string, model: string, source: 'model'}
 *                 | {ok: false, reason: string, note?: string}>}
 */
export async function askModel({
  message,
  context = {},
  client = supabase,
  endpoint = assistantEndpoint(),
  apiKey = (import.meta.env && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)) || '',
  fetchImpl = fetch
} = {}) {
  const question = String(message || '').trim();
  if (!question) return { ok: false, reason: 'empty-message' };

  /* No `supabaseConfigured` term here on purpose: the endpoint is already derived
   * from the project URL, so a configured deployment implies it, and an injected
   * endpoint (preview host, test) must not be refused by a build-time constant. */
  if (!client || !endpoint) {
    return { ok: false, reason: 'not-configured', note: 'No server is configured, so the built-in assistant answers.' };
  }

  let token = null;
  try {
    const { data } = await client.auth.getSession();
    token = data?.session?.access_token ?? null;
  } catch {
    return { ok: false, reason: 'session-unavailable' };
  }
  if (!token) return { ok: false, reason: 'not-signed-in', note: 'Sign in for a model answer; the built-in assistant works without an account.' };

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(apiKey ? { apikey: apiKey } : {})
      },
      body: JSON.stringify({ message: question, context })
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 501) {
    return { ok: false, reason: 'not-configured', note: body?.note };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'not-signed-in' };
  if (response.status === 400) return { ok: false, reason: 'blocked', note: 'That request was refused before it was sent to a model.' };
  if (response.status === 413) return { ok: false, reason: 'too-long' };
  if (response.status < 200 || response.status >= 300) return { ok: false, reason: body?.error || 'unavailable' };

  if (typeof body?.text !== 'string' || !body.text.trim()) return { ok: false, reason: 'empty-answer' };

  return { ok: true, text: body.text, provider: body.provider || 'unknown', model: body.model || 'unknown', source: 'model' };
}
