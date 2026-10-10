/* Payments and billing.
 *
 * THE CENTRAL RULE (from the brief): never trust payment status supplied by the
 * frontend. This module therefore contains no function that lets the client
 * declare an invoice paid. `applyPaymentUpdate` REFUSES any update that does not
 * carry evidence of server origin, and the UI has no path to mark a payment
 * settled. That refusal is the point of the module, not a limitation of it.
 *
 * Everything else here is the arithmetic that a payment provider would otherwise
 * be trusted to get right: billing periods across month ends, proration on a
 * mid-cycle change, coupon eligibility, tiered metered pricing, dunning
 * backoff and refund caps.
 */

import { roundToCurrency } from './rates.js';

/* ---------------------------------------------------------------------------
 * Plans and entitlements
 * ------------------------------------------------------------------------ */

/* The plan catalogue lives in plans.js and is re-exported here, so every
 * existing `from './billing.js'` import keeps working. It was moved because an
 * eager importer of `PLANS` was pulling this whole engine — period arithmetic,
 * proration, dunning, refunds — into the initial bundle. */
// Imported for local use AND re-exported. `export { … } from` alone creates no
// local binding, so periodFor, trialState and prorate below could not see them —
// the functions this module is named for stopped working.
import { BILLING_CYCLES, PLANS, planById, hasEntitlement, entitlementGap } from './plans.js';
export { BILLING_CYCLES, PLANS, planById, hasEntitlement, entitlementGap };

/* ---------------------------------------------------------------------------
 * Billing periods — month ends are the whole difficulty
 * ------------------------------------------------------------------------ */

