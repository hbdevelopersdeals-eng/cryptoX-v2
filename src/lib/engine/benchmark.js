/* Matching-engine benchmark.
 *
 * Measures the engine that actually runs in this app (no simulated numbers):
 * submits a configurable workload, records per-order match latency, and reports
 * throughput plus p50/p95/p99 latency.
 *
 * Runs on the main thread, so figures reflect browser JavaScript — not a
 * colocated exchange core. That distinction is stated in the UI.
 */

import { OrderBook } from './matching.js';

export function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[idx];
}

export function summarise(samples = [], elapsedMs = 0) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    orders: samples.length,
    elapsedMs,
    opsPerSecond: elapsedMs > 0 ? (samples.length / elapsedMs) * 1000 : null,
    meanMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null
  };
}

/**
 * Run a workload against a fresh book.
 * opts: { orders, priceLevels, restingRatio, price, tick }
 */
export function runBenchmark({ orders = 5000, priceLevels = 60, restingRatio = 0.5, price = 100, tick = 0.01 } = {}) {
  const book = new OrderBook({ rules: { tickSize: tick, stepSize: 0.0001, minQty: 0.0001, minNotional: 1 } });
  const samples = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  for (let i = 0; i < orders; i++) {
    const side = rand() < 0.5 ? 'buy' : 'sell';
    const level = Math.floor(rand() * priceLevels);
    const offset = (level + 1) * tick;
    const isResting = rand() < restingRatio;
    const px = Number((side === 'buy' ? price - offset : price + offset).toFixed(6));
    const qty = Number((0.001 + rand() * 0.5).toFixed(4));
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (isResting) {
      book.submit({ type: 'limit', side, price: px, qty, ownerId: `maker-${i % 25}` });
    } else {
      // aggressive order that crosses into the book for matching work
      book.submit({ type: 'limit', side, price: Number((side === 'buy' ? price + offset : price - offset).toFixed(6)), qty, ownerId: `taker-${i % 25}` });
    }
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    samples.push(t1 - t0);
  }
  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

  return {
    ...summarise(samples, elapsedMs),
    fills: book.fills.length,
    rejections: book.rejections.length,
    restingOrders: book.openOrders().length,
    l1: book.getL1(),
    deterministic: true
  };
}
