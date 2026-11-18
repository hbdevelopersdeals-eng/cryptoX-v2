/* Server-authoritative entitlements (the fix for "quotas are UI-only").
 *
 * HISTORY. Entitlements used to be a browser-side affordance: `upgrade.js`
 * hid a button and `plans.js` compared usage to a limit that lived in the same
 * bundle. That is a pricing page, not access control — a user can edit
 * localStorage, and a paid quota nobody enforces is a false claim on the
 * pricing table.
 *
 * The model now has one authority: Postgres. `supabase/migrations/0007_entitlements.sql`
 * owns `cx_usage_counters` and the `cx_consume_quota()` function, which takes a
 * row lock, reads the caller's plan from `cx_subscriptions`, and either
 * increments the counter or refuses. The table has no INSERT/UPDATE policy for
 * `authenticated`, so the only way to move a counter is through that function.
 *
 * What this module is for, therefore, is not enforcement. It is:
 *   1. PREDICTION — the UI asks "may I?" before the round trip, so a button can
 *      be disabled with a reason instead of failing after a click.
 *   2. EXPLANATION — every refusal carries the limit, the usage and the reset
 *      date, because "quota exceeded" with no numbers is a support ticket.
 *   3. HONESTY — `ENFORCEMENT` records which keys are server-enforced. If the
 *      migration has not been applied, the UI must say so rather than imply
 *      protection that is not there.
 */

import { planById } from './plans.js';

/** Keys the server meters. Order matches the pricing table. */
export const QUOTA_KEYS = ['alerts', 'portfolios', 'bots', 'apiCallsPerMonth', 'seats'];

export const QUOTA_LABELS = {
  alerts: 'Price alerts',
  portfolios: 'Portfolios',
  bots: 'Trading bots',
  apiCallsPerMonth: 'API calls / month',
  seats: 'Team seats'
};

/**
 * Enforcement status per key, as of this build.
 *
 * `server: true` means `cx_consume_quota()` refuses the write past the limit.
 * `server: false` means the value is still display-only and the UI must label
 * it as such — a price that is not enforced is a promise the product cannot
 * keep, so the honest move is to say so until the migration is deployed.
 */
export const ENFORCEMENT = {
  alerts: { server: true, table: 'cx_alerts', mechanism: 'trigger + cx_consume_quota' },
  portfolios: {
    server: false,
    /* `ready` means the mechanism EXISTS in a migration but may not be applied to
     * the deployment the reader is looking at. Three states, not two: claiming
     * "server" for a migration that is not deployed is the same lie as claiming a
     * quota nobody checks. The pricing page words this state separately. */
    ready: true,
    migration: '0008_quotas_portfolios_seats.sql',
    table: 'cx_settings',
    mechanism: 'trigger on cx_settings.portfolios (jsonb array length)',
    note: 'Until 0008 is applied, portfolios are counted in the app only.'
  },
  bots: { server: true, table: 'cx_strategy_arms', mechanism: 'trigger + cx_consume_quota' },
  apiCallsPerMonth: { server: true, table: 'cx_usage_counters', mechanism: 'atomic counter' },
  seats: {
    server: false,
    ready: true,
    migration: '0008_quotas_portfolios_seats.sql',
    table: 'cx_org_members',
    mechanism: 'trigger on cx_org_members (owner plan seat count)',
    note: 'Until 0008 is applied, seats are advisory.'
  }
};

/** 'server' | 'pending-migration' | 'display-only' — one word per quota. */
export function enforcementState(key) {
  const entry = ENFORCEMENT[key];
  if (!entry) return 'display-only';
  if (entry.server) return 'server';
  return entry.ready ? 'pending-migration' : 'display-only';
}

export const MIGRATION = '0007_entitlements.sql';

