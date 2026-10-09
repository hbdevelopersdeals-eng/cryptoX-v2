import { describe, it, expect } from 'vitest';
import {
  PLANS, planById, hasEntitlement, entitlementGap, addMonthsClamped, periodFor, nextRenewal,
  trialState, prorate, evaluateCoupon, bestCoupon, usageCharge, DUNNING_SCHEDULE, nextRetry,
  classifyDecline, planRefund, PAYMENT_PROVIDERS, REGIONAL_METHODS, applyPaymentUpdate,
  verifyWebhookSignature, PAYMENT_STATUSES
} from './billing.js';
import {
  validateGstin, validateAbn, validateUkVat, validateCaBusinessNumber, verifyTaxId, taxIdSchemeFor,
  JURISDICTIONS, jurisdictionFor, resolveTax, allocateNumber, peekNumber, createSeries,
  issueCreditNote, invoiceBalance, appendFinancialEvent, accountingExport, jurisdictionCoverage
} from './tax.js';
import {
  POLICY_TYPES, publishPolicy, requiredAcceptances, acceptanceState, recordAcceptance,
  CONSENT_CATEGORIES, REQUIRED_CATEGORIES, DEFAULT_CONSENT, normaliseConsent, recordConsent,
  withdrawConsent, consentGranted, consentSummary, DSR_RULES, dsrRuleFor, createDsr, advanceDsr,
  dsrStatus, RETENTION_CLASSES, retentionFor, createLegalHold, activeHolds, isUnderHold,
  releaseHold, canDelete, purgeCandidates, REGULATED_SCOPE, COMPLIANCE_READINESS, complianceSummary
} from './compliance.js';

/* ---------------------------------------------------------------------------
 * Section 11 — Payments and billing
 * ------------------------------------------------------------------------ */

describe('plans and entitlements', () => {
  it('expresses limits as data rather than branching on a plan name', () => {
    expect(hasEntitlement('free', 'alerts', 5)).toBe(true);
    expect(hasEntitlement('free', 'alerts', 6)).toBe(false);
    expect(hasEntitlement('pro', 'alerts', 100)).toBe(true);
    expect(hasEntitlement('nope', 'alerts', 1)).toBe(false); // unknown plan denies
  });

  it('treats a null limit as unlimited, not as zero', () => {
    expect(hasEntitlement('enterprise', 'apiCallsPerMonth', 10 ** 9)).toBe(true);
    expect(planById('free').entitlements.bots).toBe(0);
    expect(hasEntitlement('free', 'bots', 0)).toBe(true);
    expect(hasEntitlement('free', 'bots', 1)).toBe(false);
  });

  it('names the limits a downgrade would reduce', () => {
    const gap = entitlementGap('team', 'pro', 'alerts');
    expect(gap.shrinking).toBe(true);
    expect(gap.note).toMatch(/Downgrade/);
    expect(entitlementGap('free', 'enterprise', 'alerts').unlimited).toBe(true);
  });
});

