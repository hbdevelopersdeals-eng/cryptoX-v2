/* Upgrade experience logic (conversion).
 *
 * EVERY PREMIUM BOUNDARY HERE IS DERIVED FROM `PLANS` IN billing.js. Nothing is
 * invented: a feature is gated only because the plan data already says the free
 * tier has none of it. If someone changes a limit in `PLANS`, the gates, the
 * prompts and the pricing page all move together, because they all read the
 * same numbers.
 *
 * What this module deliberately does NOT do:
 *   - It never invents scarcity, countdowns, discounts or social proof. There
 *     is no mechanism here to express them, on purpose.
 *   - It never blocks free features or interrupts navigation. A prompt is
 *     attached to a route that requires a paid entitlement, and to nothing else.
 *   - It never treats a checkout redirect as entitlement. That lives in
 *     subscription.jsx and fails closed.
 *
 * HARD LIMIT, STATED PLAINLY: everything here runs in the browser, so it is a
 * UI affordance, NOT access control. Hiding a button does not protect anything.
 * Until the paid features are enforced where the data lives, a determined user
 * can bypass every gate in this file.
 */

// From plans.js, not billing.js: importing the catalogue from the engine pulled
// period arithmetic, proration and dunning into the initial bundle.
import { PLANS, planById } from './plans.js';

/* ------------------------------------------------------------ entitlements */

/**
 * Routes that require a paid entitlement, each tied to the entitlement key that
 * actually justifies it. The `reason` is written for the user and names the
 * concrete capability, because "Upgrade to unlock" tells them nothing.
 */
export const GATED_ROUTES = {
  '/bots': {
    entitlement: 'bots',
    feature: 'trading-bots',
    title: 'Trading bots',
    reason: 'Automate DCA, grid, TWAP, momentum and mean-reversion strategies.'
  },
  '/exchange': {
    entitlement: 'bots',
    feature: 'exchange-engine',
    title: 'Exchange engine',
    reason: 'Place and manage paper orders with matching, risk checks and halts.'
  },
  '/strategies': {
    entitlement: 'bots',
    feature: 'strategy-engine',
    title: 'Strategy engine',
    reason: 'Run ready-made strategies against live market data.'
  },
  '/derivatives': {
    entitlement: 'bots',
    feature: 'derivatives',
    title: 'Derivatives',
    reason: 'Perpetual futures, funding, margin tiers and liquidation modelling.'
  }
};

/**
 * Usage limits that are real, with the entitlement key and how the limit resets.
 * `resets: 'monthly'` means the counter clears each calendar month; a plain
 * count has no reset, so the prompt must not promise one.
 */
export const USAGE_LIMITS = {
  alerts: { entitlement: 'alerts', label: 'price alerts', resets: null },
  portfolios: { entitlement: 'portfolios', label: 'portfolios', resets: null },
  bots: { entitlement: 'bots', label: 'trading bots', resets: null },
  apiCallsPerMonth: { entitlement: 'apiCallsPerMonth', label: 'API calls', resets: 'monthly' },
  seats: { entitlement: 'seats', label: 'seats', resets: null }
};

/** Is a route premium-only for this plan? */
export function routeGate(route, planId = 'free') {
  const gate = GATED_ROUTES[route];
  if (!gate) return { gated: false };
  const plan = planById(planId);
  if (!plan) return { gated: true, ...gate, reason_unavailable: 'unknown-plan' };
  const limit = plan.entitlements?.[gate.entitlement];
  // 0 means the tier has none of it; null means unlimited.
  const allowed = limit == null || Number(limit) > 0;
  return { gated: !allowed, entitlement: gate.entitlement, feature: gate.feature, title: gate.title, reason: gate.reason, limit };
}

