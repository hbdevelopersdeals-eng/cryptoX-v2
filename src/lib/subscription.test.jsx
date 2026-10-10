import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import {
  deriveSubscription, entitlementsFor, readUsage, recordCheckoutReturn,
  pricingPlans, ACCESS_STATUSES, SUBSCRIPTION_TABLE, SubscriptionProvider, useSubscription
} from './subscription.jsx';
import { PLANS, planById } from './billing.js';

/* Subscription state. The single most important property in this file is that
 * EVERY failure mode lands on the free tier. */

const NOW = new Date('2026-10-10T12:00:00Z');
const active = (over = {}) => ({ plan_id: 'pro', status: 'active', renews_at: '2026-11-10T00:00:00Z', ends_at: null, test_mode: false, ...over });

describe('subscription: every failure mode fails closed to free', () => {
  it('returns free for no row at all', () => {
    expect(deriveSubscription({ row: null, now: NOW })).toMatchObject({ planId: 'free', isPaid: false, reason: 'no-subscription' });
    expect(deriveSubscription({ now: NOW })).toMatchObject({ planId: 'free', isPaid: false });
    expect(deriveSubscription({ row: 'not-an-object', now: NOW })).toMatchObject({ planId: 'free', isPaid: false });
  });

  it('returns free for an unrecognised status rather than guessing', () => {
    expect(deriveSubscription({ row: active({ status: 'made_up' }), now: NOW })).toMatchObject({ planId: 'free', reason: 'unknown-status' });
    expect(deriveSubscription({ row: active({ status: null }), now: NOW }).isPaid).toBe(false);
  });

  it('returns free for an unknown or non-paid plan', () => {
    expect(deriveSubscription({ row: active({ plan_id: 'made_up' }), now: NOW })).toMatchObject({ planId: 'free', reason: 'unknown-plan' });
    // 'free' is a real plan but it is not a paid one.
    expect(deriveSubscription({ row: active({ plan_id: 'free' }), now: NOW })).toMatchObject({ planId: 'free', reason: 'unknown-plan' });
    expect(deriveSubscription({ row: active({ plan_id: null }), now: NOW }).isPaid).toBe(false);
  });

  it('NEVER lets a test-mode subscription grant live access', () => {
    const res = deriveSubscription({ row: active({ test_mode: true }), now: NOW, deploymentLive: true });
    expect(res).toMatchObject({ planId: 'free', isPaid: false, reason: 'test-subscription-confers-no-live-access', testMode: true });
    // In a test deployment it does grant, which is how test mode is usable.
    expect(deriveSubscription({ row: active({ test_mode: true }), now: NOW, deploymentLive: false }).isPaid).toBe(true);
  });

  it('treats an active status with a lapsed period as lapsed', () => {
    const res = deriveSubscription({ row: active({ renews_at: '2026-09-01T00:00:00Z' }), now: NOW });
    expect(res).toMatchObject({ planId: 'free', isPaid: false, reason: 'period-lapsed' });
  });

  it('honours a grace period without extending it for ever', () => {
    const row = active({ renews_at: '2026-10-08T00:00:00Z' });
    expect(deriveSubscription({ row, now: NOW }).isPaid).toBe(false);
    expect(deriveSubscription({ row, now: NOW, graceDays: 3 }).isPaid).toBe(true);
    expect(deriveSubscription({ row, now: new Date('2026-12-01T00:00:00Z'), graceDays: 3 }).isPaid).toBe(false);
  });

  it('withholds access for paused, unpaid and expired', () => {
    for (const status of ['paused', 'unpaid', 'expired']) {
      const res = deriveSubscription({ row: active({ status }), now: NOW });
      expect(res.isPaid, status).toBe(false);
      expect(res.planId, status).toBe('free');
    }
  });

  it('grants the access statuses while the period holds', () => {
    for (const status of ACCESS_STATUSES) {
      expect(deriveSubscription({ row: active({ status }), now: NOW }).isPaid, status).toBe(true);
    }
    expect(ACCESS_STATUSES).toEqual(['on_trial', 'active', 'past_due']);
  });
});

describe('subscription: cancellation keeps what was paid for', () => {
  it('keeps access until the paid period ends', () => {
    const res = deriveSubscription({ row: active({ status: 'cancelled', ends_at: '2026-11-01T00:00:00Z' }), now: NOW });
    expect(res).toMatchObject({ planId: 'pro', isPaid: true, reason: 'cancelled-but-still-paid', cancelAt: '2026-11-01T00:00:00Z' });
  });

  it('drops access once that period has passed', () => {
    const res = deriveSubscription({ row: active({ status: 'cancelled', ends_at: '2026-10-01T00:00:00Z' }), now: NOW });
    expect(res).toMatchObject({ planId: 'free', isPaid: false, reason: 'period-ended' });
  });

  it('does not treat a cancellation with no end date as continuing for ever', () => {
    const res = deriveSubscription({ row: active({ status: 'cancelled', ends_at: null, renews_at: null }), now: NOW });
    expect(res.isPaid).toBe(false);
  });
});

