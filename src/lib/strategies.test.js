import { describe, it, expect } from 'vitest';
import { PRESETS, presetById, evaluateStrategy, INTERVALS, intervalLabel } from './strategies.js';
import { signalSeries } from './backtest.js';

/* Deterministic synthetic market data */
function oscillating(n = 220) {
  const close = [];
  const high = [];
  const low = [];
  const open = [];
  const volume = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 9) * 1.6 + Math.sin(i / 29) * 2.4;
    const prev = price;
    price = Math.max(1, price + drift);
    open.push(prev);
    close.push(price);
    high.push(Math.max(prev, price) * 1.004);
    low.push(Math.min(prev, price) * 0.996);
    volume.push(1000 + (i % 7) * 120);
  }
  return { open, high, low, close, volume };
}

const flat = (n = 120) => {
  const arr = new Array(n).fill(100);
  return { open: [...arr], high: [...arr], low: [...arr], close: [...arr], volume: arr.map(() => 500) };
};

describe('preset catalogue', () => {
  it('exposes eight unique presets with defaults', () => {
    expect(PRESETS.length).toBe(8);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(8);
    PRESETS.forEach((p) => expect(typeof p.defaults).toBe('object'));
  });
  it('looks presets up by id', () => {
    expect(presetById('rsi-reversal').name).toBe('RSI Reversal');
    expect(presetById('nope')).toBeUndefined();
  });
  it('exposes the five timeframes with labels', () => {
    expect(INTERVALS.map((i) => i.key)).toEqual(['5m', '15m', '1h', '4h', '1d']);
    expect(intervalLabel('4h')).toBe('4h');
  });
});

describe('evaluateStrategy', () => {
  it('reports insufficient data instead of guessing', () => {
    const short = oscillating(10);
    const res = evaluateStrategy('rsi-reversal', short, undefined, { price: 100 });
    expect(res.signal).toBeNull();
    expect(res.reason).toMatch(/Not enough candle data/i);
  });

  it('never signals on perfectly flat data', () => {
    const f = flat();
    PRESETS.forEach((p) => {
      const res = evaluateStrategy(p.id, f, undefined, { price: 100 });
      expect(res.signal).toBeNull();
    });
  });

  it('returns a state and a human-readable reason for every preset', () => {
    const k = oscillating();
    PRESETS.forEach((p) => {
      const res = evaluateStrategy(p.id, k, undefined, { price: k.close[k.close.length - 1] });
      expect(['bullish', 'bearish', 'neutral']).toContain(res.state);
      expect(typeof res.reason).toBe('string');
      expect(res.reason.length).toBeGreaterThan(0);
    });
  });

  it('agrees with the vectorised signal series at the signal bar (no drift between live and backtest logic)', () => {
    const k = oscillating();
    PRESETS.forEach((p) => {
      const series = signalSeries(p.id, k, p.defaults);
      // live evaluation needs >= 30 bars, so only compare on signals past that warm-up
      const firstIdx = series.findIndex((s, i) => s != null && i >= 29);
      if (firstIdx === -1) return;
      const sliced = {
        open: k.open.slice(0, firstIdx + 1),
        high: k.high.slice(0, firstIdx + 1),
        low: k.low.slice(0, firstIdx + 1),
        close: k.close.slice(0, firstIdx + 1),
        volume: k.volume.slice(0, firstIdx + 1)
      };
      const live = evaluateStrategy(p.id, sliced, p.defaults, { price: sliced.close[sliced.close.length - 1] });
      expect(live.signal).toBe(series[firstIdx]);
    });
  });

  it('honours custom RSI thresholds', () => {
    const k = oscillating();
    const loose = evaluateStrategy('rsi-reversal', k, { period: 14, buyBelow: 90, sellAbove: 95 }, { price: k.close[k.close.length - 1] });
    expect(loose.reason).toMatch(/RSI\(14\)/);
  });
});
