/* Vectorised event-driven backtester.
 *
 * Modelling decisions (deliberately conservative, all surfaced in the UI):
 *  - Signals are computed from data available up to bar i (causal indicators).
 *  - Execution happens on the OPEN of bar i+1 — never on the signal bar (no look-ahead).
 *  - Slippage is applied against the trader on both entry and exit.
 *  - Fees are charged on notional (entry and exit).
 *  - Long-only, no leverage, no shorting, single asset, no liquidity limits.
 *  - Funding/borrow costs are NOT modelled (spot assumption).
 */

import { rsi, sma, ema, macd, bollinger, stochastic, roc, donchian, vwap, stochRsi, cci } from './indicators.js';

export const DEFAULT_ASSUMPTIONS = {
  initialCapital: 10000,
  feePct: 0.1,        // per side, %
  slippagePct: 0.05,  // per side, %
  positionPct: 100,   // % of cash deployed per entry
  longOnly: true
};

const BARS_PER_YEAR = { '5m': 105120, '15m': 35040, '1h': 8760, '4h': 2190, '1d': 365 };

const crossedAbove = (prevA, prevB, curA, curB) => prevA != null && prevB != null && curA != null && curB != null && prevA <= prevB && curA > curB;
const crossedBelow = (prevA, prevB, curA, curB) => prevA != null && prevB != null && curA != null && curB != null && prevA >= prevB && curA < curB;

