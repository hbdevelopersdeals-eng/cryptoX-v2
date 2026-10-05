/* Backpressure and reconciliation utilities for the real-time engine.
 * Pure, bounded and unit tested. */

/** Bounded queue with an explicit overflow policy (drop oldest / drop newest). */
export class BackpressureQueue {
  constructor(capacity = 500, policy = 'drop_oldest') {
    this.capacity = capacity;
    this.policy = policy;
    this.items = [];
    this.dropped = 0;
    this.enqueued = 0;
    this.highWater = 0;
  }

  push(item) {
    this.enqueued += 1;
    if (this.items.length >= this.capacity) {
      if (this.policy === 'drop_newest') {
        this.dropped += 1;
        return { accepted: false, dropped: true, evicted: false };
      }
      // drop_oldest: the incoming item is accepted, the oldest one is evicted.
      this.items.shift();
      this.dropped += 1;
      this.items.push(item);
      this.highWater = Math.max(this.highWater, this.items.length);
      return { accepted: true, dropped: false, evicted: true };
    }
    this.items.push(item);
    this.highWater = Math.max(this.highWater, this.items.length);
    return { accepted: true, dropped: false, evicted: false };
  }

  drain(handler, max = Infinity) {
    let processed = 0;
    while (this.items.length && processed < max) {
      handler(this.items.shift());
      processed += 1;
    }
    return processed;
  }

  stats() {
    return {
      depth: this.items.length,
      capacity: this.capacity,
      dropped: this.dropped,
      enqueued: this.enqueued,
      highWater: this.highWater,
      pressure: this.capacity ? Math.round((this.items.length / this.capacity) * 100) : 0,
      policy: this.policy
    };
  }

  clear() {
    this.items = [];
  }
}

/** Leading+trailing throttle that guarantees the last call is not lost. */
export function throttle(fn, waitMs = 250) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    pendingArgs = args;
    const run = () => {
      last = Date.now();
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
    };
    if (now - last >= waitMs) {
      if (timer) { clearTimeout(timer); timer = null; }
      run();
    } else if (!timer) {
      timer = setTimeout(run, waitMs - (now - last));
    }
  };
}

/** Difference between two prices in basis points. */
export function driftBps(a, b) {
  if (a == null || b == null) return null;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !y) return null;
  return Math.abs((x - y) / y) * 10000;
}

/** Compare streamed top-of-book with a REST snapshot. */
export function reconcileTopOfBook(sample = {}, { toleranceBps = 8 } = {}) {
  const { wsBid, wsAsk, restBid, restAsk } = sample;
  const issues = [];
  const bidDrift = driftBps(wsBid, restBid);
  const askDrift = driftBps(wsAsk, restAsk);
  if (bidDrift != null && bidDrift > toleranceBps) issues.push({ field: 'bid', driftBps: bidDrift });
  if (askDrift != null && askDrift > toleranceBps) issues.push({ field: 'ask', driftBps: askDrift });
  const maxDriftBps = Math.max(bidDrift ?? 0, askDrift ?? 0);
  return { ok: issues.length === 0, issues, maxDriftBps, bidDrift, askDrift, at: Date.now() };
}

/** Rolling reconciliation summary for the engine panel. */
export class Reconciler {
  constructor(capacity = 200) {
    this.samples = [];
    this.capacity = capacity;
    this.checks = 0;
    this.mismatches = 0;
    this.worstBps = 0;
  }

  record(sample, options) {
    const result = reconcileTopOfBook(sample, options);
    this.checks += 1;
    if (!result.ok) this.mismatches += 1;
    this.worstBps = Math.max(this.worstBps, result.maxDriftBps || 0);
    this.samples.push(result);
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
    return result;
  }

  summary() {
    return {
      checks: this.checks,
      mismatches: this.mismatches,
      mismatchRate: this.checks ? this.mismatches / this.checks : 0,
      worstBps: this.worstBps
    };
  }
}
