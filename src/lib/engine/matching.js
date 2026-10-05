/* Deterministic paper matching engine.
 *
 * Implements the exchange-engine mechanics that are legitimately buildable in a
 * browser against live prices: price-time priority, the full order-type set,
 * self-trade prevention, market protection, tick/lot enforcement, risk checks,
 * circuit breakers, halts and a kill switch.
 *
 * It does NOT move real money or place real orders — settlement is simulated
 * against the user's paper balances. A production exchange additionally needs
 * custody, a regulated entity and audited infrastructure.
 *
 * Pure module: no DOM, no network — fully unit tested.
 */

export const ORDER_TYPES = ['market', 'limit', 'stop', 'stop-limit', 'take-profit', 'oco', 'trailing-stop'];
export const SIDES = ['buy', 'sell'];

export const DEFAULT_RULES = {
  tickSize: 0.01,
  stepSize: 0.000001,
  minQty: 0.000001,
  minNotional: 1,
  maxSlippagePct: 0.5,
  priceBandPct: 5
};

export const roundToTick = (price, tick = DEFAULT_RULES.tickSize) =>
  tick > 0 ? Math.round(price / tick) * tick : price;

export const roundToStep = (qty, step = DEFAULT_RULES.stepSize) =>
  step > 0 ? Math.floor(qty / step) * step : qty;

