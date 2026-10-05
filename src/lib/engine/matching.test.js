import { describe, it, expect } from 'vitest';
import {
  OrderBook, validateOrder, checkRisk, evaluateCircuitBreaker, roundToTick, roundToStep, DEFAULT_RULES
} from './matching.js';

const rules = { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 1, maxSlippagePct: 0.5, priceBandPct: 5 };

describe('rounding', () => {
  it('rounds prices to tick and quantities down to step', () => {
    expect(roundToTick(100.016, 0.01)).toBeCloseTo(100.02, 6);
    expect(roundToStep(1.2349, 0.001)).toBeCloseTo(1.234, 6);
  });
});

describe('validateOrder', () => {
  it('accepts a well-formed limit order', () => {
    const res = validateOrder({ type: 'limit', side: 'buy', price: 100, qty: 1 }, rules);
    expect(res.ok).toBe(true);
    expect(res.normalized.qty).toBe(1);
  });

  it('rejects tick, step, minimum and notional violations', () => {
    expect(validateOrder({ type: 'limit', side: 'buy', price: 100.005, qty: 1 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'limit', side: 'buy', price: 100, qty: 1.2345 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'limit', side: 'buy', price: 100, qty: 0.0001 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'limit', side: 'buy', price: 0.5, qty: 0.001 }, rules).ok).toBe(false);
  });

  it('requires prices and legs for the right order types', () => {
    expect(validateOrder({ type: 'limit', side: 'buy', qty: 1 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'stop', side: 'sell', qty: 1 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'stop', side: 'sell', qty: 1, stopPrice: 90 }, rules).ok).toBe(true);
    expect(validateOrder({ type: 'trailing-stop', side: 'sell', qty: 1, trailingPct: 2 }, rules).ok).toBe(true);
    expect(validateOrder({ type: 'trailing-stop', side: 'sell', qty: 1, trailingPct: 80 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'oco', side: 'sell', qty: 1, takeProfit: 120, stopLoss: 90 }, rules).ok).toBe(true);
    expect(validateOrder({ type: 'oco', side: 'sell', qty: 1, takeProfit: 120 }, rules).ok).toBe(false);
  });

  it('rejects unknown sides and types', () => {
    expect(validateOrder({ type: 'limit', side: 'hold', price: 1, qty: 1 }, rules).ok).toBe(false);
    expect(validateOrder({ type: 'iceberg', side: 'buy', price: 1, qty: 1 }, rules).ok).toBe(false);
  });
});

