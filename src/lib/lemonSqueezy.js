/* Lemon Squeezy subscription provider adapter.
 *
 * WHAT THIS IS. A tested, provider-shaped adapter for the hosted-checkout +
 * webhook pattern: build a checkout URL, verify the webhook signature, map the
 * provider's events and subscription statuses onto this application's plans,
 * and decide entitlement. Every function here is pure, so all of it is testable
 * without a live store.
 *
 * WHAT THIS IS NOT. It contains NO real IDs, NO secrets, NO prices and NO store
 * slug. Those live in the store and are supplied as configuration. Any function
 * that would need one and does not have it FAILS CLOSED rather than guessing —
 * a hard-coded variant id that happens to belong to another app is how a
 * customer pays for the wrong thing.
 *
 * THE FOUR RULES THIS ENCODES, because each is a way real integrations get
 * breached:
 *
 *   1. A SUCCESS REDIRECT GRANTS NOTHING. The browser landing on a thank-you
 *      page is not evidence of payment; it is a query string a user can type.
 *      Only a signature-verified webhook changes subscription state.
 *
 *   2. ATTRIBUTION COMES FROM A SERVER-MINTED NONCE, NEVER FROM THE CLIENT.
 *      The checkout URL carries an opaque nonce in `checkout[custom][nonce]`.
 *      A pending-checkout row is the only thing that maps that nonce to a user
 *      id, so a forged or replayed nonce resolves to nothing. Passing a raw
 *      `user_id` through the URL would let anyone grant themselves a plan.
 *
 *   3. TEST EVENTS NEVER GRANT LIVE ACCESS. `meta.test_mode` is recorded with
 *      the subscription, and a test subscription confers no live entitlement.
 *
 *   4. EVERY EVENT IS IDEMPOTENT. The provider retries; a retry must not create
 *      a second subscription or extend a period twice.
 */

import { verifyWebhookSignature } from './billing.js';

/* ------------------------------------------------------------------- config */

/**
 * Configuration that must come from the real store. Listed explicitly so the
 * absence of a value is a named error rather than a silent `undefined` in a URL.
 */
export const REQUIRED_CONFIG = ['storeId', 'storeSlug', 'webhookSecret'];

/**
 * Validate provider configuration. Returns every missing field at once so the
 * operator fixes one list instead of discovering them one deploy at a time.
 */
export function validateConfig(config = {}) {
  const missing = REQUIRED_CONFIG.filter((key) => {
    const value = config[key];
    return value == null || String(value).trim() === '';
  });
  // The checkout origin is derived, but an explicit override must be sane.
  if (config.checkoutOrigin != null && !/^https:\/\/[a-z0-9.-]+$/i.test(String(config.checkoutOrigin))) {
    return { ok: false, missing, reason: 'checkout-origin-must-be-https-host' };
  }
  return { ok: missing.length === 0, missing, reason: missing.length ? 'missing-config' : null };
}

