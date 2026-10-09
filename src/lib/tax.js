/* Tax configuration, jurisdiction rules and business tax identifiers.
 *
 * DESIGN RULE (from the brief): jurisdiction rules are CONFIGURATION, not code.
 * Nothing here branches on a country name. Adding a country is a row in
 * JURISDICTIONS plus, at most, a validator id.
 *
 * RATE HONESTY: the `standardRate` values are starting configuration, not
 * authoritative tax law. Rates change by legislation, some countries run several
 * rates by product class, and several US states tax by locality rather than
 * state. Treat every rate as needing maintenance, and never present one as
 * verified. `verifyTaxId` proves format and checksum only — it is not a
 * substitute for VIES or a government registry lookup.
 */

/* ---------------------------------------------------------------------------
 * Tax identifiers — real checksums where a published algorithm exists
 * ------------------------------------------------------------------------ */

/** India GSTIN: 15 chars, final character is a mod-36 check digit. */
export function validateGstin(value) {
  const v = String(value || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v)) {
    return { ok: false, reason: 'format' };
  }
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const char = v[i];
    const value36 = alphabet.indexOf(char);
    if (value36 < 0) return { ok: false, reason: 'format' };
    // Alternate factors 1 and 2, then take the digit sum of the product.
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value36 * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = alphabet[(36 - (sum % 36)) % 36];
  return check === v[14] ? { ok: true } : { ok: false, reason: 'checksum' };
}

/** Australia ABN: 11 digits, weighted mod-89 with the first digit reduced by 1. */
export function validateAbn(value) {
  const v = String(value || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(v)) return { ok: false, reason: 'format' };
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const digit = Number(v[i]) - (i === 0 ? 1 : 0);
    sum += digit * weights[i];
  }
  return sum % 89 === 0 ? { ok: true } : { ok: false, reason: 'checksum' };
}

/**
 * UK VAT: 9 digits (or 12 with a 3-digit branch suffix).
 * The standard form uses a mod-97 check where 97 is subtracted from the
 * weighted total of the first seven digits.
 */
export function validateUkVat(value) {
  const v = String(value || '').replace(/[\s-]/g, '').toUpperCase().replace(/^GB/, '');
  if (!/^\d{9}(\d{3})?$/.test(v)) return { ok: false, reason: 'format' };
  const digits = v.slice(0, 9);
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let total = 0;
  for (let i = 0; i < 7; i += 1) total += Number(digits[i]) * weights[i];
  // The last two digits are the check value.
  const check = Number(digits.slice(7, 9));
  let remainder = total % 97;
  if (remainder !== check) {
    // The published algorithm also allows a second check with 55 added.
    remainder = (total + 55) % 97;
    if (remainder !== check) return { ok: false, reason: 'checksum' };
  }
  return { ok: true };
}

/** Canada: 9-digit business number validated with the Luhn algorithm. */
export function validateCaBusinessNumber(value) {
  const v = String(value || '').replace(/\D/g, '').slice(0, 9);
  if (!/^\d{9}$/.test(v)) return { ok: false, reason: 'format' };
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let digit = Number(v[i]) * (i % 2 === 0 ? 1 : 2);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0 ? { ok: true } : { ok: false, reason: 'checksum' };
}

/**
 * EU member states: FORMAT only, per the published national patterns.
 * Full validation requires the EU VIES service, which is a server-side call —
 * claiming otherwise would be the kind of false assurance that gets an invoice
 * rejected months later.
 */
const EU_VAT_PATTERNS = {
  AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/,
  ES: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/, FI: /^FI\d{8}$/, FR: /^FR[0-9A-Z]{2}\d{9}$/,
  GR: /^EL\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE(\d[A-Z0-9]\d{5}[A-Z]|\d{7}[A-Z]{1,2})$/,
  IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/, SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/
};

export const VAT_ID_VALIDATORS = {
  in_gstin: { label: 'GSTIN (India)', validate: validateGstin, coverage: 'checksum' },
  au_abn: { label: 'ABN (Australia)', validate: validateAbn, coverage: 'checksum' },
  uk_vat: { label: 'VAT number (United Kingdom)', validate: validateUkVat, coverage: 'checksum' },
  ca_bn: { label: 'Business Number (Canada)', validate: validateCaBusinessNumber, coverage: 'checksum' },
  eu_vat: {
    label: 'VAT number (EU)',
    coverage: 'format-only',
    validate: (value, country) => {
      const pattern = EU_VAT_PATTERNS[String(country || '').toUpperCase()];
      if (!pattern) return { ok: false, reason: 'no-pattern-for-country' };
      const v = String(value || '').replace(/[\s-]/g, '').toUpperCase();
      return pattern.test(v) ? { ok: true } : { ok: false, reason: 'format' };
    }
  }
};

