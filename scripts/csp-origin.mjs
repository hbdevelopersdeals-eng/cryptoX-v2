/* Derives the Supabase entry for the Content-Security-Policy from the SAME
 * environment variable the browser client reads.
 *
 * WHY THIS EXISTS. The policy used to name the project host by hand. That is a
 * second, silently divergent copy of a value that already lives in
 * VITE_SUPABASE_URL: point the app at a different project and the client would
 * move while the policy stayed behind, so every auth and Edge Function request
 * would be refused by the browser before it was sent. The symptom is
 * `TypeError: Failed to fetch` with no request in the network log — which is
 * exactly what happened here, and it cost real time to trace.
 *
 * Generating the directive from the same variable removes that class of bug:
 * if the client can reach a project, the policy permits it too.
 *
 * NO WILDCARDS. Never `*` and never a bare `https:`. A policy that permits every
 * host is not a policy. An unconfigured build simply gets `'self'` and the
 * explicit public market-data origins, which is consistent: with no URL the
 * client is not created at all.
 */

/** Token left in index.html and public/_headers for the build to replace. */
export const SUPABASE_CSP_PLACEHOLDER = '__SUPABASE_CONNECT_SRC__';

/**
 * The connect-src entries for a Supabase base URL, or '' when there is nothing
 * usable to permit.
 *
 * Both the HTTPS origin and its websocket counterpart are returned, because the
 * app subscribes to Supabase Realtime (src/lib/walletEvents.js), and a policy
 * that allows the REST host but not `wss://` breaks live updates while leaving
 * ordinary requests working.
 *
 * @param {string | undefined | null} value - e.g. VITE_SUPABASE_URL
 * @returns {string} space-separated CSP source expressions, or ''
 */
export function supabaseConnectSources(value) {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }

  // Only http(s). Anything else (javascript:, data:, file:) must never be
  // written into a policy, even if it somehow reached the environment.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  // A URL with no host is not an origin we can permit.
  if (!url.host) return '';

  const socketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${url.origin} ${socketProtocol}//${url.host}`;
}

/**
 * Substitutes the placeholder in a text document (index.html, _headers).
 * Every occurrence is replaced; a shipped document must never contain the
 * literal token, because an unsubstituted token is an invalid source expression.
 *
 * @param {string} text
 * @param {string | undefined | null} supabaseUrl
 * @returns {string}
 */
export function applySupabaseCsp(text, supabaseUrl) {
  if (typeof text !== 'string' || !text.includes(SUPABASE_CSP_PLACEHOLDER)) return text;
  const sources = supabaseConnectSources(supabaseUrl);
  return text.split(SUPABASE_CSP_PLACEHOLDER).join(sources);
}
