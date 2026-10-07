/* Pricing: multi-currency price books, display vs settlement currency, tax
 * treatment and rounding order.
 *
 * Two mistakes this module is built to prevent:
 *
 *  1. Tax applied the wrong way. For a tax-INCLUSIVE price the rate divides,
 *     it does not multiply: net = gross / (1 + rate). Multiplying gives a gross
 *     that is too large and a tax figure that is too small — silently, and on
 *     every line of every invoice.
 *
 *  2. Rounding before converting. Rounding to the settlement currency's minor
 *     unit and then converting compounds the rounding error and can make a line
 *     total disagree with the invoice total. Convert first, then round to the
 *     DISPLAY currency's minor unit.
 */

import { currencyByCode, decimalsFor, currenciesForCountry, defaultCurrencyFor } from './currencies.js';
import { convert, roundToCurrency } from './rates.js';

export const TAX_MODES = [
  { id: 'exclusive', label: 'Tax added at checkout', note: 'The listed price excludes tax; tax is added on top.' },
  { id: 'inclusive', label: 'Tax included in price', note: 'The listed price already contains tax; it is shown split out.' },
  { id: 'none', label: 'No tax applied', note: 'Used for crypto-to-crypto and zero-rated sales.' }
];

export const taxModeById = (id) => TAX_MODES.find((t) => t.id === id) || TAX_MODES[0];

export const CONVERSION_DISCLAIMER =
  'Converted amounts are indicative and use the exchange rate shown. The amount charged is set by the '
  + 'settlement currency; card issuers and banks may apply their own rate and a conversion fee.';

/**
 * Split an amount into net and tax.
 * `amount` is the price as listed, and `mode` says whether it already includes
 * tax. Returns net, tax and gross in the same currency.
 */
export function splitTax(amount, { mode = 'exclusive', taxRate = 0 } = {}) {
  const value = Number(amount);
  const rate = Math.max(0, Number(taxRate) || 0);
  if (!Number.isFinite(value)) return null;

  if (mode === 'none' || rate === 0) {
    return { mode: 'none', net: value, tax: 0, gross: value, taxRate: rate };
  }
  if (mode === 'inclusive') {
    // The listed amount IS the gross, so the rate divides.
    const net = value / (1 + rate);
    return { mode: 'inclusive', net, tax: value - net, gross: value, taxRate: rate };
  }
  // Exclusive: the listed amount is net and tax is added on top.
  const tax = value * rate;
  return { mode: 'exclusive', net: value, tax, gross: value + tax, taxRate: rate };
}

/** Rebuild a gross from a net without floating-point drift in the tax leg. */
export const grossFromNet = (net, taxRate = 0) => Number((Number(net) * (1 + Number(taxRate))).toFixed(6));

/**
 * Price one line item for display and for settlement.
 *
 * Conversion happens first and rounding second, per currency, so the displayed
 * figure is the rounded value of the true converted amount rather than the
 * conversion of an already-rounded one.
 */
export function priceLine({
  amount,
  settlementCurrency = 'USD',
  displayCurrency = 'USD',
  rateTable = null,
  taxMode = 'exclusive',
  taxRate = 0,
  cashIncrement = null,
  inclusiveOfSettlement = true
} = {}) {
  const settlement = currencyByCode(settlementCurrency) ? settlementCurrency : 'USD';
  const display = currencyByCode(displayCurrency) ? displayCurrency : settlement;

  // `amount` is quoted in the settlement currency unless told otherwise.
  const base = Number(amount);
  if (!Number.isFinite(base)) return null;

  const tax = splitTax(base, { mode: taxMode, taxRate });

  let converted = tax.gross;
  let convertedNet = tax.net;
  let convertedTax = tax.tax;
  let rate = 1;

  if (display !== settlement) {
    const table = rateTable?.rates ? rateTable : null;
    if (!table) return { ok: false, reason: 'no-rate-table', settlement, display };
    const c = convert(tax.gross, settlement, display, table);
    if (c == null) return { ok: false, reason: 'no-rate-for-pair', settlement, display };
    converted = c;
    rate = c / (tax.gross || 1);
    convertedNet = convert(tax.net, settlement, display, table);
    convertedTax = convert(tax.tax, settlement, display, table);
  }

  const roundedGross = roundToCurrency(converted, display, { increment: cashIncrement });
  const roundedNet = roundToCurrency(convertedNet, display, { increment: cashIncrement });
  const roundedTax = roundToCurrency(convertedTax, display, { increment: cashIncrement });

  return {
    ok: true,
    settlement,
    display,
    rate,
    /*
     * Unrounded, converted to the DISPLAY currency. Named explicitly because the
     * previous `exact` label was ambiguous — a caller could reasonably have read
     * it as settlement amounts in either currency, which is a different number.
     */
    displayExact: { gross: converted, net: convertedNet, tax: convertedTax },
    settlementAmounts: { gross: tax.gross, net: tax.net, tax: tax.tax },
    displayAmounts: { gross: roundedGross, net: roundedNet, tax: roundedTax },
    taxMode: tax.mode,
    taxRate: tax.taxRate,
    decimals: decimalsFor(display),
    cashIncrement,
    disclaimer: display !== settlement ? CONVERSION_DISCLAIMER : null,
    note: display !== settlement
      ? 'Charged in ' + settlement + ', displayed in ' + display
      : null
  };
}

