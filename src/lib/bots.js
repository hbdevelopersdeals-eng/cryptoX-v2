/* Trading bots — PAPER EXECUTION ONLY.
 *
 * Every bot here emits *intents* (a side, a size, a reference price and a
 * reason). Nothing in this module can reach an exchange: there is no API key,
 * no signing and no order transport. The paper account in PaperTrading.jsx is
 * the only consumer.
 *
 * Design: each bot is a pure `step(ctx) -> { orders, notes, state }`. That makes
 * every bot deterministically testable without a network, a clock or a UI.
 *
 * Risk controls run AFTER the bot and can only reduce or block orders — a bot
 * can never widen its own limits.
 */

import { sma } from './indicators.js';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, dp = 8) => Number(Number(v).toFixed(dp));

/* ======================= position / indicator helpers ======================= */

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  const v = a.reduce((acc, x) => acc + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

/** z-score of the latest value versus the trailing window (excluding it). */
export function zScore(a, period) {
  if (a.length < period + 1) return null;
  const window = a.slice(-period - 1, -1);
  const sd = stdev(window);
  if (!sd) return null;
  return (a[a.length - 1] - mean(window)) / sd;
}

/** Donchian channel over PRIOR bars — the current bar must be excluded, or a
 *  breakout can never fire (the forming high/low always contains the price). */
export function donchian(candles, period) {
  if (!candles || candles.length < period + 1) return null;
  const prior = candles.slice(-period - 1, -1);
  return {
    high: Math.max(...prior.map((c) => c.h)),
    low: Math.min(...prior.map((c) => c.l))
  };
}

export function roc(a, period) {
  if (a.length < period + 1) return null;
  const past = a[a.length - 1 - period];
  if (!past) return null;
  return ((a[a.length - 1] - past) / past) * 100;
}

/** Simple ATR over true ranges. */
export function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  return mean(trs);
}

export const closesOf = (candles) => (candles || []).map((c) => c.c);

/* ======================= risk controls ======================= */

export const DEFAULT_RISK = {
  maxPositionPct: 25,     // max % of equity in one position
  maxOrderQuote: 1000,    // absolute cap per order
  maxDrawdownPct: 20,     // halt the bot if equity falls this far from peak
  dailyLossPct: 10,       // halt for the day beyond this loss
  maxTradesPerDay: 50
};

/**
 * Apply the user's risk limits to whatever the bot wanted to do.
 * Returns the surviving orders plus an explicit list of what was blocked and
 * why — a silently dropped order would look like the bot simply did nothing.
 */