/** Add months, clamping to the target month's last day. */
export function addMonthsClamped(date, months, anchorDay = null) {
  const d = new Date(date);
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * The billing period containing `at`.
 *
 * Anchored on the subscription's original day-of-month so a subscription that
 * started on the 31st bills on the 31st again in the months that have one,
 * instead of silently sliding to the 28th forever after February.
 */
export function periodFor({ start, cycle = 'monthly', at = new Date() }) {
  const months = BILLING_CYCLES.find((c) => c.id === cycle)?.months ?? 1;
  const anchorDay = new Date(start).getUTCDate();
  let index = 0;
  let from = new Date(start);
  let to = addMonthsClamped(start, months, anchorDay);
  const when = new Date(at);
  // Bounded so a bad start date cannot spin forever.
  while (when >= to && index < 1200) {
    index += 1;
    from = to;
    to = addMonthsClamped(start, months * (index + 1), anchorDay);
  }
  const totalDays = Math.max(1, (to - from) / 86400000);
  const elapsedDays = Math.min(totalDays, Math.max(0, (when - from) / 86400000));
  return {
    index, from, to, totalDays,
    elapsedDays,
    remainingDays: Math.max(0, totalDays - elapsedDays),
    anchorDay
  };
}

export function nextRenewal({ start, cycle = 'monthly', at = new Date() }) {
  return periodFor({ start, cycle, at }).to;
}

/* ---------------------------------------------------------------------------
 * Trial
 * ------------------------------------------------------------------------ */

export function trialState({ planId, startedAt, at = new Date(), now = () => new Date() } = {}) {
  const plan = planById(planId);
  const days = plan?.trialDays ?? 0;
  if (!days || !startedAt) return { onTrial: false, days: 0, reason: 'no-trial-for-plan' };
  const end = new Date(new Date(startedAt).getTime() + days * 86400000);
  const when = at instanceof Date ? at : new Date(at);
  return {
    onTrial: when < end,
    days,
    endsAt: end,
    daysLeft: Math.max(0, Math.ceil((end - when) / 86400000)),
    expired: when >= end,
    reason: when < end ? 'active' : 'expired',
    // A trial that ends without a payment method must degrade, not silently
    // continue on paid entitlements.
    onExpiry: 'revert-to-free'
  };
}

/* ---------------------------------------------------------------------------
 * Proration
 * ------------------------------------------------------------------------ */

/**
 * Prorate a plan change mid-cycle.
 *
 * Unused time on the old plan becomes a credit; the remainder of the new plan is
 * charged. The result can legitimately be NEGATIVE — an upgrade late in a cycle
 * from an expensive plan to a cheaper one owes the customer money, and clamping
 * that to zero silently keeps it.
 */
export function prorate({ fromPlanId, toPlanId, cycle = 'monthly', subscriptionStart, at = new Date(), currency = 'USD' } = {}) {
  const from = planById(fromPlanId);
  const to = planById(toPlanId);
  if (!from || !to) return { ok: false, reason: 'unknown-plan' };
  if (to.contactOnly || from.contactOnly) return { ok: false, reason: 'contact-sales-plan' };

  /*
   * `at` may arrive as a Date or an ISO string. periodFor already accepts both,
   * so this must too — otherwise the two disagree and one of them throws on a
   * value the other handled fine.
   */
  const when = at instanceof Date ? at : new Date(at);
  const period = periodFor({ start: subscriptionStart, cycle, at: when });
  const fraction = period.remainingDays / period.totalDays;
  const oldPrice = from.price?.[cycle] ?? 0;
  const newPrice = to.price?.[cycle] ?? 0;

  const rawCredit = oldPrice * fraction;
  const rawCharge = newPrice * fraction;
  const credit = roundToCurrency(rawCredit, currency);
  const charge = roundToCurrency(rawCharge, currency);
  const net = roundToCurrency(rawCharge - rawCredit, currency);

  return {
    ok: true,
    direction: to.rank > from.rank ? 'upgrade' : to.rank < from.rank ? 'downgrade' : 'sidegrade',
    fraction,
    remainingDays: period.remainingDays,
    totalDays: period.totalDays,
    credit, charge, net,
    dueNow: net > 0 ? net : 0,
    accountCredit: net < 0 ? Math.abs(net) : 0,
    effectiveAt: when.toISOString(),
    note: net < 0
      ? 'A negative net is a credit the customer is owed, not a zero charge.'
      : undefined
  };
}

/* ---------------------------------------------------------------------------
 * Coupons and discounts
 * ------------------------------------------------------------------------ */

export const COUPON_DURATIONS = ['once', 'repeating', 'forever'];

export function evaluateCoupon({ coupon, subtotal, currency = 'USD', now = new Date(), redemptions = 0, cyclesSinceStart = 0 } = {}) {
  if (!coupon) return { ok: false, reason: 'no-coupon', discount: 0 };
  if (coupon.revoked) return { ok: false, reason: 'revoked', discount: 0 };
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return { ok: false, reason: 'expired', discount: 0 };
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return { ok: false, reason: 'not-yet-valid', discount: 0 };
  if (coupon.maxRedemptions != null && redemptions >= coupon.maxRedemptions) {
    return { ok: false, reason: 'redemption-limit', discount: 0 };
  }
  if (coupon.currency && coupon.currency !== currency) {
    return { ok: false, reason: 'currency-mismatch', discount: 0 };
  }
  if (coupon.minSubtotal != null && subtotal < coupon.minSubtotal) {
    return { ok: false, reason: 'below-minimum', discount: 0, required: coupon.minSubtotal };
  }
  // A 'once' coupon applies to the first invoice only; 'repeating' for N cycles.
  if (coupon.duration === 'once' && cyclesSinceStart > 0) return { ok: false, reason: 'already-applied', discount: 0 };
  if (coupon.duration === 'repeating' && cyclesSinceStart >= (coupon.durationInCycles ?? 0)) {
    return { ok: false, reason: 'duration-exhausted', discount: 0 };
  }

  let discount = 0;
  if (coupon.percentOff != null) discount = subtotal * (Number(coupon.percentOff) / 100);
  else if (coupon.amountOff != null) discount = Number(coupon.amountOff);

  // Never discount below zero, and never more than the subtotal.
  const capped = Math.min(discount, subtotal);
  return {
    ok: true,
    reason: 'applied',
    discount: roundToCurrency(capped, currency),
    capped: capped < discount,
    total: roundToCurrency(subtotal - capped, currency)
  };
}

/** Best single coupon for a subtotal. Coupons do not stack unless told to. */
export function bestCoupon({ coupons = [], subtotal, currency = 'USD', now = new Date(), allowStacking = false } = {}) {
  const evaluated = coupons
    .map((coupon) => ({ coupon, result: evaluateCoupon({ coupon, subtotal, currency, now }) }))
    .filter((e) => e.result.ok)
    .sort((a, b) => b.result.discount - a.result.discount);
  if (!evaluated.length) return { discount: 0, applied: [], rejected: [], total: subtotal };
  const applied = allowStacking ? evaluated : [evaluated[0]];
  const discount = roundToCurrency(applied.reduce((s, e) => s + e.result.discount, 0), currency);
  return {
    discount,
    applied: applied.map((e) => e.coupon.code),
    rejected: coupons.filter((c) => !evaluated.some((e) => e.coupon.code === c.code)).map((c) => c.code),
    total: roundToCurrency(subtotal - Math.min(discount, subtotal), currency)
  };
}

/* ---------------------------------------------------------------------------
 * Usage-based pricing
 * ------------------------------------------------------------------------ */

/**
 * Tiered metered pricing.
 *
 * GRADUATED and VOLUME are different and routinely confused:
 *   graduated — each tier's rate applies only to the units that fall in it
 *   volume    — the rate of the tier the TOTAL lands in applies to every unit
 * Getting this backwards under- or over-bills by a large factor, so both are
 * implemented explicitly and the mode is always named in the result.
 */
export function usageCharge({ units, tiers = [], mode = 'graduated', currency = 'USD' } = {}) {
  const n = Number(units);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'invalid-units' };
  if (!tiers.length) return { ok: false, reason: 'no-tiers' };

  const sorted = [...tiers].sort((a, b) => a.upTo - b.upTo);

  if (mode === 'volume') {
    const tier = sorted.find((t) => n <= t.upTo) || sorted[sorted.length - 1];
    // 0 units costs nothing even if the first tier has a standing fee.
    const amount = n === 0 ? 0 : n * tier.rate;
    return { ok: true, mode, units: n, amount: roundToCurrency(amount, currency), tier: tier.upTo, breakdown: [{ upTo: tier.upTo, units: n, rate: tier.rate }] };
  }

  let remaining = n;
  let previous = 0;
  let amount = 0;
  const breakdown = [];
  for (const tier of sorted) {
    if (remaining <= 0) break;
    const band = tier.upTo === Infinity ? remaining : Math.max(0, Math.min(remaining, tier.upTo - previous));
    if (band > 0) {
      amount += band * tier.rate;
      breakdown.push({ upTo: tier.upTo, units: band, rate: tier.rate, subtotal: roundToCurrency(band * tier.rate, currency) });
      remaining -= band;
    }
    previous = tier.upTo;
  }
  return { ok: true, mode: 'graduated', units: n, amount: roundToCurrency(amount, currency), breakdown };
}

