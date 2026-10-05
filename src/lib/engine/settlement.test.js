import { describe, it, expect } from 'vitest';
import { SettlementLedger, SettlementError, equity } from './settlement.js';
import { runBenchmark, percentile, summarise } from './benchmark.js';
import { OrderBook } from './matching.js';

const rules = { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 1 };

describe('advanced order options', () => {
  const fresh = () => new OrderBook({ rules, ownerId: 'me' });

  it('rejects post-only orders that would take liquidity', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 1, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1, postOnly: true });
    expect(res.rejected).toMatch(/post-only/);
    expect(book.getL2().bids.length).toBe(0);
  });

  it('rests post-only orders that do not cross', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 101, qty: 1, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1, postOnly: true });
    expect(res.rejected).toBeUndefined();
    expect(book.getL2().bids[0].price).toBe(100);
  });

  it('cancels the unfilled remainder of an IOC order', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 0.5, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1, timeInForce: 'IOC' });
    expect(res.fills).toHaveLength(1);
    expect(res.order.status).toBe('partially_filled_cancelled');
    expect(book.getL2().bids.length).toBe(0); // nothing left resting
  });

  it('rejects a FOK order that cannot fill completely', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 0.4, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1, timeInForce: 'FOK' });
    expect(res.rejected).toMatch(/FOK/);
    expect(book.getL2().asks[0].qty).toBeCloseTo(0.4, 6); // book untouched
  });

  it('fills a FOK order completely when liquidity is sufficient', () => {
    const book = fresh();
    book.submit({ type: 'limit', side: 'sell', price: 100, qty: 1, ownerId: 'a' });
    const res = book.submit({ type: 'limit', side: 'buy', price: 100, qty: 1, timeInForce: 'FOK' });
    expect(res.rejected).toBeUndefined();
    expect(res.order.status).toBe('filled');
  });

  it('defaults to GTC and rests the remainder', () => {
    const book = fresh();
    const res = book.submit({ type: 'limit', side: 'buy', price: 90, qty: 1 });
    expect(res.order.timeInForce).toBe('GTC');
    expect(book.getL2().bids).toHaveLength(1);
  });
});

describe('atomic settlement ledger', () => {
  const fill = (side, price, qty) => ({ id: `f-${side}`, side, price, qty });

  it('settles a buy atomically with fee taken from quote', () => {
    const ledger = new SettlementLedger({ balances: { base: 0, quote: 10000 } });
    const receipt = ledger.settle(fill('buy', 100, 10));
    expect(receipt.fee).toBeCloseTo(1, 6); // 0.1% of 1000
    expect(ledger.balances.base).toBeCloseTo(10, 6);
    expect(ledger.balances.quote).toBeCloseTo(10000 - 1000 - 1, 6);
    expect(receipt.before).toEqual({ base: 0, quote: 10000 });
  });

  it('settles a sell and books the fee', () => {
    const ledger = new SettlementLedger({ balances: { base: 5, quote: 0 } });
    ledger.settle(fill('sell', 100, 5));
    expect(ledger.balances.base).toBeCloseTo(0, 6);
    expect(ledger.balances.quote).toBeCloseTo(500 - 0.5, 6);
  });

  it('rejects a fill that would overdraw a balance', () => {
    const ledger = new SettlementLedger({ balances: { base: 0, quote: 50 } });
    expect(() => ledger.settle(fill('buy', 100, 1))).toThrow(SettlementError);
    expect(ledger.balances.quote).toBe(50); // untouched
    expect(ledger.receipts).toHaveLength(0);
  });

  it('rolls back the whole batch when one leg fails', () => {
    const ledger = new SettlementLedger({ balances: { base: 2, quote: 1000 } });
    expect(() => ledger.settleBatch([fill('buy', 100, 1), fill('sell', 100, 50)])).toThrow(SettlementError);
    expect(ledger.balances).toEqual({ base: 2, quote: 1000 });
    expect(ledger.audit().receipts).toBe(0);
    expect(ledger.audit().totalFees).toBe(0);
  });

  it('audits receipts against the fee balance and keeps balances non-negative', () => {
    const ledger = new SettlementLedger({ balances: { base: 1, quote: 5000 } });
    ledger.settleBatch([fill('buy', 100, 1), fill('sell', 100, 1)]);
    const audit = ledger.audit();
    expect(audit.receipts).toBe(2);
    expect(audit.feesMatchReceipts).toBe(true);
    expect(audit.nonNegative).toBe(true);
  });

  it('computes mark-to-market equity', () => {
    const ledger = new SettlementLedger({ balances: { base: 2, quote: 100 } });
    expect(equity(ledger, 50)).toBeCloseTo(200, 6);
  });
});

describe('matching engine benchmark', () => {
  it('summarises latency percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 50)).toBeNull();
    const s = summarise([1, 2, 3, 4], 10);
    expect(s.orders).toBe(4);
    expect(s.opsPerSecond).toBeCloseTo(400, 6);
    expect(s.p95Ms).toBeGreaterThanOrEqual(s.p50Ms);
  });

  it('runs a real workload against the engine and returns measurements', () => {
    const result = runBenchmark({ orders: 400, priceLevels: 20, restingRatio: 0.4, price: 100 });
    expect(result.orders).toBe(400);
    expect(result.opsPerSecond).toBeGreaterThan(0);
    expect(result.p99Ms).toBeGreaterThanOrEqual(0);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.p50Ms);
    expect(result.deterministic).toBe(true);
  });
});
