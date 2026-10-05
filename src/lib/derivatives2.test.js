import { describe, it, expect } from 'vitest';
import {
  CONTRACTS, lastFriday, quarterlyExpiries, daysToExpiry, datedContracts,
  priceBasis, fundingFromPremium, annualisedBasis, fairFuturesPrice,
  closePartial, realizeFunding, crossWallet, initialMargin, maintenanceRequirement,
  liquidate, positionView, unrealizedPnl, contractBySymbol
} from './derivativesEngine.js';

const T0 = Date.UTC(2026, 9, 5); // 5 Oct 2026

describe('dated futures', () => {
  it('finds the last Friday of a month', () => {
    // March 2026: last day is the 31st, a Tuesday → last Friday is the 27th.
    const d = lastFriday(2026, 2);
    expect(d.getUTCDay()).toBe(5);            // Friday
    expect(d.getUTCMonth()).toBe(2);
  });

  it('returns the next two quarterly expiries, all in the future and on a Friday', () => {
    const ex = quarterlyExpiries(T0, 2);
    expect(ex).toHaveLength(2);
    ex.forEach((d) => {
      expect(d.getTime()).toBeGreaterThan(T0);
      expect(d.getUTCDay()).toBe(5);
      expect([2, 5, 8, 11]).toContain(d.getUTCMonth());
    });
    expect(ex[0].getTime()).toBeLessThan(ex[1].getTime());
  });

  it('skips a quarter that has already expired', () => {
    // A quarter expiry at 08:00 UTC on the last Friday — anything before now is skipped.
    const ex = quarterlyExpiries(T0, 1);
    expect(ex[0].getTime()).toBeGreaterThan(T0);
  });

  it('computes days to expiry', () => {
    const inTen = new Date(T0 + 10 * 86400000).toISOString();
    expect(daysToExpiry(inTen, T0)).toBeCloseTo(10, 4);
    expect(daysToExpiry(new Date(T0 - 86400000).toISOString(), T0)).toBe(0);
  });

  it('derives dated contracts from the perpetual spec rather than inventing them', () => {
    const dated = datedContracts(T0, CONTRACTS[0]);
    expect(dated.length).toBe(2);
    dated.forEach((c) => {
      expect(c.kind).toBe('dated');
      expect(c.symbol).toMatch(/^BTCUSDT_\d{6}$/);
      expect(new Date(c.expiry).getTime()).toBeGreaterThan(T0);
      expect(c.base).toBe('BTC');
      // Dated futures carry less leverage than the perpetual.
      expect(c.maxLeverage).toBeLessThanOrEqual(50);
      expect(c.maintenanceTiers).toBe(CONTRACTS[0].maintenanceTiers);
    });
  });
});

describe('mark vs index price', () => {
  it('computes the basis between mark and index', () => {
    const b = priceBasis({ markPrice: 101, indexPrice: 100 });
    expect(b.abs).toBe(1);
    expect(b.pct).toBeCloseTo(1, 6);
  });

  it('returns null on unusable inputs instead of NaN', () => {
    expect(priceBasis({ markPrice: 0, indexPrice: 100 })).toBeNull();
    expect(priceBasis({ markPrice: 100, indexPrice: null })).toBeNull();
    expect(priceBasis({})).toBeNull();
  });

  it('derives funding from the premium with the published clamp', () => {
    // A large premium is clamped by the interest-rate band, then capped.
    const high = fundingFromPremium({ premiumPct: 0.05 });
    expect(high).toBeLessThanOrEqual(0.0075);
    expect(high).toBeGreaterThan(0);

    // Tiny premium: the interest-rate pull dominates but stays inside the clamp.
    const tiny = fundingFromPremium({ premiumPct: 0 });
    expect(tiny).toBeCloseTo(0.0001, 6);

    // Negative premium drives funding negative.
    expect(fundingFromPremium({ premiumPct: -0.05 })).toBeLessThan(0);
  });

  it('annualises a term-structure basis and flags contango', () => {
    const c = annualisedBasis({ futuresPrice: 105, indexPrice: 100, days: 90 });
    expect(c.pct).toBeCloseTo(5, 6);
    expect(c.annualisedPct).toBeCloseTo(5 * (365 / 90), 4);
    expect(c.contango).toBe(true);

    const back = annualisedBasis({ futuresPrice: 95, indexPrice: 100, days: 90 });
    expect(back.contango).toBe(false);
    expect(back.annualisedPct).toBeLessThan(0);

    expect(annualisedBasis({ futuresPrice: 0, indexPrice: 100, days: 90 })).toBeNull();
    expect(annualisedBasis({ futuresPrice: 100, indexPrice: 100, days: 0 })).toBeNull();
  });

  it('prices a dated future by cost of carry', () => {
    // Zero rate → fair value equals the index.
    expect(fairFuturesPrice({ indexPrice: 100, days: 365, rate: 0 })).toBeCloseTo(100, 6);
    // 10% for a year → e^0.1 ≈ 1.10517
    expect(fairFuturesPrice({ indexPrice: 100, days: 365, rate: 0.1 })).toBeCloseTo(100 * Math.exp(0.1), 4);
    expect(fairFuturesPrice({ indexPrice: 0, days: 10 })).toBeNull();
  });
});

