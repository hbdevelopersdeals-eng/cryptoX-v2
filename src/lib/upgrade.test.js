import { describe, it, expect } from 'vitest';
import {
  GATED_ROUTES, USAGE_LIMITS, routeGate, cheapestPlanWith, usageState, limitHit,
  upgradePromptFor, DISMISSAL_TTL_MS, shouldSuppress, dismiss, oncePerFlow,
  annualSaving, purchasablePlans, pricingIntegrity, pricingAgrees,
  UPGRADE_EVENTS, createEventDeduper, CONVERSION_FUNNEL, conversionByContext,
  ctaFor, upgradeContextFor, isPaidPlan, managementInfo
} from './upgrade.js';
import { PLANS, planById } from './billing.js';
import { EVENT_NAMES, validateEvent } from './analytics.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const PAID = ['pro', 'business', 'enterprise'];

/* The upgrade experience. Every gate below exists because PLANS says so. */

describe('upgrade: gates come from the plan data, not from invention', () => {
  it('gates only routes that a free plan genuinely cannot use', () => {
    const free = planById('free');
    for (const [route, gate] of Object.entries(GATED_ROUTES)) {
      // bots is 0 on Free, which is the only thing that justifies a hard gate.
      expect(free.entitlements[gate.entitlement], `${route} → ${gate.entitlement}`).toBe(0);
    }
  });

  it('gates nothing for a paid plan that has the entitlement', () => {
    for (const planId of PAID) {
      for (const route of Object.keys(GATED_ROUTES)) {
        expect(routeGate(route, planId).gated, `${planId} ${route}`).toBe(false);
      }
    }
  });

  it('gates every listed route for a free user', () => {
    for (const route of Object.keys(GATED_ROUTES)) {
      expect(routeGate(route, 'free').gated, route).toBe(true);
    }
  });

  it('never gates a route that is not premium', () => {
    // Blocking free features to force a purchase is the thing not to do.
    for (const route of ['/', '/watchlist', '/news', '/calculator', '/region', '/account', '/billing']) {
      expect(routeGate(route, 'free').gated, route).toBe(false);
    }
  });

  it('gates an unknown plan conservatively rather than granting access', () => {
    expect(routeGate('/bots', 'made_up').gated).toBe(true);
    expect(routeGate('/bots', 'made_up').reason_unavailable).toBe('unknown-plan');
  });

  it('explains each gate with a concrete capability, not "upgrade to unlock"', () => {
    for (const gate of Object.values(GATED_ROUTES)) {
      expect(gate.title).toBeTruthy();
      expect(gate.reason.length).toBeGreaterThan(20);
      expect(gate.reason).not.toMatch(/unlock/i);
      expect(gate.feature).toBeTruthy();
    }
  });
});

describe('upgrade: the target plan is the cheapest one that helps', () => {
  it('suggests Pro for a limit Team also improves', () => {
    // Sending a free user straight to the most expensive tier is the mistake.
    expect(cheapestPlanWith('bots', { fromPlanId: 'free' })).toMatchObject({ ok: true, planId: 'pro' });
    expect(cheapestPlanWith('alerts', { fromPlanId: 'free' })).toMatchObject({ ok: true, planId: 'pro' });
  });

  it('suggests Team when Pro would not improve the entitlement', () => {
    // Working down from Team, only Enterprise improves seats, and it is quoted
    // per contract, so there is nothing to sell and that must be reported.
    // Business seats are 25 and Enterprise is unlimited, so Business DOES have
    // an upgrade to sell here.
    expect(cheapestPlanWith('seats', { fromPlanId: 'business' })).toMatchObject({ ok: true, planId: 'enterprise' });
  });

  it('offers nothing when the plan is already unlimited', () => {
    expect(cheapestPlanWith('alerts', { fromPlanId: 'enterprise' })).toMatchObject({ ok: false });
  });

  it('never offers a contact-only plan as a self-serve upgrade', () => {
    for (const entitlement of Object.keys(USAGE_LIMITS)) {
      const res = cheapestPlanWith(entitlement, { fromPlanId: 'free' });
      if (res.ok) expect(planById(res.planId).contactOnly, entitlement).toBeFalsy();
    }
  });

  it('reports the real numeric improvement', () => {
    expect(cheapestPlanWith('alerts', { fromPlanId: 'free' })).toMatchObject({ from: 5, to: 100 });
    expect(cheapestPlanWith('bots', { fromPlanId: 'free' })).toMatchObject({ from: 0, to: 3 });
  });
});

