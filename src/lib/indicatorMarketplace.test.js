import { describe, it, expect } from 'vitest';
import {
  INDICATOR_PRESETS, INDICATOR_CATEGORIES, INDICATOR_FAMILIES, MA_TYPES,
  makeCustomIndicator, presetById, STUDY_FAMILIES
} from './indicatorMarketplace.js';

describe('indicator marketplace registry', () => {
  it('gives every preset a unique id and the required metadata', () => {
    const ids = new Set();
    INDICATOR_PRESETS.forEach((p) => {
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
      ids.add(p.id);
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.author).toBeTruthy();
      expect(p.blurb.length).toBeGreaterThan(15);
      expect(typeof p.installs).toBe('number');
    });
  });

  it('never points a preset at an indicator the engine does not implement', () => {
    Object.values(INDICATOR_PRESETS).forEach((p) => {
      expect(INDICATOR_FAMILIES[p.family], `unknown family ${p.family}`).toBeDefined();
    });
  });

  it('categorises every preset from the published category list', () => {
    INDICATOR_PRESETS.forEach((p) => {
      expect(INDICATOR_CATEGORIES).toContain(p.category);
    });
  });

  it('covers the indicator families the checklist names', () => {
    const families = new Set(INDICATOR_PRESETS.map((p) => p.family));
    ['sma', 'ema', 'wma', 'rsi', 'macd', 'bollinger', 'atr', 'adx', 'stochastic', 'obv', 'ichimoku', 'supertrend', 'vwap']
      .forEach((f) => expect(families.has(f), `missing preset for ${f}`).toBe(true));
  });

  it('labels study-pane families so the UI can place them correctly', () => {
    expect(STUDY_FAMILIES).toContain('rsi');
    expect(STUDY_FAMILIES).toContain('macd');
    expect(STUDY_FAMILIES).not.toContain('ema'); // an overlay, not a study
  });

  it('resolves a preset by id, or null', () => {
    expect(presetById(INDICATOR_PRESETS[0].id).id).toBe(INDICATOR_PRESETS[0].id);
    expect(presetById('nope')).toBeNull();
  });

  it('keeps the custom preset consistent with the builder defaults', () => {
    const custom = INDICATOR_PRESETS.find((p) => p.family === 'custom');
    expect(custom).toBeDefined();
    expect(MA_TYPES).toContain(custom.params.ma);
    expect(custom.params.period).toBeGreaterThan(0);
  });
});

describe('user-created indicators', () => {
  const candles = Array.from({ length: 40 }, (_, i) => ({ c: 100 + i, h: 101 + i, l: 99 + i, v: 10 }));

  it('builds a valid indicator and computes its series', () => {
    const r = makeCustomIndicator({ ma: 'wma', period: 9, source: candles });
    expect(r.ok).toBe(true);
    expect(r.spec.label).toBe('WMA 9');
    expect(r.spec.builtIn).toBe(false);
    expect(r.series).toHaveLength(40);
    // The final value must be a real number for a complete window.
    expect(Number.isFinite(r.series[r.series.length - 1])).toBe(true);
  });

  it('computes the SMA correctly as a sanity anchor', () => {
    const r = makeCustomIndicator({ ma: 'sma', period: 3, source: [{ c: 1 }, { c: 2 }, { c: 3 }, { c: 4 }] });
    expect(r.ok).toBe(true);
    // Trailing 3-window at the end = (2+3+4)/3 = 3
    expect(r.series[r.series.length - 1]).toBeCloseTo(3, 10);
  });

  it('returns an empty series when no source is supplied', () => {
    const r = makeCustomIndicator({ ma: 'ema', period: 12 });
    expect(r.ok).toBe(true);
    expect(r.series).toEqual([]);
  });

  it('rejects an unsupported average with a reason', () => {
    const r = makeCustomIndicator({ ma: 'hull', period: 9, source: candles });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Unsupported average/);
  });

  it('rejects a nonsense period instead of producing a broken series', () => {
    expect(makeCustomIndicator({ period: 0 }).ok).toBe(false);
    expect(makeCustomIndicator({ period: -5 }).ok).toBe(false);
    expect(makeCustomIndicator({ period: 2.5 }).ok).toBe(false);
    expect(makeCustomIndicator({ period: 501 }).ok).toBe(false);
    expect(makeCustomIndicator({ period: 'abc' }).ok).toBe(false);
  });

  it('accepts the boundary periods', () => {
    expect(makeCustomIndicator({ period: 1 }).ok).toBe(true);
    expect(makeCustomIndicator({ period: 500 }).ok).toBe(true);
  });
});
