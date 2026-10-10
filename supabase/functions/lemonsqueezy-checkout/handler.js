/* Lemon Squeezy checkout creation — pure logic, no runtime globals.
 *
 * Kept free of Deno APIs so the whole flow is unit-testable with an injected
 * fetch and store. index.ts supplies the real environment, the authenticated
 * user and the Supabase client.
 *
 * WHY THE SERVER CREATES THE CHECKOUT AT ALL. The obvious alternative is to
 * build the hosted-checkout URL in the browser and put an identifier in the
 * query string. A query string is user-visible and user-editable, so whatever
 * it carries has to be worthless to forge — and it cannot carry the identity
 * directly. Creating the checkout here means:
 *
 *   - The client sends ONLY a plan and a cycle. It never sends a user id, a
 *     variant id, a price or a nonce. There is nothing in the request worth
 *     tampering with, because the server decides all of it.
 *   - The variant is resolved from THIS file's map, not from the request, so a
 *     crafted request cannot buy the enterprise plan at the pro price.
 *   - The user id comes from the verified JWT, never from the body, so a
 *     checkout cannot be attributed to somebody else.
 *   - The nonce is minted here, bound here, and stored here. The webhook
 *     resolves it back to a user; a forged nonce has no row and grants nothing.
 *
 * FAIL CLOSED. No API key -> refuse before writing anything. A non-2xx from
 * the provider -> refuse. A response without an https URL -> refuse. At no
 * point does a failure produce a checkout URL.
 */

export const REQUIRED_SECRETS = ['LEMONSQUEEZY_API_KEY'];

/** The store and product these six variants belong to. */
export const STORE_ID = '489130';
export const PRODUCT_ID = '1426526';

export const API_BASE = 'https://api.lemonsqueezy.com/v1';

/** How long a minted nonce stays usable. Long enough to complete a purchase,
 *  short enough that a leaked one is not indefinitely replayable. */
export const NONCE_TTL_MS = 2 * 60 * 60 * 1000;

/** Plans a client may ask for. 'free' is deliberately absent: there is nothing
 *  to buy, and accepting it would mint a nonce for a non-purchase. */
export const SELLABLE_PLANS = ['pro', 'business', 'enterprise'];
export const CYCLES = ['monthly', 'annual'];

/** The six verified variants. Asserted equal to src/lib/checkout.js by test. */
export const VARIANTS = [
  { plan: 'pro', cycle: 'monthly', id: '2230904', uuid: '0f87360b-875c-4ec3-b8fa-5d6acc812376', amount: 9.99 },
  { plan: 'pro', cycle: 'annual', id: '2230911', uuid: 'b4d5b470-3b30-475c-9e74-923ad0324ccf', amount: 99.99 },
  { plan: 'business', cycle: 'monthly', id: '2230938', uuid: 'ae243fd9-68e7-46d2-82e2-6b0c2147ee13', amount: 24.99 },
  { plan: 'business', cycle: 'annual', id: '2230940', uuid: 'bc795aa1-0236-4217-8b84-8913718dfc32', amount: 249.99 },
  { plan: 'enterprise', cycle: 'monthly', id: '2230941', uuid: '4d721527-e23c-42e8-b755-133f295c1ad3', amount: 199.99 },
  { plan: 'enterprise', cycle: 'annual', id: '2230943', uuid: '3e7d6fae-e239-420f-a3de-bf27d80da671', amount: 1999.99 }
];

const BY_KEY = new Map(VARIANTS.map((v) => [`${v.plan}:${v.cycle}`, v]));

export function variantFor(plan, cycle) {
  return BY_KEY.get(`${plan}:${cycle}`) || null;
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const respond = (status, body) => ({ status, headers: JSON_HEADERS, body });

/* ------------------------------------------------------------------ secrets */

export function checkSecrets(env = {}) {
  const missing = REQUIRED_SECRETS.filter((key) => !env[key] || String(env[key]).trim() === '');
  return { ok: missing.length === 0, missing };
}

/* ------------------------------------------------------------------- intent */

/**
 * Read the request body. ONLY `plan` and `cycle` are read.
 *
 * Everything else is ignored rather than rejected, so a client that sends
 * extra fields cannot even probe which extra fields exist. Nothing returned
 * here is a value the server will act on beyond choosing a variant.
 */
export function readIntent(body) {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-body' };
  }

  const plan = parsed.plan;
  const cycle = parsed.cycle;

  if (typeof plan !== 'string' || !SELLABLE_PLANS.includes(plan)) {
    return { ok: false, reason: 'invalid-plan', detail: 'plan must be one of ' + SELLABLE_PLANS.join(', ') };
  }
  if (typeof cycle !== 'string' || !CYCLES.includes(cycle)) {
    return { ok: false, reason: 'invalid-cycle', detail: 'cycle must be one of ' + CYCLES.join(', ') };
  }

  const variant = variantFor(plan, cycle);
  if (!variant) {
    // A plan and cycle that are each valid but have no sellable variant is a
    // mapping gap, not a client error. Refuse rather than guess.
    return { ok: false, reason: 'no-variant-mapped' };
    }
  return { ok: true, plan, cycle, variant };
}