/** The checkout origin for a store slug. No slug means no URL, not a guess. */
export function checkoutOrigin({ storeSlug, checkoutOrigin: override } = {}) {
  if (override) return String(override).replace(/\/+$/, '');
  const slug = String(storeSlug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  return `https://${slug}.lemonsqueezy.com`;
}

/* ----------------------------------------------------- plan ↔ variant mapping */

/**
 * The mapping from (plan, cycle) to a variant id in the store.
 *
 * Supplied as data, because the ids only exist in the store. An unmapped pair is
 * REFUSED — never defaulted to a "closest" plan, which is how a customer gets
 * charged for something they did not choose.
 */
export const MAPPING_ERRORS = {
  variant_not_mapped: 'This plan and billing cycle have no variant in the store.',
  variant_unknown: 'The webhook named a variant this build does not recognise.',
  cycle_not_supported: 'That billing cycle is not offered.',
  plan_not_purchasable: 'This plan is not sold through checkout.'
};

const key = (planId, cycle) => `${planId}:${cycle}`;

/** Build a lookup from a plain `{ 'pro:monthly': '<variantId>' }` map. */
export function buildVariantMap(mapping = {}) {
  const forward = new Map();
  const reverse = new Map();
  for (const [pair, variantId] of Object.entries(mapping)) {
    if (!pair.includes(':') || variantId == null || String(variantId).trim() === '') continue;
    const normalised = String(variantId).trim();
    forward.set(pair, normalised);
    // A variant that maps to two plans is a configuration bug: refuse it rather
    // than letting the last write win.
    if (reverse.has(normalised) && reverse.get(normalised) !== pair) {
      reverse.set(normalised, null);
    } else {
      reverse.set(normalised, pair);
    }
  }
  return { forward, reverse };
}

/** The variant id for a plan and cycle, or a named refusal. */
export function variantFor(map, planId, cycle) {
  if (!planId || !cycle) return { ok: false, reason: 'missing-input' };
  const pair = key(planId, cycle);
  const variantId = map.forward.get(pair);
  if (!variantId) return { ok: false, reason: 'variant_not_mapped', pair };
  return { ok: true, variantId, pair };
}

/** Which plan and cycle a webhook's variant id belongs to, or a refusal. */
export function planForVariant(map, variantId) {
  const id = String(variantId ?? '').trim();
  if (!id) return { ok: false, reason: 'missing-input' };
  const pair = map.reverse.get(id);
  if (pair == null) return { ok: false, reason: 'variant_unknown', variantId: id };
  const [planId, cycle] = pair.split(':');
  return { ok: true, planId, cycle, pair };
}

/* ------------------------------------------------------------- checkout URL */

/**
 * Build a hosted-checkout URL.
 *
 * Deliberately takes `nonce` rather than a user id: the URL is user-visible and
 * user-editable, so it must carry something that is worthless to forge. The
 * server resolves the nonce to a user when the webhook arrives.
 */
export function buildCheckoutUrl({
  storeSlug,
  checkoutOrigin: override,
  variantId,
  nonce,
  email = null,
  name = null,
  discountCode = null,
  redirectUrl = null,
  testMode = false,
  media = false
} = {}) {
  const origin = checkoutOrigin({ storeSlug, checkoutOrigin: override });
  if (!origin) return { ok: false, reason: 'invalid-store-slug' };
  const variant = String(variantId ?? '').trim();
  if (!variant) return { ok: false, reason: 'missing-variant-id' };
  if (!nonce) return { ok: false, reason: 'missing-nonce' };

  const url = new URL(`${origin}/checkout/buy/${encodeURIComponent(variant)}`);
  // Passthrough data, echoed back on the webhook as meta.custom_data.
  url.searchParams.set('checkout[custom][nonce]', String(nonce));
  url.searchParams.set('checkout[embed]', '0');
  if (email) url.searchParams.set('checkout[email]', String(email));
  if (name) url.searchParams.set('checkout[name]', String(name));
  if (discountCode) url.searchParams.set('checkout[discount_code]', String(discountCode));
  if (redirectUrl) url.searchParams.set('checkout[redirect_url]', String(redirectUrl));
  // `media=1` shows the store's own product art; `logo=0` keeps ours.
  url.searchParams.set('logo', '0');
  if (media) url.searchParams.set('media', '1');
  url.searchParams.set('test', testMode ? '1' : '0');

  return { ok: true, url: url.toString(), testMode: !!testMode, variantId: variant, nonce: String(nonce) };
}

/* -------------------------------------------------------- subscription model */

/** The provider's subscription statuses. */
export const SUBSCRIPTION_STATUSES = [
  'on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'
];

/** Statuses that confer paid access while they hold. */
export const ACCESS_STATUSES = ['on_trial', 'active', 'past_due'];

/**
 * Statuses that never confer access, and why — recorded so a support agent does
 * not have to infer it from a status string.
 */
export const NO_ACCESS_REASON = {
  paused: 'Subscription is paused; access is suspended until it resumes.',
  unpaid: 'Payment was not collected; access is withheld.',
  cancelled: 'Cancelled. Access continues only until the paid period ends.',
  expired: 'The paid period has ended.'
};

/**
 * Does this subscription confer paid access right now?
 *
 * `cancelled` is the subtle one: a cancellation is not an expiry. The customer
 * paid through the end of the period, so access continues until `endsAt`.
 * Revoking on the cancel event is a refund the customer did not ask for.
 */
export function entitlementFor({
  status,
  endsAt = null,
  renewsAt = null,
  now = new Date(),
  graceDays = 0,
  testMode = false,
  liveMode = true
} = {}) {
  if (testMode && liveMode) {
    return { paid: false, reason: 'test-subscription-confers-no-live-access', expiresAt: null };
  }
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    return { paid: false, reason: 'unknown-status', expiresAt: null };
  }
  if (!ACCESS_STATUSES.includes(status)) {
    // A cancelled subscription keeps access until the period it already paid for.
    if (status === 'cancelled' && endsAt) {
      const until = new Date(endsAt).getTime() + graceDays * 86_400_000;
      return {
        paid: new Date(now).getTime() < until,
        reason: new Date(now).getTime() < until ? 'cancelled-but-still-paid' : 'period-ended',
        expiresAt: new Date(until).toISOString()
      };
    }
    return { paid: false, reason: NO_ACCESS_REASON[status] || 'no-access', expiresAt: null };
  }

  // An active status with a lapsed date is lapsed: a missed webhook must not
  // extend access indefinitely.
  const horizon = endsAt ? new Date(endsAt) : renewsAt ? new Date(renewsAt) : null;
  if (horizon) {
    const until = horizon.getTime() + graceDays * 86_400_000;
    const within = new Date(now).getTime() < until;
    return { paid: within, reason: within ? 'within-period' : 'period-lapsed', expiresAt: new Date(until).toISOString() };
  }
  return { paid: true, reason: 'no-end-date-recorded', expiresAt: null };
}

