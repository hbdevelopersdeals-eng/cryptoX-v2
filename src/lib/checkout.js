/* Lemon Squeezy checkout mapping (the provider half of the plan catalogue).
 *
 * THESE IDS WERE READ FROM THE DASHBOARD'S OWN VARIANTS UI — clicking each
 * variant card and reading its detail page — not from page state or embedded
 * JSON. Numeric ids are what the API uses; the CHECKOUT UUID is what a
 * customer-facing buy link needs. A checkout URL built from the numeric id
 * returns 404, which is a mistake worth stating in a comment.
 *
 *   variant id   checkout uuid                          plan / cycle
 *   2230904      0f87360b-875c-4ec3-b8fa-5d6acc812376   pro / monthly        $9.99
 *   2230911      b4d5b470-3b30-475c-9e74-923ad0324ccf   pro / annual         $99.99
 *   2230938      ae243fd9-68e7-46d2-82e2-6b0c2147ee13   business / monthly   $24.99
 *   2230940      bc795aa1-0236-4217-8b84-8913718dfc32   business / annual    $249.99
 *   2230941      4d721527-e23c-42e8-b755-133f295c1ad3   enterprise / monthly $199.99
 *   2230943      3e7d6fae-e239-420f-a3de-bf27d80da671   enterprise / annual  $1,999.99
 *
 * All six are standard fixed-price subscriptions. The old metered "Default"
 * variant is gone: the product now carries exactly these six.
 *
 * WHY CHECKOUT IS STILL GATED. A hosted checkout can be opened for any variant
 * right now. What is missing is ATTRIBUTION: with no server to mint and store a
 * nonce, nothing reliably ties a completed purchase back to an account. A
 * checkout that takes money and cannot say whose it is would be worse than one
 * that is not offered yet. So `attributionReady` is false, the UI says so, and
 * flipping it is the single line that enables checkout once the backend exists.
 */

import { PLANS, planById } from './plans.js';

/** Set true only when a server can mint and validate checkout nonces. */
export const ATTRIBUTION_READY = false;

/** The store. The slug is what forms the checkout origin. */
export const STORE = { slug: 'hbstore', id: '489130' };

/**
 * The verified variant map. `id` is the API id, `uuid` is the checkout slug,
 * `amount` is what the provider actually charges — recorded so it can be
 * compared against the plan catalogue rather than trusted.
 */
export const VARIANTS = [
  { plan: 'pro', cycle: 'monthly', id: '2230904', uuid: '0f87360b-875c-4ec3-b8fa-5d6acc812376', amount: 9.99, interval: 'month', status: 'published' },
  { plan: 'pro', cycle: 'annual', id: '2230911', uuid: 'b4d5b470-3b30-475c-9e74-923ad0324ccf', amount: 99.99, interval: 'year', status: 'published' },
  { plan: 'business', cycle: 'monthly', id: '2230938', uuid: 'ae243fd9-68e7-46d2-82e2-6b0c2147ee13', amount: 24.99, interval: 'month', status: 'published' },
  { plan: 'business', cycle: 'annual', id: '2230940', uuid: 'bc795aa1-0236-4217-8b84-8913718dfc32', amount: 249.99, interval: 'year', status: 'published' },
  { plan: 'enterprise', cycle: 'monthly', id: '2230941', uuid: '4d721527-e23c-42e8-b755-133f295c1ad3', amount: 199.99, interval: 'month', status: 'published' },
  { plan: 'enterprise', cycle: 'annual', id: '2230943', uuid: '3e7d6fae-e239-420f-a3de-bf27d80da671', amount: 1999.99, interval: 'year', status: 'published' }
];

const key = (plan, cycle) => `${plan}:${cycle}`;
const BY_KEY = new Map(VARIANTS.map((v) => [key(v.plan, v.cycle), v]));
const BY_UUID = new Map(VARIANTS.map((v) => [v.uuid, v]));
const BY_ID = new Map(VARIANTS.map((v) => [v.id, v]));

export const variantFor = (plan, cycle) => BY_KEY.get(key(plan, cycle)) || null;
export const variantByUuid = (uuid) => BY_UUID.get(String(uuid || '')) || null;
export const variantById = (id) => BY_ID.get(String(id || '')) || null;

/** Is there a sellable variant for this plan and cycle? */
export function mappingFor(plan, cycle) {
  const variant = variantFor(plan, cycle);
  if (!variant) return { ok: false, reason: 'no-variant-mapped' };
  if (variant.status !== 'published') return { ok: false, reason: 'variant-not-published', variant };
  return { ok: true, variant };
}