/** Calendar-month period key in UTC — the same string the SQL function writes. */
export function periodKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** When the current period's counters reset. */
export function nextReset(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** The plan's limit for a key. `null` means unlimited, `undefined` means unknown. */
export function limitFor(planId, key) {
  const plan = planById(planId);
  if (!plan) return undefined;
  const value = plan.entitlements?.[key];
  return value === undefined ? undefined : value;
}

/**
 * Predict whether an increment is allowed.
 *
 * Fails CLOSED on an unknown key or unknown plan: an unknown key cannot be
 * mapped to a limit, and "no limit found" must never mean "unlimited".
 */
export function checkQuota({ planId, key, used = 0, amount = 1 } = {}) {
  const limit = limitFor(planId, key);
  if (limit === undefined) {
    return {
      allowed: false,
      limit: null,
      used,
      remaining: 0,
      reason: 'unknown-key',
      message: `"${key}" is not an entitlement this platform meters.`
    };
  }
  if (limit === null) {
    return { allowed: true, limit: null, used, remaining: null, period: periodKey(), reason: 'unlimited', message: 'Unlimited on this plan.' };
  }

  const predicted = used + Math.max(0, amount);
  const allowed = predicted <= limit;
  return {
    allowed,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    predicted,
    period: periodKey(),
    resetAt: nextReset().toISOString(),
    reason: allowed ? 'within-quota' : 'quota-exceeded',
    message: allowed
      ? `${predicted} of ${limit} used.`
      : `Limit reached: ${used} of ${limit} ${QUOTA_LABELS[key] || key}. Resets ${nextReset().toISOString().slice(0, 10)}.`
  };
}

/** Remaining headroom for every metered key, for the billing page. */
export function usageSummary(planId, usage = {}) {
  return QUOTA_KEYS.map((key) => {
    const limit = limitFor(planId, key);
    const used = Number(usage[key]) || 0;
    return {
      key,
      label: QUOTA_LABELS[key],
      used,
      limit,
      unlimited: limit === null,
      remaining: limit === null ? null : Math.max(0, limit - used),
      pct: limit === null || limit === 0 ? null : Math.min(100, (used / limit) * 100),
      enforcement: enforcementState(key)
    };
  });
}

/**
 * Should the UI warn before the wall?
 * 80% is the threshold: warning at the limit is a warning after the harm.
 */
export function quotaWarning(planId, key, used = 0, threshold = 0.8) {
  const check = checkQuota({ planId, key, used, amount: 0 });
  if (check.limit == null) return null;
  const ratio = check.limit === 0 ? 1 : used / check.limit;
  if (ratio < threshold) return null;
  return {
    ...check,
    ratio,
    severity: ratio >= 1 ? 'blocked' : 'warning',
    message: ratio >= 1
      ? `${QUOTA_LABELS[key] || key}: limit of ${check.limit} reached.`
      : `${QUOTA_LABELS[key] || key}: ${Math.round(ratio * 100)}% of ${check.limit} used.`
  };
}

/**
 * Normalise the JSON that `cx_consume_quota()` returns into the same shape as
 * `checkQuota`, so callers do not branch on which side answered.
 */
export function fromServer(payload = {}) {
  const allowed = Boolean(payload.allowed);
  return {
    allowed,
    limit: payload.limit ?? null,
    used: Number(payload.used) || 0,
    remaining: payload.remaining ?? null,
    period: payload.period || periodKey(),
    resetAt: payload.reset_at || nextReset().toISOString(),
    planId: payload.plan_id || null,
    reason: allowed ? 'within-quota' : 'quota-exceeded',
    message: allowed
      ? `${payload.used ?? 0}${payload.limit == null ? '' : ` of ${payload.limit}`} used.`
      : `Limit reached (${payload.limit}). Upgrade or wait for the next period.`
  };
}

/**
 * The one call a write path should make before persisting.
 * `client` is a Supabase client; when it is missing the caller gets a clear
 * "cannot verify" rather than a silent local yes.
 */
export async function consumeQuota(client, key, amount = 1) {
  if (!client?.rpc) {
    return { allowed: false, reason: 'no-client', message: 'Entitlements could not be verified: no database session.' };
  }
  const { data, error } = await client.rpc('cx_consume_quota', { p_key: key, p_amount: amount });
  if (error) {
    /* A failed quota call must not fail open: refuse the write and surface why. */
    return { allowed: false, reason: 'rpc-error', message: error.message || 'Quota check failed.' };
  }
  return fromServer(Array.isArray(data) ? data[0] : data);
}

/**
 * Read current usage for the signed-in user. Returns `null` counters with a
 * `note` when the migration is absent, so the billing page can say "not metered
 * yet" instead of rendering zeros as if they were real.
 */
export async function readUsage(client, now = Date.now()) {
  if (!client?.from) return { ok: false, note: 'No database session.', usage: {} };
  const { data, error } = await client
    .from('cx_usage_counters')
    .select('key,used')
    .eq('period', periodKey(now));
  if (error) return { ok: false, note: error.message, usage: {} };
  const usage = {};
  for (const row of data || []) usage[row.key] = Number(row.used) || 0;
  return { ok: true, note: null, usage };
}
