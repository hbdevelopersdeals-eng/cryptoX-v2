import { describe, it, expect } from 'vitest';
import { runBacktest, signalSeries, computeMetrics, DEFAULT_ASSUMPTIONS } from './backtest.js';

/* Deterministic synthetic series builders */
function build(n, mode) {
  const out = [];
  let price = 100;
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const prev = price;
    let step;
    if (mode === 'rise') step = 1.2 + Math.sin(i / 5) * 0.4;
    else if (mode === 'fallRise') step = i < n / 2 ? -1.0 : 1.0;
    else if (mode === 'fallRiseFall') step = i < n / 3 ? -1.2 : i < (2 * n) / 3 ? 1.2 : -1.2;
    else step = Math.sin(i / 7) * 1.4 + Math.sin(i / 23) * 2.2 + 0.35 * Math.sin(i / 40);
    price = Math.max(2, price + step);
    out.push({
      t: start + i * 3600e3,
      o: prev,
      c: price,
      h: Math.max(prev, price) * 1.003,
      l: Math.min(prev, price) * 0.997,
      v: 1000 + (i % 5) * 100
    });
  }
  return out;
}

const kab = (data) => ({
  high: data.map((c) => c.h),
  low: data.map((c) => c.l),
  close: data.map((c) => c.c),
  volume: data.map((c) => c.v)
});

describe('runBacktest', () => {
  it('refuses to run without enough history', () => {
    const res = runBacktest({ candles: build(30, 'oscillate'), presetId: 'rsi-reversal', interval: '1h' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least 60 candles/i);
  });

  it('produces a coherent equity curve and bounded risk statistics', () => {
    const data = build(400, 'oscillate');
    const res = runBacktest({ candles: data, presetId: 'donchian-breakout', interval: '1h', initialCapital: 10000 });
    expect(res.ok).toBe(true);
    expect(res.equity.length).toBe(data.length);
    expect(res.metrics.finalEquity).toBeGreaterThan(0);
    expect(res.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(res.metrics.maxDrawdown).toBeLessThanOrEqual(1);
    expect(res.metrics.trades).toBeGreaterThanOrEqual(0);
    expect(res.walkForward.splitPct).toBe(70);
  });

  it('opens a position when the strategy fires', () => {
    const data = build(200, 'rise');
    const res = runBacktest({ candles: data, presetId: 'donchian-breakout', interval: '1h' });
    expect(res.ok).toBe(true);
    // note: metrics.trades counts closed round-trips; res.trades includes the open entry
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    expect(res.trades[0].side).toBe('BUY');
  });

  it('executes on the NEXT bar open with slippage (no look-ahead fills)', () => {
    const data = build(200, 'rise');
    const slip = 0.05;
    const res = runBacktest({ candles: data, presetId: 'donchian-breakout', interval: '1h', slippagePct: slip, feePct: 0 });
    const series = signalSeries('donchian-breakout', kab(data), {});
    const firstSignalIdx = series.findIndex((s) => s === 'BUY');
    expect(firstSignalIdx).toBeGreaterThan(-1);
    const firstBuy = res.trades.find((t) => t.side === 'BUY');
    expect(firstBuy).toBeTruthy();
    const expected = data[firstSignalIdx + 1].o * (1 + slip / 100);
    expect(Math.abs(firstBuy.price - expected) / expected).toBeLessThan(1e-9);
  });

  it('charges fees and slippage so more friction can never improve the result', () => {
    const data = build(600, 'fallRiseFall');
    const cheap = runBacktest({ candles: data, presetId: 'golden-cross', interval: '1h', feePct: 0, slippagePct: 0 });
    const pricey = runBacktest({ candles: data, presetId: 'golden-cross', interval: '1h', feePct: 1, slippagePct: 0.5 });
    expect(cheap.ok && pricey.ok).toBe(true);
    expect(pricey.trades.some((t) => t.pnl != null)).toBe(true);
    expect(pricey.feesPaid).toBeGreaterThan(0);
    expect(pricey.metrics.finalEquity).toBeLessThanOrEqual(cheap.metrics.finalEquity);
  });

  it('compares against buy & hold over the same window', () => {
    const data = build(300, 'rise');
    const res = runBacktest({ candles: data, presetId: 'macd-momentum', interval: '1h' });
    const expected = data[data.length - 1].c / data[0].c - 1;
    expect(res.benchmarkReturn).toBeCloseTo(expected, 10);
    expect(res.alphaVsHold).toBeCloseTo(res.metrics.totalReturn - res.benchmarkReturn, 10);
  });

  it('states its modelling assumptions explicitly', () => {
    const res = runBacktest({ candles: build(200, 'rise'), presetId: 'vwap-pullback', interval: '4h' });
    expect(res.assumptions.longOnly).toBe(true);
    expect(res.assumptions.note).toMatch(/next bar open/i);
    expect(DEFAULT_ASSUMPTIONS.feePct).toBeGreaterThan(0);
  });
});

describe('computeMetrics', () => {
  it('computes returns, drawdown and win rate from raw series', () => {
    const equity = [100, 110, 105, 120];
    const trades = [
      { pnl: 10, barsHeld: 1 },
      { pnl: -5, barsHeld: 1 },
      { pnl: 20, barsHeld: 2 }
    ];
    const m = computeMetrics(equity, trades, 4, '1h', 100);
    expect(m.totalReturn).toBeCloseTo(0.2, 10);
    expect(m.maxDrawdown).toBeCloseTo((110 - 105) / 110, 10);
    expect(m.winRate).toBeCloseTo(2 / 3, 10);
    expect(m.profitFactor).toBeCloseTo(30 / 5, 10);
    expect(m.trades).toBe(3);
  });

  it('handles an all-losing book without dividing by zero', () => {
    const m = computeMetrics([100, 90], [{ pnl: -10, barsHeld: 1 }], 2, '1d', 100);
    expect(m.profitFactor).toBe(0);
    expect(Number.isFinite(m.sharpe)).toBe(true);
  });
});