describe('subscription: entitlements follow the derived plan', () => {
  it('gives a paid user that plan’s entitlements', () => {
    const ent = entitlementsFor({ isPaid: true, planId: 'pro' });
    expect(ent).toMatchObject({ alerts: 100, bots: 3, portfolios: 10, seats: 3 });
  });

  it('gives a non-paid user the free entitlements whatever the plan field says', () => {
    // A lapsed Pro row must not keep Pro limits.
    const ent = entitlementsFor({ isPaid: false, planId: 'pro' });
    expect(ent).toMatchObject({ alerts: 5, bots: 0, portfolios: 1 });
  });

  it('falls back to free for a missing or unknown state', () => {
    expect(entitlementsFor(null)).toMatchObject({ bots: 0 });
    expect(entitlementsFor({ isPaid: true, planId: 'nonsense' })).toMatchObject({ alerts: 5 });
  });

  it('returns a copy, so a caller cannot mutate the shared plan table', () => {
    const ent = entitlementsFor({ isPaid: true, planId: 'pro' });
    ent.alerts = 99999;
    expect(planById('pro').entitlements.alerts).toBe(100);
  });
});

describe('subscription: usage comes from where the features store it', () => {
  it('reports zero rather than inventing a count when nothing is stored', () => {
    const usage = readUsage();
    expect(usage).toMatchObject({ alerts: 0, bots: 0, portfolios: 0 });
    // API calls are tracked server-side only, so the client says so.
    expect(usage.apiCallsPerMonth).toBeNull();
  });

  it('never reports a usage it cannot actually measure', () => {
    for (const [key, value] of Object.entries(readUsage())) {
      expect(['alerts', 'bots', 'portfolios', 'seats', 'apiCallsPerMonth'], key).toContain(key);
      expect(value === null || typeof value === 'number', key).toBe(true);
    }
  });
});

describe('subscription: a checkout redirect grants nothing', () => {
  it('records the return and explicitly grants nothing', () => {
    const res = recordCheckoutReturn({ status: 'success' });
    expect(res.granted).toBe(false);
    expect(res.refresh).toBe(true);
    expect(res.note).toMatch(/as soon as the payment provider confirms/i);
  });

  it('says nothing was charged on a cancelled checkout', () => {
    expect(recordCheckoutReturn({ status: null }).note).toMatch(/Nothing was charged/);
  });

  it('does not grant for any status a query string could carry', () => {
    for (const status of ['success', 'paid', 'active', 'complete', 'grant-me', null]) {
      expect(recordCheckoutReturn({ status }).granted, String(status)).toBe(false);
    }
  });
});

describe('subscription: pricing comes from one place', () => {
  it('exposes the real plan prices with no invention', () => {
    const rows = pricingPlans();
    expect(rows.map((p) => p.id)).toEqual(['free', 'pro', 'business', 'enterprise']);
    expect(rows.find((p) => p.id === 'pro')).toMatchObject({ monthly: 9.99, annual: 99.99 });
    expect(rows.find((p) => p.id === 'business')).toMatchObject({ monthly: 24.99, annual: 249.99 });
    expect(rows.find((p) => p.id === 'free')).toMatchObject({ monthly: 0, annual: 0 });
  });

  it('includes Enterprise, which is purchasable with a list price', () => {
    expect(pricingPlans().map((p) => p.id)).toContain('enterprise');
    expect(planById('enterprise').price.monthly).toBe(199.99);
  });

  it('always matches the plan table exactly', () => {
    for (const row of pricingPlans()) {
      const plan = planById(row.id);
      expect(row.monthly).toBe(plan.price.monthly);
      expect(row.annual).toBe(plan.price.annual);
      expect(row.name).toBe(plan.name);
    }
    // And no plan is silently dropped or added.
    expect(pricingPlans().length).toBe(PLANS.filter((p) => !p.contactOnly).length);
  });
});

describe('subscription: the provider resolves to free when the backend is absent', () => {
  it('exposes the free tier, because no backend is configured in this build', () => {
    const { result } = renderHook(() => useSubscription(), {
      wrapper: ({ children }) => <SubscriptionProvider>{children}</SubscriptionProvider>
    });
    expect(result.current.planId).toBe('free');
    expect(result.current.isPaid).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.entitlements).toMatchObject({ bots: 0, alerts: 5 });
  });

  it('refuses a gated entitlement for a free user through the provider API', () => {
    const { result } = renderHook(() => useSubscription(), {
      wrapper: ({ children }) => <SubscriptionProvider>{children}</SubscriptionProvider>
    });
    expect(result.current.has('bots')).toBe(false);
    expect(result.current.can('alerts', 5).allowed).toBe(false);
    expect(result.current.can('alerts', 4).allowed).toBe(true);
    expect(result.current.upgradeTarget('bots')).toMatchObject({ ok: true, planId: 'pro' });
  });

  it('offers management only to a payer', () => {
    const { result } = renderHook(() => useSubscription(), {
      wrapper: ({ children }) => <SubscriptionProvider>{children}</SubscriptionProvider>
    });
    expect(result.current.management).toMatchObject({ showUpgrade: true, showManagement: false });
  });

  it('names the table it reads, so the contract is explicit', () => {
    expect(SUBSCRIPTION_TABLE).toBe('cx_subscriptions');
  });
});
