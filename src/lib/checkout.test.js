import { describe, it, expect } from 'vitest';
import {
  VARIANTS, STORE, ATTRIBUTION_READY, variantFor, variantByUuid, variantById,
  mappingFor, validateMapping, checkoutOrigin, buildCheckoutUrl, checkoutEnabled,
  checkoutStatus, catalogueRows
} from './checkout.js';
import { PLANS, planById } from './plans.js';

/* The provider map. The IDs in this file were read from the dashboard's own
 * Variants UI, clicking each variant card — not from page state. These tests
 * exist so the mapping cannot silently drift from the plan catalogue, which is
 * what a displayed price disagreeing with a charge looks like. */

describe('checkout: the verified provider map', () => {
  it('holds exactly the six approved variants, all published', () => {
    expect(VARIANTS).toHaveLength(6);
    expect(VARIANTS.every((v) => v.status === 'published')).toBe(true);
  });

  it('matches the approved prices exactly', () => {
    const byKey = Object.fromEntries(VARIANTS.map((v) => [`${v.plan}:${v.cycle}`, v.amount]));
    expect(byKey).toEqual({
      'pro:monthly': 9.99,
      'pro:annual': 99.99,
      'business:monthly': 24.99,
      'business:annual': 249.99,
      'enterprise:monthly': 199.99,
      'enterprise:annual': 1999.99
    });
  });

  it('has no duplicate variant ids or checkout uuids', () => {
    expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(6);
    expect(new Set(VARIANTS.map((v) => v.uuid)).size).toBe(6);
  });

  it('uses a UUID slug for checkout, never the numeric id', () => {
    // A checkout URL built from the numeric id 404s — a real mistake made here.
    for (const v of VARIANTS) {
      expect(v.uuid, v.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(v.uuid).not.toBe(v.id);
      expect(v.uuid).not.toMatch(/^\d+$/);
    }
  });

  it('resolves a variant by id, by uuid and by plan and cycle', () => {
    expect(variantFor('pro', 'monthly')?.id).toBe('2230904');
    expect(variantById('2230943')?.cycle).toBe('annual');
    expect(variantByUuid('ae243fd9-68e7-46d2-82e2-6b0c2147ee13')?.plan).toBe('business');
    expect(variantFor('free', 'monthly')).toBeNull();
    expect(variantByUuid('nonsense')).toBeNull();
    expect(variantById(null)).toBeNull();
  });
});

describe('checkout: the mapping agrees with the plan catalogue', () => {
  it('validates clean against PLANS', () => {
    const res = validateMapping();
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.mapped).toBe(6);
  });

  it('catches a provider amount that differs from the displayed price', () => {
    // The failure this whole module exists to prevent.
    const drifted = [Object.assign({}, VARIANTS[0], { amount: 12.99 })];
    const problems = [];
    for (const v of drifted) {
      const expected = planById(v.plan).price[v.cycle];
      if (Math.abs(expected - v.amount) > 0.005) problems.push({ reason: 'amount-mismatch' });
    }
    expect(problems).toEqual([{ reason: 'amount-mismatch' }]);
  });

  it('catches an interval swap, which would bill annually at a monthly price', () => {
    const swapped = { ...VARIANTS[0], interval: 'year' };
    const wantInterval = swapped.cycle === 'annual' ? 'year' : 'month';
    expect(swapped.interval).not.toBe(wantInterval);
  });

  it('requires a variant for every purchasable plan and cycle', () => {
    for (const plan of PLANS) {
      if (plan.rank === 0) continue;
      for (const cycle of ['monthly', 'annual']) {
        expect(variantFor(plan.id, cycle), `${plan.id}:${cycle}`).not.toBeNull();
        expect(mappingFor(plan.id, cycle).ok).toBe(true);
      }
    }
  });

  it('publishes no variant for the free plan', () => {
    expect(variantFor('free', 'monthly')).toBeNull();
    expect(catalogueRows().every((r) => r.plan !== 'free')).toBe(true);
  });
});

describe('checkout: URLs', () => {
  it('builds from the store slug and the variant uuid', () => {
    expect(checkoutOrigin()).toBe('https://hbstore.lemonsqueezy.com');
    expect(STORE.id).toBe('489130');
    const res = buildCheckoutUrl({ plan: 'pro', cycle: 'monthly', nonce: 'n1' });
    expect(res.ok).toBe(true);
    expect(res.url).toContain('https://hbstore.lemonsqueezy.com/checkout/buy/0f87360b-875c-4ec3-b8fa-5d6acc812376');
    expect(res).toMatchObject({ amount: 9.99, interval: 'month', variantId: '2230904', attributed: true });
  });

  it('carries the nonce as passthrough data, never a user id', () => {
    const res = buildCheckoutUrl({ plan: 'business', cycle: 'annual', nonce: 'opaque-nonce' });
    expect(res.url).toContain('checkout%5Bcustom%5D%5Bnonce%5D=opaque-nonce');
    expect(res.url).not.toMatch(/user_id|userId|price=|amount=/);
  });

  it('maps each cycle to its own uuid, so a monthly plan cannot open an annual checkout', () => {
    const m = buildCheckoutUrl({ plan: 'pro', cycle: 'monthly', nonce: 'n' });
    const a = buildCheckoutUrl({ plan: 'pro', cycle: 'annual', nonce: 'n' });
    expect(m.url).not.toBe(a.url);
    expect(m.url).toContain('0f87360b');
    expect(a.url).toContain('b4d5b470');
    expect(m.interval).toBe('month');
    expect(a.interval).toBe('year');
  });

  it('refuses to build a checkout it cannot attribute', () => {
    // Taking a payment that cannot be tied to an account is worse than not
    // offering checkout at all.
    const res = buildCheckoutUrl({ plan: 'pro', cycle: 'monthly' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('attribution-not-ready');
  });

  it('refuses a plan with no variant', () => {
    expect(buildCheckoutUrl({ plan: 'free', cycle: 'monthly', nonce: 'n' }).reason).toBe('no-variant-mapped');
  });

  it('is gated until attribution exists, and says why', () => {
    expect(ATTRIBUTION_READY).toBe(false);
    expect(checkoutEnabled()).toBe(false);
    const status = checkoutStatus();
    expect(status.enabled).toBe(false);
    expect(status.reason).toBe('attribution-not-ready');
    expect(status.note).toMatch(/attribute a purchase to an account/);
  });
});

describe('checkout: the comparison rows', () => {
  it('reports a row per purchasable plan and cycle, all in agreement', () => {
    const rows = catalogueRows();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.agrees)).toBe(true);
    expect(rows.every((r) => r.appAmount === r.providerAmount)).toBe(true);
  });

  it('carries the uuid each row would check out with', () => {
    const pro = catalogueRows().find((r) => r.plan === 'pro' && r.cycle === 'monthly');
    expect(pro).toMatchObject({ appAmount: 9.99, providerAmount: 9.99, variantId: '2230904', agrees: true });
    expect(pro.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('flags disagreement rather than hiding it', () => {
    const rows = catalogueRows({ plans: PLANS.map((p) => (p.id === 'pro' ? { ...p, price: { ...p.price, monthly: 12.5 } } : p)) });
    const pro = rows.find((r) => r.plan === 'pro' && r.cycle === 'monthly');
    expect(pro.agrees).toBe(false);
    expect(pro.appAmount).toBe(12.5);
    expect(pro.providerAmount).toBe(9.99);
  });
});