/**
 * Validate the provider map against the plan catalogue.
 *
 * This is the guarantee that the page and the provider cannot disagree: it
 * compares the amount and the interval the provider actually enforces with the
 * amount the application displays, and refuses to pick a winner when they
 * differ.
 */
export function validateMapping({ plans = PLANS } = {}) {
  const problems = [];
  for (const variant of VARIANTS) {
    const plan = planById(variant.plan);
    if (!plan) { problems.push({ ...variant, reason: 'unknown-plan' }); continue; }
    const expected = plan.price?.[variant.cycle];
    if (expected == null) { problems.push({ ...variant, reason: 'plan-does-not-offer-this-cycle', expected }); continue; }
    if (Math.abs(Number(expected) - Number(variant.amount)) > 0.005) {
      problems.push({ ...variant, reason: 'amount-mismatch', appAmount: expected, providerAmount: variant.amount });
    }
    const wantInterval = variant.cycle === 'annual' ? 'year' : 'month';
    if (variant.interval !== wantInterval) {
      problems.push({ ...variant, reason: 'interval-mismatch', expected: wantInterval, actual: variant.interval });
    }
  }
  // Every purchasable plan and cycle must have a variant, or a price is shown
  // that cannot be bought.
  for (const plan of plans) {
    if (plan.rank === 0) continue; // free has no checkout
    for (const cycle of ['monthly', 'annual']) {
      if (plan.price?.[cycle] == null) continue;
      if (!variantFor(plan.id, cycle)) problems.push({ plan: plan.id, cycle, reason: 'missing-variant' });
    }
  }
  return { ok: problems.length === 0, problems, mapped: VARIANTS.length };
}

/** The checkout origin for the store. */
export const checkoutOrigin = () => `https://${STORE.slug}.lemonsqueezy.com`;

/**
 * Build the hosted-checkout URL for a plan and cycle.
 *
 * `nonce` is required to attribute the purchase. Without it the URL is still
 * buildable — useful for a manual test — but the caller is told attribution is
 * not established, so nothing silently accepts a payment it cannot assign.
 */
export function buildCheckoutUrl({ plan, cycle, email = null, nonce = null, discountCode = null, redirectUrl = null } = {}) {
  if (!ATTRIBUTION_READY && !nonce) {
    return { ok: false, reason: 'attribution-not-ready', note: 'No server can mint a checkout nonce yet, so a purchase could not be attributed to an account.' };
  }
  const found = mappingFor(plan, cycle);
  if (!found.ok) return found;

  const url = new URL(`${checkoutOrigin()}/checkout/buy/${found.variant.uuid}`);
  url.searchParams.set('checkout[embed]', '0');
  url.searchParams.set('logo', '0');
  if (nonce) url.searchParams.set('checkout[custom][nonce]', String(nonce));
  if (email) url.searchParams.set('checkout[email]', String(email));
  if (discountCode) url.searchParams.set('checkout[discount_code]', String(discountCode));
  if (redirectUrl) url.searchParams.set('checkout[redirect_url]', String(redirectUrl));

  return {
    ok: true,
    url: url.toString(),
    plan,
    cycle,
    amount: found.variant.amount,
    interval: found.variant.interval,
    variantId: found.variant.id,
    attributed: !!nonce
  };
}

/** Whether the UI should offer a working Subscribe action. */
export const checkoutEnabled = () => ATTRIBUTION_READY;

/** A one-line status for the UI, so the reason is visible rather than implied. */
export function checkoutStatus() {
  const mapping = validateMapping();
  if (!mapping.ok) return { enabled: false, reason: 'mapping-invalid', problems: mapping.problems };
  if (!ATTRIBUTION_READY) return { enabled: false, reason: 'attribution-not-ready', note: 'Plan prices are verified against the store; checkout opens once the server can attribute a purchase to an account.' };
  return { enabled: true, reason: 'ready' };
}

/** The plan comparison rows for the pricing page, provider amount included. */
export function catalogueRows({ plans = PLANS } = {}) {
  const rows = [];
  for (const plan of plans) {
    if (plan.rank === 0) continue;
    for (const cycle of ['monthly', 'annual']) {
      const appAmount = plan.price?.[cycle] ?? null;
      const variant = variantFor(plan.id, cycle);
      rows.push({
        plan: plan.id,
        planName: plan.name,
        cycle,
        appAmount,
        providerAmount: variant?.amount ?? null,
        variantId: variant?.id ?? null,
        uuid: variant?.uuid ?? null,
        agrees: variant != null && appAmount != null && Math.abs(Number(appAmount) - Number(variant.amount)) <= 0.005
      });
    }
  }
  return rows;
}