/** The lowest paid plan that gives a non-zero amount of an entitlement. */
export function cheapestPlanWith(entitlement, { fromPlanId = 'free', plans = PLANS } = {}) {
  const from = planById(fromPlanId);
  const fromLimit = from?.entitlements?.[entitlement];
  const fromRank = from?.rank ?? 0;
  const candidates = plans
    .filter((p) => p.rank > fromRank && !p.contactOnly)
    .filter((p) => {
      const to = p.entitlements?.[entitlement];
      if (to == null) return true;                 // unlimited
      if (fromLimit == null) return false;         // already unlimited
      return to > fromLimit;                       // a genuine improvement
    });
  if (!candidates.length) return { ok: false, reason: 'no-plan-improves-this' };
  const best = candidates.reduce((a, b) => (a.rank <= b.rank ? a : b));
  return { ok: true, planId: best.id, name: best.name, from: fromLimit, to: best.entitlements?.[entitlement] };
}

/* --------------------------------------------------------------- usage state */

/**
 * Compare current usage against a plan's limit.
 * `remaining` is null when the plan is unlimited, so the UI can say "Unlimited"
 * rather than a number that implies a ceiling.
 */
export function usageState({ entitlement, planId = 'free', used = 0 } = {}) {
  const meta = USAGE_LIMITS[entitlement];
  if (!meta) return { ok: false, reason: 'unknown-entitlement' };
  const plan = planById(planId);
  if (!plan) return { ok: false, reason: 'unknown-plan' };
  const raw = plan.entitlements?.[entitlement];
  const limit = raw == null ? null : Number(raw);
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  if (limit == null) return { ok: true, entitlement, planId, used: safeUsed, limit: null, remaining: null, unlimited: true, atLimit: false, resets: meta.resets, label: meta.label };
  return {
    ok: true,
    entitlement,
    planId,
    used: safeUsed,
    limit,
    remaining: Math.max(0, limit - safeUsed),
    unlimited: false,
    atLimit: safeUsed >= limit,
    // Near the limit is worth surfacing once, not a countdown.
    nearLimit: safeUsed >= Math.max(1, Math.ceil(limit * 0.8)),
    resets: meta.resets,
    label: meta.label
  };
}

/** Which limit, if any, this interaction just exhausted. */
export function limitHit({ entitlement, planId, used }) {
  const state = usageState({ entitlement, planId, used });
  if (!state.ok || !state.atLimit) return { hit: false, state };
  const upgrade = cheapestPlanWith(entitlement, { fromPlanId: planId });
  return { hit: true, state, upgrade };
}

/* ------------------------------------------------------------ the prompt */

/**
 * The prompt for a context, or nothing.
 *
 * Returns `null` when there is no genuine upgrade opportunity, so a caller can
 * render the page normally instead of a nag. A paid user never receives an
 * upgrade prompt for a feature they already have.
 */
export function upgradePromptFor({ route = null, entitlement = null, planId = 'free', used = 0, dismissals = {}, now = new Date(), flow = 'default' } = {}) {
  const key = entitlement ? `limit:${entitlement}` : route ? `route:${route}` : null;
  if (!key) return null;
  if (shouldSuppress(dismissals, `${flow}:${key}`, now)) return null;

  if (entitlement) {
    const hit = limitHit({ entitlement, planId, used });
    if (!hit.hit) return null;
    return {
      kind: 'limit',
      key,
      entitlement,
      title: `You've reached your ${hit.state.label} limit`,
      detail: `${hit.state.used} of ${hit.state.limit} used.`,
      resets: hit.state.resets,
      resetsNote: hit.state.resets === 'monthly'
        ? 'Your allowance resets at the start of each month.'
        : 'This limit does not reset on a schedule.',
      cta: hit.upgrade.ok ? `Upgrade to ${hit.upgrade.name}` : 'Compare plans',
      targetPlanId: hit.upgrade.ok ? hit.upgrade.planId : null,
      benefit: hit.upgrade.ok ? `${hit.upgrade.to == null ? 'Unlimited' : hit.upgrade.to} ${hit.state.label} on ${hit.upgrade.name}.` : null
    };
  }

  const gate = routeGate(route, planId);
  if (!gate.gated) return null;
  const upgrade = cheapestPlanWith(gate.entitlement, { fromPlanId: planId });
  return {
    kind: 'feature',
    key,
    entitlement: gate.entitlement,
    title: `${gate.title} is part of ${upgrade.ok ? upgrade.name : 'a paid plan'}`,
    detail: gate.reason,
    resets: null,
    cta: upgrade.ok ? `Upgrade to ${upgrade.name}` : 'Compare plans',
    targetPlanId: upgrade.ok ? upgrade.planId : null,
    benefit: upgrade.ok ? `${upgrade.name} includes ${describeLimit(gate.entitlement, upgrade.to)}.` : null
  };
}