describe('upgrade: real usage against a real limit', () => {
  it('counts usage against the free alert limit', () => {
    const res = usageState({ entitlement: 'alerts', planId: 'free', used: 3 });
    expect(res).toMatchObject({ ok: true, used: 3, limit: 5, remaining: 2, atLimit: false, unlimited: false });
  });

  it('flags the limit as reached at exactly the limit', () => {
    expect(usageState({ entitlement: 'alerts', planId: 'free', used: 5 }).atLimit).toBe(true);
    expect(usageState({ entitlement: 'alerts', planId: 'free', used: 6 }).atLimit).toBe(true);
  });

  it('reports unlimited as null rather than a number implying a ceiling', () => {
    const res = usageState({ entitlement: 'alerts', planId: 'enterprise', used: 900 });
    expect(res).toMatchObject({ unlimited: true, limit: null, remaining: null, atLimit: false });
  });

  it('knows which limits reset and which do not', () => {
    expect(usageState({ entitlement: 'apiCallsPerMonth', planId: 'free', used: 1 }).resets).toBe('monthly');
    expect(usageState({ entitlement: 'alerts', planId: 'free', used: 1 }).resets).toBeNull();
    expect(USAGE_LIMITS.apiCallsPerMonth.resets).toBe('monthly');
  });

  it('treats missing or nonsense usage as zero, never as over the limit', () => {
    for (const used of [undefined, null, NaN, -5, 'x']) {
      const res = usageState({ entitlement: 'alerts', planId: 'free', used });
      expect(res.used, String(used)).toBe(0);
      expect(res.atLimit, String(used)).toBe(false);
    }
    expect(usageState({ entitlement: 'alerts', planId: 'free', used: 2.9 }).used).toBe(2);
  });

  it('refuses an unknown entitlement instead of inventing a limit', () => {
    expect(usageState({ entitlement: 'unicorns' })).toMatchObject({ ok: false, reason: 'unknown-entitlement' });
    expect(usageState({ entitlement: 'alerts', planId: 'nope' })).toMatchObject({ ok: false, reason: 'unknown-plan' });
  });

  it('surfaces a hit only once the limit is actually reached', () => {
    expect(limitHit({ entitlement: 'alerts', planId: 'free', used: 4 }).hit).toBe(false);
    const hit = limitHit({ entitlement: 'alerts', planId: 'free', used: 5 });
    expect(hit.hit).toBe(true);
    expect(hit.upgrade.planId).toBe('pro');
  });
});

