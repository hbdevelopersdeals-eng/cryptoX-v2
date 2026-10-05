import { describe, it, expect } from 'vitest';
import {
  classifyRsi, rsiFromCloses, closesWithLive, distanceToTrigger, scanStats, chunk,
  OVERSOLD, OVERBOUGHT, RSI_PERIOD
} from './rsiScan.js';

describe('classifyRsi', () => {
  it('flags oversold as BUY', () => {
    expect(classifyRsi(12).signal).toBe('BUY');
    expect(classifyRsi(29.9).signal).toBe('BUY');
  });
  it('flags overbought as SELL', () => {
    expect(classifyRsi(70.1).signal).toBe('SELL');
    expect(classifyRsi(93).signal).toBe('SELL');
  });
  it('treats the neutral band as HOLD, boundaries inclusive', () => {
    expect(classifyRsi(30).signal).toBe('HOLD');
    expect(classifyRsi(50).signal).toBe('HOLD');
    expect(classifyRsi(70).signal).toBe('HOLD');
  });
  it('handles missing values', () => {
    expect(classifyRsi(null).signal).toBe('NA');
    expect(classifyRsi(undefined).signal).toBe('NA');
    expect(classifyRsi(NaN).signal).toBe('NA');
  });
  it('honours custom thresholds', () => {
    expect(classifyRsi(25, 20, 80).signal).toBe('HOLD');
    expect(classifyRsi(15, 20, 80).signal).toBe('BUY');
  });
});

describe('rsiFromCloses', () => {
  it('returns null when history is too short', () => {
    expect(rsiFromCloses([1, 2, 3])).toBeNull();
    expect(rsiFromCloses([])).toBeNull();
    expect(rsiFromCloses(null)).toBeNull();
  });

  it('is 100 for a strictly rising series (no losses)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    expect(rsiFromCloses(closes)).toBeCloseTo(100, 5);
  });

  it('is 0 for a strictly falling series (no gains)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(rsiFromCloses(closes)).toBeCloseTo(0, 5);
  });

  it('stays inside 0..100 on noisy data', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 8);
    const value = rsiFromCloses(closes);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('needs period + 2 bars before it reports a value', () => {
    const justEnough = Array.from({ length: RSI_PERIOD + 2 }, (_, i) => 100 + i);
    expect(rsiFromCloses(justEnough)).not.toBeNull();
    const tooShort = Array.from({ length: RSI_PERIOD + 1 }, (_, i) => 100 + i);
    expect(rsiFromCloses(tooShort)).toBeNull();
  });
});

describe('closesWithLive', () => {
  it('replaces only the final close', () => {
    const candles = [{ c: 1 }, { c: 2 }, { c: 3 }];
    expect(closesWithLive(candles, 99)).toEqual([1, 2, 99]);
  });
  it('leaves data untouched without a valid live price', () => {
    const candles = [{ c: 1 }, { c: 2 }];
    expect(closesWithLive(candles, null)).toEqual([1, 2]);
    expect(closesWithLive(candles, 0)).toEqual([1, 2]);
  });
  it('is safe on empty input', () => {
    expect(closesWithLive([], 5)).toEqual([]);
    expect(closesWithLive(null, 5)).toEqual([]);
  });
});

describe('distanceToTrigger', () => {
  it('measures how far past the trigger a signal is', () => {
    expect(distanceToTrigger(22)).toEqual({ side: 'BUY', points: 8 });
    expect(distanceToTrigger(81)).toEqual({ side: 'SELL', points: 11 });
  });
  it('points at the nearer trigger when neutral', () => {
    expect(distanceToTrigger(28).side).toBe('BUY');
    expect(distanceToTrigger(68).side).toBe('SELL');
  });
  it('returns null without a value', () => {
    expect(distanceToTrigger(null)).toBeNull();
  });
});

describe('scanStats', () => {
  it('counts each signal type', () => {
    const stats = scanStats([
      { signal: 'BUY' }, { signal: 'BUY' }, { signal: 'SELL' }, { signal: 'HOLD' }, { signal: 'NA' }
    ]);
    expect(stats).toEqual({ buy: 2, sell: 1, hold: 1, na: 1, total: 5 });
  });
  it('is empty-safe', () => {
    expect(scanStats().total).toBe(0);
  });
});

describe('chunk', () => {
  it('splits into bounded slices', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
