import { describe, it, expect } from 'vitest';
import {
  REQUIRED_CONFIG, validateConfig, checkoutOrigin, buildVariantMap, variantFor, planForVariant,
  buildCheckoutUrl, SUBSCRIPTION_STATUSES, ACCESS_STATUSES, NO_ACCESS_REASON,
  entitlementFor, WEBHOOK_EVENTS, ENTITLEMENT_EVENTS, verifyWebhook, eventKey,
  normaliseEvent, planChangeFor, CHECKOUT_TTL_MS, createPendingCheckout,
  resolvePendingCheckout, interpretRedirect
} from './lemonSqueezy.js';
import { PLANS, planById } from './billing.js';

/* Lemon Squeezy adapter. No real IDs, secrets or store slug appear here: the
 * whole point is that those are configuration, and an unmapped value fails
 * closed rather than defaulting. */

const SECRET = 'whsec_not_a_real_secret';
const CONFIG = { storeId: 'config-store-id', storeSlug: 'cryptox', webhookSecret: SECRET };
const MAP = buildVariantMap({
  'pro:monthly': 'v-pro-m', 'pro:annual': 'v-pro-a',
  'business:monthly': 'v-business-m', 'business:annual': 'v-business-a',
  'enterprise:monthly': 'v-ent-m', 'enterprise:annual': 'v-ent-a'
});

const sign = async (body, secret = SECRET) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const webhook = (over = {}) => ({
  meta: { event_name: 'subscription_created', test_mode: false, custom_data: { nonce: 'n1' }, ...(over.meta || {}) },
  data: {
    type: 'subscriptions',
    id: 'sub_1',
    attributes: { store_id: 1, order_id: 10, customer_id: 5, variant_id: 'v-pro-m', product_id: 2, status: 'active', renews_at: '2026-11-10T00:00:00Z', ends_at: null, currency: 'USD', total: 29, ...(over.attributes || {}) }
  }
});

describe('lemonsqueezy: configuration fails closed', () => {
  it('names every missing required field at once', () => {
    const res = validateConfig({});
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(REQUIRED_CONFIG);
    expect(res.reason).toBe('missing-config');
  });

  it('accepts a complete configuration', () => {
    expect(validateConfig(CONFIG)).toMatchObject({ ok: true, missing: [] });
  });

  it('treats a blank string as missing, not as present', () => {
    expect(validateConfig({ ...CONFIG, webhookSecret: '   ' }).missing).toEqual(['webhookSecret']);
  });

  it('refuses a non-https checkout origin', () => {
    expect(validateConfig({ ...CONFIG, checkoutOrigin: 'http://evil.test' }).reason).toBe('checkout-origin-must-be-https-host');
    expect(validateConfig({ ...CONFIG, checkoutOrigin: 'https://cryptox.lemonsqueezy.com' }).ok).toBe(true);
  });

  it('derives the origin from the store slug, and refuses a bad slug', () => {
    expect(checkoutOrigin({ storeSlug: 'cryptox' })).toBe('https://cryptox.lemonsqueezy.com');
    expect(checkoutOrigin({ storeSlug: 'My Store!' })).toBeNull();
    expect(checkoutOrigin({ storeSlug: '' })).toBeNull();
    expect(checkoutOrigin({ storeSlug: 'x', checkoutOrigin: 'https://custom.test/' })).toBe('https://custom.test');
  });
});

describe('lemonsqueezy: plan to variant mapping', () => {
  it('maps a plan and cycle to its variant', () => {
    expect(variantFor(MAP, 'pro', 'monthly')).toMatchObject({ ok: true, variantId: 'v-pro-m', pair: 'pro:monthly' });
    expect(variantFor(MAP, 'business', 'annual').variantId).toBe('v-business-a');
  });

  it('refuses an unmapped pair rather than defaulting to a closest plan', () => {
    // A default here charges a customer for something they did not choose.
    const res = variantFor(MAP, 'free', 'monthly');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('variant_not_mapped');
  });

  it('resolves a variant back to its plan', () => {
    expect(planForVariant(MAP, 'v-business-a')).toMatchObject({ ok: true, planId: 'business', cycle: 'annual' });
  });

  it('refuses a variant this build does not know', () => {
    expect(planForVariant(MAP, 'v-someone-elses')).toMatchObject({ ok: false, reason: 'variant_unknown' });
    expect(planForVariant(MAP, '')).toMatchObject({ ok: false, reason: 'missing-input' });
  });

  it('refuses a variant that maps to two different plans', () => {
    // An ambiguous mapping must not resolve by last-write-wins.
    const ambiguous = buildVariantMap({ 'pro:monthly': 'v-shared', 'business:monthly': 'v-shared' });
    expect(planForVariant(ambiguous, 'v-shared').ok).toBe(false);
    expect(planForVariant(ambiguous, 'v-shared').reason).toBe('variant_unknown');
  });

  it('ignores blank and malformed mapping entries', () => {
    const messy = buildVariantMap({ 'pro:monthly': 'v1', malformed: 'v2', 'business:monthly': '   ' });
    expect(messy.forward.size).toBe(1);
    expect(variantFor(messy, 'pro', 'monthly').ok).toBe(true);
  });
});