/* ------------------------------------------------------------- webhook events */

/** Event names this adapter understands. Anything else is acknowledged and ignored. */
export const WEBHOOK_EVENTS = [
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
  'subscription_payment_failed',
  'subscription_payment_recovered',
  'subscription_payment_refunded',
  'order_created',
  'order_refunded',
  'license_key_created'
];

/** Events that can change entitlement. The rest are informational. */
export const ENTITLEMENT_EVENTS = WEBHOOK_EVENTS.filter((e) => e.startsWith('subscription_'));

/**
 * Verify a Lemon Squeezy webhook.
 *
 * HMAC-SHA256 over the RAW body, hex, in the `X-Signature` header. The raw body
 * matters: re-serialising parsed JSON changes key order and whitespace and the
 * signature will not match.
 */
export async function verifyWebhook({ rawBody, signature, secret } = {}) {
  if (!rawBody) return { ok: false, reason: 'missing-raw-body' };
  const res = await verifyWebhookSignature({ payload: rawBody, signature, secret, algorithm: 'SHA-256' });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, algorithm: 'SHA-256' };
}

/**
 * A stable key for idempotency.
 *
 * Prefers an explicit event id when the payload carries one; otherwise falls
 * back to a digest of the raw body, which is stable for a given delivery and
 * therefore still de-duplicates a retry.
 */
export async function eventKey({ payload = null, rawBody = null, headers = {} } = {}) {
  const explicit =
    payload?.meta?.event_id ??
    payload?.meta?.id ??
    headers['x-event-id'] ??
    headers['X-Event-Id'] ??
    null;
  if (explicit != null) return { ok: true, key: `id:${explicit}`, source: 'event-id' };

  const body = rawBody ?? (payload ? JSON.stringify(payload) : null);
  if (!body) return { ok: false, reason: 'missing-payload' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { ok: true, key: `body:${hex}`, source: 'body-digest' };
}

/**
 * Normalise a webhook payload into the shape the rest of the app uses.
 * Returns a refusal rather than a half-populated object when the payload does
 * not look like a webhook, so a malformed delivery cannot write bad state.
 */
export function normaliseEvent(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'not-an-object' };
  const name = payload?.meta?.event_name;
  if (!name) return { ok: false, reason: 'missing-event-name' };

  const resource = payload?.data;
  const attributes = resource?.attributes || {};
  const custom = payload?.meta?.custom_data || {};

  return {
    ok: true,
    name,
    known: WEBHOOK_EVENTS.includes(name),
    affectsEntitlement: ENTITLEMENT_EVENTS.includes(name),
    // The EVENT's mode. Whether the DEPLOYMENT is live is a separate input:
    // conflating them meant a test delivery to a live app granted access,
    // because a test event also looked like a non-live deployment.
    testMode: payload?.meta?.test_mode === true,
    storeId: attributes.store_id != null ? String(attributes.store_id) : null,
    subscriptionId: resource?.type === 'subscriptions' ? String(resource.id) : null,
    orderId: attributes.order_id != null ? String(attributes.order_id) : resource?.type === 'orders' ? String(resource.id) : null,
    customerId: attributes.customer_id != null ? String(attributes.customer_id) : null,
    variantId: attributes.variant_id != null ? String(attributes.variant_id) : null,
    productId: attributes.product_id != null ? String(attributes.product_id) : null,
    status: attributes.status || null,
    renewsAt: attributes.renews_at || null,
    endsAt: attributes.ends_at || null,
    trialEndsAt: attributes.trial_ends_at || null,
    cancelled: attributes.cancelled === true,
    currency: attributes.currency || null,
    total: attributes.total != null ? attributes.total : null,
    // The one field that ties the event to a user, and it is opaque by design.
    nonce: custom.nonce != null ? String(custom.nonce) : null,
    customData: custom
  };
}

/**
 * What a webhook should change.
 *
 * Pure: it says what SHOULD happen so the caller records it, rather than
 * performing side effects that a test cannot observe.
 */
