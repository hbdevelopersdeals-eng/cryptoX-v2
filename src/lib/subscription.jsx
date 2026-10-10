import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { lsGet, lsSet } from './storage.js';
import { PLANS, planById } from './plans.js';
import { supabase, supabaseConfigured } from './supabase.js';
import { usageState as limitState, cheapestPlanWith, isPaidPlan, managementInfo } from './upgrade.js';

/* Subscription and entitlement state.
 *
 * THE SOURCE OF TRUTH IS THE BACKEND. This module reads a `cx_subscriptions`
 * row and derives everything from it. It is written so that every failure mode
 * lands on the FREE tier:
 *
 *   - Supabase not configured            → free
 *   - no row for the user                → free
 *   - row present but the period lapsed  → free
 *   - status the app does not recognise  → free
 *   - a test-mode subscription           → free (in a live deployment)
 *   - anything throws                    → free
 *
 * FAILING CLOSED IS THE WHOLE POINT. A subscription check that falls back to
 * "grant" turns one network error into free premium for everyone.
 *
 * WHAT THIS IS NOT. Client-side gating is a UI affordance, not access control.
 * Every value here is readable and editable by the person using the app, so a
 * gate in the browser protects nothing on its own. The paid features must be
 * enforced where the data lives — in Supabase RLS and in the API — and until
 * that exists this file changes what the user SEES, not what they CAN DO.
 */

export const SUBSCRIPTION_TABLE = 'cx_subscriptions';

/** Statuses that grant paid access while they hold — mirrors the provider rules. */
export const ACCESS_STATUSES = ['on_trial', 'active', 'past_due'];

/**
 * Derive the entitlement-bearing state from a subscription row.
 * Pure, so every branch above is testable without a network.
 */
export function deriveSubscription({ row = null, now = new Date(), graceDays = 0, deploymentLive = true } = {}) {
  const free = {
    planId: 'free',
    status: 'none',
    isPaid: false,
    reason: 'no-subscription',
    renewsAt: null,
    endsAt: null,
    cancelAt: null,
    testMode: false
  };
  if (!row || typeof row !== 'object') return free;

  const status = String(row.status || '');
  if (!ACCESS_STATUSES.includes(status) && status !== 'cancelled' && status !== 'unpaid' && status !== 'expired' && status !== 'paused') {
    return { ...free, reason: 'unknown-status' };
  }

  const testMode = row.test_mode === true;
  // A test subscription must never confer live access.
  if (testMode && deploymentLive) return { ...free, reason: 'test-subscription-confers-no-live-access', testMode: true };

  const planId = row.plan_id;
  if (!planById(planId) || !isPaidPlan(planId)) {
    return { ...free, reason: 'unknown-plan', planId: 'free' };
  }

  const horizon = row.ends_at || row.renews_at || null;
  const withGrace = horizon ? new Date(horizon).getTime() + graceDays * 86_400_000 : null;

  // A cancellation keeps access until the period already paid for ends.
  if (status === 'cancelled') {
    const stillPaid = withGrace != null && new Date(now).getTime() < withGrace;
    return {
      planId: stillPaid ? planId : 'free',
      status,
      isPaid: stillPaid,
      reason: stillPaid ? 'cancelled-but-still-paid' : 'period-ended',
      renewsAt: row.renews_at || null,
      endsAt: row.ends_at || null,
      cancelAt: row.ends_at || null,
      testMode
    };
  }

  if (!ACCESS_STATUSES.includes(status)) {
    return { planId: 'free', status, isPaid: false, reason: `status-${status}`, renewsAt: row.renews_at || null, endsAt: row.ends_at || null, cancelAt: null, testMode };
  }

  // An active status with a lapsed horizon is lapsed: a missed webhook must not
  // extend access for ever.
  if (withGrace != null && new Date(now).getTime() >= withGrace) {
    return { planId: 'free', status, isPaid: false, reason: 'period-lapsed', renewsAt: row.renews_at || null, endsAt: row.ends_at || null, cancelAt: null, testMode };
  }

  return {
    planId,
    status,
    isPaid: true,
    reason: 'within-period',
    renewsAt: row.renews_at || null,
    endsAt: row.ends_at || null,
    cancelAt: null,
    testMode
  };
}

/** The entitlements for a derived state. Free when not paid. */
export function entitlementsFor(derived) {
  const plan = planById(derived?.isPaid ? derived.planId : 'free') || planById('free');
  return { ...plan.entitlements };
}