export function applyRiskControls(orders = [], ctx = {}, limits = {}, state = {}) {
  const L = { ...DEFAULT_RISK, ...limits };
  const equity = num(ctx.equity);
  const price = num(ctx.price);
  const blocked = [];
  const kept = [];

  // Portfolio-level halts take precedence over any individual order.
  const peak = num(state.peakEquity);
  if (equity != null && peak != null && peak > 0) {
    const dd = ((peak - equity) / peak) * 100;
    if (dd >= L.maxDrawdownPct) {
      return { orders: [], blocked: [{ reason: `Drawdown ${dd.toFixed(2)}% ≥ limit ${L.maxDrawdownPct}% — bot halted`, code: 'max-drawdown' }], halted: true };
    }
  }
  const dayStart = num(state.dayStartEquity);
  if (equity != null && dayStart != null && dayStart > 0) {
    const loss = ((dayStart - equity) / dayStart) * 100;
    if (loss >= L.dailyLossPct) {
      return { orders: [], blocked: [{ reason: `Daily loss ${loss.toFixed(2)}% ≥ limit ${L.dailyLossPct}% — halted for the day`, code: 'daily-loss' }], halted: true };
    }
  }
  if (num(state.tradesToday) != null && state.tradesToday >= L.maxTradesPerDay) {
    return { orders: [], blocked: [{ reason: `Trade count ${state.tradesToday} ≥ limit ${L.maxTradesPerDay}`, code: 'trade-count' }], halted: true };
  }

  orders.forEach((o) => {
    const qty = num(o.qty);
    if (!qty || qty <= 0) {
      blocked.push({ reason: 'Order size is zero or invalid', code: 'bad-size', order: o });
      return;
    }
    const ref = num(o.price) ?? price;
    const quote = ref != null ? qty * ref : null;

    if (quote != null && quote > L.maxOrderQuote) {
      const scaled = (L.maxOrderQuote / ref);
      kept.push({ ...o, qty: round(scaled), scaledFrom: round(qty), scaleReason: `capped at maxOrderQuote ${L.maxOrderQuote}` });
      return;
    }

    if (o.side === 'buy' && equity != null && ref != null && ctx.positionValue != null) {
      const wouldBe = (ctx.positionValue + qty * ref) / equity * 100;
      if (wouldBe > L.maxPositionPct) {
        const room = Math.max(0, (equity * L.maxPositionPct) / 100 - ctx.positionValue);
        if (room <= 0) {
          blocked.push({ reason: `Position already at ${L.maxPositionPct}% cap`, code: 'max-position', order: o });
          return;
        }
        kept.push({ ...o, qty: round(room / ref), scaledFrom: round(qty), scaleReason: `capped at maxPositionPct ${L.maxPositionPct}%` });
        return;
      }
    }

    if (o.side === 'sell' && ctx.positionQty != null && qty > ctx.positionQty) {
      blocked.push({ reason: `Sell of ${qty} exceeds open position ${ctx.positionQty}`, code: 'oversell', order: o });
      return;
    }

    kept.push(o);
  });

  // Never let the combined buys exceed available cash.
  if (equity != null && ctx.cash != null && price != null) {
    let spend = 0;
    const out = [];
    for (const o of kept) {
      if (o.side !== 'buy') { out.push(o); continue; }
      const cost = o.qty * (num(o.price) ?? price);
      if (spend + cost > ctx.cash) {
        const room = ctx.cash - spend;
        if (room <= 0) {
          blocked.push({ reason: 'Insufficient cash', code: 'insufficient-cash', order: o });
          continue;
        }
        out.push({ ...o, qty: round(room / (num(o.price) ?? price)), scaledFrom: round(o.qty), scaleReason: 'trimmed to available cash' });
        spend = ctx.cash;
        continue;
      }
      spend += cost;
      out.push(o);
    }
    return { orders: out.filter((o) => o.qty > 0), blocked, halted: false };
  }

  return { orders: kept.filter((o) => o.qty > 0), blocked, halted: false };
}

/* ======================= bot definitions ======================= */

const P = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

