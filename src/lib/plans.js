/* The plan catalogue.
 *
 * Split out of billing.js deliberately. The plan list is read all over the app
 * at startup — the header, the pricing page, every entitlement check — while the
 * billing engine beside it (period arithmetic, proration, dunning, refunds) is
 * only needed on the billing page.
 *
 * They lived in one module, so the first eager importer of `PLANS` dragged the
 * whole engine into the initial bundle and pushed the entry chunk over its
 * budget. A small leaf module fixes that structurally, rather than by raising
 * the budget: billing.js re-exports every name below, so no existing import
 * changes.
 *
 * Nothing here branches on a plan NAME. A check like `plan === 'pro'` is how a
 * trial becomes permanent; entitlements are data.
 */

export const BILLING_CYCLES = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'annual', label: 'Annual', months: 12 }
];

export const PLANS = [
  {
    id: 'free', name: 'Free', rank: 0, price: { monthly: 0, annual: 0 },
    entitlements: {
      portfolios: 1, alerts: 5, bots: 0, apiCallsPerMonth: 1000,
      seats: 1, auditLogDays: 7, exportFormats: ['csv'], support: 'community'
    }
  },
  {
    id: 'pro', name: 'Pro', rank: 1, price: { monthly: 29, annual: 290 },
    trialDays: 14,
    entitlements: {
      portfolios: 10, alerts: 100, bots: 3, apiCallsPerMonth: 250000,
      seats: 3, auditLogDays: 90, exportFormats: ['csv', 'json'], support: 'email'
    }
  },
  {
    id: 'team', name: 'Team', rank: 2, price: { monthly: 99, annual: 990 },
    trialDays: 14,
    entitlements: {
      portfolios: 50, alerts: 1000, bots: 25, apiCallsPerMonth: 2000000,
      seats: 25, auditLogDays: 365, exportFormats: ['csv', 'json', 'xlsx'], support: 'priority'
    }
  },
  {
    id: 'enterprise', name: 'Enterprise', rank: 3, price: { monthly: null, annual: null },
    // Quoted per contract, so there is no list price to prorate against.
    contactOnly: true,
    entitlements: {
      portfolios: null, alerts: null, bots: null, apiCallsPerMonth: null,
      seats: null, auditLogDays: 2555, exportFormats: ['csv', 'json', 'xlsx'], support: 'dedicated'
    }
  }
];

export const planById = (id) => PLANS.find((p) => p.id === id) || null;

/**
 * Is a given usage within the plan's quota?
 *
 * Note this is a QUOTA check, not a capability check: with a limit of 0 and a
 * usage of 0 it returns true, because "nothing used of nothing allowed" is
 * within quota. Asking whether a plan INCLUDES a feature is a different
 * question — see `has()` in subscription.jsx, which treats 0 as not included.
 */
export function hasEntitlement(planId, key, usage = 0) {
  const plan = planById(planId);
  if (!plan) return false;
  const limit = plan.entitlements?.[key];
  if (limit == null) return true;
  if (key === 'exportFormats' || key === 'support') return true;
  return usage <= limit;
}

export function entitlementGap(fromPlanId, toPlanId, entitlement) {
  const from = planById(fromPlanId)?.entitlements?.[entitlement];
  const to = planById(toPlanId)?.entitlements?.[entitlement];
  if (to == null) return { unlimited: true };
  const shrinking = from != null && to < from;
  return { from, to, shrinking, note: shrinking ? 'Downgrade reduces this limit.' : null };
}
