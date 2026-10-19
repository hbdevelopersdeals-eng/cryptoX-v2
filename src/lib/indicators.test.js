import { describe, it, expect } from 'vitest';
import {
  sma, ema, rsi, macd, bollinger, stochastic, roc, donchian, vwap, mulberry32, stochRsi, cci
} from './indicators.js';

const seq = (n, f = (i) => i + 1) => Array.from({ length: n }, (_, i) => f(i));

describe('sma', () => {
  it('returns nulls before the window fills, then correct averages', () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });
  it('handles window larger than input', () => {
    expect(sma([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe('ema', () => {
  it('seeds from the first value and is monotonic for a rising series', () => {
    const out = ema(seq(30), 10);
    expect(out.length).toBe(30);
    expect(out[8]).toBeNull();
    expect(out[9]).not.toBeNull();
    expect(out[29]).toBeGreaterThan(out[20]);
    expect(out[29]).toBeLessThan(30);
  });
});

describe('rsi', () => {
  it('is 100 for a strictly rising series and 0 for a strictly falling one', () => {
    const up = rsi(seq(40, (i) => 100 + i), 14);
    const down = rsi(seq(40, (i) => 200 - i), 14);
    expect(up[39]).toBeCloseTo(100, 5);
    expect(down[39]).toBeCloseTo(0, 5);
  });
  it('is bounded 0..100 and null before the period', () => {
    const closes = seq(60, (i) => 100 + Math.sin(i / 3) * 5);
    const out = rsi(closes, 14);
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    out.slice(14).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

describe('macd', () => {
  it('produces aligned arrays and hist = line - signal where defined', () => {
    const closes = seq(80, (i) => 100 + Math.sin(i / 5) * 10 + i * 0.3);
    const m = macd(closes, 12, 26, 9);
    expect(m.line.length).toBe(80);
    expect(m.signal.length).toBe(80);
    for (let i = 0; i < 80; i++) {
      if (m.line[i] != null && m.signal[i] != null) {
        expect(m.hist[i]).toBeCloseTo(m.line[i] - m.signal[i], 10);
      } else {
        expect(m.hist[i]).toBeNull();
      }
    }
  });
});

describe('bollinger', () => {
  it('centres the mid band on the SMA and orders the bands', () => {
    const closes = seq(50, (i) => 100 + Math.sin(i / 4) * 8);
    const b = bollinger(closes, 20, 2);
    const s = sma(closes, 20);
    for (let i = 19; i < 50; i++) {
      expect(b.mid[i]).toBeCloseTo(s[i], 10);
      expect(b.upper[i]).toBeGreaterThan(b.mid[i]);
      expect(b.lower[i]).toBeLessThan(b.mid[i]);
    }
  });
});

describe('stochastic', () => {
  it('keeps %K within 0..100 and returns %D only after enough data', () => {
    const highs = seq(40, (i) => 110 + Math.sin(i / 3) * 5);
    const lows = seq(40, (i) => 90 + Math.sin(i / 3) * 5);
    const closes = seq(40, (i) => 100 + Math.sin(i / 3) * 5);
    const s = stochastic(highs, lows, closes, 14, 3);
    s.k.slice(13).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
    expect(s.d[13]).toBeNull();
    expect(s.d[20]).not.toBeNull();
  });
});

describe('roc', () => {
  it('computes percentage change over the period', () => {
    const out = roc([100, 101, 102, 103, 104, 110], 5);
    expect(out[5]).toBeCloseTo(10, 6);
    expect(out[0]).toBeNull();
  });
});

describe('donchian', () => {
  it('tracks rolling highs and lows', () => {
    const highs = [1, 5, 3, 2, 9, 4];
    const lows = [0, 2, 1, 0.5, 3, 1];
    const d = donchian(highs, lows, 3);
    expect(d.up[2]).toBe(5);
    expect(d.dn[2]).toBe(0);
    expect(d.up[4]).toBe(9);
    expect(d.dn[4]).toBe(0.5);
  });
});

describe('vwap', () => {
  it('equals the typical price for a single bar and stays bounded afterwards', () => {
    const h = [10, 12], l = [8, 9], c = [9, 11], v = [1, 1];
    const out = vwap(h, l, c, v);
    expect(out[0]).toBeCloseTo((10 + 8 + 9) / 3, 10);
    const tp2 = (12 + 9 + 11) / 3;
    expect(out[1]).toBeCloseTo((((10 + 8 + 9) / 3) + tp2) / 2, 10);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed and stays in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('stochRsi', () => {
  it('computes stochastic oscillator over RSI values and bounds within 0..100', () => {
    const closes = seq(60, (i) => 100 + Math.sin(i / 4) * 15);
    const res = stochRsi(closes, 14, 14, 3, 3);
    expect(res.raw.length).toBe(60);
    expect(res.k.length).toBe(60);
    expect(res.d.length).toBe(60);
    res.k.filter((v) => v !== null).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

describe('cci', () => {
  it('computes Commodity Channel Index oscillating around 0', () => {
    const highs = seq(50, (i) => 110 + Math.sin(i / 3) * 10);
    const lows = seq(50, (i) => 90 + Math.sin(i / 3) * 10);
    const closes = seq(50, (i) => 100 + Math.sin(i / 3) * 10);
    const out = cci(highs, lows, closes, 20);
    expect(out.length).toBe(50);
    expect(out[18]).toBeNull();
    expect(out[19]).not.toBeNull();
    expect(typeof out[30]).toBe('number');
  });
});
