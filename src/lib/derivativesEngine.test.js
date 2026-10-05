import { describe, it, expect } from 'vitest';
import {
  CONTRACTS, contractBySymbol, maintenanceRequirement, initialMargin, unrealizedPnl, roe,
  liquidationPrice, marginRatio, riskLevel, fundingPayment, adlQueue, InsuranceFund,
  positionView, applyFunding, liquidate, nextFundingTime, FUNDING_INTERVAL_MS
} from './derivativesEngine.js';
import { bsPrice, bsGreeks, impliedVol, normCdf, optionPayoff, yearsFromDays } from './options.js';
import { bucketLiquidations, clusterLevels, estimateHeatmap, heatColor, heatmapGrid } from './liquidationHeatmap.js';

describe('contract specs & margin', () => {
  it('picks tiered maintenance requirements', () => {
    const small = maintenanceRequirement(10000, CONTRACTS[0]);
    const big = maintenanceRequirement(500000, CONTRACTS[0]);
    expect(small.mmr).toBeLessThan(big.mmr);
    expect(small.maintenanceMargin).toBeCloseTo(10000 * 0.004, 6);
  });

  it('sizes initial margin from leverage', () => {
    expect(initialMargin(10000, 10)).toBe(1000);
    expect(initialMargin(10000, 1)).toBe(10000);
  });

  it('resolves contracts by symbol with a safe default', () => {
    expect(contractBySymbol('ETHUSDT').base).toBe('ETH');
    expect(contractBySymbol('NOPE').symbol).toBe('BTCUSDT');
  });
});

describe('pnl, roe and risk', () => {
  it('computes long and short unrealized pnl', () => {
    expect(unrealizedPnl({ side: 'long', entry: 100, mark: 110, qty: 2 })).toBeCloseTo(20, 6);
    expect(unrealizedPnl({ side: 'short', entry: 100, mark: 90, qty: 2 })).toBeCloseTo(20, 6);
    expect(unrealizedPnl({ side: 'long', entry: 100, mark: 90, qty: 1 })).toBeCloseTo(-10, 6);
  });

  it('computes ROE on margin', () => {
    expect(roe(100, 500)).toBeCloseTo(20, 6);
    expect(roe(100, 0)).toBe(0);
  });

  it('classifies margin ratio into risk levels', () => {
    expect(riskLevel(0.2)).toBe('safe');
    expect(riskLevel(0.6)).toBe('warning');
    expect(riskLevel(0.9)).toBe('danger');
    expect(riskLevel(1.2)).toBe('liquidated');
    expect(riskLevel(Infinity)).toBe('liquidated');
    expect(marginRatio({ maintenanceMargin: 10, marginBalance: 100 })).toBeCloseTo(0.1, 6);
  });
});

describe('liquidation price', () => {
  it('places a long liquidation below entry and a short above', () => {
    const long = liquidationPrice({ side: 'long', entry: 100, qty: 1, leverage: 10, contract: CONTRACTS[0] });
    const short = liquidationPrice({ side: 'short', entry: 100, qty: 1, leverage: 10, contract: CONTRACTS[0] });
    expect(long).toBeLessThan(100);
    expect(short).toBeGreaterThan(100);
  });

  it('moves the liquidation further away with lower leverage', () => {
    const lowLev = liquidationPrice({ side: 'long', entry: 100, qty: 1, leverage: 3, contract: CONTRACTS[0] });
    const highLev = liquidationPrice({ side: 'long', entry: 100, qty: 1, leverage: 50, contract: CONTRACTS[0] });
    expect(lowLev).toBeLessThan(highLev);
  });

  it('pushes liquidation further away in cross margin with extra wallet balance', () => {
    const isolated = liquidationPrice({ side: 'long', entry: 100, qty: 1, leverage: 10, mode: 'isolated', contract: CONTRACTS[0] });
    const cross = liquidationPrice({ side: 'long', entry: 100, qty: 1, leverage: 10, mode: 'cross', walletBalance: 500, contract: CONTRACTS[0] });
    expect(cross).toBeLessThan(isolated);
  });
});

describe('funding', () => {
  it('makes longs pay when the rate is positive', () => {
    expect(fundingPayment({ side: 'long', notional: 10000, rate: 0.0001 })).toBeCloseTo(-1, 6);
    expect(fundingPayment({ side: 'short', notional: 10000, rate: 0.0001 })).toBeCloseTo(1, 6);
  });

  it('applies funding to realized pnl', () => {
    const out = applyFunding({ side: 'long', entry: 100, qty: 1, realizedPnl: 0 }, 0.001);
    expect(out.payment).toBeLessThan(0);
    expect(out.realizedPnl).toBeCloseTo(out.payment, 6);
  });

  it('aligns the next funding time to an 8h boundary', () => {
    const t = nextFundingTime(Date.UTC(2026, 0, 1, 9, 30));
    expect(t % FUNDING_INTERVAL_MS).toBe(0);
    expect(t).toBeGreaterThan(Date.UTC(2026, 0, 1, 9, 30));
  });
});

