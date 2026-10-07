import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FORMULA_VARS, tokenize, parseFormula, evaluateFormula, EXTRA_RULES, EXTRA_RULE_TYPES,
  evaluateExtraRule, CHANNELS, channelById, channelCoverage, buildWebhookPayload, UNAVAILABLE_RULES
} from './alertExtras.js';
import { RULE_TYPES, RULE_LABELS, describeRule, evaluateRule, validateRule } from './alertsEngine.js';

describe('formula tokenizer', () => {
  it('tokenizes numbers, identifiers and operators', () => {
    const r = tokenize('rsi < 30 && price > 1_000');
    expect(r.ok).toBe(true);
    expect(r.tokens.map((t) => t.v)).toEqual(['rsi', '<', 30, '&&', 'price', '>', 1000]);
  });

  it('rejects an unknown character instead of ignoring it', () => {
    const r = tokenize('rsi < 30 # comment');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unexpected character/);
  });

  it('rejects a malformed number', () => {
    expect(tokenize('1.2.3').ok).toBe(false);
  });
});

describe('formula parsing', () => {
  it('applies standard precedence', () => {
    const { ast } = parseFormula('1 + 2 * 3');
    expect(ast.op).toBe('+');
    expect(ast.b.op).toBe('*');
  });

  it('honours parentheses', () => {
    const r = evaluateFormula('(1 + 2) * 3', {});
    expect(r.value).toBe(9);
  });

  it('handles unary minus and exponentiation', () => {
    expect(evaluateFormula('-2 ^ 2', {}).value).toBe(-4);
  });

  it('lists referenced variables', () => {
    const r = parseFormula('rsi < 30 && price > 100');
    expect(r.vars).toEqual(['rsi', 'price']);
  });

  it('reports unknown variables before evaluation', () => {
    const r = parseFormula('rsi < 30 && nonsense > 1');
    expect(r.unknown).toEqual(['nonsense']);
  });

  it('rejects unbalanced parentheses and trailing tokens', () => {
    expect(parseFormula('(1 + 2').ok).toBe(false);
    expect(parseFormula('1 + 2)').ok).toBe(false);
    expect(parseFormula('').ok).toBe(false);
    expect(parseFormula('rsi').ok).toBe(true); // a bare variable is valid
  });
});