function describeLimit(entitlement, limit) {
  if (limit == null) return `unlimited ${USAGE_LIMITS[entitlement]?.label || entitlement}`;
  return `${limit} ${USAGE_LIMITS[entitlement]?.label || entitlement}`;
}

/* --------------------------------------------------------------- dismissal */

/**
 * Respect a dismissal. Keyed per flow so dismissing a prompt on one page does
 * not silence a genuinely different one, and expiring so it is not permanent.
 */
export const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldSuppress(dismissals = {}, key, now = new Date()) {
  const at = dismissals?.[key];
  if (!at) return false;
  const when = new Date(at).getTime();
  if (!Number.isFinite(when)) return false;
  return new Date(now).getTime() - when < DISMISSAL_TTL_MS;
}

export function dismiss(dismissals = {}, key, now = new Date()) {
  if (!key) return { ...dismissals };
  return { ...dismissals, [key]: new Date(now).toISOString() };
}

/** A prompt must never be shown twice in the same interaction flow. */
export function oncePerFlow(seen = new Set(), key) {
  if (!key) return { show: false, seen };
  if (seen.has(key)) return { show: false, seen };
  const next = new Set(seen);
  next.add(key);
  return { show: true, seen: next };
}

/* ------------------------------------------------------------ annual saving */

/**
 * The annual saving, computed ONLY when the prices support the arithmetic.
 *
 * A plan with no annual price, a zero monthly price, or an annual price that is
 * not actually cheaper yields `available: false` — so the UI omits the claim
 * rather than printing "save 0%" or a negative saving.
 */
export function annualSaving(plan) {
  const monthly = plan?.price?.monthly;
  const annual = plan?.price?.annual;
  if (monthly == null || annual == null) return { available: false, reason: 'missing-price' };
  if (typeof monthly !== 'number' || typeof annual !== 'number') return { available: false, reason: 'price-not-a-number' };
  if (monthly <= 0) return { available: false, reason: 'free-plan-has-no-saving' };
  const fullYear = monthly * 12;
  if (annual >= fullYear) return { available: false, reason: 'annual-is-not-cheaper' };
  const saving = fullYear - annual;
  return {
    available: true,
    fullYear,
    annual,
    saving,
    savingPct: Math.round((saving / fullYear) * 100),
    // What the annual price works out to per month, with no rounding fudge.
    monthlyEquivalent: Math.round((annual / 12) * 100) / 100,
    monthsFree: Math.round((saving / monthly) * 10) / 10
  };
}

/** Purchasable plans, in ascending rank — the order to show them in. */
export function purchasablePlans(plans = PLANS) {
  return plans.filter((p) => !p.contactOnly && p.rank > 0).sort((a, b) => a.rank - b.rank);
}

/* ------------------------------------------------------- pricing integrity */

/**
 * Compare the app's prices against the store's variants.
 *
 * This is the anti-drift gate: the application DISPLAYS one price and the
 * provider CHARGES another, and nothing in either system notices. Every
 * disagreement is reported with both sides so it can be resolved, and the
 * function never picks a winner.
 */