describe('billing periods across month ends', () => {
  it('clamps the 31st instead of sliding it forever', () => {
    // A subscription starting on the 31st bills on the 31st again in a month
    // that has one, not on the 28th for the rest of its life.
    const feb = addMonthsClamped('2026-01-31T00:00:00Z', 1, 31);
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28');
    const mar = addMonthsClamped('2026-01-31T00:00:00Z', 2, 31);
    expect(mar.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('handles a leap February', () => {
    expect(addMonthsClamped('2028-01-31T00:00:00Z', 1, 31).toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('finds the period containing a date and reports remaining days', () => {
    const period = periodFor({ start: '2026-01-15T00:00:00Z', cycle: 'monthly', at: '2026-01-25T00:00:00Z' });
    expect(period.index).toBe(0);
    expect(period.totalDays).toBe(31);
    expect(period.elapsedDays).toBeCloseTo(10, 6);
    expect(period.remainingDays).toBeCloseTo(21, 6);
  });

  it('advances to a later period rather than staying in the first forever', () => {
    const period = periodFor({ start: '2026-01-15T00:00:00Z', cycle: 'monthly', at: '2026-04-20T00:00:00Z' });
    expect(period.index).toBe(3);
    expect(period.from.toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(nextRenewal({ start: '2026-01-15T00:00:00Z', cycle: 'monthly', at: '2026-04-20T00:00:00Z' }).toISOString().slice(0, 10)).toBe('2026-05-15');
  });

  it('uses twelve months for an annual cycle', () => {
    const period = periodFor({ start: '2026-03-31T00:00:00Z', cycle: 'annual', at: '2026-06-01T00:00:00Z' });
    expect(period.to.toISOString().slice(0, 10)).toBe('2027-03-31');
  });
});

describe('trials', () => {
  it('runs for the plan trial length and reverts rather than continuing', () => {
    const at = new Date('2026-01-05T00:00:00Z');
    const t = trialState({ planId: 'pro', startedAt: '2026-01-01T00:00:00Z', at });
    expect(t.onTrial).toBe(true);
    expect(t.daysLeft).toBe(10);
    expect(t.onExpiry).toBe('revert-to-free');
  });

  it('reports expiry once past the window', () => {
    const t = trialState({ planId: 'pro', startedAt: '2026-01-01T00:00:00Z', at: new Date('2026-02-01T00:00:00Z') });
    expect(t.onTrial).toBe(false);
    expect(t.expired).toBe(true);
  });

  it('says so when a plan has no trial at all', () => {
    expect(trialState({ planId: 'free', startedAt: '2026-01-01T00:00:00Z' }).reason).toBe('no-trial-for-plan');
  });
});

describe('proration on a mid-cycle change', () => {
  it('credits unused time and charges the remainder', () => {
    const p = prorate({ fromPlanId: 'pro', toPlanId: 'team', cycle: 'monthly', subscriptionStart: '2026-01-01T00:00:00Z', at: '2026-01-21T00:00:00Z' });
    expect(p.ok).toBe(true);
    expect(p.direction).toBe('upgrade');
    // 11 of 31 days remain.
    expect(p.fraction).toBeCloseTo(11 / 31, 6);
    expect(p.credit).toBeCloseTo((29 * 11) / 31, 2);
    expect(p.charge).toBeCloseTo((99 * 11) / 31, 2);
    expect(p.net).toBeCloseTo(((99 - 29) * 11) / 31, 2);
    expect(p.dueNow).toBeCloseTo(p.net, 2);
    expect(p.accountCredit).toBe(0);
  });

  it('returns a credit rather than zero when the net is negative', () => {
    const p = prorate({ fromPlanId: 'team', toPlanId: 'pro', cycle: 'monthly', subscriptionStart: '2026-01-01T00:00:00Z', at: '2026-01-21T00:00:00Z' });
    expect(p.net).toBeLessThan(0);
    expect(p.dueNow).toBe(0);
    expect(p.accountCredit).toBeGreaterThan(0);
    expect(p.note).toMatch(/owed/);
  });

  it('refuses a contact-sales plan, which has no list price to prorate', () => {
    const p = prorate({ fromPlanId: 'pro', toPlanId: 'enterprise', cycle: 'monthly', subscriptionStart: '2026-01-01T00:00:00Z', at: '2026-01-21T00:00:00Z' });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('contact-sales-plan');
  });
});

describe('coupons', () => {
  const base = { code: 'SAVE20', percentOff: 20 };

  it('applies a percentage and never discounts below zero', () => {
    const r = evaluateCoupon({ coupon: base, subtotal: 100 });
    expect(r.ok).toBe(true);
    expect(r.discount).toBe(20);
    expect(r.total).toBe(80);
  });

  it('caps a fixed amount at the subtotal', () => {
    const r = evaluateCoupon({ coupon: { code: 'BIG', amountOff: 500 }, subtotal: 100 });
    expect(r.discount).toBe(100);
    expect(r.capped).toBe(true);
    expect(r.total).toBe(0);
  });

  it('refuses expired, revoked, below-minimum and currency-mismatched coupons', () => {
    expect(evaluateCoupon({ coupon: { ...base, revoked: true }, subtotal: 100 }).reason).toBe('revoked');
    expect(evaluateCoupon({ coupon: { ...base, expiresAt: '2020-01-01T00:00:00Z' }, subtotal: 100 }).reason).toBe('expired');
    expect(evaluateCoupon({ coupon: { ...base, minSubtotal: 200 }, subtotal: 100 }).reason).toBe('below-minimum');
    expect(evaluateCoupon({ coupon: { ...base, currency: 'EUR' }, subtotal: 100 }).reason).toBe('currency-mismatch');
    expect(evaluateCoupon({ coupon: { ...base, maxRedemptions: 5 }, subtotal: 100, redemptions: 5 }).reason).toBe('redemption-limit');
  });

  it('honours duration so a one-off coupon cannot repeat', () => {
    const once = { ...base, duration: 'once' };
    expect(evaluateCoupon({ coupon: once, subtotal: 100, cyclesSinceStart: 0 }).ok).toBe(true);
    expect(evaluateCoupon({ coupon: once, subtotal: 100, cyclesSinceStart: 1 }).reason).toBe('already-applied');
    const repeating = { ...base, duration: 'repeating', durationInCycles: 3 };
    expect(evaluateCoupon({ coupon: repeating, subtotal: 100, cyclesSinceStart: 2 }).ok).toBe(true);
    expect(evaluateCoupon({ coupon: repeating, subtotal: 100, cyclesSinceStart: 3 }).reason).toBe('duration-exhausted');
  });

  it('picks the single best coupon and does not stack by default', () => {
    const out = bestCoupon({
      coupons: [{ code: 'A', percentOff: 10 }, { code: 'B', amountOff: 35 }, { code: 'C', percentOff: 5 }],
      subtotal: 100
    });
    expect(out.applied).toEqual(['B']);
    expect(out.discount).toBe(35);
    expect(out.total).toBe(65);
  });
});

describe('usage-based pricing: graduated and volume are different', () => {
  const tiers = [{ upTo: 1000, rate: 0.10 }, { upTo: 10000, rate: 0.05 }, { upTo: Infinity, rate: 0.01 }];

  it('charges each tier only for the units inside it (graduated)', () => {
    const r = usageCharge({ units: 5000, tiers, mode: 'graduated' });
    // 1000*0.10 + 4000*0.05 = 100 + 200
    expect(r.amount).toBeCloseTo(300, 6);
    expect(r.breakdown).toHaveLength(2);
    expect(r.mode).toBe('graduated');
  });

  it('applies the landing tier rate to every unit (volume) — a different number', () => {
    const r = usageCharge({ units: 5000, tiers, mode: 'volume' });
    // 5000 * 0.05, NOT 300
    expect(r.amount).toBeCloseTo(250, 6);
    expect(r.mode).toBe('volume');
  });

  it('charges nothing for zero units even with a standing first tier', () => {
    expect(usageCharge({ units: 0, tiers, mode: 'volume' }).amount).toBe(0);
    expect(usageCharge({ units: 0, tiers, mode: 'graduated' }).amount).toBe(0);
  });

  it('refuses invalid input instead of guessing', () => {
    expect(usageCharge({ units: -1, tiers }).ok).toBe(false);
    expect(usageCharge({ units: 5, tiers: [] }).reason).toBe('no-tiers');
  });
});

describe('failed payments and dunning', () => {
  it('walks the retry schedule and stops at the end', () => {
    const first = nextRetry({ failedAt: '2026-01-01T00:00:00Z', attempts: 1 });
    expect(first.retry).toBe(true);
    expect(first.at.toISOString()).toBe('2026-01-04T00:00:00.000Z'); // +72h
    const last = nextRetry({ failedAt: '2026-01-01T00:00:00Z', attempts: DUNNING_SCHEDULE.length });
    expect(last.retry).toBe(false);
    expect(last.exhausted).toBe(true);
    expect(last.action).toBe('suspend-and-notify');
  });

  it('refuses to retry a card that can never succeed', () => {
    expect(classifyDecline('card_expired').retryable).toBe(false);
    expect(classifyDecline('card_expired').action).toBe('request-new-method');
    expect(classifyDecline('authentication_required').action).toBe('request-authentication');
    expect(classifyDecline('insufficient_funds').retryable).toBe(true);
    // An unknown code must not be blind-retried.
    expect(classifyDecline('who_knows').retryable).toBe(false);
    expect(classifyDecline('who_knows').action).toBe('manual-review');
  });
});

describe('refunds', () => {
  const invoice = { id: 'inv_1', number: 'INV-000001', currency: 'USD', total: 100, paid: 100, refunded: 0 };

  it('derives partial vs full rather than trusting the caller', () => {
    const partial = planRefund({ invoice, amount: 30, reason: 'goodwill' });
    expect(partial.ok).toBe(true);
    expect(partial.refund.kind).toBe('partial');
    expect(partial.available).toBe(70);

    const full = planRefund({ invoice, amount: 100 });
    expect(full.refund.kind).toBe('full');
  });

  it('never refunds more than was actually paid', () => {
    const r = planRefund({ invoice, amount: 150 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-paid');
    expect(r.available).toBe(100);
  });

  it('accounts for money already refunded', () => {
    const r = planRefund({ invoice: { ...invoice, refunded: 80 }, amount: 30 });
    expect(r.ok).toBe(false);
    expect(r.available).toBe(20);
  });

  it('defaults to the remaining balance when no amount is given', () => {
    const r = planRefund({ invoice: { ...invoice, refunded: 40 } });
    expect(r.refund.amount).toBe(60);
    expect(r.available).toBe(0);
  });

  it('refuses entirely when nothing is left', () => {
    expect(planRefund({ invoice: { ...invoice, refunded: 100 } }).reason).toBe('nothing-refundable');
  });
});

describe('payment status authority — the central rule', () => {
  it('IGNORES a paid status asserted by the client', () => {
    const r = applyPaymentUpdate({ update: { status: 'paid', source: 'client' } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('untrusted-source');
    // The status must not change, even though the update said "paid".
    expect(r.status).toBe('requires_payment');
  });

  it('ignores a status that merely claims to be server-set', () => {
    expect(applyPaymentUpdate({ update: { status: 'paid', source: 'server' } }).ok).toBe(false);
    expect(applyPaymentUpdate({ update: { status: 'paid', source: 'admin-ui' } }).ok).toBe(false);
  });

  it('accepts a verified webhook with a verification timestamp', () => {
    const r = applyPaymentUpdate({
      update: { status: 'paid', source: 'webhook-verified', signatureVerifiedAt: '2026-01-01T00:00:00Z' }
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('paid');
  });

  it('refuses a webhook that was never verified', () => {
    expect(applyPaymentUpdate({ update: { status: 'paid', source: 'webhook-verified' } }).reason).toBe('unverified-signature');
  });

  it('accepts server reconciliation and provider API reads', () => {
    expect(applyPaymentUpdate({ update: { status: 'failed', source: 'server-reconciliation' } }).ok).toBe(true);
    expect(applyPaymentUpdate({ update: { status: 'processing', source: 'provider-api' } }).ok).toBe(true);
  });

  it('will not un-settle a refunded invoice with a stale paid event', () => {
    const r = applyPaymentUpdate({
      currentStatus: 'refunded',
      update: { status: 'paid', source: 'server-reconciliation' }
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('would-unsettle-refund');
  });

  it('rejects an unknown status', () => {
    expect(applyPaymentUpdate({ update: { status: 'maybe', source: 'provider-api' } }).reason).toBe('unknown-status');
    expect(PAYMENT_STATUSES).toContain('partially_refunded');
  });
});

describe('webhook signature verification', () => {
  // Published HMAC-SHA256 vector (RFC-style example), so this is checked against
  // an external value rather than against itself.
  const payload = 'The quick brown fox jumps over the lazy dog';
  const secret = 'key';
  const known = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';

  it('matches a known HMAC-SHA256 vector', async () => {
    const r = await verifyWebhookSignature({ payload, signature: known, secret });
    expect(r.ok).toBe(true);
  });

  it('accepts the sha256= prefix providers send', async () => {
    const r = await verifyWebhookSignature({ payload, signature: `sha256=${known}`, secret });
    expect(r.ok).toBe(true);
  });

  it('rejects a tampered payload and a wrong secret', async () => {
    expect((await verifyWebhookSignature({ payload: `${payload}.`, signature: known, secret })).ok).toBe(false);
    expect((await verifyWebhookSignature({ payload, signature: known, secret: 'other' })).ok).toBe(false);
  });

  it('rejects malformed input instead of throwing', async () => {
    expect((await verifyWebhookSignature({ payload, signature: 'abc', secret })).reason).toBe('length-mismatch');
    expect((await verifyWebhookSignature({ payload, secret })).reason).toBe('missing-input');
  });
});

describe('provider and regional coverage', () => {
  it('names what each provider needs from a server', () => {
    PAYMENT_PROVIDERS.forEach((p) => expect(p.requires).toBeTruthy());
    expect(PAYMENT_PROVIDERS.find((p) => p.id === 'paddle').capabilities.merchantOfRecord).toBe(true);
  });

  it('covers the regional methods a global launch needs', () => {
    const regions = REGIONAL_METHODS.map((r) => r.region);
    ['EU', 'IN', 'BR', 'CN', 'PK'].forEach((r) => expect(regions).toContain(r));
  });
});

/* ---------------------------------------------------------------------------
 * Section 12 — Tax and financial infrastructure
 * ------------------------------------------------------------------------ */

describe('tax identifier checksums', () => {
  /*
   * These are CONSTRUCTED numbers that satisfy each published algorithm, not
   * real business registrations. The point is that the checksum maths is real.
   */
  it('validates an Indian GSTIN mod-36 checksum', () => {
    expect(validateGstin('27ABCDE1234F1Z0').ok).toBe(true);
    expect(validateGstin('27ABCDE1234F1Z1').reason).toBe('checksum');
    expect(validateGstin('27ABCDE1234F1').reason).toBe('format');
  });

  it('validates the ATO published sample ABN', () => {
    // 51 824 753 556 is the Australian Taxation Office's own published example.
    expect(validateAbn('51824753556').ok).toBe(true);
    expect(validateAbn('5182475355').reason).toBe('format');
    expect(validateAbn('51824753557').reason).toBe('checksum');
  });

  it('validates a UK VAT number mod-97', () => {
    expect(validateUkVat('GB123456715').ok).toBe(true);
    expect(validateUkVat('123456715').ok).toBe(true);
    expect(validateUkVat('GB123456716').reason).toBe('checksum');
  });

  it('validates a Canadian business number with Luhn', () => {
    expect(validateCaBusinessNumber('123456782').ok).toBe(true);
    expect(validateCaBusinessNumber('123456783').reason).toBe('checksum');
  });

  it('validates EU VAT by pattern and says it is format-only', () => {
    const r = verifyTaxId({ value: 'DE123456789', country: 'DE' });
    expect(r.ok).toBe(true);
    expect(r.coverage).toBe('format-only');
    expect(r.note).toMatch(/VIES|registry/);
    expect(verifyTaxId({ value: 'DE12345', country: 'DE' }).reason).toBe('format');
  });

  it('refuses to validate where no scheme exists', () => {
    expect(verifyTaxId({ value: '123', country: 'ZM' }).reason).toBe('no-scheme-for-country');
    expect(taxIdSchemeFor('ZM')).toBeNull();
  });

  it('always states that a checksum is not a registry check', () => {
    expect(verifyTaxId({ value: '27ABCDE1234F1Z0', country: 'IN' }).note).toMatch(/does not confirm/i);
  });
});

describe('tax rule resolution is configuration, not code', () => {
  it('applies the buyer jurisdiction rate on a domestic supply', () => {
    const r = resolveTax({ sellerCountry: 'DE', buyerCountry: 'DE' });
    expect(r.taxable).toBe(true);
    expect(r.rate).toBe(19);
    expect(r.reason).toBe('standard');
  });

  it('zero-rates a cross-border B2B supply with a verified tax ID', () => {
    const r = resolveTax({ sellerCountry: 'DE', buyerCountry: 'FR', buyer: { type: 'business', taxIdVerified: true } });
    expect(r.taxable).toBe(false);
    expect(r.reason).toBe('reverse-charge');
    expect(r.steps.join(' ')).toMatch(/reverse charge/i);
  });

  it('does NOT zero-rate a cross-border B2C supply', () => {
    const r = resolveTax({ sellerCountry: 'DE', buyerCountry: 'FR', buyer: { type: 'consumer' } });
    expect(r.taxable).toBe(true);
    expect(r.rate).toBe(20); // France
  });

  it('refuses to invent a US rate rather than sending 0 as if it were tax-free', () => {
    const r = resolveTax({ sellerCountry: 'US', buyerCountry: 'US' });
    expect(r.taxable).toBe(false);
    expect(r.reason).toBe('rate-must-be-set-locally');
    expect(r.confidence).toBe('none');
  });

  it('reports an unconfigured jurisdiction instead of assuming zero', () => {
    const r = resolveTax({ sellerCountry: 'GB', buyerCountry: 'ZM' });
    expect(r.reason).toBe('no-rate-configured');
    expect(r.confidence).toBe('none');
  });

  it('uses a reduced rate only when the product class allows it', () => {
    expect(resolveTax({ sellerCountry: 'DE', buyerCountry: 'DE', product: { reducedRate: 7 } }).rate).toBe(7);
    // 12 is not a German reduced rate, so the standard rate stands.
    expect(resolveTax({ sellerCountry: 'DE', buyerCountry: 'DE', product: { reducedRate: 12 } }).rate).toBe(19);
  });

  it('carries configuration confidence and flags which countries need local rates', () => {
    const cov = jurisdictionCoverage();
    expect(cov.configured).toBe(JURISDICTIONS.length);
    expect(cov.needingLocalRates).toContain('US');
    expect(jurisdictionFor('us').extra).toBeUndefined();
    expect(jurisdictionFor('us').note).toMatch(/locality/);
  });
});

describe('invoice numbering is gapless per series', () => {
  it('allocates in order without reusing a number', () => {
    let series = createSeries({ prefix: 'INV', year: 2026 });
    expect(peekNumber(series)).toBe('INV-2026-000001');
    const a = allocateNumber(series);
    series = a.series;
    expect(a.number).toBe('INV-2026-000001');
    expect(allocateNumber(series).number).toBe('INV-2026-000002');
  });

  it('separates series by jurisdiction so they cannot collide', () => {
    const de = allocateNumber(createSeries({ prefix: 'INV', country: 'DE', year: 2026 }));
    const fr = allocateNumber(createSeries({ prefix: 'INV', country: 'FR', year: 2026 }));
    expect(de.number).toBe('INV-DE-2026-000001');
    expect(fr.number).toBe('INV-FR-2026-000001');
  });

  it('is pure, so allocation only takes effect when the caller commits it', () => {
    const series = createSeries({ prefix: 'INV' });
    allocateNumber(series);
    expect(series.next).toBe(1); // unchanged
  });
});

describe('credit notes and balances', () => {
  const invoice = { id: 'inv_1', number: 'INV-000001', total: 120, paid: 120, credited: 0, currency: 'USD' };

  it('issues a credit note within the creditable balance', () => {
    const r = issueCreditNote({ invoice, amount: 20, reason: 'goodwill', series: createSeries({ prefix: 'CN' }) });
    expect(r.ok).toBe(true);
    expect(r.credit.number).toBe('CN-000001');
    expect(r.credit.remainingAfter).toBe(100);
  });

  it('refuses to credit more than remains, which is how a refund gets paid twice', () => {
    const r = issueCreditNote({ invoice: { ...invoice, credited: 100 }, amount: 50, reason: 'refund', series: createSeries({ prefix: 'CN' }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('exceeds-remaining');
    expect(r.remaining).toBe(20);
  });

  it('refuses an unknown reason and a currency mismatch', () => {
    expect(issueCreditNote({ invoice, amount: 5, reason: 'because', series: createSeries({}) }).reason).toBe('invalid-reason');
    expect(issueCreditNote({ invoice, amount: 5, reason: 'refund', currency: 'EUR', series: createSeries({}) }).reason).toBe('currency-mismatch');
  });

  it('reports a settled balance and surfaces an overpayment rather than clamping it', () => {
    expect(invoiceBalance({ total: 100, paid: 100 }).settled).toBe(true);
    const over = invoiceBalance({ total: 100, paid: 130 });
    expect(over.overpaid).toBe(true);
    expect(over.balance).toBe(-30);
    expect(over.settled).toBe(false);
  });
});

describe('financial audit trail and accounting export', () => {
  it('is append-only and refuses an unknown event', () => {
    const log = [];
    const a = appendFinancialEvent(log, { action: 'invoice.created', actorId: 'u1' });
    expect(a.ok).toBe(true);
    const b = appendFinancialEvent(a.log, { action: 'invoice.deleted' });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('unknown-event');
    expect(b.log).toBe(a.log); // unchanged
  });

  it('freezes entries so a trail cannot be edited after the fact', () => {
    const out = appendFinancialEvent([], { action: 'invoice.paid' });
    expect(Object.isFrozen(out.entry)).toBe(true);
  });

  it('bounds the log rather than growing without limit', () => {
    let log = [];
    for (let i = 0; i < 5; i += 1) log = appendFinancialEvent(log, { action: 'invoice.created' }, { limit: 3 }).log;
    expect(log).toHaveLength(3);
  });

  it('exports money as decimal strings, never floats', () => {
    const out = accountingExport({
      invoices: [{ number: 'INV-1', issuedAt: '2026-01-01T00:00:00Z', currency: 'USD', net: 100, tax: 19, total: 119, paid: 119, taxCountry: 'DE', taxRate: 19 }],
      credits: [{ number: 'CN-1', issuedAt: '2026-01-02T00:00:00Z', currency: 'USD', amount: 19 }]
    });
    expect(out.text).toMatch(/119\.00/);
    expect(out.text).toMatch(/-19\.00/); // credit notes are negative
    expect(out.rows[0].net).toBe('100.00');
  });

  it('sorts the export by date so a ledger reconciles', () => {
    const out = accountingExport({
      invoices: [
        { number: 'B', issuedAt: '2026-02-01T00:00:00Z', total: 1 },
        { number: 'A', issuedAt: '2026-01-01T00:00:00Z', total: 1 }
      ]
    });
    expect(out.rows.map((r) => r.number)).toEqual(['A', 'B']);
  });
});

/* ---------------------------------------------------------------------------
 * Section 13 — Global compliance
 * ------------------------------------------------------------------------ */

describe('policies and acceptance', () => {
  const v1 = publishPolicy({ type: 'terms', version: '1.0', effectiveAt: '2026-01-01T00:00:00Z' }).policy;
  const v2 = publishPolicy({ type: 'terms', version: '2.0', effectiveAt: '2026-06-01T00:00:00Z' }).policy;

  it('requires only the newest effective version of each type', () => {
    const required = requiredAcceptances({ policies: [v1, v2], at: new Date('2026-07-01T00:00:00Z') });
    expect(required.map((p) => p.id)).toEqual(['terms@2.0']);
  });

  it('does not treat a scheduled policy as binding yet', () => {
    const required = requiredAcceptances({ policies: [v1, v2], at: new Date('2026-03-01T00:00:00Z') });
    expect(required.map((p) => p.id)).toEqual(['terms@1.0']);
  });

  it('does NOT carry an acceptance of v1 over to v2', () => {
    const acceptances = [recordAcceptance({ policyId: 'terms@1.0', userId: 'u1' }).acceptance];
    const state = acceptanceState({ policies: [v1, v2], acceptances, at: new Date('2026-07-01T00:00:00Z') });
    expect(state.satisfied).toBe(false);
    expect(state.outstanding).toEqual(['terms@2.0']);
  });

  it('records acceptance with evidence, because consent must be demonstrable', () => {
    const a = recordAcceptance({ policyId: 'terms@2.0', userId: 'u1', evidence: { userAgent: 'test' } }).acceptance;
    expect(a.acceptedAt).toBeTruthy();
    expect(a.evidence.userAgent).toBe('test');
    expect(a.withdrawnAt).toBeNull();
  });

  it('hides business-only documents from consumers', () => {
    const dpa = publishPolicy({ type: 'dpa', version: '1.0', effectiveAt: '2026-01-01T00:00:00Z' }).policy;
    const forConsumer = requiredAcceptances({ policies: [dpa], at: new Date('2026-07-01T00:00:00Z'), isBusiness: false });
    expect(forConsumer).toHaveLength(0);
  });
});

describe('consent', () => {
  it('forces strictly-necessary categories on and drops unknown keys', () => {
    const n = normaliseConsent({ necessary: false, analytics: true, tracking: true });
    expect(n.necessary).toBe(true);
    expect(n.analytics).toBe(true);
    expect(n.tracking).toBeUndefined();
    expect(n.marketing).toBe(false); // off unless explicitly granted
  });

  it('defaults marketing and analytics to OFF, and says why that matters', () => {
    expect(DEFAULT_CONSENT.analytics).toBe(false);
    expect(DEFAULT_CONSENT.marketing).toBe(false);
    expect(REQUIRED_CATEGORIES).toEqual(['necessary']);
    expect(CONSENT_CATEGORIES.length).toBe(4);
  });

  it('binds the record to a policy version so a change is detectable', () => {
    const { record } = recordConsent({ selection: { analytics: true }, policyVersion: 'privacy@2.0' });
    expect(record.policyVersion).toBe('privacy@2.0');
    expect(record.changed).toEqual(['analytics']);
  });

  it('withdraws immediately and never asks for a reason', () => {
    const w = withdrawConsent({ current: { ...DEFAULT_CONSENT, marketing: true }, category: 'marketing' });
    expect(w.ok).toBe(true);
    expect(w.state.marketing).toBe(false);
    expect(w.immediate).toBe(true);
    expect(w).not.toHaveProperty('reason');
  });

  it('refuses to withdraw a required category and points at the real route', () => {
    const w = withdrawConsent({ category: 'necessary' });
    expect(w.ok).toBe(false);
    expect(w.reason).toBe('required-category');
    expect(w.note).toMatch(/closing the account/i);
  });

  it('answers whether a category is actually permitted', () => {
    const state = normaliseConsent({ analytics: true });
    expect(consentGranted(state, 'necessary')).toBe(true);
    expect(consentGranted(state, 'analytics')).toBe(true);
    expect(consentGranted(state, 'marketing')).toBe(false);
    expect(consentGranted(state, 'nonsense')).toBe(false);
    expect(consentSummary(state)).toHaveLength(4);
  });
});

describe('data-subject requests', () => {
  it('uses the jurisdiction response window, which is not always 30 days', () => {
    expect(dsrRuleFor('gdpr').days).toBe(30);
    expect(dsrRuleFor('ccpa').days).toBe(45);
    expect(dsrRuleFor('lgpd').days).toBe(15);
    expect(dsrRuleFor('unknown').label).toMatch(/No specific rule/);
  });

  it('sets the due date from the rule in force', () => {
    const { request } = createDsr({ type: 'export', userId: 'u1', jurisdiction: 'ccpa', at: new Date('2026-01-01T00:00:00Z') });
    expect(request.dueAt.slice(0, 10)).toBe('2026-02-15');
  });

  it('refuses an unknown request type', () => {
    expect(createDsr({ type: 'guess', userId: 'u1' }).reason).toBe('unknown-type');
  });

  it('enforces legal transitions and cannot move backwards', () => {
    const { request } = createDsr({ type: 'deletion', userId: 'u1', jurisdiction: 'gdpr' });
    const skipped = advanceDsr({ request, nextState: 'completed' });
    expect(skipped.ok).toBe(false);
    expect(skipped.reason).toBe('illegal-transition');

    const verified = advanceDsr({ request, nextState: 'verifying' });
    expect(verified.ok).toBe(true);
    const back = advanceDsr({ request: verified.request, nextState: 'received' });
    expect(back.ok).toBe(false);
  });

  it('allows one justified extension and refuses a second', () => {
    const { request } = createDsr({ type: 'access', userId: 'u1', jurisdiction: 'gdpr', at: new Date('2026-01-01T00:00:00Z') });
    const ext = advanceDsr({ request, nextState: 'verifying', extensionReason: 'complex request' });
    expect(ext.ok).toBe(true);
    // Received 1 Jan + 30 days = 31 Jan, extended by the full 60 days = 1 Apr.
    expect(ext.request.dueAt.slice(0, 10)).toBe('2026-04-01');
    const twice = advanceDsr({ request: ext.request, nextState: 'processing', extensionReason: 'again' });
    expect(twice.ok).toBe(false);
    expect(twice.reason).toBe('extension-already-used');
  });

  it('refuses an extension where the jurisdiction does not allow one', () => {
    const { request } = createDsr({ type: 'access', userId: 'u1', jurisdiction: 'lgpd' });
    const r = advanceDsr({ request, nextState: 'verifying', extensionReason: 'busy' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('extension-not-available');
  });

  it('flags an overdue request but not a closed one', () => {
    const { request } = createDsr({ type: 'access', userId: 'u1', jurisdiction: 'appi', at: new Date('2026-01-01T00:00:00Z') });
    expect(dsrStatus({ request, at: new Date('2026-02-01T00:00:00Z') }).overdue).toBe(true);
    const done = advanceDsr({ request: advanceDsr({ request, nextState: 'verifying' }).request, nextState: 'processing' });
    const closed = advanceDsr({ request: done.request, nextState: 'completed' });
    expect(dsrStatus({ request: closed.request, at: new Date('2027-01-01T00:00:00Z') }).overdue).toBe(false);
  });
});

describe('retention and legal hold', () => {
  it('keeps tax records beyond what a user can delete', () => {
    const block = canDelete({ retentionClass: 'financial' });
    expect(block.allowed).toBe(false);
    expect(block.reason).toBe('legal-retention');
    expect(retentionFor('financial').days).toBeGreaterThan(2000);
  });

  it('allows deletion of consent-backed data', () => {
    expect(canDelete({ retentionClass: 'location' }).allowed).toBe(true);
  });

  it('blocks deletion of anything under hold, including an erasure request', () => {
    const { hold } = createLegalHold({ scope: 'account', reason: 'litigation hold 2026-04' });
    const blocked = canDelete({ holds: [hold], retentionClass: 'account' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('legal-hold');
    expect(activeHolds([hold])).toHaveLength(1);
    expect(isUnderHold([hold], 'account')).toBe(true);
    expect(isUnderHold([hold], 'usage')).toBe(false);
  });

  it('requires a reason to place a hold and a reason to lift one', () => {
    expect(createLegalHold({ scope: 'account' }).reason).toBe('reason-required');
    const { hold } = createLegalHold({ scope: 'account', reason: 'investigation' });
    expect(releaseHold({ hold }).reason).toBe('release-reason-required');
    const released = releaseHold({ hold, reason: 'matter closed' });
    expect(released.ok).toBe(true);
    expect(activeHolds([released.hold])).toHaveLength(0);
    expect(canDelete({ holds: [released.hold], retentionClass: 'account' }).allowed).toBe(true);
  });

  it('sets a review date so a hold cannot become permanent by neglect', () => {
    const { hold } = createLegalHold({ scope: '*', reason: 'regulator request' });
    expect(hold.reviewAt).toBeTruthy();
    expect(isUnderHold([hold], 'anything')).toBe(true); // wildcard scope
  });

  it('selects only records past their class retention', () => {
    const at = new Date('2026-06-01T00:00:00Z');
    const candidates = purgeCandidates({
      at,
      records: [
        { id: 'old', retentionClass: 'location', createdAt: '2025-01-01T00:00:00Z' }, // 90d
        { id: 'fresh', retentionClass: 'location', createdAt: '2026-05-30T00:00:00Z' },
        { id: 'unknown-class', retentionClass: 'nope', createdAt: '2020-01-01T00:00:00Z' }
      ]
    });
    expect(candidates.map((r) => r.id)).toEqual(['old']);
  });
});

describe('regulated activity is declared, not faked', () => {
  it('marks KYC, AML and sanctions screening as requiring a server', () => {
    const byItem = Object.fromEntries(REGULATED_SCOPE.map((r) => [r.item, r]));
    expect(byItem['KYC (identity verification)'].status).toBe('server-only');
    expect(byItem['Sanctions and PEP screening'].status).toBe('server-only');
    expect(byItem['AML transaction monitoring'].status).toBe('server-only');
    REGULATED_SCOPE.forEach((r) => expect(r.why).toBeTruthy());
  });

  it('marks licensing as a legal question rather than a code task', () => {
    const licensing = REGULATED_SCOPE.find((r) => r.item === 'Licensing and registration');
    expect(licensing.status).toBe('not-applicable');
    expect(licensing.why).toMatch(/legal question/);
  });

  it('separates what is built from what each framework still needs', () => {
    const gdpr = COMPLIANCE_READINESS.find((f) => f.framework.startsWith('GDPR'));
    expect(gdpr.built.length).toBeGreaterThan(4);
    expect(gdpr.needs).toContain('DPO appointment and EU representative');
    COMPLIANCE_READINESS.forEach((f) => {
      expect(f.built.length).toBeGreaterThan(0);
      expect(f.needs.length).toBeGreaterThan(0);
    });
  });

  it('summarises coverage without overstating it', () => {
    const s = complianceSummary();
    expect(s.policies).toBe(POLICY_TYPES.length);
    expect(s.requiredCategories).toBe(1);
    expect(s.regulated['server-only']).toBeGreaterThan(0);
  });
});
