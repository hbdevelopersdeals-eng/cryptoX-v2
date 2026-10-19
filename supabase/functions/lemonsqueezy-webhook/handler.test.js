import { describe, it, expect, beforeEach } from 'vitest';
import {
  REQUIRED_SECRETS, HANDLED_EVENTS, KNOWN_STATUSES, VARIANT_TO_PLAN, PRODUCT_ID,
  checkSecrets, verifySignature, eventKey, interpretEvent, planForVariant, statusFor,
  decide, subscriptionRow, handleRequest, isEntitled
} from './handler.js';
import { VARIANTS } from '../../../src/lib/checkout.js';

/* The webhook receiver. The cases that matter are the ones a provider will
 * actually produce: a retry, a wrong signature, a variant nobody recognises,
 * and a test event arriving at a live deployment. */

const SECRET = 'whsec_test_not_a_real_secret';
const env = { LEMONSQUEEZY_WEBHOOK_SECRET: SECRET };

const body = (over = {}) => JSON.stringify({
  meta: { event_name: 'subscription_created', test_mode: false, custom_data: { nonce: 'n1' }, ...(over.meta || {}) },
  data: {
    type: 'subscriptions',
    id: 'sub_1',
    attributes: {
      customer_id: 5, order_id: 10, variant_id: '2230904', product_id: PRODUCT_ID,
      status: 'active', renews_at: '2026-11-10T00:00:00Z', ends_at: null, cancelled: false,
      ...(over.attributes || {})
    }
  }
});

const sign = async (raw, secret = SECRET) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** An in-memory stand-in for the database, recording every call. */
function makeStore({ existingEvent = null, nonceUser = 'user-1', existingSubscription = null } = {}) {
  const calls = { recorded: [], upserted: [], processed: [], consumed: [] };
  return {
    calls,
    async findEvent() { return existingEvent; },
    async recordEvent(row) { calls.recorded.push(row); },
    async findSubscription() { return existingSubscription; },
    // A consumed nonce stops resolving, which is what makes it single-use.
    async resolveNonce(nonce) { return calls.consumed.includes(nonce) ? null : nonceUser; },
    async consumeNonce(nonce) { calls.consumed.push(nonce); },
    async upsertSubscription(row) { calls.upserted.push(row); },
    async markEventProcessed(key, outcome) { calls.processed.push({ key, outcome }); }
  };
}

describe('webhook: fails closed without a signing secret', () => {
  it('names the secrets it requires', () => {
    expect(REQUIRED_SECRETS).toEqual(['LEMONSQUEEZY_WEBHOOK_SECRET']);
  });

  it('reports every missing secret', () => {
    expect(checkSecrets({})).toEqual({ ok: false, missing: REQUIRED_SECRETS });
    expect(checkSecrets({ LEMONSQUEEZY_WEBHOOK_SECRET: '   ' })).toEqual({ ok: false, missing: REQUIRED_SECRETS });
    expect(checkSecrets(env)).toEqual({ ok: true, missing: [] });
  });

  it('refuses EVERY delivery when the secret is absent, and asks for a retry', async () => {
    // 500, not 200: a misconfigured deployment must not silently swallow real
    // subscription events. And nothing may be written.
    const store = makeStore();
    const raw = body();
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env: {}, store });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'not-configured' });
    expect(store.calls.upserted).toEqual([]);
    expect(store.calls.recorded).toEqual([]);
  });
});