export const BOT_TYPES = {
  dca: {
    id: 'dca', name: 'DCA', group: 'Accumulation', icon: 'calendar',
    blurb: 'Buys a fixed quote amount on a schedule, regardless of price. Averages the entry over time.',
    params: [
      P('amountQuote', 'Amount per buy (quote)', 100, { min: 1 }),
      P('everyBars', 'Buy every N bars', 10, { min: 1, step: 1 })
    ],
    step({ bot, price, barIndex }) {
      const every = Math.max(1, num(bot.params.everyBars) || 10);
      const last = num(bot.state.lastBuyBar);
      if (last != null && barIndex - last < every) return { orders: [], notes: [`Next buy in ${every - (barIndex - last)} bars`] };
      const amount = num(bot.params.amountQuote) || 100;
      if (!price) return { orders: [] };
      return {
        orders: [{ side: 'buy', qty: round(amount / price), price, reason: `Scheduled DCA #${(num(bot.state.buysDone) || 0) + 1}` }],
        state: { lastBuyBar: barIndex, buysDone: (num(bot.state.buysDone) || 0) + 1 },
        notes: [`DCA buy of ${amount} quote`]
      };
    }
  },

  grid: {
    id: 'grid', name: 'Grid', group: 'Range', icon: 'grid',
    blurb: 'Places buy levels below and sell levels above the current price. Profits from oscillation inside a range.',
    params: [
      P('lower', 'Lower bound', 0, { min: 0 }),
      P('upper', 'Upper bound', 0, { min: 0 }),
      P('levels', 'Number of levels', 10, { min: 2, step: 1 }),
      P('orderQuote', 'Quote per level', 100, { min: 1 })
    ],
    step({ bot, price }) {
      const lower = num(bot.params.lower);
      const upper = num(bot.params.upper);
      const levels = Math.max(2, Math.round(num(bot.params.levels) || 10));
      const per = num(bot.params.orderQuote) || 100;
      if (!price || lower == null || upper == null || upper <= lower) {
        return { orders: [], notes: ['Set an upper bound above the lower bound'] };
      }
      if (price < lower || price > upper) {
        return { orders: [], notes: [`Price ${price} is outside the grid (${lower}–${upper}) — no action`] };
      }
      // Geometric spacing suits percentage moves better than arithmetic.
      const ratio = (upper / lower) ** (1 / (levels - 1));
      const lines = Array.from({ length: levels }, (_, i) => lower * ratio ** i);
      const held = new Set(bot.state.heldLevels || []);
      const orders = [];
      const nextHeld = new Set(held);

      lines.forEach((line, idx) => {
        if (price <= line && !held.has(idx)) {
          orders.push({ side: 'buy', qty: round(per / line), price: line, reason: `Grid buy at level ${idx + 1}` });
          nextHeld.add(idx);
        } else if (price >= line && held.has(idx) && idx < levels - 1 && price >= lines[idx + 1]) {
          orders.push({ side: 'sell', qty: round(per / line), price: line, reason: `Grid sell at level ${idx + 1}` });
          nextHeld.delete(idx);
        }
      });

      return { orders, state: { heldLevels: [...nextHeld] }, notes: [`${nextHeld.size}/${levels} levels filled`] };
    }
  },

  twap: {
    id: 'twap', name: 'TWAP', group: 'Execution', icon: 'clock',
    blurb: 'Slices a large order into equal parts over time so the average fill tracks the time-weighted price.',
    params: [
      P('totalQty', 'Total quantity', 1, { min: 0 }),
      P('slices', 'Number of slices', 10, { min: 1, step: 1 }),
      P('everyBars', 'One slice every N bars', 1, { min: 1, step: 1 }),
      P('side', 'Side (buy/sell)', 'buy', { options: ['buy', 'sell'] })
    ],
    step({ bot, price, barIndex }) {
      const slices = Math.max(1, Math.round(num(bot.params.slices) || 10));
      const done = num(bot.state.slicesDone) || 0;
      if (done >= slices) return { orders: [], notes: ['TWAP complete'] };
      const every = Math.max(1, num(bot.params.everyBars) || 1);
      const last = num(bot.state.lastSliceBar);
      if (last != null && barIndex - last < every) return { orders: [] };
      const total = num(bot.params.totalQty) || 0;
      return {
        orders: [{ side: bot.params.side === 'sell' ? 'sell' : 'buy', qty: round(total / slices), price, reason: `TWAP slice ${done + 1}/${slices}` }],
        state: { slicesDone: done + 1, lastSliceBar: barIndex },
        notes: [`Slice ${done + 1} of ${slices}`]
      };
    }
  },

  vwap: {
    id: 'vwap', name: 'VWAP', group: 'Execution', icon: 'bar-chart',
    blurb: 'Slices an order weighted by the historical volume profile, so size follows liquidity.',
    params: [
      P('totalQty', 'Total quantity', 1, { min: 0 }),
      P('side', 'Side (buy/sell)', 'buy', { options: ['buy', 'sell'] })
    ],
    step({ bot, price, candles, barIndex }) {
      const total = num(bot.params.totalQty) || 0;
      const done = num(bot.state.slicesDone) || 0;
      if (done >= 5) return { orders: [], notes: ['VWAP complete'] };
      if (!candles || candles.length < 20) return { orders: [], notes: ['Need 20+ bars for a volume profile'] };

      // Bucket the recent history into 5 volume-weighted tranches.
      const recent = candles.slice(-20);
      const bucket = Math.min(4, Math.floor(done));
      const chunk = recent.slice(bucket * 4, bucket * 4 + 4);
      const vol = chunk.reduce((a, c) => a + c.v, 0);
      const totalVol = recent.reduce((a, c) => a + c.v, 0) || 1;
      const weight = vol / totalVol;

      return {
        orders: [{ side: bot.params.side === 'sell' ? 'sell' : 'buy', qty: round(total * weight), price, reason: `VWAP tranche ${bucket + 1}/5 (${(weight * 100).toFixed(1)}% of volume)` }],
        state: { slicesDone: done + 1 },
        notes: [`Volume-weighted slice ${(weight * 100).toFixed(1)}%`]
      };
    }
  },

  arbitrage: {
    id: 'arbitrage', name: 'Arbitrage', group: 'Market-neutral', icon: 'git-compare',
    blurb: 'Buys on the cheapest venue and sells on the dearest when the gap beats round-trip fees. Paper only — real fills depend on depth and latency.',
    params: [
      P('minNetPct', 'Minimum net gap %', 0.3, { min: 0, step: 0.05 }),
      P('tradeQuote', 'Quote per leg', 500, { min: 1 })
    ],
    step({ bot, venues }) {
      if (!venues || venues.length < 2) return { orders: [], notes: ['Need at least two venues'] };
      const minNet = num(bot.params.minNetPct) ?? 0.3;
      const quote = num(bot.params.tradeQuote) || 500;
      const sorted = [...venues].sort((a, b) => a.price - b.price);
      const buy = sorted[0];
      const sell = sorted[sorted.length - 1];
      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      // Same 0.1% per leg assumption used by the aggregator's fee model.
      const netPct = grossPct - 0.2;
      if (netPct < minNet) {
        return { orders: [], notes: [`Best gap ${grossPct.toFixed(3)}% gross → ${netPct.toFixed(3)}% net, below ${minNet}%`] };
      }
      return {
        orders: [
          { side: 'buy', qty: round(quote / buy.price), price: buy.price, venue: buy.venue, reason: `Buy on ${buy.venue} (cheapest)` },
          { side: 'sell', qty: round(quote / sell.price), price: sell.price, venue: sell.venue, reason: `Sell on ${sell.venue} (dearest)` }
        ],
        notes: [`Net gap ${netPct.toFixed(3)}% after fees`]
      };
    }
  },

  rebalance: {
    id: 'rebalance', name: 'Rebalancing', group: 'Portfolio', icon: 'scale',
    blurb: 'Restores target weights when they drift past a threshold. Sells what ran up, buys what lagged.',
    params: [
      P('driftPct', 'Drift threshold %', 5, { min: 0.1, step: 0.5 })
    ],
    step({ bot, holdings, price }) {
      const drift = num(bot.params.driftPct) ?? 5;
      if (!holdings || !holdings.length) return { orders: [], notes: ['No holdings to rebalance'] };
      const total = holdings.reduce((a, h) => a + h.value, 0);
      if (!total) return { orders: [] };
      const orders = [];
      holdings.forEach((h) => {
        const targetPct = (h.targetWeight ?? 0) * 100;
        const actualPct = (h.value / total) * 100;
        const diff = actualPct - targetPct;
        if (Math.abs(diff) < drift) return;
        const deltaValue = (diff / 100) * total;
        const qty = Math.abs(deltaValue) / (h.price || price);
        orders.push({
          side: deltaValue > 0 ? 'sell' : 'buy',
          qty: round(qty),
          price: h.price || price,
          reason: `${h.symbol} is ${actualPct.toFixed(1)}% vs ${targetPct.toFixed(1)}% target (drift ${diff.toFixed(1)}%)`
        });
      });
      return { orders, notes: orders.length ? [`${orders.length} leg(s) needed to restore weights`] : ['All positions within tolerance'] };
    }
  },

  market_making: {
    id: 'market_making', name: 'Market making', group: 'Liquidity', icon: 'repeat',
    blurb: 'Quotes a bid and an ask around the mid, skewed by inventory so the bot leans against its own position.',
    params: [
      P('spreadBps', 'Half-spread (bps)', 25, { min: 1, step: 1 }),
      P('orderQuote', 'Quote per side', 200, { min: 1 }),
      P('skewBps', 'Inventory skew (bps)', 50, { min: 0, step: 5 })
    ],
    step({ bot, price, positionValue = 0, equity = 1 }) {
      if (!price) return { orders: [] };
      const half = (num(bot.params.spreadBps) || 25) / 10000;
      const quote = num(bot.params.orderQuote) || 200;
      const skewBps = num(bot.params.skewBps) || 0;
      // Positive inventory → shade quotes down to encourage selling.
      const invRatio = equity ? positionValue / equity : 0;
      const skew = invRatio * (skewBps / 10000);
      const bid = price * (1 - half - skew);
      const ask = price * (1 + half - skew);
      return {
        orders: [
          { side: 'buy', qty: round(quote / bid), price: round(bid, 6), reason: `Quote bid at ${round(bid, 6)}` },
          { side: 'sell', qty: round(quote / ask), price: round(ask, 6), reason: `Quote ask at ${round(ask, 6)}` }
        ],
        notes: [`Mid ${price} · bid ${round(bid, 6)} / ask ${round(ask, 6)} · inventory skew ${(skew * 10000).toFixed(1)}bps`]
      };
    }
  },

  momentum: {
    id: 'momentum', name: 'Momentum', group: 'Directional', icon: 'trending-up',
    blurb: 'Goes long while the fast average leads the slow one and the rate of change is positive.',
    params: [
      P('fast', 'Fast MA', 12, { min: 2, step: 1 }),
      P('slow', 'Slow MA', 26, { min: 3, step: 1 }),
      P('rocPeriod', 'ROC period', 10, { min: 1, step: 1 })
    ],
    step({ bot, candles, price }) {
      const candlesOk = candles && candles.length > (num(bot.params.slow) || 26) + 2;
      if (!candlesOk) return { orders: [], notes: ['Not enough history'] };
      const closes = closesOf(candles);
      const fast = sma(closes, num(bot.params.fast) || 12);
      const slow = sma(closes, num(bot.params.slow) || 26);
      const f = fast[fast.length - 1];
      const s = slow[slow.length - 1];
      const r = roc(closes, num(bot.params.rocPeriod) || 10);
      const long = f != null && s != null && f > s && r != null && r > 0;
      const holding = (bot.state.inPosition) === true;
      if (long && !holding) {
        return { orders: [{ side: 'buy', qty: round((bot.params.orderQuote || 100) / price), price, reason: `Fast ${f.toFixed(2)} > slow ${s.toFixed(2)}, ROC ${r.toFixed(2)}%` }], state: { inPosition: true }, notes: ['Momentum long entry'] };
      }
      if (!long && holding) {
        return { orders: [{ side: 'sell', qty: bot.state.positionQty || 0, price, reason: `Fast ${f?.toFixed(2)} vs slow ${s?.toFixed(2)}, ROC ${r?.toFixed(2)}%` }], state: { inPosition: false }, notes: ['Momentum exit'] };
      }
      return { orders: [], notes: [long ? 'Long, holding' : 'No momentum signal'] };
    }
  },

  mean_reversion: {
    id: 'mean_reversion', name: 'Mean reversion', group: 'Directional', icon: 'activity',
    blurb: 'Buys when price is stretched below its average and sells when it reverts.',
    params: [
      P('period', 'Lookback', 20, { min: 3, step: 1 }),
      P('zEntry', 'Entry z-score', 2, { min: 0.5, step: 0.1 }),
      P('zExit', 'Exit z-score', 0, {})
    ],
    step({ bot, candles, price }) {
      const closes = closesOf(candles);
      const period = num(bot.params.period) || 20;
      const z = zScore(closes, period);
      if (z == null) return { orders: [], notes: ['Not enough history'] };
      const zEntry = num(bot.params.zEntry) ?? 2;
      const zExit = num(bot.params.zExit) ?? 0;
      const holding = bot.state.inPosition === true;
      if (!holding && z <= -zEntry) {
        return { orders: [{ side: 'buy', qty: round((bot.params.orderQuote || 100) / price), price, reason: `z ${z.toFixed(2)} ≤ -${zEntry}` }], state: { inPosition: true }, notes: [`Oversold at z=${z.toFixed(2)}`] };
      }
      if (holding && z >= zExit) {
        return { orders: [{ side: 'sell', qty: bot.state.positionQty || 0, price, reason: `z ${z.toFixed(2)} reverted` }], state: { inPosition: false }, notes: [`Reverted at z=${z.toFixed(2)}`] };
      }
      return { orders: [], notes: [`z=${z.toFixed(2)} — waiting`] };
    }
  },

  breakout: {
    id: 'breakout', name: 'Breakout', group: 'Directional', icon: 'move-up-right',
    blurb: 'Enters when price clears the prior N-bar range and exits on the opposite break.',
    params: [
      P('period', 'Range period', 20, { min: 3, step: 1 })
    ],
    step({ bot, candles, price }) {
      const period = num(bot.params.period) || 20;
      const ch = donchian(candles, period);
      if (!ch) return { orders: [], notes: ['Not enough history'] };
      const holding = bot.state.inPosition === true;
      if (!holding && price > ch.high) {
        return { orders: [{ side: 'buy', qty: round((bot.params.orderQuote || 100) / price), price, reason: `Broke ${period}-bar high ${ch.high}` }], state: { inPosition: true }, notes: [`Breakout above ${ch.high}`] };
      }
      if (holding && price < ch.low) {
        return { orders: [{ side: 'sell', qty: bot.state.positionQty || 0, price, reason: `Broke ${period}-bar low ${ch.low}` }], state: { inPosition: false }, notes: [`Breakdown below ${ch.low}`] };
      }
      return { orders: [], notes: [`Range ${ch.low}–${ch.high}`] };
    }
  },

  copy: {
    id: 'copy', name: 'Copy strategy', group: 'Social', icon: 'users',
    blurb: 'Mirrors a source trader’s reported trades, scaled to your equity and capped per trade.',
    params: [
      P('allocationPct', 'Allocation %', 10, { min: 0.1, step: 0.5 }),
      P('maxPerTradePct', 'Max per trade %', 2, { min: 0.1, step: 0.1 })
    ],
    step({ bot, sourceTrades = [], equity = 0, price }) {
      if (!sourceTrades.length) return { orders: [], notes: ['Waiting for source activity'] };
      const alloc = (num(bot.params.allocationPct) || 10) / 100;
      const cap = (num(bot.params.maxPerTradePct) || 2) / 100;
      const budget = equity * alloc;
      const orders = sourceTrades.map((t) => {
        const value = Math.min(budget * (t.weight ?? 1), equity * cap);
        return {
          side: t.side,
          qty: round(value / (t.price || price)),
          price: t.price || price,
          reason: `Mirroring ${t.source || 'source'}: ${t.side} (scaled to ${((value / equity) * 100).toFixed(2)}% of equity)`
        };
      });
      return { orders, notes: [`${orders.length} mirrored order(s), budget ${budget.toFixed(2)}`] };
    }
  },

  custom: {
    id: 'custom', name: 'Custom strategy', group: 'Builder', icon: 'wrench',
    blurb: 'Compose your own entry and exit rules from indicators. Conditions are ANDed.',
    params: [],
    step({ bot, candles, price }) {
      const closes = closesOf(candles);
      if (!closes.length) return { orders: [], notes: ['No data'] };
      const entry = evaluateConditions(bot.entry || [], { closes, candles, price });
      const exit = evaluateConditions(bot.exit || [], { closes, candles, price });
      const holding = bot.state.inPosition === true;
      if (!holding && entry.allTrue && (bot.entry || []).length) {
        return { orders: [{ side: 'buy', qty: round((bot.orderQuote || 100) / price), price, reason: `Entry: ${entry.summary}` }], state: { inPosition: true }, notes: [entry.summary] };
      }
      if (holding && exit.allTrue && (bot.exit || []).length) {
        return { orders: [{ side: 'sell', qty: bot.state.positionQty || 0, price, reason: `Exit: ${exit.summary}` }], state: { inPosition: false }, notes: [exit.summary] };
      }
      return { orders: [], notes: ['Conditions not met'] };
    }
  }
};

