import { describe, it, expect } from 'vitest';
import {
  buildContext, contextReadout, needsCandles, symbolsNeedingCandles, CANDLE_RULES
} from './alertContext.js';
import {
  normaliseAlert, applyCooldown, DEFAULT_COOLDOWN_MS, evaluateRule, validateRule,
  RULE_LABELS, PORTFOLIO_SYMBOL, PORTFOLIO_RULES
} from './alertsEngine.js';

/** Deterministic candle series: strictly rising closes. */
const mk = (n, { base = 100, step = 1, lastVol = null } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const c = base + i * step;
    return { o: c, c, h: c + 0.5, l: c - 0.5, v: i === n - 1 && lastVol != null ? lastVol : 100 };
  });

describe('alert context — candle requirements', () => {
  it('knows which rule types need history', () => {
    expect(needsCandles([{ type: 'price_above' }])).toBe(false);
    expect(needsCandles([{ type: 'pct_change' }])).toBe(false);
    expect(needsCandles([{ type: 'rsi_below' }])).toBe(true);
    // disabled rules must not pull candle history
    expect(needsCandles([{ type: 'rsi_below', enabled: false }])).toBe(false);
  });

  it('collects the distinct symbols that need history', () => {
    const syms = symbolsNeedingCandles([
      { type: 'rsi_below', symbol: 'BTC' },
      { type: 'ma_cross', symbol: 'ETH' },
      { type: 'price_above', symbol: 'BTC' },
      { type: 'rsi_above', symbol: 'BTC' }
    ]);
    expect(syms).toEqual(['BTC', 'ETH']);
  });

  it('exposes the candle-dependent rule set', () => {
    ['rsi_above', 'rsi_below', 'ma_cross', 'macd_cross', 'breakout', 'volume_spike'].forEach((t) => {
      expect(CANDLE_RULES.has(t)).toBe(true);
    });
  });
});

describe('alert context — buildContext', () => {
  it('keeps ticker fields and leaves indicators absent without candles', () => {
    const ctx = buildContext({ price: 105, pct24: -3 }, { price: 100 }, null, [{ type: 'rsi_below' }]);
    expect(ctx.price).toBe(105);
    expect(ctx.prevPrice).toBe(100);
    expect(ctx.pct24).toBe(-3);
    expect(ctx.rsi).toBeUndefined();
    expect(ctx.macd).toBeUndefined();
    expect(ctx.volume).toBeUndefined();
    expect(ctx.high).toBeUndefined();
  });

  it('computes RSI and MACD from history', () => {
    const ctx = buildContext({ price: 300 }, null, mk(200), [{ type: 'rsi_above' }]);
    expect(ctx.rsi).toBeCloseTo(100, 6); // monotonic gains → no losses
    expect(ctx.prevRsi).toBeCloseTo(100, 6);
    expect(ctx.macd).toBeGreaterThan(0);
    expect(ctx.macdSignal).toBeDefined();
  });

  it('uses the rule’s own periods for the MA cross', () => {
    const ctx = buildContext({ price: 300 }, null, mk(200), [{ type: 'ma_cross', periods: [9, 21] }]);
    expect(ctx.maFast).toBeGreaterThan(ctx.maSlow); // rising market → fast above slow
    expect(ctx.prevMaFast).toBeGreaterThan(ctx.prevMaSlow);
  });

  it('excludes the forming bar from the breakout range', () => {
    const candles = mk(200);
    const ctx = buildContext({ price: 300 }, null, candles, [{ type: 'breakout', periods: [20] }]);
    // prior window is indices 179..198, so the highest prior high is index 198
    expect(ctx.high).toBeCloseTo(100 + 198 * 1 + 0.5, 6);
    expect(ctx.low).toBeCloseTo(100 + 179 * 1 - 0.5, 6);
    expect(ctx.price).toBeGreaterThan(ctx.high); // a real upside breakout
  });

  it('derives volume and its baseline from the same source', () => {
    const ctx = buildContext(
      { price: 300, vol: 999999 }, // ticker volume is a DIFFERENT unit and must be ignored
      null,
      mk(200, { lastVol: 1000 }),
      [{ type: 'volume_spike' }]
    );
    expect(ctx.volume).toBe(1000);
    expect(ctx.volumeAvg).toBe(100); // all prior bars are 100
    expect(ctx.volume).not.toBe(999999);
  });

  it('never invents volume when history is missing', () => {
    const ctx = buildContext({ price: 300, vol: 999999 }, null, null, [{ type: 'volume_spike' }]);
    expect(ctx.volume).toBeUndefined();
    expect(ctx.volumeAvg).toBeUndefined();
  });
});

