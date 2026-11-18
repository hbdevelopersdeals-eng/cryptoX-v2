import { describe, it, expect } from 'vitest';
import {
  nextTier, annualSaving, priceLine, quotaPressure, recommend, shouldShow, recordShown,
  recordDismissed, readState, ladder, rankOf, TIER_PITCH, PLACEMENTS, DISMISS_COOLDOWN_HOURS
} from './upsell.js';

describe('tier ladder', () => {
  it('climbs one tier at a time and stops at the top', () => {
    expect(nextTier('free')).toBe('pro');
    expect(nextTier('pro')).toBe('business');
    expect(nextTier('business')).toBe('enterprise');
    expect(nextTier('enterprise')).toBeNull();
  });

  it('ranks plans in order', () => {
    expect(rankOf('free')).toBe(0);
    expect(rankOf('enterprise')).toBe(3);
    expect(rankOf('nonsense')).toBe(0);
  });
});

describe('pricing shown to the user', () => {
  it('derives the annual saving from the real prices instead of asserting it', () => {
    const pro = annualSaving('pro');
    // 9.99 × 12 = 119.88 against 99.99 → 19.89 off, 16.6%
    expect(pro.perYear).toBeCloseTo(19.89, 2);
    expect(pro.pct).toBeCloseTo(16.6, 1);
  });

  it('finds a saving on every paid tier and none on free', () => {
    expect(annualSaving('business').perYear).toBeCloseTo(49.89, 2);
    expect(annualSaving('enterprise').perYear).toBeCloseTo(399.89, 2);
    expect(annualSaving('free')).toBeNull();
  });

  it('quotes both cycles', () => {
    expect(priceLine('pro').text).toBe('$9.99/month or $99.99/year');
    expect(priceLine('free').text).toBe('Free');
  });

  it('never sells a discount that does not exist', () => {
    for (const tier of ['pro', 'business', 'enterprise']) {
      const saving = annualSaving(tier);
      expect(saving.perYear).toBeGreaterThan(0);
      expect(saving.pct).toBeGreaterThan(0);
      expect(saving.pct).toBeLessThan(30);
    }
  });
});

describe('quota pressure', () => {
  it('orders by how close each limit is', () => {
    const rows = quotaPressure('free', { alerts: 4, portfolios: 0, apiCallsPerMonth: 10 });
    expect(rows[0].key).toBe('alerts');
    expect(rows[0].pct).toBe(80);
  });

  it('marks an exhausted limit', () => {
    expect(quotaPressure('free', { alerts: 5 }).find((r) => r.key === 'alerts').atLimit).toBe(true);
  });

  it('treats a zero entitlement as exhausted, not as unlimited', () => {
    const bots = quotaPressure('free', { bots: 0 }).find((r) => r.key === 'bots');
    expect(bots.limit).toBe(0);
    expect(bots.atLimit).toBe(true);
    expect(bots.pct).toBe(100);
  });

  it('omits unlimited keys rather than showing 0%', () => {
    const rows = quotaPressure('enterprise', { alerts: 9000 });
    expect(rows.find((r) => r.key === 'alerts')).toBeUndefined();
  });
});

describe('recommendation', () => {
  it('offers Pro to a free user who has filled their alerts', () => {
    const r = recommend({ context: 'alerts', planId: 'free', usage: { alerts: 5 } });
    expect(r.show).toBe(true);
    expect(r.tier).toBe('pro');
    expect(r.reason).toBe('at-limit');
  });

  it('offers Pro when alerts are close, not only when full', () => {
    const r = recommend({ context: 'alerts', planId: 'free', usage: { alerts: 4 } });
    expect(r.tier).toBe('pro');
    expect(r.reason).toBe('near-limit');
  });

  it('stays silent when there is no pressure at all', () => {
    expect(recommend({ context: 'alerts', planId: 'free', usage: { alerts: 1 } }).show).toBe(false);
  });

  it('climbs past a tier the user already owns', () => {
    // Pro at its alert ceiling is a Business conversation, not another Pro pitch.
    const r = recommend({ context: 'alerts', planId: 'pro', usage: { alerts: 100 } });
    expect(r.tier).toBe('business');
  });

  it('sells Enterprise only to someone already at Business', () => {
    const r = recommend({ context: 'alerts', planId: 'business', usage: { alerts: 1000 } });
    expect(r.tier).toBe('enterprise');
  });

  it('returns nothing at the top tier — no "upgrade to Enterprise" for Enterprise', () => {
    expect(recommend({ context: 'alerts', planId: 'enterprise', usage: { alerts: 1e9 } }).show).toBe(false);
    expect(recommend({ context: 'alerts', planId: 'enterprise', usage: { alerts: 1e9 } }).reason).toBe('top-tier');
  });

  it('offers Pro for bots on free, where the entitlement is zero', () => {
    const r = recommend({ context: 'bots', planId: 'free', usage: {} });
    expect(r.show).toBe(true);
    expect(r.tier).toBe('pro');
  });

  it('does not pitch bots to a Pro user who is under the bot limit', () => {
    expect(recommend({ context: 'bots', planId: 'pro', usage: { bots: 1 } }).show).toBe(false);
  });

  it('sells Business on seats, not Pro', () => {
    const r = recommend({ context: 'team', planId: 'free', usage: { seats: 1 } });
    expect(r.tier).toBe('business');
  });

  it('routes the Enterprise CTA to a conversation, not checkout', () => {
    const r = recommend({ context: 'alerts', planId: 'business', usage: { alerts: 1000 } });
    expect(r.href).toBe('/compliance');
    expect(TIER_PITCH.enterprise.cta).toMatch(/sales/i);
  });

  it('shows nothing for the billing page, which renders the ladder instead', () => {
    expect(recommend({ context: 'billing', planId: 'free' })).toEqual({ show: false, reason: 'ladder' });
  });

  it('refuses an unknown placement rather than guessing a tier', () => {
    expect(recommend({ context: 'sidebar', planId: 'free' }).show).toBe(false);
  });

  it('gives each tier a different audience and a different promise', () => {
    const audiences = new Set(Object.values(TIER_PITCH).map((p) => p.audience));
    expect(audiences.size).toBe(3);
    expect(TIER_PITCH.pro.audience).toMatch(/one trader/i);
    expect(TIER_PITCH.business.audience).toMatch(/team|desk/i);
    expect(TIER_PITCH.enterprise.audience).toMatch(/institution/i);
  });

  it('does not claim SSO is self-serve', () => {
    expect(TIER_PITCH.enterprise.adds.join(' ')).toMatch(/under contract, not self-serve/);
  });
});

