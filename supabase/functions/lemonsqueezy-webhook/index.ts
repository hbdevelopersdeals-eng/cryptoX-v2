/* Deno entry point for the Lemon Squeezy webhook.
 *
 * Deliberately thin. Every decision that could be wrong lives in handler.js,
 * which is runtime-free and unit-tested; this file only wires the real
 * environment and database to it.
 *
 * NOT DEPLOYED YET. Deploying is safe (it fails closed without the signing
 * secret), but there is no point exposing an endpoint that rejects every
 * delivery until LEMONSQUEEZY_WEBHOOK_SECRET exists. Deploy, then create the
 * webhook, then store the secret.
 *
 * Required secrets (Supabase -> Edge Functions -> Secrets):
 *   LEMONSQUEEZY_WEBHOOK_SECRET  from the webhook you create in Lemon Squeezy
 *   SUPABASE_SERVICE_ROLE_KEY    auto-injected by Supabase
 *
 * The service-role key is required and is used ONLY here, server-side. It must
 * never reach the client bundle: it bypasses RLS, which is the entire reason
 * cx_subscriptions has no client write policy.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-signature, x-event-id',
  'access-control-allow-methods': 'POST, OPTIONS'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
      status: 405, headers: { ...cors, 'content-type': 'application/json' }
    });
  }

  // The RAW body is what was signed. Reading it as text before any parsing is
  // the whole point: re-serialising JSON changes key order and whitespace and
  // the signature would no longer match.
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature');

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const store = {
    async findEvent(key: string) {
      const { data } = await client.from('cx_webhook_events').select('id').eq('id', key).maybeSingle();
      return data;
    },
    async recordEvent(row: Record<string, unknown>) {
      // A primary-key collision is the idempotency mechanism, not an error.
      const { error } = await client.from('cx_webhook_events').insert(row);
      if (error && error.code !== '23505') throw new Error(error.message);
    },
    async resolveNonce(nonce: string) {
      const { data } = await client
        .from('cx_checkout_nonces')
        .select('user_id')
        .eq('nonce', nonce)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      return data?.user_id ?? null;
    },
    async upsertSubscription(row: Record<string, unknown>) {
      const { error } = await client
        .from('cx_subscriptions')
        .upsert(row, { onConflict: 'provider,provider_subscription_id' });
      if (error) throw new Error(error.message);
    },
    async markEventProcessed(key: string, outcome: string) {
      await client.from('cx_webhook_events')
        .update({ processed_at: new Date().toISOString(), outcome })
        .eq('id', key);
    }
  };

  const result = await handleRequest({
    rawBody,
    signature,
    headers: Object.fromEntries(req.headers),
    env: {
      LEMONSQUEEZY_WEBHOOK_SECRET: Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET') ?? '',
      // The deployment's own mode. A test subscription must never grant live
      // access, so this is read from configuration rather than assumed.
      DEPLOYMENT_LIVE: Deno.env.get('DEPLOYMENT_LIVE') ?? 'true'
    },
    store
  });

  return new Response(typeof result.body === 'string' ? result.body : JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, ...result.headers }
  });
});
