/* Deno entry point for the AI assistant.
 *
 * Thin on purpose: every decision (which provider, what may be sent, what may be
 * returned) lives in handler.js, which is runtime-free and unit-tested. This file
 * resolves the caller and passes an allow-listed env.
 *
 * DEPLOYED WITH verify_jwt = true: an anonymous caller is rejected by the
 * gateway before this code runs, and the user id is read from the token rather
 * than the body, so a caller cannot spend another account's budget.
 *
 * Required secrets (Supabase -> Edge Functions -> Secrets), ONE of:
 *   ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY
 * With none set the function answers 501 and the app keeps using its built-in
 * deterministic assistant — an explicit "not configured", never a fake answer.
 *
 * Optional:
 *   AI_DAILY_REQUESTS  soft per-user cap (default 200, enforced in handler later)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

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
    vary: 'origin'
  };
};

Deno.serve(async (req: Request) => {
  const cors = corsFor(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const authorization = req.headers.get('Authorization') ?? '';

  const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: authData } = await authClient.auth.getUser();
  const userId = authData?.user?.id ?? null;

  const body = req.method === 'POST' ? await req.text() : null;

  const result = await handleRequest({
    method: req.method,
    body,
    userId,
    // An allow-list, not a spread: a key saved in the dashboard must be named
    // here before the handler can see it (see the Lemon Squeezy test-mode bug in
    // SETUP.md, where exactly this omission made a switch silently do nothing).
    env: {
      ANTHROPIC_API_KEY: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      OPENAI_API_KEY: Deno.env.get('OPENAI_API_KEY') ?? '',
      GOOGLE_API_KEY: Deno.env.get('GOOGLE_API_KEY') ?? ''
    }
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, ...result.headers }
  });
});
