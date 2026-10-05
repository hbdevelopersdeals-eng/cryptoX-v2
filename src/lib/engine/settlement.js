/* Atomic settlement ledger.
 *
 * Every fill settles as ONE atomic transaction: either all balance movements in
 * a receipt are applied, or none are. Invariants are checked after each
 * settlement and any violation raises, so a partially applied trade can never
 * be recorded as success.
 *
 * Pure — unit tested.
 */

export class SettlementError extends Error {}

/** Ledger of balances + immutable settlement receipts. */
export class SettlementLedger {
  constructor({ base = 'BTC', quote = 'USDT', balances = { base: 0, quote: 0 }, feePct = 0.001 } = {}) {
    this.base = base;
    this.quote = quote;
    this.balances = { ...balances };
    this.feePct = feePct;
    this.receipts = [];
    this.seq = 0;
    this.totalFees = 0;
  }

  snapshot() {
    return { ...this.balances };
  }

  /** Build (but do not apply) the movements for a fill. */
  plan(fill) {
    const notional = fill.price * fill.qty;
    const fee = notional * this.feePct;
    if (fill.side === 'buy') {
      return {
        deltas: { base: fill.qty, quote: -(notional + fee) },
        fee,
        notional
      };
    }
    return {
      deltas: { base: -fill.qty, quote: notional - fee },
      fee,
      notional
    };
  }

  /** Validate a plan without mutating state. */
  validate(plan) {
    const after = {
      base: this.balances.base + plan.deltas.base,
      quote: this.balances.quote + plan.deltas.quote
    };
    const errors = [];
    if (after.base < -1e-9) errors.push('base balance would go negative');
    if (after.quote < -1e-9) errors.push('quote balance would go negative');
    return { ok: errors.length === 0, errors, after };
  }

  /** Apply a fill atomically, returning a receipt (or throwing). */
  settle(fill) {
    const plan = this.plan(fill);
    const check = this.validate(plan);
    if (!check.ok) {
      throw new SettlementError(`settlement rejected: ${check.errors.join('; ')}`);
    }
    const before = this.snapshot();
    // atomic block: apply every movement, then verify, then commit the receipt
    const next = { base: before.base + plan.deltas.base, quote: before.quote + plan.deltas.quote };
    const conservationBefore = before.quote + before.base * fill.price;
    const conservationAfter = next.quote + next.base * fill.price;
    const drift = Math.abs(conservationAfter - conservationBefore + plan.fee);
    if (drift > 1e-6) {
      throw new SettlementError(`conservation violated (drift ${drift})`);
    }
    this.balances = next;
    this.totalFees += plan.fee;
    const receipt = {
      id: `st-${++this.seq}`,
      at: Date.now(),
      fillId: fill.id || null,
      side: fill.side,
      price: fill.price,
      qty: fill.qty,
      notional: plan.notional,
      fee: plan.fee,
      before,
      after: { ...next },
      deltas: plan.deltas
    };
    this.receipts.push(receipt);
    return receipt;
  }

  /** Settle a batch; if any leg fails the whole batch is rolled back. */
  settleBatch(fills = []) {
    const rollback = { ...this.balances };
    const applied = [];
    try {
      fills.forEach((f) => applied.push(this.settle(f)));
      return applied;
    } catch (err) {
      this.balances = rollback;
      this.receipts = this.receipts.filter((r) => !applied.some((a) => a.id === r.id));
      this.totalFees -= applied.reduce((a, r) => a + r.fee, 0);
      throw err;
    }
  }

  /** Invariant report used by the UI. */
  audit() {
    const feesAccounted = this.receipts.reduce((a, r) => a + r.fee, 0);
    return {
      receipts: this.receipts.length,
      totalFees: this.totalFees,
      feesMatchReceipts: Math.abs(feesAccounted - this.totalFees) < 1e-9,
      nonNegative: this.balances.base >= -1e-9 && this.balances.quote >= -1e-9
    };
  }
}

/** Mark-to-market total equity of the ledger at a given price. */
export function equity(ledger, price) {
  return ledger.balances.quote + ledger.balances.base * (price || 0);
}
