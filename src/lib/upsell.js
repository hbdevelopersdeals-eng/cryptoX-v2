/* Upgrade prompting (Section 33 — commercial).
 *
 * The product must ask for money in more than one place, and must ask for the
 * RIGHT amount in each place. A trader who has filled five alerts should be
 * offered Pro, not Enterprise; a desk that has run out of seats should be offered
 * Business, not unlimited alerts. So the rule here is: pick the LOWEST tier above
 * the current one that actually removes the constraint the user has hit.
 *
 * Three constraints on how this is allowed to behave — a paywall that nags is
 * worse than no paywall, because it teaches users to ignore every prompt:
 *
 *   1. NO FABRICATED URGENCY. No countdown, no "3 people viewing", no invented
 *      discount. Every number below is derived from `plans.js`, and the annual
 *      saving is computed from the two prices rather than asserted.
 *   2. ONE NUDGE PER PLACE, PER SESSION, and a 14-day cooldown after a dismissal.
 *      Both are enforced here so a component cannot decide to be louder.
 *   3. NEVER DOWN. `recommend()` returns null when the suggestion is at or below
 *      the current plan — the bug that shows "upgrade to Pro" to a Pro customer.
 *
 * What each tier is sold on is deliberately different, because the buyer is:
 *   Pro        one trader who needs room (alerts, portfolios, bots, API)
 *   Business   a desk that needs seats, audit history and exports
 *   Enterprise an institution that needs a contract: SLA, SSO, retention, data
 */

import { PLANS, planById } from './plans.js';

export const TIER_PITCH = {
  pro: {
    id: 'pro',
    name: 'Pro',
    audience: 'One trader who needs room to work',
    headline: 'You have outgrown the free limits',
    oneLiner: 'More alerts, more portfolios, and bots that run without you watching.',
    adds: [
      '100 price alerts, up from 5',
      '10 portfolios, up from 1',
      '3 automated bots',
      '250,000 API calls a month',
      '90 days of audit history',
      'Email support'
    ],
    proof: 'A real watchlist hits the five-alert cap in a week.',
    cta: 'Upgrade to Pro'
  },
  business: {
    id: 'business',
    name: 'Business',
    audience: 'A desk or small team',
    headline: 'This is a team problem now',
    oneLiner: 'Seats, shared limits and an audit trail long enough to be useful.',
    adds: [
      '25 seats, up from 3',
      '1,000 alerts and 50 portfolios',
      '25 bots running in parallel',
      '2,000,000 API calls a month',
      '365 days of audit history',
      'XLSX export and priority support'
    ],
    proof: 'Audit history is the first thing a compliance reviewer asks for.',
    cta: 'Upgrade to Business'
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'An institution with obligations',
    headline: 'You need terms, not a bigger plan',
    oneLiner: 'Unlimited usage, a contract with an SLA, and a named contact.',
    adds: [
      'Unlimited seats, alerts, portfolios and bots',
      'Dedicated support with a contracted SLA',
      'SSO and SCIM — provisioned under contract, not self-serve',
      'Seven-year audit retention',
      'Custom data sources and deployment terms'
    ],
    proof: 'Enterprise is sold by conversation; the button opens one.',
    cta: 'Talk to sales'
  }
};

export const TIER_ORDER = ['free', 'pro', 'business', 'enterprise'];

/** Where a prompt is allowed to appear, and which tier it is allowed to name. */
export const PLACEMENTS = {
  alerts: { tier: 'pro', quota: 'alerts', title: 'Price alerts' },
  portfolios: { tier: 'pro', quota: 'portfolios', title: 'Portfolios' },
  bots: { tier: 'pro', quota: 'bots', title: 'Automated bots' },
  api: { tier: 'business', quota: 'apiCallsPerMonth', title: 'API calls' },
  team: { tier: 'business', quota: 'seats', title: 'Team seats' },
  compliance: { tier: 'enterprise', quota: null, title: 'Compliance and procurement' },
  billing: { tier: null, quota: null, title: 'Plans' }
};

/** After a dismissal, stay quiet in that placement for this long. */
export const DISMISS_COOLDOWN_HOURS = 14 * 24;

/** Hard ceiling per browser session, so a user browsing ten pages sees one prompt. */
export const MAX_PER_SESSION = 2;

export const STORAGE_KEY = 'cx_upsell_v1';

export const rankOf = (planId) => Math.max(0, TIER_ORDER.indexOf(planId));
export const planFor = (planId) => planById(planId) || PLANS[0];

/** The next tier up, or null at the top. */
export function nextTier(planId) {
  const idx = rankOf(planId);
  return TIER_ORDER[idx + 1] || null;
}

/**
 * Annual saving, computed from the plan model rather than hardcoded.
 * Returns null when either price is zero (the free plan).
 */
export function annualSaving(tierId) {
  const plan = planFor(tierId);
  const { monthly, annual } = plan.price || {};
  if (!monthly || !annual) return null;
  const full = monthly * 12;
  const absolute = full - annual;
  if (absolute <= 0) return null;
  return { perYear: Number(absolute.toFixed(2)), pct: Number(((absolute / full) * 100).toFixed(1)) };
}

export function priceLine(tierId) {
  const plan = planFor(tierId);
  const { monthly, annual } = plan.price || {};
  if (!monthly) return { monthly: 0, annual: 0, text: 'Free' };
  const saving = annualSaving(tierId);
  return {
    monthly,
    annual,
    text: `$${monthly.toFixed(2)}/month or $${annual.toFixed(2)}/year`,
    saving
  };
}