describe('realized PnL', () => {
  const position = { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 2, leverage: 10, realizedPnl: 0 };

  it('realizes profit on a partial close, net of fees', () => {
    const r = closePartial(position, { qty: 1, price: 110 });
    expect(r.closeQty).toBe(1);
    expect(r.gross).toBeCloseTo(10, 6);       // (110-100) * 1
    expect(r.fee).toBeCloseTo(110 * 0.0005, 6);
    expect(r.realizedPnl).toBeCloseTo(10 - 110 * 0.0005, 6);
    expect(r.remainingQty).toBe(1);
    expect(r.position.qty).toBe(1);
    expect(r.position.closed).toBeUndefined();
    // Margin allocated was 100*1/10 = 10
    expect(r.roe).toBeCloseTo(((10 - 110 * 0.0005) / 10) * 100, 4);
  });

  it('realizes a loss on a short when price rises', () => {
    const short = { ...position, side: 'short', qty: 1 };
    const r = closePartial(short, { qty: 1, price: 105 });
    expect(r.gross).toBeCloseTo(-5, 6);
    expect(r.realizedPnl).toBeLessThan(-5);   // fees make it worse
  });

  it('accumulates onto existing realized PnL', () => {
    const r = closePartial({ ...position, realizedPnl: 7 }, { qty: 1, price: 110 });
    expect(r.position.realizedPnl).toBeCloseTo(7 + r.realizedPnl, 6);
  });

  it('marks the position closed on a full close', () => {
    const r = closePartial(position, { qty: 2, price: 90 });
    expect(r.remainingQty).toBe(0);
    expect(r.position.closed).toBe(true);
    expect(r.position.qty).toBe(0);
    expect(r.position.closePrice).toBe(90);
  });

  it('never closes more than the open size', () => {
    const r = closePartial(position, { qty: 99, price: 100 });
    expect(r.closeQty).toBe(2);
    expect(r.remainingQty).toBe(0);
  });

  it('returns null on an unusable close', () => {
    expect(closePartial(position, { qty: 0, price: 100 })).toBeNull();
    expect(closePartial(position, { qty: 1, price: 0 })).toBeNull();
  });

  it('accrues funding into realized PnL with the correct sign', () => {
    // Positive rate → longs pay shorts.
    const long = realizeFunding({ ...position, qty: 1 }, 0.0001);
    expect(long.payment).toBeLessThan(0);
    expect(long.position.realizedPnl).toBeLessThan(0);

    const short = realizeFunding({ ...position, side: 'short', qty: 1 }, 0.0001);
    expect(short.payment).toBeGreaterThan(0);
  });
});