/** Which validator applies to a jurisdiction, if any. */
export function taxIdSchemeFor(country) {
  const c = String(country || '').toUpperCase();
  if (c === 'IN') return 'in_gstin';
  if (c === 'AU') return 'au_abn';
  if (c === 'GB') return 'uk_vat';
  if (c === 'CA') return 'ca_bn';
  if (EU_VAT_PATTERNS[c]) return 'eu_vat';
  return null;
}

/**
 * Validate a tax identifier, refusing when no scheme exists rather than
 * returning a hopeful `true`.
 */
export function verifyTaxId({ value, country, scheme = null } = {}) {
  const id = scheme || taxIdSchemeFor(country);
  if (!id) return { ok: false, reason: 'no-scheme-for-country', scheme: null };
  const validator = VAT_ID_VALIDATORS[id];
  if (!validator) return { ok: false, reason: 'unknown-scheme', scheme: null };
  const result = validator.validate(value, country);
  return {
    ...result,
    scheme: id,
    coverage: validator.coverage,
    // Stated on every result so no caller can mistake this for a registry check.
    note: validator.coverage === 'checksum'
      ? 'Format and checksum verified locally. This does not confirm the business exists or is registered.'
      : 'Format verified against the published national pattern only. Confirming registration needs VIES or the national registry.'
  };
}

/* ---------------------------------------------------------------------------
 * Jurisdictions
 * ------------------------------------------------------------------------ */

export const TAX_TYPES = [
  { id: 'vat', label: 'VAT', note: 'Value Added Tax — charged on the value added at each stage.' },
  { id: 'gst', label: 'GST', note: 'Goods and Services Tax.' },
  { id: 'sales-tax', label: 'Sales tax', note: 'Collected at the point of sale; often set below national level.' },
  { id: 'none', label: 'No indirect tax configured', note: 'Not a claim that no tax applies — only that none is configured here.' }
];

/*
 * Starting configuration. `standardRate` is a percentage, `reduced` an optional
 * list of exceptions a product class can opt into.
 */
export const JURISDICTIONS = [
  { country: 'GB', type: 'vat', standardRate: 20, reduced: [5, 0], inclusiveByDefault: true, scheme: 'uk_vat' },
  { country: 'DE', type: 'vat', standardRate: 19, reduced: [7], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'FR', type: 'vat', standardRate: 20, reduced: [10, 5.5, 2.1], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'ES', type: 'vat', standardRate: 21, reduced: [10, 4], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'IT', type: 'vat', standardRate: 22, reduced: [10, 5, 4], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'NL', type: 'vat', standardRate: 21, reduced: [9], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'IE', type: 'vat', standardRate: 23, reduced: [13.5, 9, 4.8], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'PL', type: 'vat', standardRate: 23, reduced: [8, 5], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'SE', type: 'vat', standardRate: 25, reduced: [12, 6], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'PT', type: 'vat', standardRate: 23, reduced: [13, 6], inclusiveByDefault: true, scheme: 'eu_vat' },
  { country: 'IN', type: 'gst', standardRate: 18, reduced: [12, 5, 0], inclusiveByDefault: true, scheme: 'in_gstin' },
  { country: 'AU', type: 'gst', standardRate: 10, reduced: [], inclusiveByDefault: true, scheme: 'au_abn' },
  { country: 'NZ', type: 'gst', standardRate: 15, reduced: [], inclusiveByDefault: true },
  { country: 'SG', type: 'gst', standardRate: 9, reduced: [], inclusiveByDefault: true },
  { country: 'CA', type: 'gst', standardRate: 5, reduced: [], inclusiveByDefault: false, scheme: 'ca_bn', note: 'Federal GST only; provincial taxes are set separately.' },
  { country: 'JP', type: 'sales-tax', standardRate: 10, reduced: [8], inclusiveByDefault: false },
  { country: 'KR', type: 'vat', standardRate: 10, reduced: [], inclusiveByDefault: true },
  { country: 'ZA', type: 'vat', standardRate: 15, reduced: [], inclusiveByDefault: true },
  { country: 'AE', type: 'vat', standardRate: 5, reduced: [], inclusiveByDefault: false },
  { country: 'SA', type: 'vat', standardRate: 15, reduced: [], inclusiveByDefault: false },
  { country: 'PK', type: 'sales-tax', standardRate: 18, reduced: [], inclusiveByDefault: false, note: 'Provincial rates differ; verify per province before invoicing.' },
  { country: 'US', type: 'sales-tax', standardRate: 0, reduced: [], inclusiveByDefault: false, note: 'No national rate. Sales tax is set by state and often by locality, so a single figure would be wrong. Configure per state.' },
  { country: 'BR', type: 'vat', standardRate: 17, reduced: [], inclusiveByDefault: true, note: 'ICMS is state-level; this is a placeholder to be replaced per state.' }
];