describe('lemonsqueezy: checkout URL carries a nonce, not a user id', () => {
  const build = (over = {}) => buildCheckoutUrl({ storeSlug: 'cryptox', variantId: 'v-pro-m', nonce: 'n1', ...over });

  it('builds a hosted checkout URL for the variant', () => {
    const res = build();
    expect(res.ok).toBe(true);
    expect(res.url).toContain('https://cryptox.lemonsqueezy.com/checkout/buy/v-pro-m');
    expect(res.url).toContain('checkout%5Bcustom%5D%5Bnonce%5D=n1');
  });

  it('never puts a user id, plan or price in the URL', () => {
    // The URL is user-editable, so it must carry nothing worth forging.
    const url = build({ email: 'ali@example.com' }).url;
    expect(url).not.toMatch(/user_id|userId|plan=|price=/);
    expect(url).toContain('checkout%5Bcustom%5D%5Bnonce%5D=n1');
  });

  it('passes email, discount and redirect through when given', () => {
    const url = build({ email: 'ali@example.com', discountCode: 'LAUNCH', redirectUrl: 'https://cryptox-v2.site.accio.ai/#/billing' }).url;
    expect(url).toContain('checkout%5Bemail%5D=ali%40example.com');
    expect(url).toContain('checkout%5Bdiscount_code%5D=LAUNCH');
    expect(url).toContain('checkout%5Bredirect_url%5D=');
  });

  it('flags test mode so a live customer never lands in a test checkout', () => {
    expect(build({ testMode: true }).url).toContain('test=1');
    expect(build({ testMode: false }).url).toContain('test=0');
  });

  it('refuses to build without a nonce or a variant', () => {
    expect(buildCheckoutUrl({ storeSlug: 'cryptox', variantId: 'v' }).reason).toBe('missing-nonce');
    expect(buildCheckoutUrl({ storeSlug: 'cryptox', nonce: 'n' }).reason).toBe('missing-variant-id');
    expect(buildCheckoutUrl({ variantId: 'v', nonce: 'n' }).reason).toBe('invalid-store-slug');
  });
});

describe('lemonsqueezy: entitlement by status', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');

  it('grants access for the active statuses', () => {
    for (const status of ACCESS_STATUSES) {
      const res = entitlementFor({ status, renewsAt: '2026-11-10T00:00:00Z', now: NOW });
      expect(res.paid, status).toBe(true);
    }
    expect(ACCESS_STATUSES).toEqual(['on_trial', 'active', 'past_due']);
  });

  it('withholds access for paused, unpaid and expired', () => {
    for (const status of ['paused', 'unpaid', 'expired']) {
      const res = entitlementFor({ status, renewsAt: '2026-11-10T00:00:00Z', now: NOW });
      expect(res.paid, status).toBe(false);
      expect(res.reason, status).toBeTruthy();
    }
    // past_due is deliberately granting: dunning is in progress, so cutting
    // access on the first failed charge punishes an expired card.
    expect(entitlementFor({ status: 'past_due', renewsAt: '2026-11-10T00:00:00Z', now: NOW }).paid).toBe(true);
  });

  it('keeps access after a cancellation until the paid period ends', () => {
    // Revoking on the cancel event refunds time the customer already paid for.
    const stillPaid = entitlementFor({ status: 'cancelled', endsAt: '2026-10-20T00:00:00Z', now: NOW });
    expect(stillPaid).toMatchObject({ paid: true, reason: 'cancelled-but-still-paid' });

    const over = entitlementFor({ status: 'cancelled', endsAt: '2026-10-01T00:00:00Z', now: NOW });
    expect(over).toMatchObject({ paid: false, reason: 'period-ended' });
  });

  it('honours a grace period', () => {
    const lapsed = { status: 'active', renewsAt: '2026-10-08T00:00:00Z', now: NOW };
    expect(entitlementFor(lapsed).paid).toBe(false);
    expect(entitlementFor({ ...lapsed, graceDays: 3 }).paid).toBe(true);
  });

  it('does not extend access forever when no end date is recorded', () => {
    // A missed webhook must not produce an eternal subscription.
    const res = entitlementFor({ status: 'active', now: NOW });
    expect(res).toMatchObject({ paid: true, reason: 'no-end-date-recorded' });
    // An active status with a lapsed horizon is lapsed, whatever the status says.
    expect(entitlementFor({ status: 'active', renewsAt: '2020-01-01T00:00:00Z', now: NOW }).paid).toBe(false);
  });

  it('NEVER lets a test subscription grant live access', () => {
    const res = entitlementFor({ status: 'active', renewsAt: '2026-11-10T00:00:00Z', now: NOW, testMode: true, liveMode: true });
    expect(res).toMatchObject({ paid: false, reason: 'test-subscription-confers-no-live-access' });
    // In a test deployment it does grant, which is how test mode is useful.
    expect(entitlementFor({ status: 'active', testMode: true, liveMode: false, now: NOW }).paid).toBe(true);
  });

  it('refuses an unknown status rather than guessing', () => {
    expect(entitlementFor({ status: 'made_up', now: NOW })).toMatchObject({ paid: false, reason: 'unknown-status' });
    expect(entitlementFor({ now: NOW }).paid).toBe(false);
  });

  it('explains every non-access status', () => {
    for (const status of SUBSCRIPTION_STATUSES.filter((s) => !ACCESS_STATUSES.includes(s))) {
      if (status === 'cancelled') continue; // handled by the period rule
      expect(NO_ACCESS_REASON[status], status).toBeTruthy();
    }
  });
});

