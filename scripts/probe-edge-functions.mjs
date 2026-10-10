/* Probes the two deployed functions to prove they fail closed in production.
 * No secrets are sent and none are needed. Read-only: nothing is written. */

const BASE = 'https://bvyiqinyakxlefaeomoj.supabase.co/functions/v1';

const probe = async (label, url, init) => {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    console.log(`${label}\n  status=${res.status}\n  body=${JSON.stringify(body)}`);
    return { status: res.status, body };
  } catch (err) {
    console.log(`${label}\n  FETCH FAILED: ${err.message}`);
    return { status: 0, body: null };
  }
};

console.log('=== webhook: unsigned POST (no signing secret configured) ===');
await probe('POST /lemonsqueezy-webhook  (no signature)', `${BASE}/lemonsqueezy-webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ meta: { event_name: 'subscription_created' }, data: { type: 'subscriptions', id: 'x', attributes: {} } })
});

console.log('\n=== webhook: bogus signature ===');
await probe('POST /lemonsqueezy-webhook  (x-signature: 64 a\'s)', `${BASE}/lemonsqueezy-webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-signature': 'a'.repeat(64) },
  body: JSON.stringify({ meta: { event_name: 'subscription_created' }, data: { type: 'subscriptions', id: 'x', attributes: {} } })
});

console.log('\n=== webhook: GET (wrong method) ===');
await probe('GET /lemonsqueezy-webhook', `${BASE}/lemonsqueezy-webhook`, { method: 'GET' });

console.log('\n=== checkout: unauthenticated POST (verify_jwt should reject) ===');
await probe('POST /lemonsqueezy-checkout  (no auth)', `${BASE}/lemonsqueezy-checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ plan: 'pro', cycle: 'monthly' })
});
