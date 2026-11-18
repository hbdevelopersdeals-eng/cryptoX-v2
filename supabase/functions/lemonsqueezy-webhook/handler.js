/* Lemon Squeezy webhook receiver — pure logic, no runtime globals.
 *
 * Kept free of Deno and Node APIs on purpose so the whole flow is unit-testable
 * with an injected store. index.ts is the thin Deno wrapper that supplies the
 * real environment and Supabase client; everything that could be wrong lives
 * here, where a test can reach it.
 *
 * FAIL CLOSED, in three places:
 *   1. No signing secret configured -> reject everything. Accepting an
 *      unverifiable event would let anyone POST themselves a subscription.
 *   2. Signature does not match the RAW body -> reject. Re-serialised JSON
 *      changes key order and whitespace, so the raw bytes are what is signed.
 *   3. Anything unrecognised — unknown event, unmapped variant, unknown status —
 *      is recorded and ignored rather than guessed at.
 *
 * IDEMPOTENT. The provider retries, so the same delivery arrives repeatedly.
 * The event key is the primary key of cx_webhook_events; an insert that
 * collides means this delivery was already handled and the handler returns
 * without touching the subscription.
 */

/** Secrets the function cannot operate without. Named here so a deploy check can
 *  assert them rather than discovering the absence at 3am. */
export const REQUIRED_SECRETS = ['LEMONSQUEEZY_WEBHOOK_SECRET'];

/** Every event name this receiver understands. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = [
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
  'subscription_payment_refunded'
];

/** Statuses the database constraint admits. Must stay in step with 0003. */
export const KNOWN_STATUSES = ['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'];

/** The variant-to-plan map. Identical to src/lib/checkout.js; asserted equal by test. */
export const VARIANT_TO_PLAN = {
  2230904: { planId: 'pro', cycle: 'monthly' },
  2230911: { planId: 'pro', cycle: 'annual' },
  2230938: { planId: 'business', cycle: 'monthly' },
  2230940: { planId: 'business', cycle: 'annual' },
  2230941: { planId: 'enterprise', cycle: 'monthly' },
  2230943: { planId: 'enterprise', cycle: 'annual' }
};

export const PRODUCT_ID = '1426526';

/* ------------------------------------------------------------------ secrets */

export function checkSecrets(env = {}) {
  const missing = REQUIRED_SECRETS.filter((key) => !env[key] || String(env[key]).trim() === '');
  return { ok: missing.length === 0, missing };
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const respond = (status, body) => ({ status, headers: JSON_HEADERS, body });

/* ------------------------------------------------------------- verification */

const encoder = new TextEncoder();

/** HMAC-SHA256 over the RAW body, hex. Uses Web Crypto, present in Deno and Node. */
export async function verifySignature({ rawBody, signature, secret }) {
  if (!rawBody) return { ok: false, reason: 'missing-raw-body' };
  if (!signature) return { ok: false, reason: 'missing-signature' };
  if (!secret) return { ok: false, reason: 'missing-secret' };

  const provided = String(signature).replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: 'malformed-signature' };

  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time comparison: a length-or-content early return leaks the prefix.
  if (provided.length !== expected.length) return { ok: false, reason: 'signature-mismatch' };
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: 'signature-mismatch' };
  return { ok: true };
}

/** A stable key for idempotency: explicit id when present, else a body digest. */
export async function eventKey({ rawBody, headers = {}, payload = null }) {
  const explicit =
    payload?.meta?.event_id ??
    headers['x-event-id'] ??
    headers['X-Event-Id'] ??
    null;
  if (explicit != null) return { ok: true, key: `id:${explicit}`, source: 'event-id' };
  if (!rawBody) return { ok: false, reason: 'missing-body' };
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(rawBody));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { ok: true, key: `body:${hex}`, source: 'body-digest' };
}

/* --------------------------------------------------------------- normalising */

export function interpretEvent(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'not-an-object' };
  const name = payload?.meta?.event_name;
  if (!name) return { ok: false, reason: 'missing-event-name' };

  const attributes = payload?.data?.attributes || {};
  const custom = payload?.meta?.custom_data || {};

  return {
    ok: true,
    name,
    handled: HANDLED_EVENTS.includes(name),
    // Absent test_mode is treated as LIVE, and a live deployment must never let a
    // test event through — so `testMode` is only true on an explicit true.
    testMode: payload?.meta?.test_mode === true,
    subscriptionId: payload?.data?.type === 'subscriptions' ? String(payload.data.id) : null,
    customerId: attributes.customer_id != null ? String(attributes.customer_id) : null,
    orderId: attributes.order_id != null ? String(attributes.order_id) : null,
    variantId: attributes.variant_id != null ? String(attributes.variant_id) : null,
    productId: attributes.product_id != null ? String(attributes.product_id) : null,
    status: attributes.status || null,
    renewsAt: attributes.renews_at || null,
    endsAt: attributes.ends_at || null,
    trialEndsAt: attributes.trial_ends_at || null,
    cancelled: attributes.cancelled === true,
    // The app sets this. It is a lookup key, never a source of identity: the
    // caller must resolve it to a user id from its own storage.
    nonce: custom.nonce != null ? String(custom.nonce) : null
  };
}