export function pricingIntegrity({ plans = PLANS, mapping = {}, variants = {} } = {}) {
  const rows = [];
  const mismatches = [];

  for (const plan of purchasablePlans(plans)) {
    for (const cycle of ['monthly', 'annual']) {
      const appPrice = plan.price?.[cycle];
      const variantId = mapping[`${plan.id}:${cycle}`] ?? null;
      const variant = variantId ? variants[variantId] ?? null : null;
      const row = {
        planId: plan.id,
        plan: plan.name,
        cycle,
        appPrice: appPrice ?? null,
        variantId,
        variantPrice: variant?.price ?? null,
        currency: variant?.currency ?? null,
        interval: variant?.interval ?? null,
        status: variant?.status ?? null
      };

      if (appPrice == null) {
        rows.push({ ...row, verdict: 'not-offered' });
        continue;
      }
      if (!variantId) {
        mismatches.push({ ...row, verdict: 'no-variant' });
        rows.push({ ...row, verdict: 'no-variant' });
        continue;
      }
      if (!variant) {
        mismatches.push({ ...row, verdict: 'variant-unknown' });
        rows.push({ ...row, verdict: 'variant-unknown' });
        continue;
      }
      if (variant.status && variant.status !== 'published') {
        mismatches.push({ ...row, verdict: 'variant-not-sellable' });
      }
      if (variant.price == null) {
        mismatches.push({ ...row, verdict: 'variant-has-no-price' });
      } else if (Math.abs(Number(variant.price) - Number(appPrice)) > 0.005) {
        mismatches.push({
          ...row,
          verdict: 'price-mismatch',
          difference: Math.round((Number(variant.price) - Number(appPrice)) * 100) / 100,
          note: `The app shows ${appPrice} and the store charges ${variant.price}. One of them is wrong; this gate will not choose.`
        });
      }
      if (variant.interval && cycle === 'monthly' && variant.interval !== 'month') {
        mismatches.push({ ...row, verdict: 'interval-mismatch', note: `A monthly plan maps to a ${variant.interval} variant.` });
      }
      if (variant.interval && cycle === 'annual' && variant.interval !== 'year') {
        mismatches.push({ ...row, verdict: 'interval-mismatch', note: `An annual plan maps to a ${variant.interval} variant.` });
      }
      if (variant.usageMetered) {
        mismatches.push({
          ...row,
          verdict: 'usage-metered',
          note: 'The variant is usage-metered, so the amount charged may not be the list price shown to the customer.'
        });
      }
      rows.push({ ...row, verdict: mismatches.some((m) => m.planId === plan.id && m.cycle === cycle) ? 'mismatch' : 'ok' });
    }
  }

  return { ok: mismatches.length === 0, rows, mismatches, checkedAt: null };
}

/** Convenience: does the app and the store agree on every purchasable plan? */
export const pricingAgrees = (args) => pricingIntegrity(args).ok;

/* ---------------------------------------------------------------- analytics */

/**
 * The event names this experience emits, mapped onto the application's existing
 * registry in analytics.js. Names follow the registry's `domain.action`
 * convention rather than introducing a second style.
 *
 * `subscription_activated` is deliberately NOT a new event: the registry
 * already has `subscription.started` with richer required properties, and a
 * second name for one event is how a funnel stops adding up.
 */
export const UPGRADE_EVENTS = {
  promptViewed: { name: 'upgrade.prompt_viewed', props: ['context', 'plan', 'kind'] },
  clicked: { name: 'upgrade.clicked', props: ['context', 'plan', 'targetPlan'] },
  checkoutStarted: { name: 'checkout.started', props: ['plan', 'cycle'] },
  checkoutCancelled: { name: 'checkout.cancelled', props: ['plan', 'cycle'] },
  // Reused from the existing registry — see the note above.
  subscriptionActivated: { name: 'subscription.started', props: ['plan', 'cycle', 'amount'] }
};

/**
 * De-duplicate a prompt view within a session.
 *
 * A prompt inside a React component re-renders many times; counting each render
 * would report a "viewed" rate several times the truth and make the funnel
 * meaningless.
 */