export const jurisdictionFor = (country) =>
  JURISDICTIONS.find((j) => j.country === String(country || '').toUpperCase()) || null;

/** How many jurisdictions carry a real configuration, for coverage reporting. */
export const jurisdictionCoverage = () => ({
  configured: JURISDICTIONS.length,
  withChecksummedId: JURISDICTIONS.filter((j) => j.scheme && VAT_ID_VALIDATORS[j.scheme]?.coverage === 'checksum').length,
  needingLocalRates: JURISDICTIONS.filter((j) => j.note).map((j) => j.country)
});

/* ---------------------------------------------------------------------------
 * Rule resolution
 * ------------------------------------------------------------------------ */

/**
 * Resolve the tax treatment for a transaction.
 *
 * The cross-border rules encoded here are the common EU/UK B2B reverse-charge
 * pattern and the zero-rating of exports. They are NOT universal — the United
 * States has no national reverse charge, and digital-goods rules differ by
 * country. Each decision carries the reason it was reached so a reviewer can
 * disagree with a specific step rather than the whole number.
 */
export function resolveTax({ sellerCountry, buyerCountry, buyer, product = {} } = {}) {
  const seller = String(sellerCountry || '').toUpperCase();
  const buyerC = String(buyerCountry || '').toUpperCase();
  const isBusiness = buyer?.type === 'business';
  const steps = [];

  if (!buyerC) return { taxable: false, rate: 0, jurisdiction: null, reason: 'buyer-country-unknown', steps, confidence: 'none' };
  const jurisdiction = jurisdictionFor(buyerC);

  if (seller && buyerC !== seller) {
    // Cross-border. A registered business buyer in another jurisdiction
    // generally self-accounts.
    if (isBusiness && buyer.taxIdVerified) {
      steps.push('Cross-border B2B with a verified tax ID: reverse charge, zero-rated by the seller.');
      return { taxable: false, rate: 0, jurisdiction, reason: 'reverse-charge', steps, confidence: 'medium' };
    }
    if (product.digital === false && product.exported !== false) {
      steps.push('Goods exported: zero-rated in the seller jurisdiction.');
      return { taxable: false, rate: 0, jurisdiction, reason: 'export-zero-rated', steps, confidence: 'medium' };
    }
    steps.push('Cross-border digital supply: tax is generally due where the customer is, so the buyer jurisdiction rate applies.');
  } else {
    steps.push('Domestic supply: the seller jurisdiction rate applies.');
  }

  if (!jurisdiction || jurisdiction.type === 'none' || (!jurisdiction.standardRate && jurisdiction.standardRate !== 0)) {
    steps.push('No rate is configured for the buyer jurisdiction.');
    return { taxable: false, rate: 0, jurisdiction, reason: 'no-rate-configured', steps, confidence: 'none' };
  }

  if (jurisdiction.standardRate === 0) {
    steps.push(`${buyerC} has no single national rate configured — set it per state before invoicing.`);
    return { taxable: false, rate: 0, jurisdiction, reason: 'rate-must-be-set-locally', steps, confidence: 'none' };
  }

  const rate = product.reducedRate != null && jurisdiction.reduced?.includes(product.reducedRate)
    ? product.reducedRate
    : jurisdiction.standardRate;
  steps.push(`Applied ${rate}% (${jurisdiction.type.toUpperCase()}).`);

  return {
    taxable: true,
    rate,
    jurisdiction,
    reason: 'standard',
    inclusive: product.inclusive ?? jurisdiction.inclusiveByDefault,
    steps,
    confidence: 'configured'
  };
}

/* ---------------------------------------------------------------------------
 * Invoice numbering
 * ------------------------------------------------------------------------ */

/**
 * Gapless invoice numbering, which several jurisdictions require.
 *
 * The sequence is per series, never derived from a count of existing rows —
 * deleting an invoice must not free its number for reuse.
 */
export function createSeries({ prefix = 'INV', country = null, year = null, padding = 6, next = 1 } = {}) {
  return { prefix, country: country ? String(country).toUpperCase() : null, year, padding, next };
}

export function peekNumber(series) {
  const parts = [series.prefix];
  if (series.country) parts.push(series.country);
  if (series.year) parts.push(String(series.year));
  return `${parts.join('-')}-${String(series.next).padStart(series.padding, '0')}`;
}

/** Allocate the next number. Returns the new series so the caller must commit it. */
export function allocateNumber(series) {
  const number = peekNumber(series);
  return { number, series: { ...series, next: series.next + 1 } };
}

/* ---------------------------------------------------------------------------
 * Credit notes and refund records
 * ------------------------------------------------------------------------ */