/**
 * Test-mode variant map, inverted for lookup.
 *
 * Shares LEMONSQUEEZY_TEST_VARIANTS with the checkout function: one JSON object
 * of 'plan:cycle' -> test variant id, which the checkout reads forwards and the
 * webhook needs backwards. A test purchase carries a test variant id, so
 * without this every test event would be ignored as variant-unknown and the
 * whole exercise would prove nothing.
 */
export function testVariantMap(env = {}) {
  const raw = env.LEMONSQUEEZY_TEST_VARIANTS;
  if (!raw) return {};
  try {
    const map = JSON.parse(raw);
    const out = {};
    for (const [key, id] of Object.entries(map)) {
      const [plan, cycle] = String(key).split(':');
      // Same shape as VARIANT_TO_PLAN: downstream reads `planId`, so emitting
      // `plan` here would write an undefined plan_id into the subscription.
      if (plan && cycle && id) out[String(id)] = { planId: plan, cycle };
    }
    return out;
  } catch {
    return {};
  }
}

/** The plan and cycle a variant represents, or a refusal. Never a default. */
export function planForVariant(variantId, variantMap = VARIANT_TO_PLAN) {
  const entry = variantMap[String(variantId ?? '')];
  if (!entry) return { ok: false, reason: 'variant-unknown', variantId: String(variantId ?? '') };
  return { ok: true, ...entry };
}

/** The status to store, or a refusal if the provider sent one we cannot reason about. */
export function statusFor(event) {
  if (!KNOWN_STATUSES.includes(event.status)) return { ok: false, reason: 'unknown-status', status: event.status };
  // A cancelled subscription that has already passed its end date is expired:
  // storing it as 'cancelled' would keep it inside the access window.
  return { ok: true, status: event.status };
}

/* -------------------------------------------------------------------- decide */

/**
 * What this delivery should do, given what is already known.
 * Pure decision: the caller performs the writes, so the test can assert the
 * decision without a database.
 */
export function decide({ event, existingEvent = null, variantMap = VARIANT_TO_PLAN, productId = PRODUCT_ID }) {
  if (!event?.ok) return { action: 'reject', status: 400, reason: 'invalid-event' };

  // Idempotency first: a retry must not touch anything.
  if (existingEvent) return { action: 'duplicate', status: 200, reason: 'already-processed' };

  if (!event.handled) return { action: 'record-only', status: 200, reason: 'unhandled-event' };

  if (event.productId && event.productId !== productId) {
    return { action: 'record-only', status: 200, reason: 'other-product' };
  }

  const mapped = planForVariant(event.variantId, variantMap);
  if (!mapped.ok) {
    // An unknown variant must never fall back to a plan: that is how a customer
    // on an unrecognised product is handed access anyway.
    return { action: 'record-only', status: 200, reason: mapped.reason };
  }

  const status = statusFor(event);
  if (!status.ok) return { action: 'record-only', status: 200, reason: status.reason };

  if (!event.subscriptionId) return { action: 'record-only', status: 200, reason: 'missing-subscription-id' };

  return {
    action: 'apply',
    status: 200,
    planId: mapped.planId,
    cycle: mapped.cycle,
    subscriptionStatus: status.status,
    testMode: event.testMode
  };
}

/**
 * The row to upsert. Written from the provider's own fields; nothing here is
 * derived from a query string or a client payload.
 */
export function subscriptionRow({ event, planId, cycle, userId }) {
  return {
    user_id: userId,
    plan_id: planId,
    billing_cycle: cycle,
    status: event.status,
    provider: 'lemonsqueezy',
    provider_subscription_id: event.subscriptionId,
    provider_customer_id: event.customerId,
    provider_order_id: event.orderId,
    variant_id: event.variantId,
    product_id: event.productId,
    test_mode: event.testMode,
    renews_at: event.renewsAt,
    ends_at: event.endsAt,
    trial_ends_at: event.trialEndsAt,
    cancelled: event.cancelled || event.name === 'subscription_cancelled'
  };
}

/* --------------------------------------------------------------------- flow */