describe('formula evaluation', () => {
  it('evaluates comparisons and logic', () => {
    expect(evaluateFormula('rsi < 30', { rsi: 22 }).triggered).toBe(true);
    expect(evaluateFormula('rsi < 30', { rsi: 55 }).triggered).toBe(false);
    expect(evaluateFormula('rsi < 30 && pct24 < -5', { rsi: 22, pct24: -8 }).triggered).toBe(true);
    expect(evaluateFormula('rsi < 30 || pct24 < -5', { rsi: 55, pct24: -8 }).triggered).toBe(true);
  });

  it('refuses to treat a missing input as zero', () => {
    // Treating undefined as 0 would make "rsi < 30" fire whenever RSI is absent.
    const r = evaluateFormula('rsi < 30', {});
    expect(r.ok).toBe(false);
    expect(r.triggered).toBe(false);
    expect(r.error).toMatch(/not available/);
  });

  it('reports division by zero rather than returning Infinity', () => {
    const r = evaluateFormula('price / 0', { price: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Division by zero/);
  });

  it('rejects an unknown variable at evaluation time too', () => {
    const r = evaluateFormula('nonsense > 1', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown variable/);
  });

  it('never uses eval or Function', () => {
    // A user-supplied string must not be able to reach the global scope.
    // Strip comments before scanning: this file *documents* that it avoids
    // these APIs, and a naive scan matches that prose instead of real code.
    const src = readFileSync('src/lib/alertExtras.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(/\beval\s*\(/.test(src)).toBe(false);
    expect(/new\s+Function\s*\(/.test(src)).toBe(false);
  });

  it('exposes the variables the UI can offer', () => {
    expect(FORMULA_VARS.length).toBeGreaterThanOrEqual(14);
    expect(FORMULA_VARS.map((v) => v.name)).toContain('portfolioValue');
  });
});

describe('extra rule types', () => {
  it('registers five new types, each with a label', () => {
    expect(EXTRA_RULE_TYPES).toHaveLength(5);
    EXTRA_RULE_TYPES.forEach((t) => {
      expect(EXTRA_RULES[t].label.length).toBeGreaterThan(3);
      expect(EXTRA_RULES[t].hint.length).toBeGreaterThan(10);
    });
  });

  it('evaluates funding in both directions and admits missing data', () => {
    expect(evaluateExtraRule({ type: 'funding_above', value: 0.01 }, { funding: 0.05 }).triggered).toBe(true);
    expect(evaluateExtraRule({ type: 'funding_below', value: 0 }, { funding: -0.02 }).triggered).toBe(true);
    const missing = evaluateExtraRule({ type: 'funding_above', value: 0.01 }, {});
    expect(missing.triggered).toBe(false);
    expect(missing.detail).toMatch(/unavailable/);
  });

  it('needs a previous reading for open-interest change', () => {
    const r = evaluateExtraRule({ type: 'oi_change', value: 5 }, { openInterest: 110, prevOpenInterest: 100 });
    expect(r.triggered).toBe(true);
    expect(r.detail).toMatch(/\+10.00%/);
    expect(evaluateExtraRule({ type: 'oi_change', value: 5 }, { openInterest: 110 }).detail).toMatch(/history unavailable/);
  });

  it('evaluates a liquidation window', () => {
    expect(evaluateExtraRule({ type: 'liquidation_spike', value: 5 }, { liqVolume: 250 }).triggered).toBe(true);
    expect(evaluateExtraRule({ type: 'liquidation_spike', value: 5 }, {}).detail).toMatch(/No liquidation stream/);
  });

  it('runs a formula rule through the same evaluator', () => {
    const r = evaluateExtraRule({ type: 'formula', formula: 'rsi < 30 && pct24 < -5' }, { rsi: 20, pct24: -9 });
    expect(r.triggered).toBe(true);
    expect(r.detail).toMatch(/rsi < 30/);
  });

  it('returns a non-trigger for an unknown extra rule', () => {
    expect(evaluateExtraRule({ type: 'nope' }, {}).triggered).toBe(false);
  });
});

describe('integration with the rules engine', () => {
  it('exposes 16 rule types including the new ones', () => {
    expect(RULE_TYPES).toHaveLength(16);
    ['funding_above', 'funding_below', 'oi_change', 'liquidation_spike', 'formula'].forEach((t) => {
      expect(RULE_TYPES).toContain(t);
      expect(RULE_LABELS[t], t).toBeTruthy();
    });
  });

  it('describes the new rules in plain language', () => {
    expect(describeRule({ type: 'formula', formula: 'rsi < 30', symbol: 'BTC' })).toMatch(/rsi < 30/);
    expect(describeRule({ type: 'funding_above', symbol: 'BTC', value: 0.01 })).toMatch(/funding above/);
    expect(describeRule({ type: 'oi_change', symbol: 'BTC', value: 5 })).toMatch(/open interest/);
    expect(describeRule({ type: 'liquidation_spike', symbol: 'BTC', value: 5 })).toMatch(/liquidations/);
  });

  it('delegates the new types to the extras evaluator', () => {
    const r = evaluateRule({ type: 'funding_above', symbol: 'BTC', value: 0.01 }, { funding: 0.05 });
    expect(r.triggered).toBe(true);
  });

  it('validates a numeric threshold for the numeric extras', () => {
    expect(validateRule({ type: 'funding_above', symbol: 'BTC', value: 0.01 }).ok).toBe(true);
    const bad = validateRule({ type: 'funding_above', symbol: 'BTC', value: 'abc' });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain('value must be a number');
  });

  it('validates a formula before it can be saved', () => {
    expect(validateRule({ type: 'formula', symbol: 'BTC', formula: 'rsi < 30' }).ok).toBe(true);
    const unknown = validateRule({ type: 'formula', symbol: 'BTC', formula: 'nothinghere < 1' });
    expect(unknown.ok).toBe(false);
    expect(unknown.errors.join(' ')).toMatch(/Unknown variable/);
    const broken = validateRule({ type: 'formula', symbol: 'BTC', formula: 'rsi <' });
    expect(broken.ok).toBe(false);
  });
});

describe('notification channels', () => {
  it('covers all seven channels the checklist names', () => {
    const ids = CHANNELS.map((c) => c.id);
    ['push', 'email', 'sms', 'telegram', 'discord', 'whatsapp', 'webhook'].forEach((id) => {
      expect(ids, id).toContain(id);
    });
  });

  it('states a status and a reason for each channel', () => {
    CHANNELS.forEach((c) => {
      expect(['live', 'needs-setup', 'unavailable']).toContain(c.status);
      expect(c.note.length).toBeGreaterThan(30);
    });
  });

  it('only marks browser push as live', () => {
    const live = CHANNELS.filter((c) => c.status === 'live');
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe('push');
    // The reason push is limited must be stated.
    expect(live[0].note).toMatch(/tab must be open/i);
  });

  it('explains why each unavailable channel is out of reach', () => {
    CHANNELS.filter((c) => c.status === 'unavailable').forEach((c) => {
      expect(c.note).toMatch(/gateway|approval|registration|paid/i);
    });
  });

  it('summarises coverage', () => {
    const cov = channelCoverage();
    expect(cov.total).toBe(7);
    expect(cov.live + cov.needsSetup + cov.unavailable).toBe(7);
    expect(channelById('telegram').status).toBe('needs-setup');
    expect(channelById('nope')).toBeNull();
  });

  it('defines a webhook payload contract and admits it is unsigned here', () => {
    const p = buildWebhookPayload(
      { id: 'a1', label: 'BTC breakout', rule: { type: 'price_above', value: 100 }, cooldownMs: 60000 },
      { at: Date.UTC(2026, 9, 5), detail: 'price 101' },
      { price: 101, symbol: 'BTC' }
    );
    expect(p.type).toBe('alert.triggered');
    expect(p.version).toBe(1);
    expect(p.alert.id).toBe('a1');
    expect(p.event.price).toBe(101);
    // The browser cannot hold the signing secret, and the payload says so.
    expect(p.signature.signed).toBe(false);
    expect(p.note).toMatch(/never include credentials/i);
  });
});

describe('rules the spec asks for but this build cannot evaluate', () => {
  it('declares whale, wallet, transfer, contract and news with reasons', () => {
    const ids = UNAVAILABLE_RULES.map((r) => r.id);
    ['whale', 'wallet', 'token_transfer', 'smart_contract', 'news'].forEach((id) => {
      expect(ids, id).toContain(id);
    });
    UNAVAILABLE_RULES.forEach((r) => {
      expect(r.reason.length).toBeGreaterThan(30);
      expect(r.label.length).toBeGreaterThan(3);
    });
  });

  it('does not expose an unavailable rule as a real rule type', () => {
    // A rule that could be created but never fires would be worse than absent.
    UNAVAILABLE_RULES.forEach((r) => {
      expect(RULE_TYPES).not.toContain(r.id);
    });
  });
});
