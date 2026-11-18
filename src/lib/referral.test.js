import { describe, it, expect } from 'vitest';
import {
  referralCode, referralLink, codeFromSearch, tierFor, commissionFor,
  attributeSignup, payoutStatus, fraudCheck, parseUtm, affiliateSummary,
  ATTRIBUTION_WINDOW_DAYS, MIN_PAYOUT_USD
} from './referral.js';

describe('codes and links', () => {
  it('is deterministic and well formed', () => {
    const a = referralCode('user_123');
    expect(a).toBe(referralCode('user_123'));
    expect(a).toMatch(/^CX[0-9A-Z]{7}$/);
    expect(a).not.toBe(referralCode('user_124'));
  });

  it('returns null without an account rather than a random code', () => {
    expect(referralCode('')).toBeNull();
    expect(referralLink(null)).toBeNull();
  });

  it('builds a registration link that carries the code', () => {
    const link = referralLink('CXABC1234', { base: 'https://cryptox.test', campaign: 'launch' });
    expect(link).toContain('/register');
    expect(link).toContain('ref=CXABC1234');
    expect(link).toContain('utm_campaign=launch');
  });

  it('extracts only a plausible code from a query string', () => {
    expect(codeFromSearch('?ref=cxabc1234')).toBe('CXABC1234');
    expect(codeFromSearch('?ref=<script>')).toBeNull();
    expect(codeFromSearch('')).toBeNull();
  });
});

describe('tiers', () => {
  it('rises with paying conversions', () => {
    expect(tierFor(0).id).toBe('starter');
    expect(tierFor(10).id).toBe('growth');
    expect(tierFor(50).id).toBe('partner');
    expect(tierFor(1000).id).toBe('partner');
  });

  it('gives recurring commission only above starter', () => {
    const starter = commissionFor({ planId: 'pro', amount: 100, conversions: 0, monthsActive: 3 });
    const growth = commissionFor({ planId: 'pro', amount: 100, conversions: 10, monthsActive: 3 });
    expect(starter.payable).toBe(20);
    expect(growth.payable).toBe(75); // 25% of 100 × 3 months
  });
});

describe('commission', () => {
  it('refuses non-commissionable plans', () => {
    const r = commissionFor({ planId: 'free', amount: 100 });
    expect(r.payable).toBe(0);
    expect(r.reason).toMatch(/not commissionable/);
  });

  it('represents a refund as a negative clawback', () => {
    const r = commissionFor({ planId: 'pro', amount: 100, conversions: 0, refunded: true });
    expect(r.payable).toBe(-20);
    expect(r.reason).toBe('refund-clawback');
  });
});

describe('attribution', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');

  it('requires a click', () => {
    expect(attributeSignup({ code: 'CXABC1234', clicks: [], now }).reason).toBe('no-click');
  });

  it('accepts a click inside the window and reports its age', () => {
    const r = attributeSignup({
      code: 'CXABC1234',
      clicks: [{ id: 'c1', code: 'CXABC1234', at: '2026-05-20T00:00:00Z' }],
      now
    });
    expect(r.attributed).toBe(true);
    expect(r.clickId).toBe('c1');
    expect(r.ageDays).toBeCloseTo(12, 5);
  });

  it('rejects a click older than the window', () => {
    const old = new Date(now - (ATTRIBUTION_WINDOW_DAYS + 5) * 86400000).toISOString();
    const r = attributeSignup({ code: 'CXABC1234', clicks: [{ id: 'c1', code: 'CXABC1234', at: old }], now });
    expect(r.attributed).toBe(false);
    expect(r.reason).toBe('window-expired');
  });

  it('blocks self-referral', () => {
    const r = attributeSignup({
      code: 'CXABC1234',
      referrerAccountId: 'u1',
      newAccountId: 'u1',
      clicks: [{ id: 'c1', code: 'CXABC1234', at: new Date(now).toISOString() }],
      now
    });
    expect(r.reason).toBe('self-referral');
  });

  it('uses the most recent click when several match', () => {
    const r = attributeSignup({
      code: 'CXABC1234',
      clicks: [
        { id: 'old', code: 'CXABC1234', at: new Date(now - 10 * 86400000).toISOString() },
        { id: 'new', code: 'CXABC1234', at: new Date(now - 86400000).toISOString() }
      ],
      now
    });
    expect(r.clickId).toBe('new');
  });
});