describe('upgrade: prompts are truthful and minimal', () => {
  it('gives a free user a feature prompt for a gated route', () => {
    const prompt = upgradePromptFor({ route: '/bots', planId: 'free', now: NOW });
    expect(prompt).toMatchObject({ kind: 'feature', entitlement: 'bots', targetPlanId: 'pro' });
    expect(prompt.title).toMatch(/Trading bots/);
    expect(prompt.detail).toMatch(/DCA/);
    expect(prompt.cta).toBe('Upgrade to Pro');
  });

  it('gives a paid user NO prompt for a feature they already have', () => {
    // Misleading upgrade prompts to a paying subscriber are the thing to avoid.
    expect(upgradePromptFor({ route: '/bots', planId: 'pro', now: NOW })).toBeNull();
    expect(upgradePromptFor({ route: '/bots', planId: 'business', now: NOW })).toBeNull();
  });

  it('gives no prompt on a free route, for any plan', () => {
    for (const planId of ['free', 'pro', 'team', 'enterprise']) {
      expect(upgradePromptFor({ route: '/watchlist', planId, now: NOW }), planId).toBeNull();
    }
  });

  it('prompts on a limit with the used count, the limit and the reset rule', () => {
    const prompt = upgradePromptFor({ entitlement: 'alerts', planId: 'free', used: 5, now: NOW });
    expect(prompt).toMatchObject({ kind: 'limit', entitlement: 'alerts' });
    expect(prompt.detail).toBe('5 of 5 used.');
    expect(prompt.resets).toBeNull();
    // It must NOT promise a reset that does not exist.
    expect(prompt.resetsNote).toMatch(/does not reset/i);
    expect(prompt.title).toMatch(/price alerts/);
  });

  it('promises a monthly reset only where one exists', () => {
    const monthly = upgradePromptFor({ entitlement: 'apiCallsPerMonth', planId: 'free', used: 1000, now: NOW });
    expect(monthly.resetsNote).toMatch(/resets at the start of each month/i);
  });

  it('states the benefit numerically, from the plan data', () => {
    const prompt = upgradePromptFor({ entitlement: 'alerts', planId: 'free', used: 5, now: NOW });
    expect(prompt.benefit).toBe('100 price alerts on Pro.');
  });

  it('never invents scarcity, discounts or social proof', () => {
    const prompts = [
      upgradePromptFor({ route: '/bots', planId: 'free', now: NOW }),
      upgradePromptFor({ entitlement: 'alerts', planId: 'free', used: 5, now: NOW }),
      upgradePromptFor({ entitlement: 'bots', planId: 'free', used: 0, now: NOW })
    ].filter(Boolean);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      const text = JSON.stringify(p);
      expect(text, text).not.toMatch(/expires|hurry|last chance|limited time|ends in|\d+% off|off today|people are|joined|trusted by/i);
    }
  });

  it('returns null when there is no genuine opportunity', () => {
    expect(upgradePromptFor({ planId: 'free', now: NOW })).toBeNull();
    expect(upgradePromptFor({ entitlement: 'alerts', planId: 'free', used: 1, now: NOW })).toBeNull();
    expect(upgradePromptFor({ entitlement: 'alerts', planId: 'pro', used: 10, now: NOW })).toBeNull();
  });
});

describe('upgrade: dismissal is respected', () => {
  it('suppresses a dismissed prompt', () => {
    const key = 'default:route:/bots';
    const dismissals = dismiss({}, key, NOW);
    expect(shouldSuppress(dismissals, key, NOW)).toBe(true);
    expect(upgradePromptFor({ route: '/bots', planId: 'free', now: NOW, dismissals })).toBeNull();
  });

  it('expires a dismissal rather than silencing for ever', () => {
    const key = 'default:route:/bots';
    const dismissals = dismiss({}, key, NOW);
    const later = new Date(NOW.getTime() + DISMISSAL_TTL_MS + 1);
    expect(shouldSuppress(dismissals, key, later)).toBe(false);
    expect(upgradePromptFor({ route: '/bots', planId: 'free', now: later, dismissals })).not.toBeNull();
  });

  it('does not let one dismissal silence a different prompt', () => {
    // Dismissing the bots prompt must not hide the alert-limit prompt.
    const dismissals = dismiss({}, 'default:route:/bots', NOW);
    const other = upgradePromptFor({ entitlement: 'alerts', planId: 'free', used: 5, now: NOW, dismissals });
    expect(other).not.toBeNull();
  });

  it('scopes dismissal per flow, so a second flow still gets its prompt', () => {
    const dismissals = dismiss({}, 'default:route:/bots', NOW);
    expect(upgradePromptFor({ route: '/bots', planId: 'free', now: NOW, dismissals, flow: 'checkout-return' })).not.toBeNull();
  });

  it('ignores a corrupt dismissal record instead of hiding the prompt for ever', () => {
    expect(shouldSuppress({ k: 'not-a-date' }, 'k', NOW)).toBe(false);
    expect(shouldSuppress({}, 'k', NOW)).toBe(false);
    expect(shouldSuppress({ k: NOW.toISOString() }, 'missing', NOW)).toBe(false);
  });

  it('shows a prompt once per flow even when re-rendered', () => {
    const first = oncePerFlow(new Set(), 'route:/bots');
    expect(first.show).toBe(true);
    const second = oncePerFlow(first.seen, 'route:/bots');
    expect(second.show).toBe(false);
    // A different key in the same flow is still allowed once.
    expect(oncePerFlow(second.seen, 'limit:alerts').show).toBe(true);
  });
});