/** How close each metered key is to its ceiling, worst first. */
export function quotaPressure(planId, usage = {}) {
  const plan = planFor(planId);
  return Object.keys(usage)
    .map((key) => {
      const limit = plan.entitlements?.[key];
      const used = Number(usage[key]) || 0;
      if (limit == null || limit === 0) {
        return { key, used, limit: limit ?? null, pct: limit === 0 ? 100 : null, atLimit: limit === 0, unlimited: limit == null };
      }
      const pct = Math.min(100, (used / limit) * 100);
      return { key, used, limit, pct, atLimit: used >= limit, unlimited: false };
    })
    .filter((row) => row.pct != null)
    .sort((a, b) => b.pct - a.pct);
}

/**
 * The recommendation for a placement.
 * Returns null when there is nothing honest to sell: at the top tier, when the
 * suggestion would not move the user up, or when the placement's tier is already
 * owned.
 */
export function recommend({ context, planId, usage = {} } = {}) {
  const placement = PLACEMENTS[context];
  if (!placement) return { show: false, reason: 'unknown-placement' };

  /* The billing page shows the ladder, not a single pitch. */
  if (placement.tier === null) return { show: false, reason: 'ladder' };

  const current = rankOf(planId);
  let tier = placement.tier;

  /* If the placement's tier is not above the user, climb to the next one that is.
     A Pro customer who is out of seats is a Business conversation. */
  if (rankOf(tier) <= current) {
    tier = nextTier(planId);
  }
  if (!tier) return { show: false, reason: 'top-tier' };
  if (rankOf(tier) <= current) return { show: false, reason: 'no-tier-above' };

  const pitch = TIER_PITCH[tier];
  const pressure = placement.quota ? quotaPressure(planId, usage).find((p) => p.key === placement.quota) : null;
  const atLimit = pressure ? pressure.atLimit : false;
  const near = pressure ? pressure.pct >= 80 : false;

  /* A seat prompt only makes sense when seats are actually scarce, and an alerts
     prompt only when alerts are actually close. Anything else is noise. */
  if (placement.quota && !atLimit && !near && context !== 'bots') {
    return { show: false, reason: 'no-pressure', pressure };
  }
  /* Bots are the exception: on Free the entitlement is zero, so "0 of 0 used" is
     the pressure, and a percentage cannot express it. */
  if (context === 'bots' && planFor(planId).entitlements?.bots !== 0 && !atLimit) {
    return { show: false, reason: 'no-pressure' };
  }

  return {
    show: true,
    tier,
    pitch,
    price: priceLine(tier),
    pressure,
    atLimit,
    reason: atLimit ? 'at-limit' : near ? 'near-limit' : 'tier-gap',
    context,
    title: placement.title,
    href: tier === 'enterprise' ? '/compliance' : '/billing'
  };
}

/* --------------------------------------------------------------- frequency */

const defaultState = () => ({ dismissals: {}, sessionShown: 0, lastShownAt: null });

export function readState(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  return {
    /* `session` must survive normalisation, or every read looks like a new
       session and the per-session cap never engages — a prompt on every page. */
    session: typeof raw.session === 'string' ? raw.session : null,
    dismissals: raw.dismissals && typeof raw.dismissals === 'object' ? raw.dismissals : {},
    sessionShown: Number(raw.sessionShown) || 0,
    lastShownAt: raw.lastShownAt || null,
    lastContext: typeof raw.lastContext === 'string' ? raw.lastContext : null
  };
}

/**
 * May this placement render now?
 * `state` is the persisted object, `sessionId` a per-tab value so the session cap
 * resets on a new visit rather than living forever in localStorage.
 */
export function shouldShow({ state, context, now = Date.now(), sessionId = 'session', cooldownHours = DISMISS_COOLDOWN_HOURS, maxPerSession = MAX_PER_SESSION } = {}) {
  const s = readState(state);
  if (s.session !== sessionId) {
    /* New session: clear the counter, keep the dismissals. */
    return { show: true, reason: 'new-session' };
  }
  if (s.sessionShown >= maxPerSession) return { show: false, reason: 'session-cap' };

  const dismissedAt = s.dismissals?.[context];
  if (dismissedAt) {
    const hours = (now - new Date(dismissedAt).getTime()) / 3600000;
    if (hours < cooldownHours) {
      return { show: false, reason: 'cooldown', hoursLeft: Math.ceil(cooldownHours - hours) };
    }
  }
  return { show: true, reason: 'eligible' };
}

export function recordShown({ state, context, now = Date.now(), sessionId = 'session' }) {
  const s = readState(state);
  const sameSession = s.session === sessionId;
  return {
    ...s,
    session: sessionId,
    sessionShown: (sameSession ? s.sessionShown : 0) + 1,
    lastShownAt: new Date(now).toISOString(),
    lastContext: context
  };
}

export function recordDismissed({ state, context, now = Date.now() }) {
  const s = readState(state);
  return {
    ...s,
    dismissals: { ...s.dismissals, [context]: new Date(now).toISOString() }
  };
}

/** Six reasons a paid tier is worth it, for the billing ladder. */
export function ladder(planId) {
  return TIER_ORDER.filter((t) => t !== 'free').map((tier) => ({
    ...TIER_PITCH[tier],
    price: priceLine(tier),
    current: tier === planId,
    above: rankOf(tier) > rankOf(planId)
  }));
}
