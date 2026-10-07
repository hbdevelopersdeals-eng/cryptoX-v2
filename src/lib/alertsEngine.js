/* Alert rules engine: rule definitions, evaluation against live context and
 * cooldown-based de-duplication. Pure functions — unit tested.
 *
 * The browser evaluates rules locally; delivery channels (in-app, browser
 * notification, email/webhook) are handled by the caller.
 */

import { EXTRA_RULE_TYPES, evaluateExtraRule, parseFormula } from './alertExtras.js';

/** Sentinel "symbol" for rules evaluated against the whole portfolio. */
export const PORTFOLIO_SYMBOL = 'PORTFOLIO';

export const PORTFOLIO_RULES = new Set(['portfolio_value_above', 'portfolio_value_below']);

export const RULE_TYPES = [
  'price_above',
  'price_below',
  'pct_change',
  'volume_spike',
  'rsi_above',
  'rsi_below',
  'ma_cross',
  'macd_cross',
  'breakout',
  'portfolio_value_above',
  'portfolio_value_below',
  ...EXTRA_RULE_TYPES
];

export const RULE_LABELS = {
  price_above: 'Price above',
  price_below: 'Price below',
  pct_change: '24h change beyond',
  volume_spike: 'Volume spike ×',
  rsi_above: 'RSI above',
  rsi_below: 'RSI below',
  ma_cross: 'MA cross (fast/slow)',
  macd_cross: 'MACD cross',
  breakout: 'Breakout of range',
  portfolio_value_above: 'Portfolio value above',
  portfolio_value_below: 'Portfolio value below',
  funding_above: 'Funding rate above',
  funding_below: 'Funding rate below',
  oi_change: 'Open interest change',
  liquidation_spike: 'Liquidation spike',
  formula: 'Custom formula'
};

