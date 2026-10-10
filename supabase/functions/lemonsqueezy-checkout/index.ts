/* Deno entry point for server-side Lemon Squeezy checkout creation.
 *
 * Deliberately thin: every decision lives in handler.js, which is runtime-free
 * and unit-tested. This file resolves the authenticated user and wires the
 * database, and nothing else.
 *
 * DEPLOYED WITH verify_jwt = true. The gateway rejects an unauthenticated call
 * before this code runs, and the user is resolved again below from the token
 * rather than from the request body — the body is not trusted for identity at
 * any point.
 *
 * Required secrets (Supabase -> Edge Functions -> Secrets):
 *   LEMONSQUEEZY_API_KEY   from the Lemon Squeezy API key created for this app
 *   CHECKOUT_REDIRECT_URL  where the buyer returns after paying (optional but
 *                          should be set; without it the provider uses its own
 *                          default thank-you page)
 *   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY  auto-injected
 *
 * The service-role key is used ONLY to write the nonce row, because
 * cx_checkout_nonces has no client policy by design. It must never reach the
 * browser bundle.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

/* Only the application's own origins may call this from a browser. */
const ALLOWED_ORIGINS = [
  'https://cryptox-v2.site.accio.ai',
  'http://localhost:5173',
  'http://localhost:4173'
];

const corsFor = (origin: string | null) => {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'origin'
  };
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsFor(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const authorization = req.headers.get('Authorization') ?? '';

  // Resolve the caller from the token itself. The user id is never read from
  // the body, so a caller cannot ask for a checkout under another account.
  const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: authData } = await authClient.auth.getUser();
  const userId = authData?.user?.id ?? null;

  // Writing the nonce needs the service role: cx_checkout_nonces has RLS
  // enabled with no client policy, so only the service role can insert.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });

  const store = {
    async saveNonce(row: Record<string, unknown>) {
      const { error } = await admin.from('cx_checkout_nonces').insert(row);
      if (error) throw new Error(error.message);
    }
  };

  const body = req.method === 'POST' ? await req.text() : null;

  const result = await handleRequest({
    method: req.method,
    body,
    userId,
    store,
    env: {
      LEMONSQUEEZY_API_KEY: Deno.env.get('LEMONSQUEEZY_API_KEY') ?? '',
      CHECKOUT_REDIRECT_URL: Deno.env.get('CHECKOUT_REDIRECT_URL') ?? '',
      DEPLOYMENT_LIVE: Deno.env.get('DEPLOYMENT_LIVE') ?? 'true'
    }
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, ...result.headers }
  });
});