/* ---------------------------------------------------------------------------
 * Failed payments and dunning
 * ------------------------------------------------------------------------ */

export const DUNNING_SCHEDULE = [
  { attempt: 1, afterHours: 0, note: 'Retry immediately — most failures are transient issuer declines.' },
  { attempt: 2, afterHours: 72, note: 'Retry after 3 days.' },
  { attempt: 3, afterHours: 120, note: 'Retry after 5 days, and email the customer.' },
  { attempt: 4, afterHours: 168, note: 'Final retry after 7 days, then suspend.' }
];

/** The next retry, or the point at which retrying stops. */
export function nextRetry({ failedAt, attempts, schedule = DUNNING_SCHEDULE } = {}) {
  const made = Number(attempts) || 0;
  const next = schedule.find((s) => s.attempt === made + 1);
  if (!next) {
    return { retry: false, attempts: made, exhausted: true, action: 'suspend-and-notify', reason: 'schedule-exhausted' };
  }
  const at = new Date(new Date(failedAt).getTime() + next.afterHours * 3600000);
  return { retry: true, attempt: next.attempt, at, note: next.note, attempts: made, exhausted: false };
}

/** Classify a decline so the retry strategy can differ per cause. */
export function classifyDecline(code) {
  const map = {
    insufficient_funds: { retryable: true, action: 'retry-later', note: 'Often resolves on payday or after a top-up.' },
    card_expired: { retryable: false, action: 'request-new-method', note: 'Retrying an expired card can never succeed.' },
    card_declined: { retryable: true, action: 'retry-later' },
    do_not_honor: { retryable: true, action: 'retry-later' },
    authentication_required: { retryable: false, action: 'request-authentication', note: 'Needs the customer to complete 3-D Secure.' },
    fraud_suspected: { retryable: false, action: 'hold-and-review', note: 'Do not retry; route to review.' },
    processing_error: { retryable: true, action: 'retry-later' },
    invalid_account: { retryable: false, action: 'request-new-method' }
  };
  return map[code] || { retryable: false, action: 'manual-review', note: 'Unknown code — do not blind-retry.' };
}

/* ---------------------------------------------------------------------------
 * Refunds
 * ------------------------------------------------------------------------ */

/**
 * Refund cap: never more than was actually paid, minus anything already
 * refunded. Refunding past the paid amount is how money leaves twice.
 */
export function planRefund({ invoice, amount = null, reason, now = new Date() } = {}) {
  if (!invoice) return { ok: false, reason: 'no-invoice' };
  const paid = Number(invoice.paid || 0);
  const already = Number(invoice.refunded || 0);
  const available = roundToCurrency(paid - already);
  if (available <= 0) return { ok: false, reason: 'nothing-refundable', available: 0 };

  const requested = amount == null ? available : Number(amount);
  if (!(requested > 0)) return { ok: false, reason: 'amount-must-be-positive' };
  if (requested > available) return { ok: false, reason: 'exceeds-paid', available, requested: roundToCurrency(requested) };

  return {
    ok: true,
    refund: {
      id: `rf_${invoice.number}_${already ? 'p' : 'f'}_${Date.now()}`,
      invoiceId: invoice.id,
      amount: roundToCurrency(requested),
      currency: invoice.currency,
      // partial vs full is derived, never asserted by the caller.
      kind: requested >= available ? 'full' : 'partial',
      reason: reason || null,
      requestedAt: now.toISOString(),
      status: 'requested'
    },
    available: roundToCurrency(available - requested)
  };
}