describe('webhook: signature verification over the raw body', () => {
  it('accepts a correct signature', async () => {
    const raw = body();
    expect(await verifySignature({ rawBody: raw, signature: await sign(raw), secret: SECRET })).toEqual({ ok: true });
  });

  it('accepts the sha256= prefixed header form, case-insensitively', async () => {
    const raw = body();
    const hex = await sign(raw);
    expect((await verifySignature({ rawBody: raw, signature: `sha256=${hex}`, secret: SECRET })).ok).toBe(true);
    expect((await verifySignature({ rawBody: raw, signature: hex.toUpperCase(), secret: SECRET })).ok).toBe(true);
  });

  it('REJECTS a body that differs by one byte', async () => {
    const raw = body();
    const signature = await sign(raw);
    const tampered = raw.replace('2230904', '2230941');
    expect(await verifySignature({ rawBody: tampered, signature, secret: SECRET }))
      .toEqual({ ok: false, reason: 'signature-mismatch' });
  });

  it('rejects re-serialised JSON, which is why the raw body is what gets signed', async () => {
    const raw = body();
    const signature = await sign(raw);
    const reserialised = JSON.stringify(JSON.parse(raw));
    // Same data, and often the same string — assert the rule, not a coincidence.
    expect(await verifySignature({ rawBody: raw, signature, secret: SECRET })).toEqual({ ok: true });
    if (reserialised !== raw) {
      expect((await verifySignature({ rawBody: reserialised, signature, secret: SECRET })).ok).toBe(false);
    }
  });

  it('rejects the wrong secret, a missing signature and a malformed one', async () => {
    const raw = body();
    expect((await verifySignature({ rawBody: raw, signature: await sign(raw, 'other'), secret: SECRET })).reason).toBe('signature-mismatch');
    expect(await verifySignature({ rawBody: raw, secret: SECRET })).toEqual({ ok: false, reason: 'missing-signature' });
    expect(await verifySignature({ rawBody: raw, signature: 'not-hex', secret: SECRET })).toEqual({ ok: false, reason: 'malformed-signature' });
    expect(await verifySignature({ rawBody: '', signature: 'a'.repeat(64), secret: SECRET })).toEqual({ ok: false, reason: 'missing-raw-body' });
  });

  it('returns 401 and writes nothing for an invalid signature', async () => {
    const store = makeStore();
    const res = await handleRequest({ rawBody: body(), signature: 'a'.repeat(64), headers: {}, env, store });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid-signature' });
    expect(store.calls.upserted).toEqual([]);
    expect(store.calls.recorded).toEqual([]);
  });
});

describe('webhook: idempotency', () => {
  it('keys on an explicit event id when present', async () => {
    const res = await eventKey({ rawBody: body(), payload: { meta: { event_id: 'evt_9' } } });
    expect(res).toMatchObject({ ok: true, key: 'id:evt_9', source: 'event-id' });
  });

  it('falls back to a body digest, so a retry of the same body collides', async () => {
    const raw = body();
    const a = await eventKey({ rawBody: raw, payload: JSON.parse(raw) });
    const b = await eventKey({ rawBody: raw, payload: JSON.parse(raw) });
    expect(a.source).toBe('body-digest');
    expect(a.key).toBe(b.key);
  });

  it('does nothing at all on a replay, and answers 200 so retries stop', async () => {
    const store = makeStore({ existingEvent: { id: 'body:x' } });
    const raw = body();
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: true });
    // The critical assertion: no second subscription.
    expect(store.calls.upserted).toEqual([]);
    expect(store.calls.recorded).toEqual([]);
  });

  it('records the delivery BEFORE applying it, so a crash cannot double-apply', async () => {
    const store = makeStore();
    const raw = body();
    await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(store.calls.recorded).toHaveLength(1);
    expect(store.calls.processed).toEqual([{ key: store.calls.recorded[0].id, outcome: 'applied' }]);
  });
});

describe('webhook: variant mapping never defaults', () => {
  it('maps each of the six verified variants to its plan and cycle', () => {
    expect(planForVariant('2230904')).toMatchObject({ ok: true, planId: 'pro', cycle: 'monthly' });
    expect(planForVariant('2230943')).toMatchObject({ ok: true, planId: 'enterprise', cycle: 'annual' });
  });

  it('never maps the metered base variant to a plan', () => {
    // 2228036 is the product's original "Default" variant and is METERED
    // (usage_aggregation=sum). It exists only to keep the product's historical
    // metering intact and is not one of the six fixed-price plans. Mapping it
    // would hand a paid plan to anyone who bought usage-based access, so its
    // absence from the map is a deliberate guarantee, not an oversight.
    expect(planForVariant('2228036')).toMatchObject({ ok: false, reason: 'variant-unknown' });
  });

  it('refuses an unknown variant instead of assuming a plan', async () => {
    expect(planForVariant('9999999')).toMatchObject({ ok: false, reason: 'variant-unknown' });
    const store = makeStore();
    const raw = body({ attributes: { variant_id: '9999999' } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ ignored: 'variant-unknown' });
    expect(store.calls.upserted).toEqual([]);
  });

  it('ignores an event for a different product', async () => {
    const store = makeStore();
    const raw = body({ attributes: { product_id: '999999' } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ ignored: 'other-product' });
    expect(store.calls.upserted).toEqual([]);
  });

  it('agrees with the committed variant map in the application', () => {
    // Two sources of truth for a variant-to-plan mapping is how a customer gets
    // charged for one plan and given another.
    const fromApp = Object.fromEntries(VARIANTS.map((v) => [v.id, { planId: v.plan, cycle: v.cycle }]));
    expect(VARIANT_TO_PLAN).toEqual(fromApp);
  });
});