/* -------------------------------------------------------------------- nonce */

/** A nonce is opaque and unguessable: it is the only thing tying a purchase
 *  back to an account, so it must not be derivable from a user id or a clock. */
export function mintNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nonceExpiry(now = new Date()) {
  return new Date(new Date(now).getTime() + NONCE_TTL_MS);
}

/* ------------------------------------------------------------------ provider */

/**
 * Create the checkout with Lemon Squeezy.
 *
 * The body is built here in full. Note what is NOT in it: no amount, no email,
 * no client-supplied redirect. The store and variant come from this file, and
 * the only caller data is the nonce.
 */
export function buildProviderRequest({ variant, nonce, env = {} }) {
  const attributes = {
    // The nonce, and ONLY the nonce. Carrying the user id here too would look
    // authoritative while being unverifiable — the webhook resolves the nonce
    // against our own table instead. A field that looks like identity but is
    // not checked is how attribution bugs get written.
    checkout_data: { custom: { nonce } },
    checkout_options: { embed: false, media: true, logo: true }
  };

  // The redirect target is ours, not the caller's: a caller-supplied redirect
  // is an open-redirect and a phishing vector.
  if (env.CHECKOUT_REDIRECT_URL) {
    attributes.product_options = { redirect_url: String(env.CHECKOUT_REDIRECT_URL) };
  }

  return {
    data: {
      type: 'checkouts',
      attributes,
      relationships: {
        store: { data: { type: 'stores', id: STORE_ID } },
        variant: { data: { type: 'variants', id: variant.id } }
      }
    }
  };
}

/** Pull the checkout URL out of the provider response, or refuse. */
export function readProviderResponse(status, payload) {
  if (status < 200 || status >= 300) {
    // The provider's own message is not echoed back: it is not the caller's
    // business and can leak account detail.
    return { ok: false, reason: 'provider-rejected', status, providerStatus: status };
  }
  const url = payload?.data?.attributes?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    // An http or non-URL value would be a downgrade or a trivially injectable
    // target. Refuse rather than redirect a buyer somewhere unexpected.
    return { ok: false, reason: 'provider-url-invalid', status };
  }
  const id = payload?.data?.id;
  return { ok: true, url, providerCheckoutId: id != null ? String(id) : null };
}

/* --------------------------------------------------------------------- flow */

/**
 * The whole request, with fetch and the database injected.
 *
 * `store` must provide:
 *   saveNonce(row) -> void
 */
export async function handleRequest({
  method = 'POST',
  body = null,
  userId = null,
  env = {},
  store,
  fetchImpl = fetch,
  now = new Date()
} = {}) {
  if (method === 'OPTIONS') return { status: 204, headers: JSON_HEADERS, body: null };
  if (method !== 'POST') return respond(405, { error: 'method-not-allowed' });

  // Authentication is checked BEFORE configuration, deliberately.
  //
  // The publishable key is in the client bundle, so anyone can present a
  // syntactically valid token; the gateway passes it through and this check is
  // what stops them. Checking configuration first would answer an anonymous
  // caller with which secrets are missing — revealing the deployment's state to
  // somebody with no business asking, and turning the endpoint into a
  // configuration oracle. Refuse the caller, then worry about ourselves.
  //
  // The user id comes from the verified token. Without it there is nobody to
  // attribute a purchase to, so there is no checkout to create.
  if (!userId) return respond(401, { error: 'unauthenticated' });

  const secrets = checkSecrets(env);
  if (!secrets.ok) {
    // 503: the service cannot serve a working checkout, and says so rather
    // than returning a URL that would fail at the provider.
    return respond(503, { error: 'not-configured', missing: secrets.missing });
  }

  const intent = readIntent(body);
  if (!intent.ok) return respond(400, { error: intent.reason, detail: intent.detail ?? null });

  const nonce = mintNonce();
  const expiresAt = nonceExpiry(now);

  // Store the nonce BEFORE asking the provider for a URL. The reverse order
  // would leave a live checkout whose purchase resolves to nobody.
  await store.saveNonce({
    nonce,
    user_id: userId,
    plan_id: intent.plan,
    billing_cycle: intent.cycle,
    variant_id: intent.variant.id,
    test_mode: env.DEPLOYMENT_LIVE === 'false',
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt.toISOString()
  });

  let status = 0;
  let payload = null;
  try {
    const res = await fetchImpl(`${API_BASE}/checkouts`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`
      },
      body: JSON.stringify(buildProviderRequest({ variant: intent.variant, nonce, env }))
    });
    status = res.status;
    payload = await res.json();
  } catch {
    // A network failure is ours to own, not the caller's.
    return respond(502, { error: 'provider-unreachable' });
  }

  const read = readProviderResponse(status, payload);
  if (!read.ok) return respond(502, { error: read.reason });

  return respond(200, {
    ok: true,
    // The URL only. The nonce is not echoed: it is already inside the checkout
    // session the provider now owns, and there is no reason to hand it back.
    url: read.url,
    plan: intent.plan,
    cycle: intent.cycle,
    amount: intent.variant.amount
  });
}