export function createEventDeduper() {
  const seen = new Set();
  return {
    shouldEmit(key) {
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    size: () => seen.size,
    reset: () => seen.clear()
  };
}

/**
 * A funnel definition that answers "which page led to a subscription?".
 * Uses the existing `funnel()` shape in analytics.js.
 */
export const CONVERSION_FUNNEL = [
  { id: 'prompt_viewed', event: 'upgrade.prompt_viewed', label: 'Prompt seen' },
  { id: 'upgrade_clicked', event: 'upgrade.clicked', label: 'Upgrade clicked' },
  { id: 'checkout_started', event: 'checkout.started', label: 'Checkout started' },
  { id: 'subscription_started', event: 'subscription.started', label: 'Subscribed' }
];

/** Group conversion by the context a prompt came from, so pages can be compared. */
export function conversionByContext(events = []) {
  const contexts = new Map();
  for (const event of events) {
    const context = event?.properties?.context;
    if (!context) continue;
    if (!contexts.has(context)) contexts.set(context, { context, viewed: 0, clicked: 0, started: 0, activated: 0 });
    const row = contexts.get(context);
    if (event.name === 'upgrade.prompt_viewed') row.viewed += 1;
    else if (event.name === 'upgrade.clicked') row.clicked += 1;
    else if (event.name === 'checkout.started') row.started += 1;
    else if (event.name === 'subscription.started') row.activated += 1;
  }
  return [...contexts.values()]
    .map((r) => ({
      ...r,
      viewToClick: r.viewed ? Math.round((r.clicked / r.viewed) * 1000) / 10 : null,
      clickToStart: r.clicked ? Math.round((r.started / r.clicked) * 1000) / 10 : null,
      viewToActivate: r.viewed ? Math.round((r.activated / r.viewed) * 1000) / 10 : null
    }))
    .sort((a, b) => (b.activated ?? 0) - (a.activated ?? 0) || b.viewed - a.viewed);
}

/* --------------------------------------------------------------- CTA labels */

/**
 * A call to action that names what the user gets and never overstates it.
 * Returns null when there is nothing truthful to promise.
 */
export function ctaFor({ kind, entitlement = null, targetPlan = null, featureTitle = null } = {}) {
  if (targetPlan == null && kind !== 'compare') return { label: 'Compare plans', intent: 'compare' };
  if (kind === 'compare') return { label: 'Compare plans', intent: 'compare' };
  if (kind === 'limit' && entitlement) {
    const label = USAGE_LIMITS[entitlement]?.label || 'this limit';
    return { label: `Raise my ${label} limit`, intent: 'upgrade', targetPlan };
  }
  if (kind === 'feature' && featureTitle) return { label: `Unlock ${featureTitle}`, intent: 'upgrade', targetPlan };
  return { label: `Upgrade to ${targetPlan}`, intent: 'upgrade', targetPlan };
}

/** Everything a gated page needs, in one call, for the UI to render. */
export function upgradeContextFor({ route, planId = 'free', usage = {}, dismissals = {}, now = new Date(), flow = 'default', seen = new Set() } = {}) {
  const gate = routeGate(route, planId);
  if (!gate.gated) return { gated: false, prompt: null, canAccess: true };

  const prompt = upgradePromptFor({ route, planId, dismissals, now, flow });
  if (!prompt) return { gated: true, canAccess: false, prompt: null, suppressed: true };

  const dedupe = oncePerFlow(seen, prompt.key);
  return {
    gated: true,
    canAccess: false,
    prompt: dedupe.show ? prompt : { ...prompt, suppressedByFlow: true },
    cta: ctaFor({ kind: prompt.kind, entitlement: prompt.entitlement, targetPlan: prompt.targetPlanId, featureTitle: gate.title }),
    usage: entitlementUsage(usage, gate.entitlement)
  };
}

function entitlementUsage(usage, entitlement) {
  if (entitlement == null || usage == null) return null;
  const used = usage[entitlement];
  return used == null ? null : { entitlement, used };
}

/** True when this plan is already paid — used to swap prompts for management UI. */
export const isPaidPlan = (planId) => {
  const plan = planById(planId);
  return !!plan && plan.rank > 0;
};

/** The management view a paying subscriber sees instead of an upgrade prompt. */
export function managementInfo({ planId = 'free', status = null, renewsAt = null, endsAt = null, cancelAt = null } = {}) {
  if (!isPaidPlan(planId)) return { showUpgrade: true, showManagement: false };
  return {
    showUpgrade: false,
    showManagement: true,
    planId,
    planName: planById(planId)?.name || planId,
    status,
    renewsAt,
    // A cancellation is information, not an advert: show what happens and when.
    cancellation: cancelAt ? { scheduledFor: cancelAt, note: 'Access continues until the end of the period you have paid for.' } : null,
    endsAt,
    canManage: true,
    note: 'Manage or cancel from your billing portal.'
  };
}
