import { describe, it, expect } from 'vitest';
import {
  equityCurve, maxDrawdown, sharpeRatio, performanceSummary, riskProfile,
  verifyTrackRecord, copyPlan, shouldStopCopy, feeBreakdown, rankTraders,
  splitAllocation, VERIFY_MIN_DAYS
} from './copyTrading.js';

describe('drawdown and curve maths', () => {
  it('compounds returns into an equity curve', () => {
    const curve = equityCurve([0.1, -0.1]);
    expect(curve[0]).toBe(1);
    expect(curve[1]).toBeCloseTo(1.1, 10);
    expect(curve[2]).toBeCloseTo(0.99, 10);
  });

  it('measures peak-to-trough drawdown, not final loss', () => {
    // 1.0 → 1.5 → 0.9: the drawdown is 40% from the peak, even though the
    // curve ends below where it started by only 10%.
    expect(maxDrawdown([1, 1.5, 0.9])).toBeCloseTo(0.4, 10);
  });

  it('returns zero drawdown for a monotonic curve', () => {
    expect(maxDrawdown([1, 1.1, 1.2])).toBe(0);
  });

  it('returns null Sharpe when variance is zero rather than Infinity', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBeNull();
    expect(sharpeRatio([0.01])).toBeNull();
  });

  it('annualises with the supplied period count', () => {
    const daily = sharpeRatio([0.01, -0.005, 0.02, 0.0], 365);
    const weekly = sharpeRatio([0.01, -0.005, 0.02, 0.0], 52);
    expect(daily).toBeGreaterThan(weekly);
  });
});

describe('performanceSummary', () => {
  it('derives every field and reports the period count', () => {
    const s = performanceSummary([0.02, -0.01, 0.03, -0.02, 0.01], { trades: 10 });
    expect(s.periods).toBe(5);
    expect(s.totalReturn).toBeCloseTo(1.02 * 0.99 * 1.03 * 0.98 * 1.01 - 1, 10);
    expect(s.winRate).toBeCloseTo(3 / 5, 10);
    expect(s.tradesPerPeriod).toBe(2);
    expect(s.maxDrawdown).toBeGreaterThan(0);
  });

  it('returns nulls instead of NaN for an empty series', () => {
    const s = performanceSummary([]);
    expect(s.totalReturn).toBeNull();
    expect(s.sharpe).toBeNull();
    expect(s.maxDrawdown).toBeNull();
  });
});

describe('riskProfile', () => {
  it('classifies by drawdown and volatility thresholds', () => {
    expect(riskProfile({ maxDrawdown: 0.1, volatility: 0.3 }).id).toBe('conservative');
    expect(riskProfile({ maxDrawdown: 0.25, volatility: 0.6 }).id).toBe('balanced');
    expect(riskProfile({ maxDrawdown: 0.7, volatility: 1.4 }).id).toBe('aggressive');
  });
});

describe('verifyTrackRecord', () => {
  const returns = Array.from({ length: VERIFY_MIN_DAYS }, (_, i) => (i % 3 === 0 ? -0.01 : 0.012));

  it('verifies a reconciled, long, gap-free record', () => {
    const v = verifyTrackRecord({
      source: 'exchange-api',
      returns,
      gaps: 0,
      reconciledAt: new Date().toISOString()
    });
    expect(v.verified).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.label).toMatch(/Verified/);
  });

  it('refuses a self-reported record and says why', () => {
    const v = verifyTrackRecord({ source: 'self-reported', returns, gaps: 0, reconciledAt: new Date().toISOString() });
    expect(v.verified).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/not reconcilable/);
  });

  it('refuses a short record', () => {
    const v = verifyTrackRecord({ source: 'exchange-api', returns: [0.01, 0.02], gaps: 0, reconciledAt: new Date().toISOString() });
    expect(v.verified).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/required/);
  });

  it('refuses a record with gaps or no reconciliation', () => {
    expect(verifyTrackRecord({ source: 'exchange-api', returns, gaps: 3, reconciledAt: new Date().toISOString() }).verified).toBe(false);
    expect(verifyTrackRecord({ source: 'exchange-api', returns, gaps: 0 }).verified).toBe(false);
  });

  it('refuses a stale reconciliation', () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    expect(verifyTrackRecord({ source: 'exchange-api', returns, gaps: 0, reconciledAt: old }).verified).toBe(false);
  });

  it('catches a declared length that does not match the series', () => {
    const v = verifyTrackRecord({ source: 'exchange-api', returns, gaps: 0, declaredDays: 400, reconciledAt: new Date().toISOString() });
    expect(v.verified).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/Declared 400/);
  });
});