/**
 * Total a set of priced lines.
 *
 * Both figures are returned on purpose. `gross` is the exact sum of the
 * converted amounts; `displayGross` is the sum of the per-line rounded
 * amounts. They can differ by a minor unit, and hiding that difference is how
 * an invoice's line items stop adding up to its total.
 */
export function totalLines(lines = []) {
  return lines.reduce((acc, line) => {
    if (!line?.displayExact) return acc;
    acc.gross += line.displayExact.gross;
    acc.net += line.displayExact.net;
    acc.tax += line.displayExact.tax;
    acc.displayGross += line.displayAmounts?.gross ?? 0;
    return acc;
  }, { gross: 0, net: 0, tax: 0, displayGross: 0 });
}

/** The rounding drift between exact and per-line-rounded totals, in minor units. */
export function roundingDrift(totals, code) {
  if (!totals) return null;
  const exact = roundToCurrency(totals.gross, code);
  if (exact == null) return null;
  const scaled = (a, b) => Math.round((a - b) * 10 ** decimalsFor(code));
  return { exactRounded: exact, displayRounded: roundToCurrency(totals.displayGross, code), driftMinorUnits: scaled(totals.displayGross, exact) };
}

/**
 * A multi-currency price book: one canonical amount, quoted in several
 * currencies. Each quote is converted then rounded independently.
 */
export function buildPriceBook({ amount, settlementCurrency = 'USD', currencies = [], rateTable = null, taxMode = 'exclusive', taxRate = 0 } = {}) {
  const list = [...new Set([settlementCurrency, ...currencies])].filter((c) => currencyByCode(c));
  return list.map((displayCurrency) => ({
    currency: displayCurrency,
    ...priceLine({ amount, settlementCurrency, displayCurrency, rateTable, taxMode, taxRate })
  }));
}

/* ---------------------------------------------------------------------------
 * Availability by country
 * ------------------------------------------------------------------------ */

/**
 * Which currencies we can offer a buyer in a country.
 *
 * A currency with no usable rate is listed as unavailable rather than quoted
 * with a wrong or invented rate — showing an unconvertible price is worse than
 * showing none, because the buyer cannot tell it is wrong.
 */
export function currencyAvailability({ country, rateTable = null, fallbackToDefault = true } = {}) {
  const local = currenciesForCountry(country);
  const primary = local[0] || (fallbackToDefault ? 'USD' : null);
  const candidates = [...new Set([...local, 'USD', 'EUR', 'GBP'])];

  const rates = rateTable?.rates || null;
  const base = rateTable?.base || 'USD';

  const supported = [];
  const unavailable = [];
  candidates.forEach((code) => {
    if (!currencyByCode(code)) return;
    // A currency is quotable when its leg exists (or it is the base itself).
    const quotable = !rates || code === base || rates[code] > 0;
    (quotable ? supported : unavailable).push(code);
  });

  return {
    country,
    primary,
    locals: local,
    supported,
    unavailable,
    missingRateNote: unavailable.length
      ? `No live rate for ${unavailable.join(', ')}. Shown as unavailable rather than converted at a guessed rate.`
      : null
  };
}

/** Round a cash total to the smallest coin actually in circulation. */
export const CASH_INCREMENTS = {
  CHF: 0.05, SEK: 1, NOK: 1, DKK: 0.5, CZK: 1, HUF: 5, AUD: 0.05,
  CAD: 0.05, NZD: 0.10, SGD: 0.05, ZAR: 0.10, INR: 0.05
};

export const cashIncrementFor = (code) => CASH_INCREMENTS[code] || null;

export const PRICING_DISCLAIMER = {
  conversion: CONVERSION_DISCLAIMER,
  rounding:
    'Amounts are rounded to the minor unit of the currency they are displayed in. Rounding is applied after '
    + 'conversion, never before, so the displayed total is the rounded true amount.',
  cash: 'Cash payments in some currencies are rounded to the nearest circulating coin.',
  tax: 'Tax is calculated on the settlement amount. Display-currency tax figures are converted, so they can '
    + 'differ by one minor unit from the settlement figure.'
};

export const defaultCurrency = defaultCurrencyFor;