describe('cross margin', () => {
  const positions = [
    { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 1, leverage: 10 },
    { symbol: 'ETHUSDT', side: 'long', entry: 50, qty: 2, leverage: 10 }
  ];
  const marks = { BTCUSDT: 100, ETHUSDT: 50 };

  it('pools collateral across every position', () => {
    const w = crossWallet({ positions, walletBalance: 1000, marks });
    expect(w.positions).toBe(2);
    expect(w.totalNotional).toBe(200);                 // 100 + 100
    expect(w.totalInitial).toBeCloseTo(10 + 10, 6);    // 100/10 and 100/10
    expect(w.totalMaintenance).toBeGreaterThan(0);
    expect(w.marginBalance).toBeCloseTo(1000, 6);      // no PnL at entry marks
    expect(w.risk).toBe('safe');
    expect(w.cushion).toBeGreaterThan(0);
  });

  it('aggregates unrealized PnL into the shared margin balance', () => {
    const w = crossWallet({ positions, walletBalance: 1000, marks: { BTCUSDT: 110, ETHUSDT: 40 } });
    // BTC +10, ETH -20 → net -10
    expect(w.totalUnrealized).toBeCloseTo(-10, 6);
    expect(w.marginBalance).toBeCloseTo(990, 6);
  });

  it('goes to liquidation risk when the pool is drained', () => {
    const w = crossWallet({ positions, walletBalance: 0, marks: { BTCUSDT: 1, ETHUSDT: 1 } });
    expect(['danger', 'liquidated']).toContain(w.risk);
    expect(w.cushion).toBeLessThan(0);
  });

  it('handles an empty wallet without dividing by zero', () => {
    const w = crossWallet({ positions: [], walletBalance: 0, marks: {} });
    expect(w.positions).toBe(0);
    expect(w.totalNotional).toBe(0);
    expect(Number.isFinite(w.marginRatio)).toBe(true);
    expect(w.risk).toBe('liquidated');
  });
});

describe('liquidation shortfall (regression)', () => {
  it('charges the fund only the gap between maintenance and margin balance', () => {
    // long 1 @100, 10x → initial margin 10. At mark 80: uPnL -20,
    // marginBalance = -10, maintenance = 80 * 0.004 = 0.32
    // shortfall = 0.32 - (-10) = 10.32  (the old formula returned 20.32)
    const pos = { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 1, leverage: 10 };
    const out = liquidate(pos, 80);
    expect(out.liquidated).toBe(true);
    expect(out.shortfall).toBeCloseTo(10.32, 6);
    expect(out.loss).toBeGreaterThan(0);
    expect(out.realizedPnl).toBeLessThan(0);
  });

  it('reports no shortfall when the margin still covers maintenance', () => {
    const pos = { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 1, leverage: 10 };
    const out = liquidate(pos, 92); // marginBalance = 10 - 8 = 2 > maintenance ~0.37
    expect(out.shortfall).toBe(0);
  });

  it('keeps the insurance fund consistent with the shortfall it absorbs', () => {
    const pos = { symbol: 'BTCUSDT', side: 'long', entry: 100, qty: 1, leverage: 10 };
    const view = positionView(pos, 80);
    const out = liquidate(pos, 80);
    expect(out.shortfall).toBeCloseTo(Math.max(0, view.maintenanceMargin - view.marginBalance), 6);
  });
});

describe('contract specs remain consistent', () => {
  it('has tiered maintenance that increases with notional', () => {
    const small = maintenanceRequirement(1000, CONTRACTS[0]);
    const large = maintenanceRequirement(2000000, CONTRACTS[0]);
    expect(large.mmr).toBeGreaterThan(small.mmr);
    expect(large.maintenanceMargin).toBeGreaterThan(small.maintenanceMargin);
  });

  it('resolves an unknown symbol to a real contract instead of throwing', () => {
    expect(contractBySymbol('NOPE').symbol).toBe(CONTRACTS[0].symbol);
  });

  it('keeps unrealized PnL symmetric for long and short', () => {
    const l = unrealizedPnl({ side: 'long', entry: 100, mark: 110, qty: 1 });
    const s = unrealizedPnl({ side: 'short', entry: 100, mark: 90, qty: 1 });
    expect(l).toBe(10);
    expect(s).toBe(10);
  });
});