describe('upgrade: annual saving is only claimed when the sums support it', () => {
  it('computes the real saving for Pro', () => {
    const res = annualSaving(planById('pro'));
    expect(res).toMatchObject({ available: true, fullYear: 119.88, annual: 99.99, saving: 19.89, savingPct: 17, monthlyEquivalent: 8.33 });
    expect(res.monthsFree).toBe(2);
  });

  it('computes the real saving for Team', () => {
    expect(annualSaving(planById('business'))).toMatchObject({ available: true, fullYear: 299.88, annual: 249.99, saving: 49.89, savingPct: 17 });
  });

  it('refuses to claim a saving for a free plan', () => {
    // "Save 0%" is worse than saying nothing.
    expect(annualSaving(planById('free'))).toMatchObject({ available: false, reason: 'free-plan-has-no-saving' });
  });

  it('refuses when there is no annual price at all', () => {
    expect(annualSaving({ price: { monthly: 29, annual: null } })).toMatchObject({ available: false, reason: 'missing-price' });
    expect(annualSaving({ price: {} })).toMatchObject({ available: false, reason: 'missing-price' });
    expect(annualSaving(null)).toMatchObject({ available: false });
  });

  it('refuses when annual is not actually cheaper', () => {
    // A "discount" that costs more is a lie the arithmetic catches.
    expect(annualSaving({ price: { monthly: 10, annual: 130 } })).toMatchObject({ available: false, reason: 'annual-is-not-cheaper' });
    expect(annualSaving({ price: { monthly: 10, annual: 120 } })).toMatchObject({ available: false, reason: 'annual-is-not-cheaper' });
  });

  it('refuses a non-numeric price rather than computing NaN into the UI', () => {
    expect(annualSaving({ price: { monthly: '29', annual: 290 } })).toMatchObject({ available: false, reason: 'price-not-a-number' });
    expect(annualSaving({ price: { monthly: 29, annual: '290' } })).toMatchObject({ available: false, reason: 'price-not-a-number' });
  });

  it('agrees with itself: every offered annual price is genuinely cheaper', () => {
    for (const plan of purchasablePlans()) {
      const res = annualSaving(plan);
      expect(res.available, plan.id).toBe(true);
      expect(res.saving, plan.id).toBeGreaterThan(0);
    }
  });
});