/**
 * The whole request, with the database injected.
 *
 * `store` must provide:
 *   findEvent(key)                        -> row | null
 *   recordEvent(row)                      -> void   (insert; collision = duplicate)
 *   findSubscription(providerSubId)       -> row | null
 *   resolveNonce(nonce)                   -> userId | null
 *   consumeNonce(nonce)                   -> void
 *   upsertSubscription(row)               -> void
 *   markEventProcessed(key, outcome)      -> void
 *
 * The order is deliberate: verify, then de-duplicate, then decide, then write.
 * A duplicate is answered 200 so the provider stops retrying, but changes nothing.
 */
export async function handleRequest({ rawBody, signature, headers = {}, env = {}, store, now = new Date() } = {}) {
  const secrets = checkSecrets(env);
  if (!secrets.ok) {
    // No secret means no delivery can be trusted. 500 asks the provider to retry
    // once the deployment is fixed, rather than 200 which would silently drop
    // every real subscription event.
    return respond(500, { error: 'not-configured', missing: secrets.missing });
  }

  const verified = await verifySignature({ rawBody, signature, secret: env.LEMONSQUEEZY_WEBHOOK_SECRET });
  if (!verified.ok) {
    // 401, with no detail: a caller probing signatures learns nothing.
    return respond(401, { error: 'invalid-signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return respond(400, { error: 'invalid-json' });
  }

  const key = await eventKey({ rawBody, headers, payload });
  if (!key.ok) return respond(400, { error: key.reason });

  const event = interpretEvent(payload);
  if (!event.ok) return respond(400, { error: event.reason });

  const existingEvent = await store.findEvent(key.key);
  // Test and live are different storefronts with different ids, so which
  // variant map and which product id apply is decided here, once, from the flag.
  const testMode = String(env.LEMONSQUEEZY_TEST_MODE ?? '').trim().toLowerCase() === 'true';
  const decision = decide({
    event,
    existingEvent,
    variantMap: testMode ? testVariantMap(env) : VARIANT_TO_PLAN,
    productId: testMode ? String(env.LEMONSQUEEZY_TEST_PRODUCT_ID ?? '') : PRODUCT_ID
  });

  if (decision.action === 'reject') return respond(decision.status, { error: decision.reason });

  if (decision.action === 'duplicate') {
    return respond(200, { ok: true, duplicate: true });
  }

  // Record the delivery before acting, so a crash mid-apply leaves an event row
  // that a retry will treat as already seen rather than applying twice.
  await store.recordEvent({
    id: key.key,
    provider: 'lemonsqueezy',
    event_name: event.name,
    test_mode: event.testMode,
    received_at: now.toISOString(),
    attempts: 1
  });

  if (decision.action === 'record-only') {
    await store.markEventProcessed(key.key, decision.reason);
    return respond(200, { ok: true, ignored: decision.reason });
  }

  // Attribution, in order of reliability.
  //
  // 1. An existing subscription for this provider subscription id. A renewal,
  //    a cancellation and an expiry all carry the SAME subscription, and must
  //    land on the same user. Resolving the nonce again for those events would
  //    be wrong twice over: once a nonce is consumed (below) it no longer
  //    resolves at all, and the provider is not guaranteed to repeat
  //    custom_data on every event.
  // 2. Otherwise the nonce — the first event of a new subscription.
  //
  // With neither there is no user, so the payment cannot be assigned and
  // nothing is granted.
  let userId = null;
  let attributedBy = null;

  const existingSubscription = await store.findSubscription(event.subscriptionId);
  if (existingSubscription?.user_id) {
    userId = existingSubscription.user_id;
    attributedBy = 'subscription';
  }

  if (!userId && event.nonce) {
    userId = await store.resolveNonce(event.nonce);
    if (userId) {
      attributedBy = 'nonce';
      // Single use: a nonce that has already opened one subscription must not
      // be replayable to open another.
      await store.consumeNonce(event.nonce);
    }
  }

  if (!userId) {
    await store.markEventProcessed(key.key, 'unattributed');
    return respond(200, { ok: true, ignored: 'no-user-for-nonce' });
  }

  await store.upsertSubscription(subscriptionRow({
    event, planId: decision.planId, cycle: decision.cycle, userId
  }));
  await store.markEventProcessed(key.key, 'applied');

  return respond(200, {
    ok: true,
    applied: true,
    plan: decision.planId,
    cycle: decision.cycle,
    status: event.status,
    testMode: event.testMode
  });
}

/**
 * The entitlement decision the application must use.
 * A test-mode subscription never confers live access, and an unrecognised state
 * is never paid.
 */
export function isEntitled({ status, endsAt = null, now = new Date(), testMode = false, deploymentLive = true } = {}) {
  if (testMode && deploymentLive) return false;
  if (status === 'cancelled') return endsAt ? new Date(now).getTime() < new Date(endsAt).getTime() : false;
  return ['on_trial', 'active', 'past_due'].includes(status);
}