export function describeRule(rule) {
  const label = RULE_LABELS[rule?.type] || rule?.type || 'rule';
  const v = rule?.value;
  switch (rule?.type) {
    case 'price_above': return `${rule.symbol} price above ${v}`;
    case 'price_below': return `${rule.symbol} price below ${v}`;
    case 'pct_change': return `${rule.symbol} 24h change beyond ±${v}%`;
    case 'volume_spike': return `${rule.symbol} volume ≥ ${v}× average`;
    case 'rsi_above': return `${rule.symbol} RSI above ${v}`;
    case 'rsi_below': return `${rule.symbol} RSI below ${v}`;
    case 'ma_cross': return `${rule.symbol} MA${rule.periods?.[0] ?? ''} crosses MA${rule.periods?.[1] ?? ''}`;
    case 'macd_cross': return `${rule.symbol} MACD crosses signal`;
    case 'breakout': return `${rule.symbol} breaks ${rule.periods?.[0] ?? 20}-bar range`;
    case 'portfolio_value_above': return `Portfolio value above $${v}`;
    case 'portfolio_value_below': return `Portfolio value below ${v}`;
    case 'funding_above': return `${rule.symbol} funding above ${v}%`;
    case 'funding_below': return `${rule.symbol} funding below ${v}%`;
    case 'oi_change': return `${rule.symbol} open interest moves ${v}%`;
    case 'liquidation_spike': return `${rule.symbol} liquidations within ${v}m`;
    case 'formula': return `Formula: ${rule.formula}`;
    default: return label;
  }
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** Evaluate one rule. ctx carries live values for one symbol. */
export function evaluateRule(rule, ctx = {}) {
  if (!rule?.type || !RULE_TYPES.includes(rule.type)) return { triggered: false, reason: 'unknown rule type' };
  const v = Number(rule.value);
  const price = num(ctx.price);
  const prev = num(ctx.prevPrice);

  switch (rule.type) {
    case 'price_above': {
      if (price == null) return { triggered: false };
      const crossed = prev != null ? prev <= v && price > v : price > v;
      return { triggered: crossed, detail: `price ${price} vs ${v}` };
    }
    case 'price_below': {
      if (price == null) return { triggered: false };
      const crossed = prev != null ? prev >= v && price < v : price < v;
      return { triggered: crossed, detail: `price ${price} vs ${v}` };
    }
    case 'pct_change': {
      const pct = num(ctx.pct24);
      if (pct == null) return { triggered: false };
      const triggered = Math.abs(pct) >= Math.abs(v);
      return { triggered, detail: `24h ${pct.toFixed(2)}% vs ±${v}%` };
    }
    case 'volume_spike': {
      const vol = num(ctx.volume);
      const avg = num(ctx.volumeAvg);
      if (vol == null || !avg) return { triggered: false };
      const ratio = vol / avg;
      return { triggered: ratio >= v, detail: `volume ${ratio.toFixed(2)}× average` };
    }
    case 'rsi_above': {
      const rsi = num(ctx.rsi);
      if (rsi == null) return { triggered: false };
      const prevRsi = num(ctx.prevRsi);
      const crossed = prevRsi != null ? prevRsi <= v && rsi > v : rsi > v;
      return { triggered: crossed, detail: `RSI ${rsi.toFixed(1)} vs ${v}` };
    }
    case 'rsi_below': {
      const rsi = num(ctx.rsi);
      if (rsi == null) return { triggered: false };
      const prevRsi = num(ctx.prevRsi);
      const crossed = prevRsi != null ? prevRsi >= v && rsi < v : rsi < v;
      return { triggered: crossed, detail: `RSI ${rsi.toFixed(1)} vs ${v}` };
    }
    case 'ma_cross': {
      const fast = num(ctx.maFast);
      const slow = num(ctx.maSlow);
      const pFast = num(ctx.prevMaFast);
      const pSlow = num(ctx.prevMaSlow);
      if ([fast, slow, pFast, pSlow].some((x) => x == null)) return { triggered: false };
      const up = pFast <= pSlow && fast > slow;
      const down = pFast >= pSlow && fast < slow;
      return { triggered: up || down, detail: up ? 'golden cross' : down ? 'death cross' : 'no cross' };
    }
    case 'macd_cross': {
      const m = num(ctx.macd);
      const s = num(ctx.macdSignal);
      const pm = num(ctx.prevMacd);
      const ps = num(ctx.prevMacdSignal);
      if ([m, s, pm, ps].some((x) => x == null)) return { triggered: false };
      const up = pm <= ps && m > s;
      const down = pm >= ps && m < s;
      return { triggered: up || down, detail: up ? 'bullish cross' : down ? 'bearish cross' : 'no cross' };
    }
    case 'breakout': {
      const high = num(ctx.high);
      const low = num(ctx.low);
      if (price == null || high == null || low == null) return { triggered: false };
      const up = price > high;
      const down = price < low;
      return { triggered: up || down, detail: up ? `broke above ${high}` : down ? `broke below ${low}` : 'inside range' };
    }
    case 'portfolio_value_above':
    case 'portfolio_value_below': {
      const value = num(ctx.portfolioValue);
      const prevValue = num(ctx.prevPortfolioValue);
      if (value == null) return { triggered: false };
      const above = rule.type === 'portfolio_value_above';
      const crossed = prevValue != null
        ? (above ? prevValue <= v && value > v : prevValue >= v && value < v)
        : (above ? value > v : value < v);
      return { triggered: crossed, detail: `portfolio $${value.toFixed(2)} vs $${v}` };
    }
    default:
      // Funding / open-interest / liquidation / formula rules live in
      // alertExtras so their data-source caveats stay in one place. Without
      // this delegation they could be created and saved but never fire —
      // a rule that is silently dead is worse than one that is absent.
      if (EXTRA_RULE_TYPES.includes(rule.type)) return evaluateExtraRule(rule, ctx);
      return { triggered: false };
  }
}

/** Evaluate every enabled rule for its symbol. */
export function evaluateAll(rules = [], ctxBySymbol = {}, now = Date.now()) {
  const hits = [];
  rules.filter((r) => r.enabled !== false).forEach((rule) => {
    const ctx = ctxBySymbol[rule.symbol] || {};
    const res = evaluateRule(rule, ctx);
    if (res.triggered) hits.push({ ruleId: rule.id, symbol: rule.symbol, type: rule.type, detail: res.detail, at: now });
  });
  return hits;
}

/**
 * Suppress repeat firings inside a cooldown window.
 * `cooldownMs` may be a number (same window for every hit) or a function
 * `(hit) => ms` when each rule carries its own window.
 */
export function applyCooldown(hits = [], lastFired = {}, cooldownMs = DEFAULT_COOLDOWN_MS, now = Date.now()) {
  const fired = [];
  const nextLastFired = { ...lastFired };
  const resolve = typeof cooldownMs === 'function' ? cooldownMs : () => cooldownMs;
  hits.forEach((hit) => {
    const key = `${hit.ruleId}`;
    const last = nextLastFired[key];
    const raw = Number(resolve(hit));
    const window = Number.isFinite(raw) ? raw : DEFAULT_COOLDOWN_MS;
    // A rule that has never fired must fire immediately. Only compare against a
    // recorded timestamp — comparing an epoch `now` against a 0 default would
    // wrongly suppress the very first alert.
    if (last != null && now - last < window) return;
    nextLastFired[key] = now;
    fired.push(hit);
  });
  return { fired, lastFired: nextLastFired };
}

export const DEFAULT_COOLDOWN_MS = 300000;

/**
 * Bring a stored alert up to the current schema.
 * Alerts created before the rules engine existed only had { dir, target } —
 * they are migrated to an equivalent price rule instead of being dropped.
 */
export function normaliseAlert(a) {
  if (!a) return null;
  const rule = a.rule?.type
    ? a.rule
    : {
      type: a.dir === 'below' ? 'price_below' : 'price_above',
      value: Number(a.target),
      symbol: a.symbol
    };
  return {
    ...a,
    rule,
    enabled: a.enabled !== false,
    cooldownMs: Number.isFinite(a.cooldownMs) ? a.cooldownMs : DEFAULT_COOLDOWN_MS,
    at: a.at || Date.now()
  };
}

export function validateRule(rule) {
  const errors = [];
  // Portfolio rules have no coin, so the symbol check does not apply to them.
  if (!PORTFOLIO_RULES.has(rule?.type) && !rule?.symbol) errors.push('symbol is required');
  if (!RULE_TYPES.includes(rule?.type)) errors.push('unknown rule type');
  if (PORTFOLIO_RULES.has(rule?.type)) {
    const pv = Number(rule?.value);
    if (!Number.isFinite(pv) || pv <= 0) errors.push('portfolio threshold must be a positive number');
    return { ok: errors.length === 0, errors };
  }
  if (['price_above', 'price_below', 'pct_change', 'volume_spike', 'rsi_above', 'rsi_below', 'funding_above', 'funding_below', 'oi_change', 'liquidation_spike'].includes(rule?.type)) {
    const v = Number(rule?.value);
    if (!Number.isFinite(v)) errors.push('value must be a number');
    else if (rule.type.startsWith('rsi') && (v < 0 || v > 100)) errors.push('RSI threshold must be between 0 and 100');
  }
  if (rule?.type === 'ma_cross') {
    const [f, s] = rule.periods || [];
    if (!(f > 0) || !(s > 0) || f >= s) errors.push('MA periods must be increasing (fast < slow)');
  }
  if (rule?.type === 'formula') {
    const parsed = parseFormula(rule.formula || '');
    if (!parsed.ok) errors.push(parsed.error);
    else if (parsed.unknown.length) errors.push(`Unknown variable(s): ${parsed.unknown.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}