describe('upgrade: pricing integrity catches app/store drift', () => {
  // A COMPLETE mapping, so "everything agrees" is a fair test. A partial one
  // would report the unmapped plan as a missing variant — correctly — and the
  // fixture, not the module, would be at fault.
  const mapping = { 'pro:monthly': 'v1', 'pro:annual': 'v2', 'business:monthly': 'v3', 'business:annual': 'v4', 'enterprise:monthly': 'v5', 'enterprise:annual': 'v6' };
  const variants = {
    v1: { price: 9.99, currency: 'USD', interval: 'month', status: 'published' },
    v2: { price: 99.99, currency: 'USD', interval: 'year', status: 'published' },
    v3: { price: 24.99, currency: 'USD', interval: 'month', status: 'published' },
    v4: { price: 249.99, currency: 'USD', interval: 'year', status: 'published' },
    v5: { price: 199.99, currency: 'USD', interval: 'month', status: 'published' },
    v6: { price: 1999.99, currency: 'USD', interval: 'year', status: 'published' }
  };

  it('passes when the app and the store agree', () => {
    const res = pricingIntegrity({ mapping, variants });
    expect(res.mismatches).toEqual([]);
  });

  it('catches a price difference and refuses to pick a winner', () => {
    const res = pricingIntegrity({ mapping, variants: { ...variants, v1: { ...variants.v1, price: 29 } } });
    const mismatch = res.mismatches.find((m) => m.planId === 'pro' && m.cycle === 'monthly');
    expect(mismatch).toMatchObject({ verdict: 'price-mismatch', appPrice: 9.99, variantPrice: 29 });
    expect(mismatch.note).toMatch(/One of them is wrong; this gate will not choose/);
    expect(res.ok).toBe(false);
  });

  it('catches a plan that has no variant to sell', () => {
    const res = pricingIntegrity({ mapping: { 'pro:monthly': 'v1' }, variants });
    expect(res.mismatches.map((m) => `${m.planId}:${m.cycle}:${m.verdict}`)).toEqual(
      expect.arrayContaining(['pro:annual:no-variant', 'business:monthly:no-variant', 'business:annual:no-variant'])
    );
  });

  it('catches a variant that is not sellable', () => {
    const res = pricingIntegrity({ mapping, variants: { ...variants, v1: { ...variants.v1, status: 'pending' } } });
    expect(res.mismatches.some((m) => m.verdict === 'variant-not-sellable')).toBe(true);
  });

  it('catches a usage-metered variant, because the charge may not be the list price', () => {
    const res = pricingIntegrity({ mapping, variants: { ...variants, v1: { ...variants.v1, usageMetered: true } } });
    const m = res.mismatches.find((x) => x.verdict === 'usage-metered');
    expect(m.note).toMatch(/usage-metered/);
  });

  it('catches an interval that does not match the cycle', () => {
    const res = pricingIntegrity({ mapping, variants: { ...variants, v2: { ...variants.v2, interval: 'month' } } });
    expect(res.mismatches.some((m) => m.cycle === 'annual' && m.verdict === 'interval-mismatch')).toBe(true);
  });

  it('reports a variant id the store does not actually have', () => {
    const res = pricingIntegrity({ mapping: { 'pro:monthly': 'ghost' }, variants });
    expect(res.mismatches.some((m) => m.verdict === 'variant-unknown')).toBe(true);
  });

  it('never prices the free plan, but does price Enterprise', () => {
    const res = pricingIntegrity({ mapping, variants });
    expect(res.rows.every((r) => r.planId !== 'free')).toBe(true);
    expect(res.rows.some((r) => r.planId === 'enterprise' && r.verdict === 'ok')).toBe(true);
  });

  it('exposes a boolean convenience that agrees with the detail', () => {
    expect(pricingAgrees({ mapping, variants })).toBe(true);
    expect(pricingAgrees({ mapping, variants: { ...variants, v1: { ...variants.v1, price: 29 } } })).toBe(false);
  });
});

