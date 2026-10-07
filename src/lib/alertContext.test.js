import { describe, it, expect } from 'vitest';
import {
  buildContext, contextReadout, needsCandles, symbolsNeedingCandles, CANDLE_RULES,
  DERIVATIVE_RULES, needsDerivatives, symbolsNeedingDerivatives
} from './alertContext.js';
import {
  normaliseAlert, applyCooldown, DEFAULT_COOLDOWN_MS, evaluateRule, validateRule,
  RULE_LABELS, RULE_TYPES, PORTFOLIO_SYMBOL, PORTFOLIO_RULES
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

describe('derivative inputs for the funding / OI / liquidation rules', () => {
  const row = { symbol: 'BTC', price: 101, pct24: 2 };

  it('knows which rules need the derivatives feed', () => {
    expect(needsDerivatives([{ type: 'price_above' }])).toBe(false);
    expect(needsDerivatives([{ type: 'funding_above' }])).toBe(true);
    expect(needsDerivatives([{ type: 'liquidation_spike', enabled: false }])).toBe(false);
    expect(symbolsNeedingDerivatives([{ type: 'oi_change', symbol: 'BTC' }, { type: 'oi_change', symbol: 'BTC' }]))
      .toEqual(['BTC']);
    expect(DERIVATIVE_RULES.has('funding_below')).toBe(true);
  });

  it('merges feed values into the context when they are known', () => {
    const ctx = buildContext(row, null, null, [], {
      funding: 0.0123, openInterest: 110, prevOpenInterest: 100, liqVolume: 250000
    });
    expect(ctx.funding).toBe(0.0123);
    expect(ctx.openInterest).toBe(110);
    expect(ctx.prevOpenInterest).toBe(100);
    expect(ctx.liqVolume).toBe(250000);
  });

  it('leaves the keys absent when the feed has not answered', () => {
    // Absent keys are what make the rule report "unavailable" instead of firing
    // against an invented zero — the whole point of the optional argument.
    const ctx = buildContext(row, null, null, [], { funding: null, liqVolume: undefined });
    expect('funding' in ctx).toBe(false);
    expect('liqVolume' in ctx).toBe(false);
    expect(evaluateRule({ type: 'funding_above', symbol: 'BTC', value: 0.01 }, ctx).triggered).toBe(false);
  });

  it('reads out a live value for each new rule type', () => {
    expect(contextReadout({ type: 'funding_above' }, { funding: 0.05 })).toBe('Funding 0.0500%');
    expect(contextReadout({ type: 'funding_below' }, {})).toBe('Funding unavailable');
    expect(contextReadout({ type: 'oi_change' }, { openInterest: 110, prevOpenInterest: 100 })).toBe('OI 10.00%');
    expect(contextReadout({ type: 'oi_change' }, { openInterest: 110 })).toBe('Open interest building…');
    expect(contextReadout({ type: 'liquidation_spike' }, {})).toBe('No liquidation stream data');
  });
});

describe('no rule type is dead', () => {
  /* The failure mode this guards against is a rule a user can create, save and
   * toggle on that can never fire. Every registered type must reach a trigger
   * given the inputs it asks for. */
  const RULES = {
    price_above: { type: 'price_above', symbol: 'BTC', value: 100 },
    price_below: { type: 'price_below', symbol: 'BTC', value: 90 },
    pct_change: { type: 'pct_change', symbol: 'BTC', value: 5 },
    volume_spike: { type: 'volume_spike', symbol: 'BTC', value: 2 },
    rsi_above: { type: 'rsi_above', symbol: 'BTC', value: 70 },
    rsi_below: { type: 'rsi_below', symbol: 'BTC', value: 30 },
    ma_cross: { type: 'ma_cross', symbol: 'BTC', periods: [9, 21] },
    macd_cross: { type: 'macd_cross', symbol: 'BTC' },
    breakout: { type: 'breakout', symbol: 'BTC', periods: [20] },
    portfolio_value_above: { type: 'portfolio_value_above', symbol: PORTFOLIO_SYMBOL, value: 10000 },
    portfolio_value_below: { type: 'portfolio_value_below', symbol: PORTFOLIO_SYMBOL, value: 10000 },
    funding_above: { type: 'funding_above', symbol: 'BTC', value: 0.01 },
    funding_below: { type: 'funding_below', symbol: 'BTC', value: 0 },
    oi_change: { type: 'oi_change', symbol: 'BTC', value: 5 },
    liquidation_spike: { type: 'liquidation_spike', symbol: 'BTC', value: 5 },
    formula: { type: 'formula', symbol: 'BTC', formula: 'rsi < 30 && pct24 < -5' }
  };

  const CONTEXTS = {
    price_above: { price: 101, prevPrice: 99 },
    price_below: { price: 89, prevPrice: 91 },
    pct_change: { pct24: -8 },
    volume_spike: { volume: 300, volumeAvg: 100 },
    rsi_above: { rsi: 75, prevRsi: 60 },
    rsi_below: { rsi: 20, prevRsi: 35 },
    ma_cross: { maFast: 2, maSlow: 1, prevMaFast: 1, prevMaSlow: 2 },
    macd_cross: { macd: 1, macdSignal: 0, prevMacd: 0, prevMacdSignal: 1 },
    breakout: { price: 101, high: 100, low: 90 },
    portfolio_value_above: { portfolioValue: 12000, prevPortfolioValue: 9000 },
    portfolio_value_below: { portfolioValue: 8000, prevPortfolioValue: 11000 },
    funding_above: { funding: 0.05 },
    funding_below: { funding: -0.05 },
    oi_change: { openInterest: 110, prevOpenInterest: 100 },
    liquidation_spike: { liqVolume: 250000 },
    formula: { rsi: 20, pct24: -9 }
  };

  it('covers every registered type in this test', () => {
    // Adding a rule type without teaching the engine to fire it fails here.
    expect(Object.keys(RULES).sort()).toEqual([...RULE_TYPES].sort());
    RULE_TYPES.forEach((t) => expect(RULE_LABELS[t], t).toBeTruthy());
  });

  it('fires each type given its inputs', () => {
    RULE_TYPES.forEach((t) => {
      const res = evaluateRule(RULES[t], CONTEXTS[t]);
      expect(res.triggered, `${t} can never fire`).toBe(true);
    });
  });

  it('accepts each type through validation', () => {
    RULE_TYPES.forEach((t) => {
      const res = validateRule(RULES[t]);
      expect(res.errors, `${t}: ${res.errors.join(', ')}`).toEqual([]);
    });
  });
});