/* Per-bar causal signal series: 'BUY' | 'SELL' | null (edge events only). */
export function signalSeries(presetId, k, params = {}) {
  const { high = [], low = [], close = [], volume = [] } = k || {};
  const n = close.length;
  const out = new Array(n).fill(null);
  if (n < 3) return out;

  const at = (arr, i) => (arr && i >= 0 && i < arr.length ? arr[i] : null);

  switch (presetId) {
    case 'rsi-reversal': {
      const r = rsi(close, params.period || 14);
      const lo = params.buyBelow ?? 30;
      const hi = params.sellAbove ?? 70;
      for (let i = 1; i < n; i++) {
        const p = r[i - 1], c = r[i];
        if (p == null || c == null) continue;
        if (p <= lo && c > lo) out[i] = 'BUY';
        else if (p >= hi && c < hi) out[i] = 'SELL';
      }
      break;
    }
    case 'golden-cross': {
      const f = sma(close, params.fast || 20);
      const s = sma(close, params.slow || 50);
      for (let i = 1; i < n; i++) {
        if (crossedAbove(f[i - 1], s[i - 1], f[i], s[i])) out[i] = 'BUY';
        else if (crossedBelow(f[i - 1], s[i - 1], f[i], s[i])) out[i] = 'SELL';
      }
      break;
    }
    case 'macd-momentum': {
      const m = macd(close, params.fast || 12, params.slow || 26, params.signal || 9);
      for (let i = 1; i < n; i++) {
        if (crossedAbove(m.line[i - 1], m.signal[i - 1], m.line[i], m.signal[i])) out[i] = 'BUY';
        else if (crossedBelow(m.line[i - 1], m.signal[i - 1], m.line[i], m.signal[i])) out[i] = 'SELL';
      }
      break;
    }
    case 'bollinger-squeeze': {
      const b = bollinger(close, params.period || 20, params.mult || 2);
      for (let i = 1; i < n; i++) {
        const pu = at(b.upper, i - 1), pl = at(b.lower, i - 1);
        const cu = at(b.upper, i), cl = at(b.lower, i);
        if (pu == null) continue;
        if (close[i - 1] <= pl && close[i] > cl) out[i] = 'BUY';
        else if (close[i - 1] >= pu && close[i] < cu) out[i] = 'SELL';
      }
      break;
    }
    case 'stochastic-osc': {
      const s = stochastic(high, low, close, params.k || 14, params.d || 3);
      const zone = params.low ?? 20;
      const highZone = params.high ?? 80;
      for (let i = 1; i < n; i++) {
        const pk = at(s.k, i - 1), pd = at(s.d, i - 1), ck = at(s.k, i), cd = at(s.d, i);
        if (pk == null || pd == null || ck == null || cd == null) continue;
        if (pk <= pd && ck > cd && ck < zone + 15) out[i] = 'BUY';
        else if (pk >= pd && ck < cd && ck > highZone - 15) out[i] = 'SELL';
      }
      break;
    }
    case 'momentum-blast': {
      const r = roc(close, params.period || 10);
      const thr = params.threshold ?? 3;
      for (let i = 1; i < n; i++) {
        const p = at(r, i - 1), c = at(r, i);
        if (p == null || c == null) continue;
        if (p <= thr && c > thr) out[i] = 'BUY';
        else if (p >= -thr && c < -thr) out[i] = 'SELL';
      }
      break;
    }
    case 'donchian-breakout': {
      const d = donchian(high, low, params.period || 20);
      for (let i = 1; i < n; i++) {
        // Breakout is measured against the channel formed by the PRIOR bars
        // (a channel that includes bar i can never be exceeded on that bar).
        const pu = at(d.up, i - 1), pl = at(d.dn, i - 1);
        if (pu == null || pl == null) continue;
        if (close[i - 1] <= pu && close[i] > pu) out[i] = 'BUY';
        else if (close[i - 1] >= pl && close[i] < pl) out[i] = 'SELL';
      }
      break;
    }
    case 'vwap-pullback': {
      const v = vwap(high, low, close, volume);
      for (let i = 1; i < n; i++) {
        const pv = at(v, i - 1), cv = at(v, i);
        if (pv == null || cv == null) continue;
        if (pv > cv && close[i] > cv) out[i] = 'BUY';
        else if (pv <= cv && close[i] < cv) out[i] = 'SELL';
      }
      break;
    }
    case 'stoch-rsi': {
      const sr = stochRsi(
        close,
        params.rsiPeriod || 14,
        params.stochPeriod || 14,
        params.smoothK || 3,
        params.smoothD || 3
      );
      const zone = params.low ?? 20;
      const highZone = params.high ?? 80;
      for (let i = 1; i < n; i++) {
        const pk = at(sr.k, i - 1), pd = at(sr.d, i - 1), ck = at(sr.k, i), cd = at(sr.d, i);
        if (pk == null || pd == null || ck == null || cd == null) continue;
        if (pk <= pd && ck > cd && ck < zone + 15) out[i] = 'BUY';
        else if (pk >= pd && ck < cd && ck > highZone - 15) out[i] = 'SELL';
      }
      break;
    }
    case 'cci-reversal': {
      const cciVals = cci(high, low, close, params.period || 20);
      const os = params.oversold ?? -100;
      const ob = params.overbought ?? 100;
      for (let i = 1; i < n; i++) {
        const pc = at(cciVals, i - 1), cc = at(cciVals, i);
        if (pc == null || cc == null) continue;
        if (pc <= os && cc > os) out[i] = 'BUY';
        else if (pc >= ob && cc < ob) out[i] = 'SELL';
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}
function downsideDev(arr) {
  const negatives = arr.filter((r) => r < 0);
  if (!negatives.length) return 0;
  return Math.sqrt(negatives.reduce((a, b) => a + b * b, 0) / negatives.length);
}
function maxDrawdown(equity) {
  let peak = equity[0] ?? 0;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  return maxDd;
}

export function computeMetrics(equity, trades, bars, interval, capital) {
  const returns = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    if (prev > 0) returns.push(equity[i] / prev - 1);
  }
  const totalReturn = capital > 0 ? equity[equity.length - 1] / capital - 1 : 0;
  const bpy = BARS_PER_YEAR[interval] || 8760;
  const years = Math.max(bars / bpy, 1 / bpy);
  const annReturn = (1 + totalReturn) ** (1 / years) - 1;
  const sd = stdev(returns);
  const dd = downsideDev(returns);
  const sharpe = sd > 0 ? (mean(returns) / sd) * Math.sqrt(bpy) : 0;
  const sortino = dd > 0 ? (mean(returns) / dd) * Math.sqrt(bpy) : 0;

  const closed = trades.filter((t) => t.pnl != null);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  return {
    totalReturn,
    annReturn,
    sharpe,
    sortino,
    maxDrawdown: maxDrawdown(equity),
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    trades: closed.length,
    exposure: bars > 0 ? trades.filter((t) => t.barsHeld != null).reduce((a, t) => a + t.barsHeld, 0) / bars : 0,
    avgWin,
    avgLoss,
    expectancy: closed.length ? (grossProfit - grossLoss) / closed.length : 0,
    finalEquity: equity[equity.length - 1] ?? capital
  };
}

export function runBacktest({
  candles = [],
  presetId,
  params = {},
  interval = '1h',
  initialCapital = DEFAULT_ASSUMPTIONS.initialCapital,
  feePct = DEFAULT_ASSUMPTIONS.feePct,
  slippagePct = DEFAULT_ASSUMPTIONS.slippagePct,
  positionPct = DEFAULT_ASSUMPTIONS.positionPct
} = {}) {
  const n = candles.length;
  const minBars = 60;
  if (!presetId || n < minBars) {
    return { ok: false, error: `Need at least ${minBars} candles to backtest (got ${n}).` };
  }

  const k = {
    high: candles.map((c) => c.h),
    low: candles.map((c) => c.l),
    close: candles.map((c) => c.c),
    volume: candles.map((c) => c.v)
  };
  const signals = signalSeries(presetId, k, params);

  const fee = Math.max(0, feePct) / 100;
  const slip = Math.max(0, slippagePct) / 100;
  const deployFrac = Math.min(Math.max(positionPct, 1), 100) / 100;

  let cash = initialCapital;
  let qty = 0;
  let entryCost = 0;
  let entryBar = null;
  let pending = null;
  const trades = [];
  const equity = [initialCapital];
  let feesPaid = 0;

  for (let i = 1; i < n; i++) {
    const bar = candles[i];
    const open = bar.o;

    // 1) execute the signal emitted on the previous bar, at this bar's open
    if (pending === 'BUY' && qty === 0) {
      const price = open * (1 + slip);
      const invest = cash * deployFrac;
      const feeAmt = invest * fee;
      const usable = invest - feeAmt;
      if (price > 0 && usable > 0) {
        qty = usable / price;
        cash -= invest;
        entryCost = invest;
        entryBar = i;
        feesPaid += feeAmt;
        trades.push({ t: bar.t, side: 'BUY', price, qty, usd: invest, fee: feeAmt, pnl: null, barsHeld: null });
      }
    } else if (pending === 'SELL' && qty > 0) {
      const price = open * (1 - slip);
      const gross = qty * price;
      const feeAmt = gross * fee;
      const proceeds = gross - feeAmt;
      const pnl = proceeds - entryCost;
      cash += proceeds;
      feesPaid += feeAmt;
      trades.push({
        t: bar.t, side: 'SELL', price, qty, usd: proceeds, fee: feeAmt,
        pnl, pnlPct: entryCost > 0 ? (pnl / entryCost) * 100 : 0,
        barsHeld: entryBar != null ? i - entryBar : null
      });
      qty = 0;
      entryCost = 0;
      entryBar = null;
    }
    pending = null;
    if (signals[i] === 'BUY' || signals[i] === 'SELL') pending = signals[i];

    // 2) mark to market on the close
    equity.push(cash + qty * bar.c);
  }

  const metrics = computeMetrics(equity, trades, n, interval, initialCapital);

  // Buy & hold benchmark over the same window
  const firstClose = candles[0].c;
  const benchmarkReturn = firstClose > 0 ? candles[n - 1].c / firstClose - 1 : 0;

  // Walk-forward: same parameters, evaluated on an in-sample and out-of-sample slice
  const split = Math.floor(n * 0.7);
  const isSlice = candles.slice(0, split);
  const oosSlice = candles.slice(split);
  const sliceRun = (cs) => {
    if (cs.length < minBars) return null;
    const sigs = signalSeries(presetId, { high: cs.map((x) => x.h), low: cs.map((x) => x.l), close: cs.map((x) => x.c), volume: cs.map((x) => x.v) }, params);
    let c = initialCapital, q = 0, cost = 0, pend = null;
    const tr = [], eq = [initialCapital];
    for (let i = 1; i < cs.length; i++) {
      const bar = cs[i];
      if (pend === 'BUY' && q === 0) {
        const price = bar.o * (1 + slip);
        const invest = c * deployFrac;
        const usable = invest - invest * fee;
        if (price > 0 && usable > 0) { q = usable / price; c -= invest; cost = invest; tr.push({ t: bar.t, side: 'BUY', pnl: null, barsHeld: null }); }
      } else if (pend === 'SELL' && q > 0) {
        const price = bar.o * (1 - slip);
        const proceeds = q * price * (1 - fee);
        tr.push({ t: bar.t, side: 'SELL', pnl: proceeds - cost, pnlPct: ((proceeds - cost) / cost) * 100, barsHeld: 1 });
        c += proceeds; q = 0; cost = 0;
      }
      pend = null;
      if (sigs[i]) pend = sigs[i];
      eq.push(c + q * bar.c);
    }
    return computeMetrics(eq, tr, cs.length, interval, initialCapital);
  };

  return {
    ok: true,
    metrics,
    benchmarkReturn,
    alphaVsHold: metrics.totalReturn - benchmarkReturn,
    equity,
    trades,
    feesPaid,
    assumptions: {
      initialCapital, feePct, slippagePct, positionPct,
      interval, bars: n, longOnly: true,
      note: 'Long-only spot model. Signals execute at the next bar open with slippage and fees; funding/borrow costs are not modelled.'
    },
    walkForward: {
      inSample: sliceRun(isSlice),
      outOfSample: sliceRun(oosSlice),
      splitPct: 70,
      note: 'Same parameters on both slices — no parameter fitting was performed, so this is an out-of-sample consistency check.'
    }
  };
}