export function planChangeFor(event, { variantMap, now = new Date(), graceDays = 0, deploymentLive = true } = {}) {
  if (!event?.ok) return { ok: false, reason: 'invalid-event' };
  if (!event.affectsEntitlement) {
    return { ok: true, action: 'record-only', reason: 'not-an-entitlement-event', name: event.name };
  }

  const mapped = event.variantId ? planForVariant(variantMap, event.variantId) : { ok: false, reason: 'variant_unknown' };
  if (!mapped.ok) {
    // An unknown variant is refused, not defaulted. A default here would grant
    // access for a product this build has never heard of.
    return { ok: false, reason: mapped.reason, variantId: event.variantId };
  }

  const entitlement = entitlementFor({
    status: event.status,
    endsAt: event.endsAt,
    renewsAt: event.renewsAt,
    now,
    graceDays,
    testMode: event.testMode,
    // The deployment's mode, NOT the event's — see the comment in normaliseEvent.
    liveMode: deploymentLive
  });

  const actionByEvent = {
    subscription_created: 'activate',
    subscription_resumed: 'resume',
    subscription_unpaused: 'resume',
    subscription_updated: 'update',
    subscription_paused: 'pause',
    subscription_cancelled: 'cancel',
    subscription_expired: 'expire',
    subscription_payment_failed: 'mark-past-due',
    subscription_payment_success: 'update',
    subscription_payment_recovered: 'restore',
    subscription_payment_refunded: 'revoke'
  };

  return {
    ok: true,
    action: actionByEvent[event.name] || 'update',
    planId: mapped.planId,
    cycle: mapped.cycle,
    pair: mapped.pair,
    status: event.status,
    paid: entitlement.paid,
    entitlementReason: entitlement.reason,
    expiresAt: entitlement.expiresAt,
    testMode: event.testMode,
    subscriptionId: event.subscriptionId,
    nonce: event.nonce
  };
}

/* ------------------------------------------------- pending checkout (server) */

/**
 * A pending checkout is the ONLY thing that maps a checkout back to a user.
 *
 * Stored server-side with a short life, single use, and bound to the plan the
 * user chose so a tampered URL cannot resolve to a different plan.
 */
export const CHECKOUT_TTL_MS = 60 * 60 * 1000;

export function createPendingCheckout({ nonce, userId, planId, cycle, variantId, at = new Date(), ttlMs = CHECKOUT_TTL_MS, testMode = false }) {
  if (!nonce) return { ok: false, reason: 'missing-nonce' };
  if (!userId) return { ok: false, reason: 'missing-user' };
  if (!planId || !cycle) return { ok: false, reason: 'missing-plan' };
  if (!variantId) return { ok: false, reason: 'missing-variant-id' };
  return {
    ok: true,
    record: {
      nonce: String(nonce),
      userId: String(userId),
      planId,
      cycle,
      variantId: String(variantId),
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(new Date(at).getTime() + ttlMs).toISOString(),
      consumedAt: null,
      testMode: !!testMode
    }
  };
}

/**
 * Resolve a webhook's nonce to the user and plan that created it.
 *
 * Refuses an unknown, expired, consumed or already-reversed nonce. A nonce that
 * has already been consumed is refused rather than re-consumed, so replaying a
 * captured webhook cannot re-activate a cancelled subscription.
 */
export function resolvePendingCheckout(record, { nonce, now = new Date(), variantId = null } = {}) {
  if (!record) return { ok: false, reason: 'unknown-nonce' };
  if (record.nonce !== String(nonce)) return { ok: false, reason: 'nonce-mismatch' };
  if (record.consumedAt) return { ok: false, reason: 'nonce-already-consumed' };
  if (new Date(record.expiresAt).getTime() <= new Date(now).getTime()) return { ok: false, reason: 'nonce-expired' };
  // The variant must be the one the user was actually quoted.
  if (variantId != null && String(variantId) !== String(record.variantId)) {
    return { ok: false, reason: 'variant-does-not-match-checkout' };
  }
  return { ok: true, userId: record.userId, planId: record.planId, cycle: record.cycle, variantId: record.variantId };
}

/* --------------------------------------------------------- redirect handling */

/**
 * The success redirect is a UI hint ONLY.
 * It deliberately returns no entitlement, because the query string is
 * user-editable and proves nothing.
 */
export function interpretRedirect({ status = null } = {}) {
  return {
    entitlement: false,
    reason: 'redirect-is-not-payment-evidence',
    ui: status === 'success' ? 'show-processing' : 'show-retry',
    note: 'Access is granted only when a signature-verified webhook is processed.'
  };
}