export const CREDIT_NOTE_REASONS = ['refund', 'correction', 'goodwill', 'chargeback-reversal', 'discount-applied-after-invoice'];

/**
 * A credit note must never exceed what remains creditable on the invoice.
 * Over-crediting is how a refund gets paid twice.
 */
export function issueCreditNote({ invoice, amount, reason, series, currency = null, now = new Date() } = {}) {
  if (!invoice) return { ok: false, reason: 'no-invoice' };
  if (!CREDIT_NOTE_REASONS.includes(reason)) return { ok: false, reason: 'invalid-reason' };
  const total = Number(invoice.total);
  if (!Number.isFinite(total)) return { ok: false, reason: 'invoice-total-invalid' };
  if (invoice.currency && currency && invoice.currency !== currency) {
    return { ok: false, reason: 'currency-mismatch' };
  }
  const already = Number(invoice.credited || 0);
  const requested = Number(amount);
  if (!(requested > 0)) return { ok: false, reason: 'amount-must-be-positive' };

  const remaining = round2(total - already);
  if (requested > remaining) {
    return { ok: false, reason: 'exceeds-remaining', remaining, requested };
  }

  const { number, series: nextSeries } = allocateNumber(series);
  const credit = {
    id: `cn_${number}`,
    number,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amount: round2(requested),
    currency: invoice.currency || currency,
    reason,
    issuedAt: now.toISOString(),
    // Totals after this note, so the invoice's creditable balance never has to
    // be recomputed from a list that might be paged.
    creditedAfter: round2(already + requested),
    remainingAfter: round2(remaining - requested)
  };
  return { ok: true, credit, series: nextSeries };
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Outstanding balance on an invoice, refusing to go negative silently. */
export function invoiceBalance(invoice) {
  if (!invoice) return null;
  const paid = Number(invoice.paid || 0);
  const credited = Number(invoice.credited || 0);
  const total = Number(invoice.total || 0);
  const balance = round2(total - paid - credited);
  return {
    total: round2(total),
    paid: round2(paid),
    credited: round2(credited),
    balance,
    settled: Math.abs(balance) < 0.005,
    // A negative balance is an overpayment, which is real and must be surfaced
    // rather than clamped to zero.
    overpaid: balance < -0.005
  };
}

/* ---------------------------------------------------------------------------
 * Financial audit trail and accounting export
 * ------------------------------------------------------------------------ */

export const FINANCIAL_EVENTS = [
  'invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.voided',
  'credit_note.issued', 'refund.requested', 'refund.settled', 'payment.failed', 'payment.retried',
  'tax.rate_changed', 'tax_id.verified', 'subscription.changed', 'pricing.overridden'
];

/** Append-only. Unknown events are refused rather than silently stored. */
export function appendFinancialEvent(log = [], event, { limit = 2000 } = {}) {
  if (!FINANCIAL_EVENTS.includes(event.action)) {
    return { ok: false, reason: 'unknown-event', log };
  }
  const entry = Object.freeze({
    id: `fin_${log.length + 1}_${Date.now()}`,
    at: new Date().toISOString(),
    ...event
  });
  const next = [...log, entry];
  return { ok: true, entry, log: next.length > limit ? next.slice(next.length - limit) : next };
}

/**
 * Accounting export.
 *
 * Amounts are exported as exact decimal STRINGS. A CSV that carries money as a
 * float loses cents at scale, and the loss is invisible until a reconciliation
 * fails months later.
 */
export function accountingExport({ invoices = [], credits = [], format = 'csv' } = {}) {
  const rows = [
    ...invoices.map((i) => ({
      type: 'invoice', number: i.number, date: (i.issuedAt || '').slice(0, 10),
      currency: i.currency, net: money(i.net), tax: money(i.tax), total: money(i.total),
      paid: money(i.paid), taxJurisdiction: i.taxCountry || '', taxRate: i.taxRate ?? ''
    })),
    ...credits.map((c) => ({
      type: 'credit_note', number: c.number, date: (c.issuedAt || '').slice(0, 10),
      currency: c.currency, net: money(-c.amount), tax: '', total: money(-c.amount),
      paid: '', taxJurisdiction: '', taxRate: ''
    }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (format === 'json') return { ok: true, format, rows };
  const header = 'type,number,date,currency,net,tax,total,paid,tax_jurisdiction,tax_rate';
  const body = rows.map((r) => [
    r.type, r.number, r.date, r.currency, r.net, r.tax, r.total, r.paid, r.taxJurisdiction, r.taxRate
  ].join(',')).join('\n');
  return { ok: true, format: 'csv', text: `${header}\n${body}` , rows };
}

const money = (n) => (n == null || n === '' ? '' : Number(n).toFixed(2));