/* ======================= custom-strategy condition builder ======================= */

export const CONDITION_FIELDS = [
  { id: 'rsi', label: 'RSI(14)' },
  { id: 'price', label: 'Price' },
  { id: 'sma_fast', label: 'SMA(fast)' },
  { id: 'sma_slow', label: 'SMA(slow)' },
  { id: 'zscore', label: 'Z-score' },
  { id: 'roc', label: 'ROC %' },
  { id: 'volume', label: 'Volume' }
];

export const CONDITION_OPS = [
  { id: 'gt', label: '>' }, { id: 'lt', label: '<' },
  { id: 'cross_up', label: 'crosses above' }, { id: 'cross_down', label: 'crosses below' },
  { id: 'gte', label: '≥' }, { id: 'lte', label: '≤' }
];

function indicatorValue(field, { closes, candles, price }) {
  switch (field) {
    case 'price': return price;
    case 'rsi': {
      // Local RSI so the bot engine has no import cycle with indicators2.
      const period = 14;
      if (closes.length < period + 1) return null;
      let g = 0; let l = 0;
      for (let i = closes.length - period; i < closes.length; i += 1) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) g += d; else l -= d;
      }
      if (g + l === 0) return 50;
      return (g / (g + l)) * 100;
    }
    case 'sma_fast': { const s = sma(closes, 9); return s[s.length - 1]; }
    case 'sma_slow': { const s = sma(closes, 21); return s[s.length - 1]; }
    case 'zscore': return zScore(closes, 20);
    case 'roc': return roc(closes, 10);
    case 'volume': return candles?.length ? candles[candles.length - 1].v : null;
    default: return null;
  }
}