describe('lemonsqueezy: webhook signature verification', () => {
  it('accepts a correct signature over the raw body', async () => {
    const raw = JSON.stringify(webhook());
    const signature = await sign(raw);
    expect(await verifyWebhook({ rawBody: raw, signature, secret: SECRET })).toEqual({ ok: true, algorithm: 'SHA-256' });
  });

  it('accepts the sha256= prefixed header form', async () => {
    const raw = JSON.stringify(webhook());
    expect((await verifyWebhook({ rawBody: raw, signature: `sha256=${await sign(raw)}`, secret: SECRET })).ok).toBe(true);
  });

  it('rejects a body changed by one byte', async () => {
    // Re-serialising parsed JSON changes key order and whitespace, which is why
    // the RAW body must be signed and verified.
    const raw = JSON.stringify(webhook());
    const signature = await sign(raw);
    const res = await verifyWebhook({ rawBody: raw.replace('subscription_created', 'subscription_cancelled'), signature, secret: SECRET });
    expect(res).toMatchObject({ ok: false, reason: 'signature-mismatch' });
  });

  it('rejects the wrong secret, and an unsigned delivery', async () => {
    const raw = JSON.stringify(webhook());
    expect((await verifyWebhook({ rawBody: raw, signature: await sign(raw, 'other'), secret: SECRET })).ok).toBe(false);
    expect((await verifyWebhook({ rawBody: raw, secret: SECRET })).ok).toBe(false);
    expect(await verifyWebhook({})).toMatchObject({ ok: false, reason: 'missing-raw-body' });
  });
});

describe('lemonsqueezy: idempotency keys', () => {
  it('prefers an explicit event id', async () => {
    const res = await eventKey({ payload: { meta: { event_id: 'evt_123' } } });
    expect(res).toMatchObject({ ok: true, key: 'id:evt_123', source: 'event-id' });
  });

  it('falls back to a stable digest of the body, so a retry still de-duplicates', async () => {
    const raw = JSON.stringify(webhook());
    const a = await eventKey({ payload: webhook(), rawBody: raw });
    const b = await eventKey({ payload: JSON.parse(raw), rawBody: raw });
    expect(a.source).toBe('body-digest');
    expect(a.key).toBe(b.key);
  });

  it('gives different deliveries different keys', async () => {
    const one = await eventKey({ rawBody: JSON.stringify(webhook()) });
    const two = await eventKey({ rawBody: JSON.stringify(webhook({ attributes: { status: 'cancelled' } })) });
    expect(one.key).not.toBe(two.key);
  });

  it('refuses with nothing to key on', async () => {
    expect((await eventKey({})).ok).toBe(false);
  });
});