describe('copyPlan', () => {
  it('converts percentages into absolute caps', () => {
    const plan = copyPlan({ equity: 10000, allocationPct: 20, maxLossPct: 25, perTradePct: 5 });
    expect(plan.ok).toBe(true);
    expect(plan.allocation).toBe(2000);
    expect(plan.maxLoss).toBe(500);
    expect(plan.perTrade).toBe(100);
    expect(plan.stopEquity).toBe(1500);
    expect(plan.worstCaseLossPctOfEquity).toBe(5);
  });

  it('refuses allocation above equity — copy trading is not margin', () => {
    const plan = copyPlan({ equity: 1000, allocationPct: 150 });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/between 0 and 100%/);
  });

  it('refuses a per-trade cap below the venue minimum', () => {
    const plan = copyPlan({ equity: 100, allocationPct: 10, perTradePct: 5, minNotional: 10 });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/venue minimum/);
  });

  it('reports the fee model with no management fee', () => {
    const plan = copyPlan({ equity: 1000 });
    expect(plan.feeModel.managementFeePct).toBe(0);
    expect(plan.feeModel.highWaterMark).toBe(true);
  });
});

describe('shouldStopCopy', () => {
  const plan = copyPlan({ equity: 1000, allocationPct: 50, maxLossPct: 20 });

  it('stops at the capital floor', () => {
    const r = shouldStopCopy({ copyEquity: plan.stopEquity - 1, startEquity: plan.allocation, plan });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('capital-stop');
  });

  it('stops when the trader drawdown breaches the threshold', () => {
    const r = shouldStopCopy({ copyEquity: plan.allocation, startEquity: plan.allocation, plan, traderDrawdown: 0.35, stopCopyDrawdown: 0.3 });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('trader-drawdown');
  });

  it('stops on a losing streak', () => {
    const r = shouldStopCopy({ copyEquity: plan.allocation, startEquity: plan.allocation, plan, consecutiveLosses: 5, maxConsecutiveLosses: 5 });
    expect(r.reason).toBe('loss-streak');
  });

  it('keeps running inside every limit', () => {
    const r = shouldStopCopy({ copyEquity: plan.allocation * 1.05, startEquity: plan.allocation, plan });
    expect(r.stop).toBe(false);
  });

  it('does not stop on missing data, and says the data is missing', () => {
    const r = shouldStopCopy({ copyEquity: null, startEquity: 100 });
    expect(r.stop).toBe(false);
    expect(r.reason).toBe('unknown');
  });
});

describe('feeBreakdown', () => {
  it('charges only the profit above the high-water mark', () => {
    const f = feeBreakdown({ grossProfit: 1000, highWaterMark: 400 });
    expect(f.chargeable).toBe(600);
    expect(f.fee).toBe(60); // 10% default
    expect(f.net).toBe(940);
  });

  it('charges nothing below the high-water mark', () => {
    const f = feeBreakdown({ grossProfit: 300, highWaterMark: 400 });
    expect(f.fee).toBe(0);
    expect(f.note).toMatch(/No fee/);
  });

  it('never charges on a loss', () => {
    expect(feeBreakdown({ grossProfit: -500 }).fee).toBe(0);
  });
});

describe('rankTraders', () => {
  const good = Array.from({ length: 120 }, (_, i) => (i % 4 === 0 ? -0.008 : 0.011));

  it('discounts an unverified spectacular record below a verified modest one', () => {
    const ranked = rankTraders([
      { id: 'loud', name: 'Loud', source: 'self-reported', returns: good.map((r) => r * 4), gaps: 0, reconciledAt: new Date().toISOString() },
      { id: 'solid', name: 'Solid', source: 'exchange-api', returns: good, gaps: 0, reconciledAt: new Date().toISOString() }
    ]);
    expect(ranked[0].id).toBe('solid');
    expect(ranked.find((r) => r.id === 'loud').confidenceDiscount).toBe(60);
  });

  it('attaches a risk profile to every row', () => {
    const ranked = rankTraders([{ id: 'a', source: 'exchange-api', returns: good, gaps: 0, reconciledAt: new Date().toISOString() }]);
    expect(ranked[0].profile.id).toBeTruthy();
  });
});

describe('splitAllocation', () => {
  it('normalises weights into amounts that sum to equity', () => {
    const r = splitAllocation({ equity: 1000, maxPerTraderPct: 80, targets: [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 3 }] });
    expect(r.ok).toBe(true);
    expect(r.legs[0].amount).toBe(250);
    expect(r.legs[1].amount).toBe(750);
  });

  it('applies the default 40% cap to a lopsided split', () => {
    const r = splitAllocation({ equity: 1000, targets: [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 3 }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/concentration cap/);
  });

  it('fails a concentration cap breach instead of silently clipping', () => {
    const r = splitAllocation({ equity: 1000, targets: [{ id: 'a', name: 'A', weight: 9 }, { id: 'b', name: 'B', weight: 1 }], maxPerTraderPct: 70 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/concentration cap/);
  });
});