describe('payouts', () => {
  const base = { earned: 200, paid: 0, pending: 0, kycVerified: true, now: Date.parse('2026-06-01T00:00:00Z') };

  it('pays when KYC, hold and minimum are satisfied', () => {
    const p = payoutStatus({ ...base, firstEarningAt: '2026-01-01T00:00:00Z' });
    expect(p.eligible).toBe(true);
    expect(p.payable).toBe(200);
  });

  it('blocks without KYC and names it', () => {
    const p = payoutStatus({ ...base, kycVerified: false, firstEarningAt: '2026-01-01T00:00:00Z' });
    expect(p.payable).toBe(0);
    expect(p.blocked.join(' ')).toMatch(/verification/i);
  });

  it('blocks inside the refund hold', () => {
    const p = payoutStatus({ ...base, firstEarningAt: '2026-05-25T00:00:00Z' });
    expect(p.blocked.join(' ')).toMatch(/hold/i);
  });

  it('blocks below the minimum', () => {
    const p = payoutStatus({ ...base, earned: MIN_PAYOUT_USD - 1, firstEarningAt: '2026-01-01T00:00:00Z' });
    expect(p.blocked.join(' ')).toMatch(/minimum/);
  });

  it('never reports a negative available balance', () => {
    const p = payoutStatus({ ...base, earned: 10, paid: 50, firstEarningAt: '2026-01-01T00:00:00Z' });
    expect(p.available).toBe(0);
  });
});

describe('fraud', () => {
  it('approves a clean account', () => {
    const f = fraudCheck({});
    expect(f.decision).toBe('approve');
    expect(f.signals).toEqual([]);
  });

  it('blocks self-referral outright', () => {
    const f = fraudCheck({ selfReferral: true });
    expect(f.decision).toBe('block');
    expect(f.score).toBe(100);
  });

  it('sends a mid-score account to review rather than approving it', () => {
    const f = fraudCheck({ disposableEmail: true });
    expect(f.decision).toBe('review');
    expect(f.score).toBeGreaterThanOrEqual(40);
  });

  it('explains each signal with its weight', () => {
    const f = fraudCheck({ ipSignups: 6, geoMismatch: true });
    expect(f.signals.map((s) => s.id)).toEqual(['ip-cluster', 'mismatched-geo']);
    expect(f.signals.every((s) => s.weight > 0)).toBe(true);
  });
});

describe('campaigns and summary', () => {
  it('keeps only known UTM keys', () => {
    const utm = parseUtm('?utm_source=Newsletter&utm_medium=EMAIL&evil=1');
    expect(utm).toEqual({ utm_source: 'newsletter', utm_medium: 'email' });
  });

  it('aggregates clicks, conversions and refunds per code', () => {
    const s = affiliateSummary([
      { type: 'click', code: 'CXABC1234' },
      { type: 'click', code: 'CXABC1234' },
      { type: 'signup', code: 'CXABC1234' },
      { type: 'conversion', code: 'CXABC1234', revenue: 100 },
      { type: 'refund', code: 'CXABC1234', revenue: 40 }
    ]);
    expect(s.clicks).toBe(2);
    expect(s.conversions).toBe(1);
    expect(s.netRevenue).toBe(60);
    expect(s.conversionRate).toBe(0.5);
    expect(s.rows[0].earningsPerClick).toBe(30);
  });

  it('never divides by zero clicks', () => {
    const s = affiliateSummary([{ type: 'signup', code: 'X' }]);
    expect(s.conversionRate).toBe(0);
  });
});