describe('upgrade: analytics integrate with the existing registry', () => {
  it('uses event names the registry already accepts, or adds them', () => {
    // A second spelling of one event is how a funnel stops adding up.
    for (const { name } of Object.values(UPGRADE_EVENTS)) {
      expect(EVENT_NAMES, name).toContain(name);
    }
  });

  it('reuses subscription.started rather than inventing subscription.activated', () => {
    expect(UPGRADE_EVENTS.subscriptionActivated.name).toBe('subscription.started');
    expect(EVENT_NAMES).not.toContain('subscription.activated');
  });

  it('emits only events the registry validates', () => {
    const samples = [
      { name: 'upgrade.prompt_viewed', properties: { context: 'route:/bots', plan: 'free', kind: 'feature' } },
      { name: 'upgrade.clicked', properties: { context: 'route:/bots', plan: 'free', targetPlan: 'pro' } },
      { name: 'checkout.started', properties: { plan: 'pro', cycle: 'monthly' } },
      { name: 'checkout.cancelled', properties: { plan: 'pro', cycle: 'monthly' } },
      { name: 'subscription.started', properties: { plan: 'pro', cycle: 'monthly', amount: 29 } }
    ];
    for (const event of samples) {
      const res = validateEvent(event);
      expect(res.ok ?? res.valid ?? (res.errors?.length === 0), JSON.stringify(res)).toBe(true);
    }
  });

  it('carries no financial or personal data beyond the minimum', () => {
    for (const { props } of Object.values(UPGRADE_EVENTS)) {
      for (const prop of props) {
        expect(prop, prop).not.toMatch(/email|card|cvv|iban|address|phone|ip|userId|wallet/i);
      }
    }
    expect(UPGRADE_EVENTS.checkoutStarted.props).toEqual(['plan', 'cycle']);
  });

  it('counts a prompt view once despite many rerenders', () => {
    const dedupe = createEventDeduper();
    const key = 'route:/bots:pro:free';
    const results = [dedupe.shouldEmit(key), dedupe.shouldEmit(key), dedupe.shouldEmit(key)];
    expect(results).toEqual([true, false, false]);
    expect(dedupe.size()).toBe(1);
    expect(dedupe.shouldEmit('limit:alerts')).toBe(true);
  });

  it('defines a funnel that ends at a real subscription event', () => {
    expect(CONVERSION_FUNNEL.map((s) => s.event)).toEqual([
      'upgrade.prompt_viewed', 'upgrade.clicked', 'checkout.started', 'subscription.started'
    ]);
    for (const step of CONVERSION_FUNNEL) expect(EVENT_NAMES, step.event).toContain(step.event);
  });

  it('attributes conversions to the page that produced them', () => {
    const events = [
      { name: 'upgrade.prompt_viewed', properties: { context: '/bots' } },
      { name: 'upgrade.prompt_viewed', properties: { context: '/bots' } },
      { name: 'upgrade.prompt_viewed', properties: { context: '/strategies' } },
      { name: 'upgrade.clicked', properties: { context: '/bots' } },
      { name: 'checkout.started', properties: { context: '/bots' } },
      { name: 'subscription.started', properties: { context: '/bots' } }
    ];
    const rows = conversionByContext(events);
    expect(rows[0]).toMatchObject({ context: '/bots', viewed: 2, clicked: 1, started: 1, activated: 1, viewToActivate: 50 });
    expect(rows[1]).toMatchObject({ context: '/strategies', viewed: 1, activated: 0, viewToActivate: 0 });
  });

  it('reports null rather than dividing by zero', () => {
    const rows = conversionByContext([{ name: 'subscription.started', properties: { context: '/x' } }]);
    expect(rows[0].viewToClick).toBeNull();
    expect(rows[0].viewToActivate).toBeNull();
  });
});

describe('upgrade: call to action wording', () => {
  it('names the limit being raised', () => {
    expect(ctaFor({ kind: 'limit', entitlement: 'alerts', targetPlan: 'pro' })).toMatchObject({ label: 'Raise my price alerts limit', intent: 'upgrade' });
  });

  it('names the feature being unlocked', () => {
    expect(ctaFor({ kind: 'feature', featureTitle: 'Trading bots', targetPlan: 'pro' }).label).toBe('Unlock Trading bots');
  });

  it('falls back to a plan comparison when there is no plan to sell', () => {
    expect(ctaFor({ kind: 'feature', featureTitle: 'X', targetPlan: null })).toMatchObject({ label: 'Compare plans', intent: 'compare' });
    expect(ctaFor({ kind: 'compare' }).label).toBe('Compare plans');
  });
});

