/* Alert engine extensions: custom-formula alerts, data-driven rule types the
 * app can actually evaluate, and an honest notification-channel registry.
 *
 * NEW RULE TYPES are only added where the app genuinely has the input:
 *   funding        — funding rate is fetched from the derivatives feed
 *   openInterest   — open interest is fetched from the derivatives feed
 *   liquidation    — a liquidation stream is subscribed (forceOrder)
 *   formula        — evaluated over the live context by the evaluator below
 *
 * RULE TYPES DELIBERATELY NOT ADDED, with the reason (see UNAVAILABLE_RULES):
 *   whale, wallet, token transfer, smart contract, news. Each needs an external
 *   indexer, a labelling database or a news feed that this build does not have.
 *   A rule that silently never fires would be worse than an absent one.
 */

/* ============================ formula evaluator ============================ */
/*
 * A real tokenizer + recursive-descent parser. `eval()` and `new Function()`
 * are never used: a user-supplied string must not be able to reach the global
 * scope, so nothing here can execute code.
 */

export const FORMULA_VARS = [
  { name: 'price', label: 'Price' },
  { name: 'pct24', label: '24h change %' },
  { name: 'volume', label: 'Volume' },
  { name: 'rsi', label: 'RSI(14)' },
  { name: 'macd', label: 'MACD' },
  { name: 'macdSignal', label: 'MACD signal' },
  { name: 'maFast', label: 'Fast MA' },
  { name: 'maSlow', label: 'Slow MA' },
  { name: 'high', label: 'Range high' },
  { name: 'low', label: 'Range low' },
  { name: 'portfolioValue', label: 'Portfolio value' },
  { name: 'funding', label: 'Funding rate %' },
  { name: 'openInterest', label: 'Open interest' },
  { name: 'liqVolume', label: 'Liquidation volume' }
];

const OPS = ['||', '&&', '>=', '<=', '==', '!=', '>', '<', '+', '-', '*', '/', '%', '^', '(', ')'];