/** Tick/lot enforcement + structural validation. */
export function validateOrder(order = {}, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  const errors = [];
  const type = order.type;
  const side = order.side;
  const qty = Number(order.qty);
  const price = order.price == null ? null : Number(order.price);

  if (!SIDES.includes(side)) errors.push('side must be buy or sell');
  if (!ORDER_TYPES.includes(type)) errors.push('unsupported order type');
  if (!Number.isFinite(qty) || qty <= 0) errors.push('quantity must be greater than zero');

  const normalizedQty = Number.isFinite(qty) ? roundToStep(qty, r.stepSize) : null;
  if (normalizedQty != null && normalizedQty < r.minQty) errors.push(`quantity below minimum (${r.minQty})`);
  if (normalizedQty != null && Math.abs(normalizedQty - qty) > 1e-12) errors.push('quantity does not respect step size');

  const needsPrice = ['limit', 'stop-limit'].includes(type);
  if (needsPrice && (!Number.isFinite(price) || price <= 0)) errors.push('limit price required');
  if (price != null && Number.isFinite(price)) {
    const rounded = roundToTick(price, r.tickSize);
    if (Math.abs(rounded - price) > 1e-12) errors.push('price does not respect tick size');
  }
  if (['stop', 'stop-limit', 'take-profit', 'trailing-stop'].includes(type) && type !== 'trailing-stop') {
    if (!Number.isFinite(Number(order.stopPrice)) || Number(order.stopPrice) <= 0) errors.push('stop price required');
  }
  if (type === 'trailing-stop') {
    const pct = Number(order.trailingPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) errors.push('trailing percentage must be between 0 and 50');
  }
  if (type === 'oco') {
    if (!Number.isFinite(Number(order.takeProfit)) || !Number.isFinite(Number(order.stopLoss))) {
      errors.push('OCO requires both take-profit and stop-loss prices');
    }
  }
  if (normalizedQty != null && Number.isFinite(price) && price > 0 && normalizedQty * price < r.minNotional) {
    errors.push(`order value below minimum notional (${r.minNotional})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...order,
      qty: normalizedQty,
      price: price != null && Number.isFinite(price) ? roundToTick(price, r.tickSize) : null
    }
  };
}

/** Pre-trade risk checks against paper balances and configured limits. */
export function checkRisk({ order, balances = {}, limits = {}, referencePrice, spreadPct = 0 }) {
  const errors = [];
  const warnings = [];
  const qty = Number(order?.qty) || 0;
  const price = Number(order?.price) || Number(referencePrice) || 0;
  const notional = qty * price;

  const maxOrderNotional = limits.maxOrderNotional ?? 100000;
  if (notional > maxOrderNotional) errors.push(`order notional exceeds limit (${maxOrderNotional})`);

  const maxSlippagePct = limits.maxSlippagePct ?? DEFAULT_RULES.maxSlippagePct;
  if (order?.type === 'market' && spreadPct > maxSlippagePct) {
    errors.push(`market protection: spread ${spreadPct.toFixed(2)}% exceeds ${maxSlippagePct}%`);
  }

  if (order?.side === 'buy') {
    const quote = balances.quote ?? 0;
    if (notional > quote) errors.push(`insufficient quote balance (need ${notional.toFixed(2)}, have ${quote.toFixed(2)})`);
    else if (notional > quote * 0.9) warnings.push('this order uses more than 90% of your quote balance');
  } else if (order?.side === 'sell') {
    const base = balances.base ?? 0;
    if (qty > base) errors.push(`insufficient base balance (need ${qty}, have ${base})`);
  }

  const priceBandPct = limits.priceBandPct ?? DEFAULT_RULES.priceBandPct;
  if (referencePrice && Number(order?.price)) {
    const dev = Math.abs((Number(order.price) - referencePrice) / referencePrice) * 100;
    if (dev > priceBandPct) errors.push(`price is ${dev.toFixed(2)}% away from the market (band ${priceBandPct}%)`);
  }

  return { ok: errors.length === 0, errors, warnings, notional };
}

/** Circuit breaker: halt trading when the market moves too far, too fast. */
export function evaluateCircuitBreaker(prices = [], { now = Date.now(), windowMs = 60000, movePct = 5 } = {}) {
  const recent = prices.filter((p) => p && typeof p.price === 'number' && now - p.at <= windowMs);
  if (recent.length < 2) return { halted: false, movePct: 0, reason: null };
  const first = recent[0].price;
  const last = recent[recent.length - 1].price;
  if (!first) return { halted: false, movePct: 0, reason: null };
  const move = ((last - first) / first) * 100;
  if (Math.abs(move) >= movePct) {
    return {
      halted: true,
      movePct: move,
      reason: `${move > 0 ? 'Upward' : 'Downward'} move of ${Math.abs(move).toFixed(2)}% in under ${Math.round(windowMs / 1000)}s`
    };
  }
  return { halted: false, movePct: move, reason: null };
}

let SEQ = 0;
const nextId = (prefix = 'o') => `${prefix}-${Date.now().toString(36)}-${(SEQ += 1)}`;

/** Price-time priority order book with conditional orders and halts. */
export class OrderBook {
  constructor({ rules = {}, selfTradePrevention = true, ownerId = 'me' } = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.selfTradePrevention = selfTradePrevention;
    this.ownerId = ownerId;
    this.bids = [];       // resting buy orders
    this.asks = [];       // resting sell orders
    this.conditionals = []; // stop / TP / trailing / OCO parents
    this.fills = [];
    this.rejections = [];
    this.halted = null;
    this.lastPrice = null;
    this.priceHistory = [];
    this.seq = 1;
  }

  /* ---------- market state ---------- */

  markPrice(price, at = Date.now()) {
    if (!Number.isFinite(price) || price <= 0) return { activated: [] };
    this.lastPrice = price;
    this.priceHistory.push({ price, at });
    if (this.priceHistory.length > 500) this.priceHistory.splice(0, this.priceHistory.length - 500);

    const triggered = [];
    const remaining = [];
    this.conditionals.forEach((parent) => {
      const hit = this.#isTriggered(parent, price);
      if (hit) {
        parent.triggeredAt = at;
        triggered.push(parent);
      } else {
        remaining.push(parent);
      }
    });
    this.conditionals = remaining;

    const activated = triggered.map((parent) => this.#activate(parent, price));

    const breaker = evaluateCircuitBreaker(this.priceHistory, { now: at });
    if (breaker.halted && !this.halted) {
      this.halted = { reason: breaker.reason, at, automatic: true };
    }
    return { activated, breaker };
  }

  #isTriggered(parent, price) {
    const { type, side, stopPrice, takeProfit, stopLoss } = parent;
    if (type === 'stop' || type === 'stop-limit') {
      return side === 'buy' ? price >= stopPrice : price <= stopPrice;
    }
    if (type === 'take-profit') {
      return side === 'buy' ? price <= stopPrice : price >= stopPrice;
    }
    if (type === 'trailing-stop') {
      const peak = parent.peak ?? parent.trailingReference ?? price;
      if (side === 'sell') {
        parent.peak = Math.max(peak, price);
        const stop = parent.peak * (1 - parent.trailingPct / 100);
        return price <= stop;
      }
      parent.trough = Math.min(parent.trough ?? price, price);
      const stop = (parent.trough) * (1 + parent.trailingPct / 100);
      return price >= stop;
    }
    if (type === 'oco') {
      if (side === 'sell') return price >= takeProfit || price <= stopLoss;
      return price <= takeProfit || price >= stopLoss;
    }
    return false;
  }

  #activate(parent, price) {
    if (parent.type === 'oco') {
      const isTp = parent.side === 'sell' ? price >= parent.takeProfit : price <= parent.takeProfit;
      const chosen = isTp ? parent.takeProfit : parent.stopLoss;
      const child = {
        id: nextId('oco'),
        parentId: parent.id,
        ownerId: parent.ownerId,
        side: parent.side,
        type: 'limit',
        price: chosen,
        qty: parent.qty,
        status: 'new',
        createdAt: Date.now(),
        reason: isTp ? 'OCO take-profit leg' : 'OCO stop-loss leg'
      };
      const res = this.submit(child, price);
      return { parent, child, res };
    }
    const child = {
      id: nextId('trg'),
      parentId: parent.id,
      ownerId: parent.ownerId,
      side: parent.side,
      type: parent.type === 'stop-limit' ? 'limit' : 'market',
      price: parent.limitPrice ?? null,
      qty: parent.qty,
      status: 'new',
      createdAt: Date.now(),
      reason: `${parent.type} triggered`
    };
    const res = this.submit(child, price);
    return { parent, child, res };
  }

  /* ---------- halts / kill switch ---------- */

  setHalt(reason, at = Date.now()) {
    this.halted = { reason, at, automatic: false };
    return this.halted;
  }

  resume() {
    this.halted = null;
  }

  killSwitch(reason = 'Kill switch engaged by operator') {
    const cancelled = this.cancelAll();
    this.setHalt(reason);
    return { cancelled, halted: this.halted };
  }

  /* ---------- order entry ---------- */

  /** Would this order take liquidity from the opposite side? */
  #crosses(incoming) {
    const book = incoming.side === 'buy' ? this.asks : this.bids;
    if (!book.length) return false;
    if (incoming.type === 'market') return true;
    return incoming.side === 'buy' ? incoming.price >= book[0].price : incoming.price <= book[0].price;
  }

  /** Liquidity available to this order, respecting price limits and self-trade. */
  #available(incoming) {
    const book = incoming.side === 'buy' ? this.asks : this.bids;
    let total = 0;
    for (const o of book) {
      if (incoming.type === 'limit') {
        const crosses = incoming.side === 'buy' ? incoming.price >= o.price : incoming.price <= o.price;
        if (!crosses) break;
      }
      if (this.selfTradePrevention && o.ownerId === incoming.ownerId) continue;
      total += o.qty - (o.filled || 0);
      if (total >= incoming.qty) return incoming.qty;
    }
    return total;
  }

  submit(order, referencePrice = this.lastPrice) {
    const timeInForce = (order.timeInForce || 'GTC').toUpperCase();
    if (this.halted) {
      const rejection = { ...order, id: order.id || nextId(), status: 'rejected', error: `trading halted: ${this.halted.reason}` };
      this.rejections.push(rejection);
      return { order: rejection, fills: [], rejected: rejection.error };
    }

    const validation = validateOrder(order, this.rules);
    if (!validation.ok) {
      const rejection = { ...order, id: order.id || nextId(), status: 'rejected', error: validation.errors.join('; ') };
      this.rejections.push(rejection);
      return { order: rejection, fills: [], rejected: rejection.error };
    }

    const ord = {
      ...validation.normalized,
      id: order.id || nextId(),
      ownerId: order.ownerId || this.ownerId,
      status: 'new',
      createdAt: Date.now(),
      filled: 0,
      timeInForce,
      postOnly: Boolean(order.postOnly),
      seq: this.seq++
    };

    // Post-only: never allowed to take liquidity.
    if (ord.postOnly && !['stop', 'stop-limit', 'take-profit', 'trailing-stop', 'oco'].includes(ord.type) && this.#crosses(ord)) {
      ord.status = 'rejected';
      ord.error = 'post-only order would take liquidity';
      this.rejections.push(ord);
      return { order: ord, fills: [], rejected: ord.error };
    }

    // Fill-or-kill: reject outright unless the whole size is immediately available.
    if (timeInForce === 'FOK' && !['stop', 'stop-limit', 'take-profit', 'trailing-stop', 'oco'].includes(ord.type)) {
      const available = this.#available(ord);
      if (available + 1e-12 < ord.qty) {
        ord.status = 'rejected';
        ord.error = `FOK could not be filled in full (available ${available})`;
        this.rejections.push(ord);
        return { order: ord, fills: [], rejected: ord.error };
      }
    }

    if (['stop', 'stop-limit', 'take-profit', 'trailing-stop', 'oco'].includes(ord.type)) {
      ord.status = 'conditional';
      this.conditionals.push(ord);
      return { order: ord, fills: [], conditional: true };
    }

    return this.#match(ord, referencePrice);
  }

  cancel(orderId) {
    const buckets = [this.bids, this.asks];
    for (const bucket of buckets) {
      const idx = bucket.findIndex((o) => o.id === orderId);
      if (idx !== -1) {
        const [ord] = bucket.splice(idx, 1);
        ord.status = 'cancelled';
        ord.cancelledAt = Date.now();
        return ord;
      }
    }
    const cIdx = this.conditionals.findIndex((o) => o.id === orderId);
    if (cIdx !== -1) {
      const [ord] = this.conditionals.splice(cIdx, 1);
      ord.status = 'cancelled';
      ord.cancelledAt = Date.now();
      return ord;
    }
    return null;
  }

  cancelAll() {
    const all = [...this.bids, ...this.asks, ...this.conditionals];
    all.forEach((o) => { o.status = 'cancelled'; o.cancelledAt = Date.now(); });
    this.bids = [];
    this.asks = [];
    this.conditionals = [];
    return all;
  }

  #match(incoming, referencePrice) {
    const fills = [];
    const book = incoming.side === 'buy' ? this.asks : this.bids;

    if (incoming.type === 'market') {
      const liquidity = book.length;
      if (!liquidity) {
        incoming.status = 'rejected';
        incoming.error = 'no liquidity to fill a market order';
        this.rejections.push(incoming);
        return { order: incoming, fills: [], rejected: incoming.error };
      }
      const bestPrice = book[0].price;
      const ref = referencePrice || bestPrice;
      const slippage = Math.abs((bestPrice - ref) / ref) * 100;
      if (slippage > this.rules.maxSlippagePct) {
        incoming.status = 'rejected';
        incoming.error = `market protection: slippage ${slippage.toFixed(2)}% exceeds ${this.rules.maxSlippagePct}%`;
        this.rejections.push(incoming);
        return { order: incoming, fills: [], rejected: incoming.error };
      }
    }

    let remaining = incoming.qty;
    // Price-time priority: best price first, then oldest (seq).
    while (remaining > 0 && book.length) {
      const resting = book[0];
      if (incoming.type === 'limit') {
        const crosses = incoming.side === 'buy' ? incoming.price >= resting.price : incoming.price <= resting.price;
        if (!crosses) break;
      }
      if (this.selfTradePrevention && resting.ownerId === incoming.ownerId) {
        // Skip own resting order: it stays in the book, we move to the next level.
        const otherIdx = book.findIndex((o, i) => i > 0 && (!this.selfTradePrevention || o.ownerId !== incoming.ownerId));
        if (otherIdx === -1) break;
        const [moved] = book.splice(otherIdx, 1);
        book.unshift(moved);
        continue;
      }

      const qty = Math.min(remaining, resting.qty - resting.filled);
      const price = resting.price;
      resting.filled += qty;
      remaining -= qty;
      if (resting.filled >= resting.qty - 1e-12) {
        resting.status = 'filled';
        resting.filledAt = Date.now();
        book.shift();
      } else {
        resting.status = 'partially_filled';
      }

      const fill = {
        id: nextId('f'),
        orderId: incoming.id,
        restingOrderId: resting.id,
        side: incoming.side,
        price,
        qty,
        at: Date.now(),
        maker: resting.ownerId !== incoming.ownerId ? 'other' : 'self'
      };
      fills.push(fill);
      this.fills.push(fill);
    }

    incoming.filled = incoming.qty - remaining;
    if (incoming.filled >= incoming.qty - 1e-12) incoming.status = 'filled';
    else if (incoming.filled > 0) incoming.status = 'partially_filled';
    else incoming.status = incoming.type === 'market' ? 'rejected' : 'open';

    if (incoming.status === 'rejected') {
      incoming.error = incoming.error || 'insufficient liquidity';
      this.rejections.push(incoming);
      return { order: incoming, fills: [], rejected: incoming.error };
    }

    if (remaining > 0 && incoming.type === 'limit') {
      const tif = incoming.timeInForce || 'GTC';
      if (tif === 'IOC' || tif === 'FOK') {
        // Immediate-or-cancel: the unfilled remainder is cancelled, never rested.
        incoming.remaining = remaining;
        incoming.status = incoming.filled > 0 ? 'partially_filled_cancelled' : 'cancelled';
        incoming.cancelReason = `${tif} remainder cancelled`;
      } else {
        incoming.remaining = remaining;
        const side = incoming.side === 'buy' ? this.bids : this.asks;
        side.push({ ...incoming });
        side.sort((a, b) => (a.side === 'buy' ? b.price - a.price || a.seq - b.seq : a.price - b.price || a.seq - b.seq));
      }
    }

    return { order: incoming, fills, filledQty: incoming.filled };
  }

  /* ---------- books ---------- */

  getL1() {
    const bestBid = this.bids[0]?.price ?? null;
    const bestAsk = this.asks[0]?.price ?? null;
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    return {
      bestBid, bestAsk, spread, mid,
      spreadPct: spread != null && mid ? (spread / mid) * 100 : null
    };
  }

  /** Aggregated price levels (L2). */
  getL2(levels = 10) {
    const group = (orders, side) => {
      const map = new Map();
      orders.forEach((o) => {
        const remaining = o.qty - (o.filled || 0);
        if (remaining <= 0) return;
        const entry = map.get(o.price) || { price: o.price, qty: 0, orders: 0 };
        entry.qty += remaining;
        entry.orders += 1;
        map.set(o.price, entry);
      });
      const rows = [...map.values()];
      rows.sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price));
      return rows.slice(0, levels);
    };
    return { bids: group(this.bids, 'bid'), asks: group(this.asks, 'ask') };
  }

  /** Order-by-order book (L3): every resting order with time priority. */
  getL3() {
    const shape = (orders, side) => [...orders]
      .sort((a, b) => (side === 'bid' ? b.price - a.price || a.seq - b.seq : a.price - b.price || a.seq - b.seq))
      .map((o) => ({ id: o.id, price: o.price, qty: o.qty - (o.filled || 0), seq: o.seq, ownerId: o.ownerId, status: o.status }));
    return { bids: shape(this.bids, 'bid'), asks: shape(this.asks, 'ask') };
  }

  openOrders() {
    const open = [...this.bids, ...this.asks].filter((o) => o.status === 'open' || o.status === 'partially_filled');
    return [...open, ...this.conditionals.filter((o) => o.status === 'conditional')];
  }

  recordSnapshot() {
    const l2 = this.getL2(10);
    return { at: Date.now(), l1: this.getL1(), l2, lastPrice: this.lastPrice };
  }
}