describe('alert context — readouts', () => {
  it('says when a value is unavailable instead of showing a fake number', () => {
    expect(contextReadout({ type: 'rsi_below' }, {})).toBe('RSI unavailable');
    expect(contextReadout({ type: 'volume_spike' }, {})).toBe('Volume baseline building…');
    expect(contextReadout({ type: 'breakout' }, {})).toBe('Range unavailable');
    expect(contextReadout({ type: 'ma_cross', periods: [9, 21] }, {})).toBe('MA unavailable');
  });

  it('formats live values when present', () => {
    expect(contextReadout({ type: 'rsi_below' }, { rsi: 28.44 })).toBe('RSI 28.4');
    expect(contextReadout({ type: 'volume_spike' }, { volume: 400, volumeAvg: 100 })).toBe('4.00× average');
    expect(contextReadout({ type: 'pct_change' }, { pct24: -7.126 })).toBe('-7.13% 24h');
  });
});

describe('alert normalisation', () => {
  it('migrates legacy dir/target alerts into a rule', () => {
    const a = normaliseAlert({ id: 'a1', coinId: 'bitcoin', symbol: 'BTC', dir: 'below', target: 50000 });
    expect(a.rule).toEqual({ type: 'price_below', value: 50000, symbol: 'BTC' });
    expect(a.enabled).toBe(true);
    expect(a.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
  });

  it('treats “above” as the default direction', () => {
    expect(normaliseAlert({ symbol: 'ETH', dir: 'above', target: 3000 }).rule.type).toBe('price_above');
  });

  it('leaves already-modern alerts untouched', () => {
    const a = normaliseAlert({ id: 'a2', symbol: 'ETH', rule: { type: 'rsi_below', symbol: 'ETH', value: 30 }, enabled: false, cooldownMs: 60000 });
    expect(a.rule).toEqual({ type: 'rsi_below', symbol: 'ETH', value: 30 });
    expect(a.enabled).toBe(false);
    expect(a.cooldownMs).toBe(60000);
    expect(normaliseAlert(null)).toBeNull();
  });
});

describe('portfolio value rules', () => {
  const above = { type: 'portfolio_value_above', symbol: PORTFOLIO_SYMBOL, value: 10000 };
  const below = { type: 'portfolio_value_below', symbol: PORTFOLIO_SYMBOL, value: 5000 };

  it('is registered as a portfolio rule family', () => {
    expect(PORTFOLIO_RULES.has('portfolio_value_above')).toBe(true);
    expect(PORTFOLIO_RULES.has('price_above')).toBe(false);
    expect(RULE_LABELS.portfolio_value_above).toMatch(/portfolio/i);
  });

  it('validates a positive threshold and ignores the symbol requirement', () => {
    expect(validateRule(above).ok).toBe(true);
    expect(validateRule({ type: 'portfolio_value_above', value: 0 }).ok).toBe(false);
    expect(validateRule({ type: 'portfolio_value_above', value: 'abc' }).ok).toBe(false);
    // A coin rule still requires a symbol.
    expect(validateRule({ type: 'price_above', value: 10 }).ok).toBe(false);
  });

  it('requires a cross, not just a state, when a previous value exists', () => {
    expect(evaluateRule(above, { portfolioValue: 10001, prevPortfolioValue: 9999 }).triggered).toBe(true);
    // Already above last tick → no repeat trigger.
    expect(evaluateRule(above, { portfolioValue: 10500, prevPortfolioValue: 10001 }).triggered).toBe(false);
    expect(evaluateRule(below, { portfolioValue: 4999, prevPortfolioValue: 5001 }).triggered).toBe(true);
    expect(evaluateRule(below, { portfolioValue: 4900, prevPortfolioValue: 4999 }).triggered).toBe(false);
  });

  it('fires on state alone when no previous value is known', () => {
    expect(evaluateRule(above, { portfolioValue: 12000 }).triggered).toBe(true);
    expect(evaluateRule(above, { portfolioValue: 8000 }).triggered).toBe(false);
  });

  it('stays silent when the portfolio cannot be valued', () => {
    expect(evaluateRule(above, { portfolioValue: null }).triggered).toBe(false);
    expect(evaluateRule(above, {}).triggered).toBe(false);
  });
});

describe('per-rule cooldown windows', () => {
  it('accepts a resolver so each rule can carry its own window', () => {
    const hits = [{ ruleId: 'r1' }, { ruleId: 'r2' }];
    const cd = (h) => (h.ruleId === 'r1' ? 1000 : 60000);

    const first = applyCooldown(hits, {}, cd, 5000);
    expect(first.fired.map((h) => h.ruleId)).toEqual(['r1', 'r2']);

    const second = applyCooldown(hits, first.lastFired, cd, 8000);
    expect(second.fired.map((h) => h.ruleId)).toEqual(['r1']); // r2 still cooling down
  });
});