/* ---------------------------------------------------------------------------
 * Provider abstraction and the authority rule
 * ------------------------------------------------------------------------ */

export const PAYMENT_PROVIDERS = [
  { id: 'stripe', label: 'Stripe', capabilities: { cards: true, wallets: true, sepa: true, subscriptions: true, webhooks: true, portal: true }, requires: 'secret key + webhook signing secret, server-side' },
  { id: 'adyen', label: 'Adyen', capabilities: { cards: true, wallets: true, localMethods: true, subscriptions: true, webhooks: true }, requires: 'API key + HMAC key, server-side' },
  { id: 'paddle', label: 'Paddle', capabilities: { cards: true, merchantOfRecord: true, taxHandling: true, subscriptions: true }, requires: 'API key, server-side' },
  { id: 'manual', label: 'Manual / invoice', capabilities: { offline: true }, requires: 'nothing — recorded by hand and reconciled' }
];

/** Regional methods that any real deployment must cover, by market. */
export const REGIONAL_METHODS = [
  { region: 'EU', methods: ['SEPA Direct Debit', 'iDEAL', 'Bancontact', 'Sofort', 'cards'] },
  { region: 'IN', methods: ['UPI', 'NetBanking', 'RuPay', 'cards'] },
  { region: 'BR', methods: ['Pix', 'Boleto', 'cards'] },
  { region: 'CN', methods: ['Alipay', 'WeChat Pay', 'UnionPay'] },
  { region: 'PK', methods: ['local bank transfer', 'Easypaisa/JazzCash', 'cards'] },
  { region: 'US/CA', methods: ['cards', 'ACH', 'Interac'] },
  { region: 'SEA', methods: ['GrabPay', 'GoPay', 'PromptPay', 'cards'] }
];

/*
 * The authority rule, enforced in code.
 *
 * A payment status is only accepted when it arrives with evidence that a server
 * derived it from a provider — a webhook with a verified signature, or a
 * server-side reconciliation. A status that merely claims to be server-set is
 * rejected, because that claim is exactly what a tampered client would send.
 */
export const PAYMENT_STATUSES = ['requires_payment', 'processing', 'paid', 'failed', 'refunded', 'partially_refunded', 'disputed'];

export function applyPaymentUpdate({ update, currentStatus = 'requires_payment' } = {}) {
  if (!update) return { ok: false, reason: 'no-update', status: currentStatus };
  if (!PAYMENT_STATUSES.includes(update.status)) {
    return { ok: false, reason: 'unknown-status', status: currentStatus };
  }
  const trustedSources = ['webhook-verified', 'server-reconciliation', 'provider-api'];
  if (!trustedSources.includes(update.source)) {
    return {
      ok: false,
      reason: 'untrusted-source',
      status: currentStatus,
      note: 'Payment status is only accepted from a verified server origin. A value asserted by the client is ignored, even when it says "paid".'
    };
  }
  if (update.source === 'webhook-verified' && !update.signatureVerifiedAt) {
    return { ok: false, reason: 'unverified-signature', status: currentStatus };
  }
  // Paid is terminal without a refund; never silently replaced by a stale event.
  if ((currentStatus === 'refunded' || currentStatus === 'partially_refunded') && update.status === 'paid') {
    return { ok: false, reason: 'would-unsettle-refund', status: currentStatus };
  }
  return { ok: true, status: update.status, previous: currentStatus, at: update.at || new Date().toISOString(), source: update.source };
}

/**
 * Webhook signature verification — the reference implementation.
 *
 * THIS MUST RUN SERVER-SIDE. It is written here because it is the same
 * algorithm, it is testable against a known vector, and having it in the
 * codebase documents the contract. Shipping the signing secret to a browser
 * would defeat its entire purpose, so the client half is `applyPaymentUpdate`
 * refusing anything unsigned.
 */
export async function verifyWebhookSignature({ payload, signature, secret, algorithm = 'SHA-256' } = {}) {
  if (!payload || !signature || !secret) return { ok: false, reason: 'missing-input' };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = String(signature).trim().toLowerCase().replace(/^sha256=/, '');
  if (given.length !== expected.length) return { ok: false, reason: 'length-mismatch' };
  // Constant-time comparison: a length-independent early exit leaks the prefix.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? { ok: true, algorithm } : { ok: false, reason: 'signature-mismatch' };
}