describe('frequency control', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');

  it('shows in a fresh session', () => {
    expect(shouldShow({ state: null, context: 'alerts', now, sessionId: 's1' }).show).toBe(true);
  });

  it('stops after the session cap', () => {
    const state = { session: 's1', sessionShown: 2, dismissals: {} };
    expect(shouldShow({ state, context: 'alerts', now, sessionId: 's1' }).reason).toBe('session-cap');
  });

  it('resets the cap in a new session but keeps dismissals', () => {
    const state = { session: 's1', sessionShown: 2, dismissals: { alerts: '2026-06-01T10:00:00Z' } };
    const res = shouldShow({ state, context: 'portfolios', now, sessionId: 's2' });
    expect(res.show).toBe(true);
  });

  it('honours the cooldown after a dismissal and reports the wait', () => {
    const state = { session: 's1', sessionShown: 1, dismissals: { alerts: new Date(now - 3600000).toISOString() } };
    const res = shouldShow({ state, context: 'alerts', now, sessionId: 's1' });
    expect(res.show).toBe(false);
    expect(res.reason).toBe('cooldown');
    expect(res.hoursLeft).toBeGreaterThan(DISMISS_COOLDOWN_HOURS - 2);
  });

  it('shows again once the cooldown has passed', () => {
    const old = new Date(now - (DISMISS_COOLDOWN_HOURS + 1) * 3600000).toISOString();
    const state = { session: 's1', sessionShown: 1, dismissals: { alerts: old } };
    expect(shouldShow({ state, context: 'alerts', now, sessionId: 's1' }).show).toBe(true);
  });

  it('keeps dismissals scoped to their placement', () => {
    const state = { session: 's1', sessionShown: 1, dismissals: { alerts: new Date(now).toISOString() } };
    expect(shouldShow({ state, context: 'team', now, sessionId: 's1' }).show).toBe(true);
  });

  it('counts impressions per session', () => {
    const first = recordShown({ state: null, context: 'alerts', now, sessionId: 's1' });
    const second = recordShown({ state: first, context: 'team', now, sessionId: 's1' });
    expect(second.sessionShown).toBe(2);
    expect(second.lastContext).toBe('team');
  });

  it('records a dismissal timestamp', () => {
    const next = recordDismissed({ state: null, context: 'alerts', now });
    expect(readState(next).dismissals.alerts).toBe(new Date(now).toISOString());
  });

  it('survives corrupted storage', () => {
    expect(readState('nope').sessionShown).toBe(0);
    expect(readState({ dismissals: 'x' }).dismissals).toEqual({});
  });
});

describe('billing ladder', () => {
  it('lists the three paid tiers with prices and marks the current one', () => {
    const rows = ladder('pro');
    expect(rows.map((r) => r.id)).toEqual(['pro', 'business', 'enterprise']);
    expect(rows[0].current).toBe(true);
    expect(rows[1].above).toBe(true);
    expect(rows[0].price.monthly).toBe(9.99);
  });

  it('marks every paid tier as above a free account', () => {
    expect(ladder('free').every((r) => r.above)).toBe(true);
  });

  it('exposes every placement with an owning tier', () => {
    expect(PLACEMENTS.alerts.tier).toBe('pro');
    expect(PLACEMENTS.team.tier).toBe('business');
    expect(PLACEMENTS.compliance.tier).toBe('enterprise');
  });
});