/* ------------------------------------------------------------------ usage */

/**
 * Real usage, read from where the features actually store it. No invented
 * counters: if a feature does not record usage, its usage is not reported.
 */
export function readUsage() {
  const count = (key) => {
    const value = lsGet(key, null);
    if (Array.isArray(value)) return value.filter(Boolean).length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
  };
  let portfolios = 0;
  const portfolio = lsGet('cx_portfolio', null);
  if (Array.isArray(portfolio)) portfolios = portfolio.filter(Boolean).length;
  else if (portfolio && typeof portfolio === 'object') portfolios = Object.keys(portfolio).length;

  return {
    alerts: count('cx_alerts'),
    bots: count('cx_bots'),
    portfolios,
    seats: 1,
    apiCallsPerMonth: null // tracked server-side only; not guessable here
  };
}

/* ---------------------------------------------------------------- provider */

const SubscriptionContext = createContext(null);
export const useSubscription = () => useContext(SubscriptionContext);

export function SubscriptionProvider({ children, deploymentLive = true, now = () => new Date() }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!supabaseConfigured || !supabase) {
      // Not configured is a legitimate state, not an error: the app runs in
      // demo mode and every user is free.
      setLoading(false);
      setRow(null);
      return () => { alive = false; };
    }
    (async () => {
      try {
        const { data, error } = await supabase.from(SUBSCRIPTION_TABLE).select('*').limit(1).maybeSingle();
        if (!alive) return;
        // An error reading the subscription is NOT a reason to grant access.
        setRow(error ? null : data || null);
      } catch {
        if (alive) setRow(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const value = useMemo(() => {
    const derived = deriveSubscription({ row, now: now(), deploymentLive });
    const entitlements = entitlementsFor(derived);
    return {
      ...derived,
      loading,
      entitlements,
      plan: planById(derived.isPaid ? derived.planId : 'free'),
      /** Can this user use an entitlement, at this usage? */
      can(entitlement, used = 0) {
        const planId = derived.isPaid ? derived.planId : 'free';
        const state = limitState({ entitlement, planId, used });
        if (!state.ok) return { allowed: false, reason: state.reason };
        return { allowed: !state.atLimit, state };
      },
      /**
       * Does this plan INCLUDE the entitlement at all?
       *
       * Deliberately not `hasEntitlement(...)` from billing.js: that is a QUOTA
       * check, so `hasEntitlement('free', 'bots', 0)` is true — "0 used of 0
       * allowed" is within quota. Read as a capability that says a free user
       * HAS bots, which a naive gate treats as permission. A numeric limit of 0
       * means the tier does not include it; null means unlimited.
       */
      has(entitlement) {
        const limit = (planById(derived.isPaid ? derived.planId : 'free') || planById('free'))?.entitlements?.[entitlement];
        if (limit == null) return true;
        return Number(limit) > 0;
      },
      usage(entitlement, used = 0) {
        return limitState({ entitlement, planId: derived.isPaid ? derived.planId : 'free', used });
      },
      upgradeTarget(entitlement) {
        return cheapestPlanWith(entitlement, { fromPlanId: derived.isPaid ? derived.planId : 'free' });
      },
      management: managementInfo(derived),
      refresh: () => setRefreshKey((k) => k + 1)
    };
  }, [row, loading, deploymentLive, now]);

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

/* ------------------------------------------------- redirect is not evidence */

/**
 * Record that the user returned from checkout, WITHOUT granting anything.
 *
 * The only thing this does is trigger a refresh, because the webhook may have
 * landed. Access still comes from the database row, never from the query string.
 */
export function recordCheckoutReturn({ status = null } = {}) {
  lsSet('cx_checkout_return', { status, at: new Date().toISOString() });
  return {
    refresh: true,
    granted: false,
    note: status === 'success'
      ? 'Thanks — we are confirming your payment. Access appears as soon as the payment provider confirms it, which is usually instant.'
      : 'Checkout was not completed. Nothing was charged.'
  };
}

/** The plans the pricing page should offer, with no price invented. */
export const pricingPlans = () => PLANS.filter((p) => !p.contactOnly).map((p) => ({
  id: p.id,
  name: p.name,
  rank: p.rank,
  monthly: p.price?.monthly ?? null,
  annual: p.price?.annual ?? null,
  trialDays: p.trialDays ?? 0,
  entitlements: { ...p.entitlements }
}));