/** Evaluate a list of conditions; all must hold (AND). */
export function evaluateConditions(conditions = [], ctx = {}) {
  const results = conditions.map((c) => {
    const left = indicatorValue(c.field, ctx);
    const right = num(c.value);
    if (left == null || right == null) return { ...c, ok: false, detail: `${c.field} unavailable` };
    let ok = false;
    switch (c.op) {
      case 'gt': ok = left > right; break;
      case 'lt': ok = left < right; break;
      case 'gte': ok = left >= right; break;
      case 'lte': ok = left <= right; break;
      default: ok = false;
    }
    return { ...c, ok, detail: `${c.field} = ${Number(left).toFixed(4)} ${c.op} ${right}` };
  });
  return {
    allTrue: results.length > 0 && results.every((r) => r.ok),
    results,
    summary: results.map((r) => r.detail).join(' AND ')
  };
}

/* ======================= strategy marketplace ======================= */

/**
 * Published presets others can install. `stats` are illustrative and are NOT a
 * performance claim — real numbers come from your own backtest on live data.
 */
export const MARKETPLACE = [
  { id: 'mk-rsi-rev', name: 'RSI Reversion 14/30/70', author: 'CryptoX Labs', botType: 'custom', risk: 'medium', timeframe: '1h', subscribers: 1284, blurb: 'Buys RSI below 30, exits above 70 — the classic preset.',
    entry: [{ field: 'rsi', op: 'lt', value: 30 }], exit: [{ field: 'rsi', op: 'gt', value: 70 }] },
  { id: 'mk-grid-eth', name: 'ETH Range Grid', author: 'CryptoX Labs', botType: 'grid', risk: 'medium', timeframe: '15m', subscribers: 942, blurb: 'Geometric grid tuned for ranging majors.', params: { levels: 12, orderQuote: 150 } },
  { id: 'mk-dca-btc', name: 'BTC Weekly DCA', author: 'CryptoX Labs', botType: 'dca', risk: 'low', timeframe: '1w', subscribers: 3110, blurb: 'Fixed weekly accumulation, no market timing.', params: { amountQuote: 250, everyBars: 7 } },
  { id: 'mk-trend-btc', name: 'BTC Trend Rider', author: 'CryptoX Labs', botType: 'momentum', risk: 'high', timeframe: '4h', subscribers: 623, blurb: 'MA crossover with a positive rate-of-change filter.', params: { fast: 20, slow: 50, rocPeriod: 14 } },
  { id: 'mk-mrev-eth', name: 'ETH Z-Score Fade', author: 'CryptoX Labs', botType: 'mean_reversion', risk: 'medium', timeframe: '1h', subscribers: 517, blurb: 'Fades 2σ deviations from the 20-bar mean.', params: { period: 20, zEntry: 2, zExit: 0 } },
  { id: 'mk-break-sol', name: 'SOL Donchian Breakout', author: 'CryptoX Labs', botType: 'breakout', risk: 'high', timeframe: '4h', subscribers: 388, blurb: 'Enters on a 20-bar range break, exits on the mirror.', params: { period: 20 } },
  { id: 'mk-mm-major', name: 'Major-pair Market Maker', author: 'CryptoX Labs', botType: 'market_making', risk: 'medium', timeframe: '1m', subscribers: 205, blurb: 'Inventory-skewed two-sided quoting with a 25bp half-spread.', params: { spreadBps: 25, orderQuote: 200, skewBps: 50 } },
  { id: 'mk-arb-cex', name: 'CEX Spread Capture', author: 'CryptoX Labs', botType: 'arbitrage', risk: 'medium', timeframe: 'tick', subscribers: 164, blurb: 'Trades cross-venue gaps above fees. Paper only.', params: { minNetPct: 0.3, tradeQuote: 500 } },
  { id: 'mk-rebal-6040', name: '60/40 Rebalancer', author: 'CryptoX Labs', botType: 'rebalance', risk: 'low', timeframe: '1d', subscribers: 741, blurb: 'Restores target weights on a 5% drift.', params: { driftPct: 5 } },
  { id: 'mk-vwap-exec', name: 'VWAP Executor', author: 'CryptoX Labs', botType: 'vwap', risk: 'low', timeframe: '1h', subscribers: 231, blurb: 'Volume-weighted execution for large orders.' }
];