export function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9._]/.test(s[j])) j += 1;
      const raw = s.slice(i, j).replace(/_/g, '');
      const v = Number(raw);
      if (!Number.isFinite(v)) return { ok: false, error: `Bad number "${raw}"` };
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      out.push({ t: 'ident', v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (OPS.includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (OPS.includes(c)) { out.push({ t: 'op', v: c }); i += 1; continue; }
    return { ok: false, error: `Unexpected character "${c}"` };
  }
  return { ok: true, tokens: out };
}

/** Recursive-descent parser producing a small AST. */
function parseExpr(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v) => {
    const tk = tokens[pos];
    if (tk && tk.t === 'op' && tk.v === v) { pos += 1; return true; }
    return false;
  };

  const primary = () => {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of formula');
    if (tk.t === 'num') { pos += 1; return { k: 'num', v: tk.v }; }
    if (tk.t === 'ident') { pos += 1; return { k: 'var', name: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') {
      pos += 1;
      const inner = orExpr();
      if (!eat(')')) throw new Error('Missing closing parenthesis');
      return inner;
    }
    throw new Error(`Unexpected token "${tk.v}"`);
  };

  /*
   * Exponentiation binds tighter than unary minus, and is right-associative:
   *   -2 ^ 2   -> -(2 ^ 2) -> -4     (maths / Python / JS ** convention)
   *   2 ^ 3 ^ 2 -> 2 ^ (3 ^ 2) -> 512
   * The earlier grammar parsed unary() *inside* the power operand, so it
   * produced (-2) ^ 2 = 4 and silently changed the value of a user's formula.
   */
  const powExpr = () => {
    const left = primary();
    if (eat('^')) return { k: 'bin', op: '^', a: left, b: unary() };
    return left;
  };

  const unary = () => {
    if (eat('-')) return { k: 'neg', a: unary() };
    if (eat('+')) return unary();
    return powExpr();
  };

  const mulExpr = () => {
    let left = unary();
    for (;;) {
      if (eat('*')) left = { k: 'bin', op: '*', a: left, b: unary() };
      else if (eat('/')) left = { k: 'bin', op: '/', a: left, b: unary() };
      else if (eat('%')) left = { k: 'bin', op: '%', a: left, b: unary() };
      else return left;
    }
  };
  const addExpr = () => {
    let left = mulExpr();
    for (;;) {
      if (eat('+')) left = { k: 'bin', op: '+', a: left, b: mulExpr() };
      else if (eat('-')) left = { k: 'bin', op: '-', a: left, b: mulExpr() };
      else return left;
    }
  };
  const cmpExpr = () => {
    const left = addExpr();
    for (;;) {
      if (eat('>=')) return { k: 'bin', op: '>=', a: left, b: addExpr() };
      if (eat('<=')) return { k: 'bin', op: '<=', a: left, b: addExpr() };
      if (eat('==')) return { k: 'bin', op: '==', a: left, b: addExpr() };
      if (eat('!=')) return { k: 'bin', op: '!=', a: left, b: addExpr() };
      if (eat('>')) return { k: 'bin', op: '>', a: left, b: addExpr() };
      if (eat('<')) return { k: 'bin', op: '<', a: left, b: addExpr() };
      return left;
    }
  };
  const andExpr = () => {
    let left = cmpExpr();
    while (eat('&&')) left = { k: 'bin', op: '&&', a: left, b: cmpExpr() };
    return left;
  };
  function orExpr() {
    let left = andExpr();
    while (eat('||')) left = { k: 'bin', op: '||', a: left, b: andExpr() };
    return left;
  }

  const ast = orExpr();
  if (pos < tokens.length) throw new Error(`Unexpected trailing "${tokens[pos].v}"`);
  return ast;
}

export function parseFormula(src) {
  const tk = tokenize(src);
  if (!tk.ok) return { ok: false, error: tk.error };
  if (!tk.tokens.length) return { ok: false, error: 'Formula is empty' };
  try {
    const ast = parseExpr(tk.tokens);
    // Collect referenced variables so an unknown name is caught before use.
    const vars = new Set();
    (function walk(n) {
      if (!n) return;
      if (n.k === 'var') vars.add(n.name);
      walk(n.a); walk(n.b);
    }(ast));
    const known = new Set(FORMULA_VARS.map((v) => v.name));
    const unknown = [...vars].filter((v) => !known.has(v));
    return { ok: true, ast, vars: [...vars], unknown };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const truthy = (v) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : Boolean(v));

export function evalAst(node, vars) {
  switch (node.k) {
    case 'num': return node.v;
    case 'var': {
      const v = vars[node.name];
      // A missing input is NOT zero: silently treating it as 0 would make
      // "rsi < 30" fire every time RSI is unavailable.
      if (v == null || v === '') throw new Error(`"${node.name}" is not available`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`"${node.name}" is not a number`);
      return n;
    }
    case 'neg': return -evalAst(node.a, vars);
    case 'bin': {
      const a = evalAst(node.a, vars);
      switch (node.op) {
        case '+': return a + evalAst(node.b, vars);
        case '-': return a - evalAst(node.b, vars);
        case '*': return a * evalAst(node.b, vars);
        case '/': {
          const b = evalAst(node.b, vars);
          if (b === 0) throw new Error('Division by zero');
          return a / b;
        }
        case '%': {
          const b = evalAst(node.b, vars);
          if (b === 0) throw new Error('Modulo by zero');
          return a % b;
        }
        case '^': return a ** evalAst(node.b, vars);
        case '>': return a > evalAst(node.b, vars);
        case '<': return a < evalAst(node.b, vars);
        case '>=': return a >= evalAst(node.b, vars);
        case '<=': return a <= evalAst(node.b, vars);
        case '==': return a === evalAst(node.b, vars);
        case '!=': return a !== evalAst(node.b, vars);
        case '&&': return truthy(a) && truthy(evalAst(node.b, vars));
        case '||': return truthy(a) || truthy(evalAst(node.b, vars));
        default: throw new Error(`Unsupported operator "${node.op}"`);
      }
    }
    default: throw new Error('Malformed formula');
  }
}

/**
 * Evaluate a formula against a context. Returns a verdict rather than a raw
 * number so the caller never has to guess why nothing fired.
 */
export function evaluateFormula(expr, vars = {}) {
  const p = parseFormula(expr);
  if (!p.ok) return { ok: false, error: p.error, triggered: false };
  if (p.unknown.length) return { ok: false, error: `Unknown variable(s): ${p.unknown.join(', ')}`, triggered: false, unknown: p.unknown };
  try {
    const value = evalAst(p.ast, vars);
    return { ok: true, value, triggered: truthy(value), vars: p.vars };
  } catch (e) {
    return { ok: false, error: e.message, triggered: false };
  }
}

/* ============================ extra rule types ============================ */

export const EXTRA_RULES = {
  funding_above: { label: 'Funding above', value: 'Rate %', hint: 'Longs pay shorts above zero.' },
  funding_below: { label: 'Funding below', value: 'Rate %', hint: 'Shorts pay longs below zero.' },
  oi_change: { label: 'Open interest change', value: 'Change %', hint: 'Absolute 24h change in open interest.' },
  liquidation_spike: { label: 'Liquidation spike', value: 'Window (minutes)', hint: 'Total liquidations inside the window.' },
  formula: { label: 'Custom formula', value: null, formula: true, hint: 'e.g. rsi < 30 && pct24 < -5' }
};

export const EXTRA_RULE_TYPES = Object.keys(EXTRA_RULES);

/** Evaluate one of the extra rule types against a context. */
export function evaluateExtraRule(rule, ctx = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (rule?.type) {
    case 'funding_above':
    case 'funding_below': {
      const f = num(ctx.funding);
      const v = Number(rule.value);
      if (f == null || !Number.isFinite(v)) return { triggered: false, detail: 'Funding rate unavailable' };
      const hit = rule.type === 'funding_above' ? f > v : f < v;
      return { triggered: hit, detail: `funding ${f.toFixed(4)}% ${rule.type === 'funding_above' ? '>' : '<'} ${v}%` };
    }
    case 'oi_change': {
      const oi = num(ctx.openInterest);
      const prev = num(ctx.prevOpenInterest);
      const v = Number(rule.value);
      if (oi == null || prev == null || !prev || !Number.isFinite(v)) return { triggered: false, detail: 'Open interest history unavailable' };
      const chg = ((oi - prev) / prev) * 100;
      return { triggered: Math.abs(chg) >= Math.abs(v), detail: `OI ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% vs threshold ${v}%` };
    }
    case 'liquidation_spike': {
      const vol = num(ctx.liqVolume);
      const mins = Number(rule.value) || 5;
      if (vol == null) return { triggered: false, detail: 'No liquidation stream data' };
      return { triggered: vol > 0, detail: `${vol.toFixed(0)} liquidated within ${mins}m` };
    }
    case 'formula': {
      const r = evaluateFormula(rule.formula || '', ctx);
      if (!r.ok) return { triggered: false, detail: r.error };
      return { triggered: r.triggered, detail: `${rule.formula} → ${typeof r.value === 'number' ? r.value.toFixed(4) : r.value}` };
    }
    default:
      return { triggered: false, detail: 'Unknown extra rule' };
  }
}

/* ============================ delivery channels ============================ */

/**
 * Notification channels. `status` reflects what this build can genuinely do:
 *   live        — wired and working
 *   needs-setup — implementable, but requires a credential or endpoint you supply
 *   unavailable — no route exists from a browser-only build
 */
export const CHANNELS = [
  { id: 'push', label: 'Browser push', status: 'live', note: 'Uses the Notification API; the tab must be open because there is no service-worker push subscription on this host.' },
  { id: 'webhook', label: 'Webhook', status: 'needs-setup', note: 'A signed JSON POST to a URL you provide. Requires a worker/proxy to hold the secret and avoid browser CORS limits.' },
  { id: 'email', label: 'Email', status: 'needs-setup', note: 'Needs a transactional email provider and a server-side key. Sending from the browser would expose the key.' },
  { id: 'telegram', label: 'Telegram', status: 'needs-setup', note: 'Needs a bot token, which cannot be shipped in a public bundle.' },
  { id: 'discord', label: 'Discord', status: 'needs-setup', note: 'Needs a webhook URL or bot token held server-side.' },
  { id: 'sms', label: 'SMS', status: 'unavailable', note: 'Requires a paid gateway, per-message billing and sender registration.' },
  { id: 'whatsapp', label: 'WhatsApp', status: 'unavailable', note: 'Business API access needs Meta approval and a verified sender.' }
];

export const channelById = (id) => CHANNELS.find((c) => c.id === id) || null;

/**
 * The payload contract a webhook consumer would receive. Defined here so the
 * shape is testable even though this build cannot transmit it.
 */
export function buildWebhookPayload(alert, event, ctx = {}) {
  return {
    version: 1,
    type: 'alert.triggered',
    sentAt: new Date(event?.at ?? Date.now()).toISOString(),
    alert: {
      id: alert?.id ?? null,
      label: alert?.label ?? null,
      rule: alert?.rule ?? null,
      cooldownMs: alert?.cooldownMs ?? null
    },
    event: { detail: event?.detail ?? null, price: ctx.price ?? null, symbol: ctx.symbol ?? null },
    // Consumers should verify this against a shared secret; the browser cannot.
    signature: { algorithm: 'HMAC-SHA256', header: 'X-CryptoX-Signature', signed: false },
    note: 'Signed server-side before dispatch. Never include credentials in the browser.'
  };
}

/** Rule types the checklist asks for that this build cannot evaluate, and why. */
export const UNAVAILABLE_RULES = [
  { id: 'whale', label: 'Whale', reason: 'Needs a labelled holder/entity database to know which wallets are "whales".' },
  { id: 'wallet', label: 'Wallet', reason: 'Needs an address-watching indexer; the app polls block heights, not address activity.' },
  { id: 'token_transfer', label: 'Token transfer', reason: 'Needs an indexer over Transfer logs; public RPC serves bounded block ranges only.' },
  { id: 'smart_contract', label: 'Smart contract', reason: 'Needs decoded event streams per contract, which requires an indexer.' },
  { id: 'news', label: 'News', reason: 'Needs a news feed with alerting; the app carries exchange status updates only.' }
];

export function channelCoverage() {
  const by = (s) => CHANNELS.filter((c) => c.status === s).length;
  return { total: CHANNELS.length, live: by('live'), needsSetup: by('needs-setup'), unavailable: by('unavailable'), channels: CHANNELS };
}