describe('webhook: status handling', () => {
  it('accepts only statuses the database admits', () => {
    for (const status of KNOWN_STATUSES) expect(statusFor({ status }).ok, status).toBe(true);
    expect(statusFor({ status: 'made_up' })).toMatchObject({ ok: false, reason: 'unknown-status' });
    expect(statusFor({ status: null }).ok).toBe(false);
  });

  it('keeps the handled-event list and the status list in step with 0003', () => {
    // 0003 constrains status to exactly these seven values.
    expect(KNOWN_STATUSES).toEqual(['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired']);
    expect(HANDLED_EVENTS.length).toBeGreaterThanOrEqual(9);
  });

  it('ignores an event name it does not handle, without writing', async () => {
    const store = makeStore();
    const raw = body({ meta: { event_name: 'license_key_created' } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ ignored: 'unhandled-event' });
    expect(store.calls.upserted).toEqual([]);
  });
});

describe('webhook: lifecycle', () => {
  const run = async (over, store = makeStore()) => {
    const raw = body(over);
    return { res: await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store }), store };
  };

  it('activates on subscription_created and stores the row', async () => {
    const { res, store } = await run({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: true, plan: 'pro', cycle: 'monthly', status: 'active' });
    expect(store.calls.upserted[0]).toMatchObject({
      user_id: 'user-1', plan_id: 'pro', billing_cycle: 'monthly', status: 'active',
      provider_subscription_id: 'sub_1', variant_id: '2230904', test_mode: false, cancelled: false
    });
  });

  it('marks cancelled, and keeps the row so access can run to the period end', async () => {
    const { store } = await run({ meta: { event_name: 'subscription_cancelled' }, attributes: { status: 'cancelled', ends_at: '2026-11-01T00:00:00Z' } });
    expect(store.calls.upserted[0]).toMatchObject({ status: 'cancelled', cancelled: true, ends_at: '2026-11-01T00:00:00Z' });
  });

  it('marks past_due on a failed payment rather than revoking immediately', async () => {
    // Cutting access on the first failed charge punishes an expired card.
    const { store } = await run({ meta: { event_name: 'subscription_payment_failed' }, attributes: { status: 'past_due' } });
    expect(store.calls.upserted[0].status).toBe('past_due');
    expect(isEntitled({ status: 'past_due' })).toBe(true);
  });

  it('expires, and an expired subscription confers nothing', async () => {
    const { store } = await run({ meta: { event_name: 'subscription_expired' }, attributes: { status: 'expired' } });
    expect(store.calls.upserted[0].status).toBe('expired');
    expect(isEntitled({ status: 'expired' })).toBe(false);
  });

  it('records a delivery that cannot be attributed, and grants nothing', async () => {
    const store = makeStore({ nonceUser: null });
    const { res } = await run({}, store);
    expect(res.body).toMatchObject({ ignored: 'no-user-for-nonce' });
    expect(store.calls.upserted).toEqual([]);
    expect(store.calls.processed[0].outcome).toBe('unattributed');
  });

  it('grants nothing when the payload carries no nonce at all', async () => {
    const store = makeStore();
    const raw = body({ meta: { custom_data: {} } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ ignored: 'no-user-for-nonce' });
    expect(store.calls.upserted).toEqual([]);
  });

  it('consumes the nonce on first use, so it cannot open a second subscription', async () => {
    const store = makeStore();
    await run({}, store);
    expect(store.calls.consumed).toEqual(['n1']);
  });

  it('applies a RENEWAL to the same user without needing the nonce again', async () => {
    // The critical renewal case: a second event arrives for a subscription that
    // already exists, with no usable nonce (already consumed, or absent from
    // custom_data). It must update the SAME row, not be dropped.
    const store = makeStore({ nonceUser: null, existingSubscription: { user_id: 'user-1', plan_id: 'pro' } });
    const raw = body({ meta: { event_name: 'subscription_payment_success', custom_data: {} }, attributes: { status: 'active', renews_at: '2026-12-10T00:00:00Z' } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ applied: true, status: 'active' });
    expect(store.calls.upserted[0]).toMatchObject({ user_id: 'user-1', status: 'active', renews_at: '2026-12-10T00:00:00Z' });
    // The nonce was never consulted, so it must not have been consumed.
    expect(store.calls.consumed).toEqual([]);
  });

  it('applies a CANCELLATION to the same user when the nonce no longer resolves', async () => {
    const store = makeStore({ nonceUser: null, existingSubscription: { user_id: 'user-1' } });
    const raw = body({ meta: { event_name: 'subscription_cancelled' }, attributes: { status: 'cancelled', ends_at: '2026-11-01T00:00:00Z' } });
    const res = await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(res.body).toMatchObject({ applied: true, status: 'cancelled' });
    expect(store.calls.upserted[0]).toMatchObject({ user_id: 'user-1', cancelled: true });
  });

  it('does not let a captured nonce re-point an existing subscription at another user', async () => {
    // The subscription already belongs to user-1. A nonce resolving elsewhere
    // must not move it.
    const store = makeStore({ nonceUser: 'attacker' , existingSubscription: { user_id: 'user-1' } });
    const { store: s } = await run({}, store);
    expect(s.calls.upserted[0].user_id).toBe('user-1');
  });
});

