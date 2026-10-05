import { describe, it, expect } from 'vitest';
import { aggregateDepth, cumulative, bookMetrics, liquidityScore, snapshotSeries, replayWindow } from './depth.js';

const lvl = (price, qty) => ({ price, qty });

describe('aggregateDepth', () => {
  it('merges nearby levels into percentage bands', () => {
    const rows = aggregateDepth([lvl(100, 1), lvl(100.02, 2), lvl(100.2, 3)], 0.1);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0].qty).toBeGreaterThanOrEqual(3);
    expect(rows[0].levels).toBe(2);
  });

  it('is safe on empty or invalid input', () => {
    expect(aggregateDepth([])).toEqual([]);
    expect(aggregateDepth([lvl(0, 1)])).toEqual([]);
  });
});

describe('cumulative', () => {
  it('accumulates quantity and notional', () => {
    const rows = cumulative([lvl(100, 1), lvl(101, 2)]);
    expect(rows[0].cumQty).toBe(1);
    expect(rows[1].cumQty).toBe(3);
    expect(rows[1].cumNotional).toBeCloseTo(302, 6);
  });
  it('handles an empty book', () => {
    expect(cumulative([])).toEqual([]);
  });
});

describe('bookMetrics', () => {
  it('computes spread, mid and imbalance', () => {
    const m = bookMetrics({ bids: [lvl(99, 10)], asks: [lvl(101, 5)] }, { depthPct: 2 });
    expect(m.bestBid).toBe(99);
    expect(m.bestAsk).toBe(101);
    expect(m.mid).toBe(100);
    expect(m.spread).toBe(2);
    expect(m.spreadPct).toBeCloseTo(2, 5);
    expect(m.imbalance).toBeGreaterThan(0);
  });

  it('is safe with an empty book', () => {
    const m = bookMetrics({ bids: [], asks: [] });
    expect(m.mid).toBeNull();
    expect(m.imbalance).toBeNull();
  });
});

describe('liquidityScore', () => {
  it('is zero without a mid and bounded otherwise', () => {
    expect(liquidityScore(null)).toBe(0);
    expect(liquidityScore({ mid: null })).toBe(0);
    const tight = liquidityScore({ mid: 100, spreadPct: 0.01, bidLiquidity: 1000000, askLiquidity: 1000000 });
    const wide = liquidityScore({ mid: 100, spreadPct: 0.4, bidLiquidity: 100, askLiquidity: 100 });
    expect(tight).toBeGreaterThan(wide);
    expect(tight).toBeLessThanOrEqual(100);
    expect(wide).toBeGreaterThanOrEqual(0);
  });
});

describe('snapshotSeries', () => {
  it('extracts values and drops empty points', () => {
    const series = snapshotSeries([
      { at: 1, lastPrice: 100 },
      { at: 2, lastPrice: null, l1: { mid: 101 } },
      { at: 3, lastPrice: null, l1: { mid: null } }
    ]);
    expect(series).toHaveLength(2);
    expect(series[1].value).toBe(101);
  });
  it('handles no snapshots', () => {
    expect(snapshotSeries([])).toEqual([]);
  });
});

describe('replayWindow', () => {
  const snaps = Array.from({ length: 10 }, (_, i) => ({ at: i, lastPrice: 100 + i }));
  it('returns a trailing window ending at the index', () => {
    const w = replayWindow(snaps, 5, 3);
    expect(w.slice).toHaveLength(3);
    expect(w.index).toBe(5);
    expect(w.slice[2].at).toBe(5);
    expect(w.total).toBe(10);
  });
  it('clamps out-of-range indices', () => {
    expect(replayWindow(snaps, 999, 5).index).toBe(9);
    expect(replayWindow(snaps, -5, 5).index).toBe(0);
  });
  it('is empty-safe', () => {
    expect(replayWindow([], 0)).toEqual({ slice: [], index: 0, total: 0 });
  });
});