describe('lemonsqueezy: event normalisation', () => {
  it('normalises a real-shaped subscription webhook', () => {
    const res = normaliseEvent(webhook());
    expect(res).toMatchObject({
      ok: true,
      name: 'subscription_created',
      known: true,
      affectsEntitlement: true,
      testMode: false,
      subscriptionId: 'sub_1',
      variantId: 'v-pro-m',
      status: 'active',
      nonce: 'n1'
    });
  });

  it('refuses a payload that is not a webhook', () => {
    expect(normaliseEvent(null)).toMatchObject({ ok: false, reason: 'not-an-object' });
    expect(normaliseEvent({})).toMatchObject({ ok: false, reason: 'missing-event-name' });
  });

  it('marks an unknown event as known:false but still normalised', () => {
    const res = normaliseEvent(webhook({ meta: { event_name: 'something_new' } }));
    expect(res).toMatchObject({ ok: true, known: false, affectsEntitlement: false });
  });

  it('records the event’s test flag, defaulting an absent flag to live', () => {
    expect(normaliseEvent(webhook({ meta: { test_mode: true } })).testMode).toBe(true);
    const noFlag = normaliseEvent({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: '1', attributes: {} } });
    expect(noFlag.testMode).toBe(false);
    // The event carries no opinion about the deployment; that is an input.
    expect(noFlag).not.toHaveProperty('liveMode');
  });

  it('distinguishes the event’s mode from the deployment’s mode', () => {
    // Conflating them meant a TEST delivery to a LIVE app granted access.
    const now = new Date('2026-10-10T00:00:00Z');
    const testEvent = normaliseEvent(webhook({ meta: { test_mode: true } }));

    const liveResult = planChangeFor(testEvent, { variantMap: MAP, now, deploymentLive: true });
    expect(liveResult).toMatchObject({ ok: true, testMode: true, paid: false });

    const testResult = planChangeFor(testEvent, { variantMap: MAP, now, deploymentLive: false });
    expect(testResult.paid).toBe(true);
  });

  it('reads the opaque nonce and never a user id', () => {
    const res = normaliseEvent(webhook({ meta: { custom_data: { nonce: 'abc', user_id: 'forged' } } }));
    expect(res.nonce).toBe('abc');
    expect(res.customData.user_id).toBe('forged'); // present in data, never trusted
  });
});