describe('position view, ADL and insurance fund', () => {
  const position = { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 1, leverage: 10, margin: 10 };

  it('summarises a position with margin, risk and liquidation', () => {
    const view = positionView(position, 105);
    expect(view.unrealizedPnl).toBeCloseTo(5, 6);
    expect(view.margin).toBeCloseTo(10, 6);
    expect(view.liquidationPrice).toBeLessThan(100);
    expect(['safe', 'warning', 'danger', 'liquidated']).toContain(view.risk);
    expect(view.distancePct).toBeGreaterThan(0);
  });

  it('ranks ADL by profit × leverage', () => {
    const q = adlQueue([
      { id: 'a', margin: 100, unrealizedPnl: 10, leverage: 5 },
      { id: 'b', margin: 100, unrealizedPnl: 50, leverage: 20 },
      { id: 'c', margin: 100, unrealizedPnl: -5, leverage: 10 }
    ]);
    expect(q[0].id).toBe('b');
    expect(q[q.length - 1].id).toBe('c');
  });

  it('drains the insurance fund and flags ADL', () => {
    const fund = new InsuranceFund(1000);
    expect(fund.needsAdl()).toBe(false);
    fund.absorb(950);
    expect(fund.balance).toBeCloseTo(50, 6);
    expect(fund.needsAdl()).toBe(true);
    fund.credit(2000);
    expect(fund.needsAdl()).toBe(false);
  });

  it('liquidates a position and reports the loss', () => {
    const out = liquidate(position, 80);
    expect(out.liquidated).toBe(true);
    expect(out.realizedPnl).toBeLessThan(0);
    expect(out.loss).toBeGreaterThan(0);
  });
});

describe('options pricing', () => {
  const base = { S: 100, K: 100, T: yearsFromDays(30), r: 0.02, sigma: 0.5 };

  it('satisfies put-call parity', () => {
    const call = bsPrice({ ...base, type: 'call' });
    const put = bsPrice({ ...base, type: 'put' });
    const { T, r, S, K } = base;
    expect(call - put).toBeCloseTo(S - K * Math.exp(-r * T), 6);
  });

  it('gives an at-the-money delta near 0.5 and sensible greeks', () => {
    const g = bsGreeks({ ...base, type: 'call' });
    expect(g.delta).toBeGreaterThan(0.4);
    expect(g.delta).toBeLessThan(0.7);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    const put = bsGreeks({ ...base, type: 'put' });
    expect(put.delta).toBeLessThan(0);
  });

  it('falls back to intrinsic value at expiry', () => {
    expect(bsPrice({ S: 120, K: 100, T: 0, r: 0, sigma: 0.5, type: 'call' })).toBeCloseTo(20, 6);
    expect(bsPrice({ S: 80, K: 100, T: 0, r: 0, sigma: 0.5, type: 'put' })).toBeCloseTo(20, 6);
    expect(optionPayoff({ type: 'call', S: 90, K: 100 })).toBe(0);
  });

  it('recovers implied volatility from a price', () => {
    const price = bsPrice({ ...base, type: 'call' });
    const iv = impliedVol({ ...base, type: 'call', price });
    expect(iv).toBeCloseTo(0.5, 3);
  });

  it('rejects impossible inputs', () => {
    expect(impliedVol({ ...base, type: 'call', price: -5 })).toBeNull();
    expect(bsPrice({ type: 'call', S: NaN, K: 100, T: 0.1, r: 0, sigma: 0.5 })).toBeNull();
  });

  it('computes the normal CDF correctly', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('liquidation heatmap', () => {
  const events = [
    { price: 100, notional: 1000, side: 'long_liquidation' },
    { price: 101, notional: 500, side: 'long_liquidation' },
    { price: 110, notional: 3000, side: 'short_liquidation' },
    { price: 120, notional: 200, side: 'long_liquidation' }
  ];

  it('buckets observed liquidations by price', () => {
    const { rows, min, max } = bucketLiquidations(events, { bins: 4 });
    expect(rows).toHaveLength(4);
    expect(min).toBe(100);
    expect(max).toBe(120);
    const total = rows.reduce((a, r) => a + r.total, 0);
    expect(total).toBeCloseTo(4700, 6);
  });

  it('ranks the biggest clusters', () => {
    const { rows } = bucketLiquidations(events, { bins: 4 });
    const clusters = clusterLevels(rows, 2);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].total).toBeGreaterThanOrEqual(clusters[1].total);
  });

  it('estimates density from open interest with normalised weights', () => {
    const est = estimateHeatmap({ markPrice: 100, openInterest: 100000, levels: 20 });
    expect(est.estimated).toBe(true);
    expect(est.rows).toHaveLength(20);
    expect(Math.max(...est.rows.map((r) => r.weight))).toBeCloseTo(1, 6);
    expect(est.rows.every((r) => r.weight >= 0 && r.weight <= 1)).toBe(true);
  });

  it('is empty-safe', () => {
    expect(bucketLiquidations([]).rows).toEqual([]);
    expect(estimateHeatmap({}).rows).toEqual([]);
    expect(clusterLevels([])).toEqual([]);
  });

  it('maps intensity to colour and groups rows into a grid', () => {
    expect(heatColor(0)).toMatch(/rgba/);
    expect(heatColor(1)).toMatch(/rgba/);
    expect(heatmapGrid(Array.from({ length: 12 }, () => ({})), 4)).toHaveLength(4);
  });
});
