import { supabase, supabaseConfigured } from './supabase.js';
import { ATTRIBUTION_READY, mappingFor } from './checkout.js';

/* Starting a checkout, from the browser.
 *
 * The browser's only job is to ask the server for a URL and send the buyer
 * there. It does not build the URL, does not choose a variant, does not choose
 * a price, and does not decide that a purchase happened.
 *
 * THE BODY CARRIES A PLAN AND A CYCLE AND NOTHING ELSE. That is a deliberate
 * contract with the Edge Function, which reads no other field. A body that
 * carried a user id could be edited to name someone else; a body that carried
 * a variant id could be edited to buy the enterprise plan at the pro price.
 * Neither is possible if neither is sent.
 *
 * NOTHING HERE GRANTS ACCESS. A successful call returns a URL to visit; the
 * subscription appears only when the payment provider confirms it to the
 * webhook. Returning from a checkout page proves nothing — the query string is
 * editable — which is why `recordCheckoutReturn` refreshes and grants nothing.
 */

/** The deployed Edge Function that mints checkouts. */
export const CHECKOUT_FUNCTION = 'lemonsqueezy-checkout';

/**
 * Where the function lives. Derived from the project URL rather than hardcoded
 * so a preview deployment points at its own project.
 */
export function checkoutEndpoint(projectUrl = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '') {
  if (!projectUrl) return null;
  return `${String(projectUrl).replace(/\/+$/, '')}/functions/v1/${CHECKOUT_FUNCTION}`;
}

/**
 * Ask the server for a checkout URL for this plan and cycle.
 *
 * Every failure returns `{ ok: false, reason }` and never a URL, so a caller
 * that forgets to check the flag still cannot send a buyer anywhere.
 */
export async function startCheckout({
  plan,
  cycle,
  client = supabase,
  endpoint = checkoutEndpoint(),
  apiKey = (import.meta.env && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)) || '',
  fetchImpl = fetch,
  // Injectable ONLY so the paths below can be tested while the real gate is
  // closed. It defaults to the real constant, so production behaviour is the
  // constant and nothing else. This gate is a UI affordance: the server-side
  // gate is the JWT check on the Edge Function and the RLS policy on the table.
  attributionReady = ATTRIBUTION_READY
} = {}) {
  // A checkout that cannot be attributed to an account must not be offered:
  // taking money we cannot assign is worse than not selling yet.
  if (!attributionReady) {
    return { ok: false, reason: 'attribution-not-ready', note: 'Checkout opens once the server can attribute a purchase to an account.' };
  }

  const mapped = mappingFor(plan, cycle);
  if (!mapped.ok) return mapped;

  if (!supabaseConfigured || !client || !endpoint) {
    return { ok: false, reason: 'not-configured' };
  }

  let token = null;
  try {
    const { data } = await client.auth.getSession();
    token = data?.session?.access_token ?? null;
  } catch {
    return { ok: false, reason: 'session-unavailable' };
  }
  if (!token) return { ok: false, reason: 'not-signed-in' };

  let status = 0;
  let body = null;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(apiKey ? { apikey: apiKey } : {})
      },
      // Exactly these two keys. Not a user id, not a variant id, not a price.
      body: JSON.stringify({ plan, cycle })
    });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (status === 401 || status === 403) return { ok: false, reason: 'not-signed-in' };
  if (status === 503) return { ok: false, reason: 'not-configured' };
  if (status < 200 || status >= 300) {
    // The server's own reason is surfaced; its raw body is not, because it can
    // carry provider detail that is not the buyer's business.
    return { ok: false, reason: body?.error || 'checkout-failed', status };
  }

  // The same https-only rule the server applies, applied again before a buyer
  // is navigated anywhere.
  if (typeof body?.url !== 'string' || !body.url.startsWith('https://')) {
    return { ok: false, reason: 'invalid-checkout-url' };
  }

  return { ok: true, url: body.url, plan: body.plan ?? plan, cycle: body.cycle ?? cycle, amount: body.amount ?? mapped.variant.amount };
}

/**
 * Send the buyer to the checkout. Returns the same result as `startCheckout`,
 * plus `opened`, so a caller can tell the difference between "no URL" and
 * "URL obtained but navigation blocked".
 */
export async function beginCheckout({ navigate = null, ...options } = {}) {
  const result = await startCheckout(options);
  if (!result.ok) return { ...result, opened: false };
  const go = navigate || ((url) => { if (typeof window !== 'undefined') window.location.assign(url); });
  try {
    go(result.url);
    return { ...result, opened: true };
  } catch {
    // The URL is still valid; the caller can offer it as a link instead.
    return { ...result, opened: false, reason: 'navigation-failed' };
  }
}