describe('lemonsqueezy: what a webhook should change', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');
  const plan = (payload, over = {}) => planChangeFor(normaliseEvent(payload), { variantMap: MAP, now: NOW, ...over });

  it('activates on subscription_created', () => {
    expect(plan(webhook())).toMatchObject({ ok: true, action: 'activate', planId: 'pro', cycle: 'monthly', paid: true, status: 'active' });
  });

  it('maps each lifecycle event to its action', () => {
    const cases = {
      subscription_resumed: 'resume',
      subscription_unpaused: 'resume',
      subscription_paused: 'pause',
      subscription_cancelled: 'cancel',
      subscription_expired: 'expire',
      subscription_payment_failed: 'mark-past-due',
      subscription_payment_recovered: 'restore',
      subscription_payment_refunded: 'revoke',
      subscription_updated: 'update'
    };
    for (const [name, action] of Object.entries(cases)) {
      const res = plan(webhook({ meta: { event_name: name } }));
      expect(res.action, name).toBe(action);
    }
  });

  it('records an informational event without changing entitlement', () => {
    const res = plan(webhook({ meta: { event_name: 'license_key_created' } }));
    expect(res).toMatchObject({ ok: true, action: 'record-only' });
  });

  it('REFUSES an unknown variant instead of granting a default plan', () => {
    // A product this build has never heard of must not confer access.
    const res = plan(webhook({ attributes: { variant_id: 'v-belongs-to-another-app' } }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('variant_unknown');
  });

  it('carries the test flag through, and grants nothing at a live deployment', () => {
    const res = plan(webhook({ meta: { test_mode: true } }));
    expect(res.testMode).toBe(true);
    expect(res.paid).toBe(false); // a test event confers no live access
  });

  it('maps a cancelled subscription to access until the period ends', () => {
    const res = plan(webhook({ meta: { event_name: 'subscription_cancelled' }, attributes: { status: 'cancelled', ends_at: '2026-10-20T00:00:00Z' } }));
    expect(res).toMatchObject({ action: 'cancel', paid: true, entitlementReason: 'cancelled-but-still-paid' });
  });

  it('refuses an event that failed normalisation', () => {
    expect(planChangeFor({ ok: false }).reason).toBe('invalid-event');
  });
});

describe('lemonsqueezy: pending checkout binds the nonce to a user', () => {
  const NOW = new Date('2026-10-10T00:00:00Z');
  const pending = createPendingCheckout({ nonce: 'n1', userId: 'u1', planId: 'pro', cycle: 'monthly', variantId: 'v-pro-m', at: NOW }).record;

  it('resolves a fresh nonce to its user and plan', () => {
    expect(resolvePendingCheckout(pending, { nonce: 'n1', now: NOW })).toMatchObject({ ok: true, userId: 'u1', planId: 'pro', cycle: 'monthly' });
  });

  it('refuses an unknown nonce', () => {
    // A forged nonce is simply not in the table, so it grants nothing.
    expect(resolvePendingCheckout(null, { nonce: 'forged', now: NOW })).toMatchObject({ ok: false, reason: 'unknown-nonce' });
    expect(resolvePendingCheckout(pending, { nonce: 'other', now: NOW })).toMatchObject({ ok: false, reason: 'nonce-mismatch' });
  });

  it('refuses an expired nonce', () => {
    const late = new Date(NOW.getTime() + CHECKOUT_TTL_MS + 1);
    expect(resolvePendingCheckout(pending, { nonce: 'n1', now: late })).toMatchObject({ ok: false, reason: 'nonce-expired' });
    const inTime = new Date(NOW.getTime() + CHECKOUT_TTL_MS - 1);
    expect(resolvePendingCheckout(pending, { nonce: 'n1', now: inTime }).ok).toBe(true);
  });

  it('refuses a consumed nonce, so a replayed webhook cannot re-activate', () => {
    const consumed = { ...pending, consumedAt: new Date(NOW).toISOString() };
    expect(resolvePendingCheckout(consumed, { nonce: 'n1', now: NOW })).toMatchObject({ ok: false, reason: 'nonce-already-consumed' });
  });

  it('refuses a variant that differs from the one quoted', () => {
    // Stops a tampered URL resolving to a different plan than the user chose.
    expect(resolvePendingCheckout(pending, { nonce: 'n1', now: NOW, variantId: 'v-team-m' }))
      .toMatchObject({ ok: false, reason: 'variant-does-not-match-checkout' });
    expect(resolvePendingCheckout(pending, { nonce: 'n1', now: NOW, variantId: 'v-pro-m' }).ok).toBe(true);
  });

  it('refuses to create a pending checkout with a missing input', () => {
    expect(createPendingCheckout({ userId: 'u1', planId: 'pro', cycle: 'monthly', variantId: 'v' }).reason).toBe('missing-nonce');
    expect(createPendingCheckout({ nonce: 'n', planId: 'pro', cycle: 'monthly', variantId: 'v' }).reason).toBe('missing-user');
    expect(createPendingCheckout({ nonce: 'n', userId: 'u1', cycle: 'monthly', variantId: 'v' }).reason).toBe('missing-plan');
    expect(createPendingCheckout({ nonce: 'n', userId: 'u1', planId: 'pro', cycle: 'monthly' }).reason).toBe('missing-variant-id');
  });
});

describe('lemonsqueezy: the success redirect grants nothing', () => {
  it('returns no entitlement for a success redirect', () => {
    // The query string is user-editable, so it proves nothing.
    const res = interpretRedirect({ status: 'success' });
    expect(res.entitlement).toBe(false);
    expect(res.reason).toBe('redirect-is-not-payment-evidence');
    expect(res.ui).toBe('show-processing');
  });

  it('tells the UI to offer a retry on a non-success redirect', () => {
    expect(interpretRedirect({ status: null }).ui).toBe('show-retry');
    expect(interpretRedirect({}).ui).toBe('show-retry');
  });
});

describe('lemonsqueezy: the plan catalogue is internally consistent', () => {
  it('only maps plans that actually exist', () => {
    for (const pair of MAP.forward.keys()) {
      const [planId, cycle] = pair.split(':');
      expect(planById(planId), planId).toBeTruthy();
      expect(['monthly', 'annual']).toContain(cycle);
    }
  });

  it('has a paid plan for every purchasable tier', () => {
    const paid = PLANS.filter((p) => !p.contactOnly && p.rank > 0);
    expect(paid.length).toBeGreaterThan(0);
    for (const plan of paid) {
      // Every purchasable plan must have both cycles available to sell.
      expect(variantFor(MAP, plan.id, 'monthly').ok, `${plan.id} monthly`).toBe(true);
      expect(variantFor(MAP, plan.id, 'annual').ok, `${plan.id} annual`).toBe(true);
    }
  });

  it('never maps the free plan to a variant, because it has no checkout', () => {
    expect(variantFor(MAP, 'free', 'monthly').ok).toBe(false);
    expect(variantFor(MAP, 'free', 'annual').ok).toBe(false);
  });
});