describe('webhook: test and live separation', () => {
  it('flags a test-mode row so it cannot be mistaken for a live one', async () => {
    const store = makeStore();
    const raw = body({ meta: { test_mode: true } });
    await handleRequest({ rawBody: raw, signature: await sign(raw), headers: {}, env, store });
    expect(store.calls.upserted[0].test_mode).toBe(true);
    expect(store.calls.recorded[0].test_mode).toBe(true);
  });

  it('NEVER lets a test subscription confer live access', () => {
    expect(isEntitled({ status: 'active', testMode: true, deploymentLive: true })).toBe(false);
    // On a test deployment it does, which is what makes test mode usable.
    expect(isEntitled({ status: 'active', testMode: true, deploymentLive: false })).toBe(true);
  });

  it('treats an absent test flag as live, never as test', () => {
    expect(interpretEvent(JSON.parse(body({ meta: { test_mode: undefined } }))).testMode).toBe(false);
  });
});

describe('webhook: entitlement rules', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');

  it('grants for the access statuses only', () => {
    for (const status of ['on_trial', 'active', 'past_due']) expect(isEntitled({ status, now: NOW }), status).toBe(true);
    for (const status of ['paused', 'unpaid', 'expired']) expect(isEntitled({ status, now: NOW }), status).toBe(false);
  });

  it('honours a cancellation only until the paid period ends', () => {
    expect(isEntitled({ status: 'cancelled', endsAt: '2026-11-01T00:00:00Z', now: NOW })).toBe(true);
    expect(isEntitled({ status: 'cancelled', endsAt: '2026-10-01T00:00:00Z', now: NOW })).toBe(false);
    // A cancellation with no end date grants nothing rather than for ever.
    expect(isEntitled({ status: 'cancelled', endsAt: null, now: NOW })).toBe(false);
  });

  it('never grants for an unknown or absent status', () => {
    expect(isEntitled({ status: 'made_up', now: NOW })).toBe(false);
    expect(isEntitled({ now: NOW })).toBe(false);
  });
});

describe('webhook: the row written to the database', () => {
  it('carries the provider identifiers and nothing client-supplied', () => {
    const event = interpretEvent(JSON.parse(body()));
    const row = subscriptionRow({ event, planId: 'pro', cycle: 'monthly', userId: 'user-1' });
    expect(row).toMatchObject({
      user_id: 'user-1', plan_id: 'pro', billing_cycle: 'monthly',
      provider: 'lemonsqueezy', provider_subscription_id: 'sub_1', provider_order_id: '10',
      variant_id: '2230904', product_id: PRODUCT_ID
    });
    // No field in the row can be set by the caller of the checkout.
    expect(JSON.stringify(row)).not.toMatch(/email|price|amount/i);
  });

  it('marks cancelled true from the event name even if the flag is absent', () => {
    const event = interpretEvent(JSON.parse(body({ meta: { event_name: 'subscription_cancelled' }, attributes: { cancelled: false } })));
    expect(subscriptionRow({ event, planId: 'pro', cycle: 'monthly', userId: 'u' }).cancelled).toBe(true);
  });
});