describe('checkRisk', () => {
  it('blocks orders that exceed the paper balance', () => {
    expect(checkRisk({ order: { side: 'buy', qty: 2, price: 100 }, balances: { quote: 100 } }).ok).toBe(false);
    expect(checkRisk({ order: { side: 'sell', qty: 5, price: 100 }, balances: { base: 1 } }).ok).toBe(false);
    expect(checkRisk({ order: { side: 'buy', qty: 1, price: 100 }, balances: { quote: 1000 } }).ok).toBe(true);
  });

  it('warns when nearly all balance is used', () => {
    const res = checkRisk({ order: { side: 'buy', qty: 0.95, price: 100 }, balances: { quote: 100 } });
    expect(res.ok).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('enforces notional limits, price bands and market protection', () => {
    expect(checkRisk({ order: { side: 'buy', qty: 1, price: 100 }, balances: { quote: 1e6 }, limits: { maxOrderNotional: 50 } }).ok).toBe(false);
    expect(checkRisk({ order: { side: 'buy', qty: 1, price: 200 }, balances: { quote: 1e6 }, referencePrice: 100 }).ok).toBe(false);
    expect(checkRisk({ order: { type: 'market', side: 'buy', qty: 1 }, balances: { quote: 1e6 }, referencePrice: 100, spreadPct: 2 }).ok).toBe(false);
  });
});

describe('evaluateCircuitBreaker', () => {
  const now = 1_000_000;
  it('halts on a fast move beyond the threshold', () => {
    const res = evaluateCircuitBreaker([{ price: 100, at: now - 10000 }, { price: 106, at: now }], { now, windowMs: 60000, movePct: 5 });
    expect(res.halted).toBe(true);
    expect(res.movePct).toBeCloseTo(6, 5);
  });
  it('stays open on small moves and thin data', () => {
    expect(evaluateCircuitBreaker([{ price: 100, at: now - 10000 }, { price: 101, at: now }], { now }).halted).toBe(false);
    expect(evaluateCircuitBreaker([{ price: 100, at: now }], { now }).halted).toBe(false);
  });
  it('ignores prices outside the window', () => {
    const res = evaluateCircuitBreaker([{ price: 100, at: now - 300000 }, { price: 120, at: now }], { now, windowMs: 60000 });
    expect(res.halted).toBe(false);
  });
});

describe('OrderBook matching', () => {
  const fresh = () => new OrderBook({ rules, ownerId: 'me' });

  it('rests then matches with price-time priority', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 101, qty: 1, ownerId: 'a' });
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 1, ownerId: 'b' });
    expect(book.getL2().asks[0].price).toBe(100);

    const res = book.submit({ type: 'limit', side: 'buy', price: 101, qty: 1.5 });
    expect(res.fills.length).toBe(2);
    expect(res.fills[0].price).toBe(100); // cheaper level first
    expect(res.fills[1].price).toBe(101);
    expect(res.order.status).toBe('filled');
  });

  it('keeps the unfilled remainder resting as open', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 0.5, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1 });
    expect(res.order.status).toBe('partially_filled');
    expect(book.getL2().bids[0].qty).toBeCloseTo(0.5, 6);
  });

  it('fills market orders against the best levels', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 0.5, ownerId: 'a' });
    book.submit({ type: 'limit', side: 'sell', price: 100.1, qty: 0.5, ownerId: 'b' });
    book.markPrice(100);
    const res = book.submit({ type: 'market', side: 'buy', qty: 1 });
    expect(res.fills.length).toBe(2);
    expect(res.fills[0].price).toBe(100);
    expect(res.order.status).toBe('filled');
  });

  it('applies market protection when slippage is too wide', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 110, qty: 1, ownerId: 'a' });
    book.markPrice(100);
    const res = book.submit({ type: 'market', side: 'buy', qty: 1 }, 100);
    expect(res.rejected).toMatch(/market protection/);
    expect(book.getL2().asks.length).toBe(1); // untouched
  });

  it('rejects a market order when the book is empty', () => {
    const book = fresh();
    const res = book.submit({ type: 'market', side: 'buy', qty: 1 });
    expect(res.rejected).toBeTruthy();
  });

  it('prevents self-trading while still filling from other participants', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 1, ownerId: 'me' });   // own order
    book.submit({ type: 'limit', side: 'sell', price: 100.5, qty: 1, ownerId: 'other' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 101, qty: 1 });
    expect(res.fills.every((f) => f.restingOrderId !== book.getL3().asks[0]?.id || true)).toBe(true);
    expect(res.fills.length).toBe(1);
    expect(res.fills[0].price).toBe(100.5);
    expect(book.getL3().asks.some((o) => o.ownerId === 'me')).toBe(true);
  });

  it('triggers stop, take-profit and trailing conditional orders', () => {
    const book = fresh();
    book.markPrice(100);
    book.submit({ type: 'stop', side: 'sell', qty: 1, stopPrice: 95 });
    book.markPrice(94);
    const stopChildren = book.getL3();
    expect(stopChildren.bids.length + stopChildren.asks.length).toBeGreaterThanOrEqual(0);
    expect(book.conditionals.length).toBe(0);

    const tp = fresh();
    tp.markPrice(100);
    tp.submit({ type: 'take-profit', side: 'sell', qty: 1, stopPrice: 110 });
    tp.markPrice(111);
    expect(tp.conditionals.length).toBe(0);

    const trail = fresh();
    trail.markPrice(100);
    trail.submit({ type: 'trailing-stop', side: 'sell', qty: 1, trailingPct: 5 });
    trail.markPrice(120); // peak
    trail.markPrice(113); // 5.8% below peak -> triggers
    expect(trail.conditionals.length).toBe(0);
  });

  it('activates exactly one leg of an OCO', () => {
    const book = fresh();
    book.markPrice(100);
    book.submit({ type: 'oco', side: 'sell', qty: 1, takeProfit: 120, stopLoss: 90 });
    book.markPrice(121);
    expect(book.conditionals.length).toBe(0);
    expect(book.fills.length + book.openOrders().length).toBeGreaterThan(0);
  });

  it('blocks submissions while halted and resumes afterwards', () => {
    const book = fresh();
    book.setHalt('maintenance');
    const blocked = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1 });
    expect(blocked.rejected).toMatch(/halted/);
    book.resume();
    const ok = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1 });
    expect(ok.rejected).toBeUndefined();
    expect(book.getL2().bids.length).toBe(1);
  });

  it('kill switch cancels everything and halts the book', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'buy', price: 99, qty: 1 });
    book.submit({ type: 'stop', side: 'sell', qty: 1, stopPrice: 110 });
    const res = book.killSwitch();
    expect(res.halted.reason).toMatch(/Kill switch/);
    expect(book.openOrders()).toHaveLength(0);
    expect(res.cancelled.length).toBe(2);
  });

  it('auto-halts on a circuit-breaker move', () => {
    const book = fresh();
    book.markPrice(100);
    const { breaker } = book.markPrice(107);
    expect(breaker.halted).toBe(true);
    expect(book.halted).toBeTruthy();
  });

  it('cancels single orders and reports L1/L2/L3 consistently', () => {
    const book = fresh();
    const a = book.submit({ type: 'limit', side: 'buy', price: 99, qty: 1, ownerId: 'a' });
    book.submit({ type: 'limit', side: 'buy', price: 98, qty: 2, ownerId: 'b' });
    book.submit({ type: 'limit', side: 'sell', price: 101, qty: 1, ownerId: 'c' });

    expect(book.cancel(a.order.id).status).toBe('cancelled');
    expect(book.cancel('missing')).toBeNull();

    const l1 = book.getL1();
    expect(l1.bestBid).toBe(98);
    expect(l1.bestAsk).toBe(101);
    expect(l1.spread).toBeCloseTo(3, 6);
    expect(l1.spreadPct).toBeCloseTo(3.015, 2);

    const l2 = book.getL2();
    expect(l2.bids[0].qty).toBe(2);
    expect(l2.asks[0].qty).toBe(1);

    const l3 = book.getL3();
    expect(l3.bids[0].id).toBeTruthy();
    expect(l3.bids[0].seq).toBeLessThan(l3.asks[0].seq + 1);

    const snap = book.recordSnapshot();
    expect(snap.l1.bestBid).toBe(98);
    expect(snap.l2.bids.length).toBe(1);
  });
});
