import { describe, it, expect } from 'vitest';
import { heikinAshi, renko, rangeBars, kagi, pointAndFigure, volumeProfile, marketProfile, scaleValue, toSeries } from './chartTypes.js';
import { wma, atr, adx, obv, ichimoku, supertrend, buildCustom } from './indicators2.js';

const bars = (n = 60) => Array.from({ length: n }, (_, i) => {
  const base = 100 + Math.sin(i / 5) * 6 + i * 0.3;
  return { t: 1700000000000 + i * 3600000, o: base - 0.5, h: base + 1.2, l: base - 1.4, c: base + 0.4, v: 100 + i };
});

describe('chart type transforms', () => {
  it('heikin ashi smooths and keeps bar count', () => {
    const src = bars(20);
    const ha = heikinAshi(src);
    expect(ha).toHaveLength(src.length);
    ha.forEach((b) => {
      expect(b.h).toBeGreaterThanOrEqual(b.c);
      expect(b.l).toBeLessThanOrEqual(b.c);
      expect(b.h).toBeGreaterThanOrEqual(b.o);
      expect(b.l).toBeLessThanOrEqual(b.o);
    });
    // first HA open is the midpoint of the first candle body
    expect(ha[0].o).toBeCloseTo((src[0].o + src[0].c) / 2, 6);
    expect(ha[0].c).toBeCloseTo((src[0].o + src[0].h + src[0].l + src[0].c) / 4, 6);
  });

  it('toSeries extracts a field', () => {
    expect(toSeries(bars(3), 'h')).toHaveLength(3);
  });

  it('renko builds bricks only on full box moves', () => {
    const flat = renko([{ t: 1, o: 100, h: 100, l: 100, c: 100, v: 1 }], { boxSize: 5 });
    expect(flat).toHaveLength(0);
    const rising = renko([
      { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1 },
      { t: 2, o: 100, h: 112, l: 100, c: 111, v: 1 }
    ], { boxSize: 5 });
    expect(rising.length).toBeGreaterThanOrEqual(2);
    expect(rising.every((b) => b.dir === 1)).toBe(true);
  });

  it('range bars close when the range fills', () => {
    const rb = rangeBars(bars(40), { rangeSize: 2 });
    expect(rb.length).toBeGreaterThan(0);
    rb.forEach((b) => expect(b.h - b.l).toBeGreaterThanOrEqual(0));
  });

  it('kagi alternates direction on reversals', () => {
    const segs = kagi([
      { t: 1, c: 100 }, { t: 2, c: 110 }, { t: 3, c: 95 }, { t: 4, c: 120 }
    ], { reversalPct: 4 });
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => Number.isFinite(s.price))).toBe(true);
  });

  it('point & figure produces columns of boxes', () => {
    const cols = pointAndFigure(bars(60), { boxSize: 1, reversal: 3 });
    expect(Array.isArray(cols)).toBe(true);
    cols.forEach((c) => expect(Array.isArray(c.boxes)).toBe(true));
  });
});

describe('volume profile / market profile', () => {
  it('distributes volume across buckets and finds a POC', () => {
    const vp = volumeProfile(bars(80), { bins: 12 });
    expect(vp.rows).toHaveLength(12);
    expect(vp.poc).toBeGreaterThan(0);
    const summed = vp.rows.reduce((a, r) => a + r.total, 0);
    const expected = bars(80).reduce((a, c) => a + c.v, 0);
    expect(summed).toBeCloseTo(expected, 6);
    expect(vp.valueArea.low).toBeLessThanOrEqual(vp.valueArea.high);
  });

  it('market profile counts touched buckets', () => {
    const mp = marketProfile(bars(30), { bins: 10 });
    expect(mp).toHaveLength(10);
    expect(mp.every((r) => r.tpo >= 0)).toBe(true);
  });
});

describe('scales', () => {
  it('maps values for linear, log and percent modes', () => {
    expect(scaleValue(100)).toBe(100);
    expect(scaleValue(100, { mode: 'log' })).toBeCloseTo(2, 6);
    expect(scaleValue(110, { mode: 'percent', base: 100 })).toBeCloseTo(10, 6);
    expect(scaleValue(0)).toBeNull();
  });
});

describe('additional indicators', () => {
  const src = bars(80);
  const closes = src.map((b) => b.c);
  const highs = src.map((b) => b.h);
  const lows = src.map((b) => b.l);
  const vols = src.map((b) => b.v);

  it('wma weights recent values more heavily', () => {
    const out = wma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[2]).toBeCloseTo((3 * 3 + 2 * 2 + 1 * 1) / 6, 6);
    expect(out[4]).toBeCloseTo((5 * 3 + 4 * 2 + 3 * 1) / 6, 6);
  });

  it('atr is positive and needs warm-up', () => {
    const out = atr(highs, lows, closes, 14);
    expect(out.slice(0, 14).every((v) => v == null)).toBe(true);
    expect(out[40]).toBeGreaterThan(0);
  });

  it('adx stays within 0..100 and provides DI lines', () => {
    const res = adx(highs, lows, closes, 14);
    const last = res.adx.filter((v) => v != null);
    expect(last.length).toBeGreaterThan(0);
    expect(Math.min(...last)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...last)).toBeLessThanOrEqual(100);
    expect(res.plusDI.some((v) => v != null)).toBe(true);
    expect(res.minusDI.some((v) => v != null)).toBe(true);
  });

  it('obv accumulates signed volume', () => {
    const out = obv([10, 11, 10, 12], [5, 5, 5, 5]);
    expect(out).toEqual([0, 5, 0, 5]);
  });

  it('ichimoku returns all five lines with correct warm-up', () => {
    const res = ichimoku(highs, lows, closes);
    expect(res.tenkan[7]).toBeNull();
    expect(res.tenkan[10]).not.toBeNull();
    expect(res.kijun[30]).not.toBeNull();
    expect(res.senkouB.length).toBe(closes.length);
  });

  it('supertrend flips direction and trails price', () => {
    const res = supertrend(highs, lows, closes, { period: 10, multiplier: 3 });
    const dirs = res.direction.filter((d) => d != null);
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.every((d) => d === 1 || d === -1)).toBe(true);
    expect(res.line.some((v) => v != null)).toBe(true);
  });

  it('custom indicator builder supports sma, ema and wma', () => {
    ['sma', 'ema', 'wma'].forEach((ma) => {
      const out = buildCustom(closes, { ma, period: 10 });
      expect(out).toHaveLength(closes.length);
      expect(out[closes.length - 1]).not.toBeNull();
    });
  });
});