export const RISK_BADGE = {
  low: 'bg-up/15 text-up',
  medium: 'bg-primary/15 text-primary',
  high: 'bg-down/15 text-down'
};

/* ======================= orchestration ======================= */

/**
 * Run one tick of a bot: produce intents, then let risk controls trim them.
 * Pure — no I/O, no timers.
 */
export function runBotTick(bot, ctx = {}) {
  const def = BOT_TYPES[bot.type];
  if (!def) return { orders: [], blocked: [], notes: ['Unknown bot type'] };

  const price = num(ctx.price);
  const state = { ...(bot.state || {}) };
  if (price != null) state.lastPrice = price;
  if (state.positionQty == null) state.positionQty = num(ctx.positionQty) || 0;

  const out = def.step({
    bot: { ...bot, state },
    price,
    barIndex: num(ctx.barIndex) ?? 0,
    candles: ctx.candles,
    venues: ctx.venues,
    holdings: ctx.holdings,
    equity: ctx.equity,
    cash: ctx.cash,
    positionValue: ctx.positionValue,
    positionQty: ctx.positionQty,
    sourceTrades: ctx.sourceTrades
  }) || {};

  const afterRisk = applyRiskControls(out.orders || [], ctx, bot.limits || {}, state);

  // Track the paper position so exit bots know what they hold.
  const nextState = { ...state, ...(out.state || {}) };
  afterRisk.orders.forEach((o) => {
    if (o.side === 'buy') nextState.positionQty = round((num(nextState.positionQty) || 0) + o.qty);
    if (o.side === 'sell') nextState.positionQty = Math.max(0, round((num(nextState.positionQty) || 0) - o.qty));
  });

  return {
    orders: afterRisk.orders,
    blocked: afterRisk.blocked,
    halted: afterRisk.halted === true,
    notes: [...(out.notes || []), ...afterRisk.blocked.map((b) => `Blocked: ${b.reason}`)],
    state: nextState
  };
}

/** Aggregate equity guard state used by the risk engine between ticks. */
export function trackEquity(state = {}, equity) {
  const e = num(equity);
  if (e == null) return state;
  const peak = Math.max(num(state.peakEquity) ?? e, e);
  return { ...state, peakEquity: peak, lastEquity: e };
}