describe('upgrade: page-level context', () => {
  it('lets a free user through a free route', () => {
    expect(upgradeContextFor({ route: '/news', planId: 'free' })).toMatchObject({ gated: false, canAccess: true, prompt: null });
  });

  it('blocks a gated route and supplies the prompt and CTA', () => {
    const ctx = upgradeContextFor({ route: '/bots', planId: 'free', now: NOW });
    expect(ctx).toMatchObject({ gated: true, canAccess: false });
    expect(ctx.prompt.kind).toBe('feature');
    expect(ctx.cta).toMatchObject({ label: 'Unlock Trading bots', intent: 'upgrade', targetPlan: 'pro' });
  });

  it('marks a prompt seen earlier in the same flow as suppressed', () => {
    const seen = new Set(['route:/bots']);
    const ctx = upgradeContextFor({ route: '/bots', planId: 'free', now: NOW, seen });
    expect(ctx.prompt.suppressedByFlow).toBe(true);
  });

  it('admits a paid user and returns no prompt', () => {
    expect(upgradeContextFor({ route: '/bots', planId: 'pro', now: NOW })).toMatchObject({ gated: false, canAccess: true });
  });
});

describe('upgrade: a subscriber sees management, not an advert', () => {
  it('shows upgrade for a free user and management for a payer', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('pro')).toBe(true);
    expect(managementInfo({ planId: 'free' })).toMatchObject({ showUpgrade: true, showManagement: false });
    expect(managementInfo({ planId: 'pro' })).toMatchObject({ showUpgrade: false, showManagement: true, planName: 'Pro' });
  });

  it('describes a scheduled cancellation as information, with what still applies', () => {
    const info = managementInfo({ planId: 'pro', status: 'cancelled', cancelAt: '2026-11-10T00:00:00Z' });
    expect(info.cancellation).toMatchObject({ scheduledFor: '2026-11-10T00:00:00Z' });
    expect(info.cancellation.note).toMatch(/end of the period/i);
  });

  it('has no cancellation block when nothing is scheduled', () => {
    expect(managementInfo({ planId: 'pro', status: 'active' }).cancellation).toBeNull();
  });

  it('treats an unknown plan as free rather than as paid', () => {
    expect(isPaidPlan('made_up')).toBe(false);
    expect(managementInfo({ planId: 'made_up' }).showUpgrade).toBe(true);
  });
});

describe('upgrade: the plan catalogue itself', () => {
  it('orders purchasable plans by rank', () => {
    const rows = purchasablePlans();
    expect(rows.map((p) => p.id)).toEqual(['pro', 'business', 'enterprise']);
    expect(rows.every((p) => p.rank > 0 && !p.contactOnly)).toBe(true);
  });

  it('never lists the free plan or a contact-only plan as purchasable', () => {
    // Enterprise is now purchasable, so no plan is quote-only.
    expect(PLANS.filter((p) => p.contactOnly).map((p) => p.id)).toEqual([]);
    expect(purchasablePlans().map((p) => p.id)).not.toContain('free');
  });

  it('has a monotonic ladder: every paid tier beats the one below it', () => {
    for (const entitlement of ['alerts', 'portfolios', 'seats', 'apiCallsPerMonth', 'auditLogDays']) {
      const ladder = PLANS.filter((p) => !p.contactOnly).map((p) => p.entitlements[entitlement]);
      for (let i = 1; i < ladder.length; i += 1) {
        const prev = ladder[i - 1];
        const curr = ladder[i];
        if (prev == null) break;      // already unlimited
        if (curr == null) continue;    // unlimited is the top of the ladder
        expect(curr, `${entitlement}: ${prev} → ${curr}`).toBeGreaterThan(prev);
      }
    }
  });
});
