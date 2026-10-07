import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { lsGet, lsSet } from './storage.js';
import { CURRENCIES, currencyByCode, symbolFor, decimalsFor, defaultCurrencyFor } from './currencies.js';
import {
  FALLBACK_RATES, RateCache, RateAuditTrail, fetchRates, convert, roundToCurrency
} from './rates.js';

/* Multi-currency display layer.
 *
 * Market data arrives in USD; this converts for display only (no FX trading).
 *
 * Two rules this module exists to enforce:
 *  1. Never build a currency string by concatenating a symbol. Symbol placement
 *     differs by locale (€1 234,56 in Germany, 1 234,56 € in France) and the
 *     previous version hard-coded a leading symbol plus 'en-US' separators.
 *  2. Respect the currency's own minor unit. JPY has no cents; rendering
 *     ¥1,234.00 is wrong, and KWD needs three decimals.
 */

export { CURRENCIES, currencyByCode, symbolFor, FALLBACK_RATES, decimalsFor };

/** Currencies offered in the header picker — the majors, in a stable order. */
export const PRIMARY_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'PKR', 'AED', 'SAR', 'TRY',
  'BRL', 'CAD', 'AUD', 'CHF', 'SGD', 'HKD', 'ZAR', 'NGN', 'BDT', 'IDR'
].filter((c) => currencyByCode(c));

/** The currency shown in the header: majors first, then everything else. */
export const PICKER_CURRENCIES = [
  ...PRIMARY_CURRENCIES.map((c) => currencyByCode(c)),
  ...CURRENCIES.filter((c) => !PRIMARY_CURRENCIES.includes(c.code))
];

/** A flat USD-based rate map is still accepted; convert it to a rate table. */
const asTable = (rates) => (rates?.rates ? rates : { base: 'USD', rates: rates || FALLBACK_RATES });

export function convertValue(usd, code = 'USD', rates = FALLBACK_RATES) {
  return convert(usd, 'USD', code, asTable(rates));
}

/**
 * How many decimals to show for a value, given the currency and its size.
 *
 * Money keeps the currency's minor unit at any magnitude. An earlier version
 * dropped to zero decimals above 1000 — fine for a market-cap figure, but it
 * turned €1,135.74 into €1,136 on an amount the user is actually paying.
 * Only sub-unit values (crypto prices) gain extra digits.
 */
export function displayDecimals(value, code, override) {
  if (override != null) return override;
  const currencyDigits = decimalsFor(code);
  // A zero-decimal currency never grows decimals, however small the value.
  if (currencyDigits === 0) return 0;
  const abs = Math.abs(Number(value) || 0);
  if (abs >= 1) return currencyDigits;
  if (abs >= 0.01) return Math.max(4, currencyDigits);
  return Math.max(6, currencyDigits);
}

/**
 * Format a USD amount in another currency.
 * Uses Intl currency formatting, so symbol position, the symbol itself and the
 * digit separators all follow the requested locale.
 */
export function formatMoney(usd, { code = 'USD', rates = FALLBACK_RATES, compact = false, digits, lang = 'en' } = {}) {
  const value = convertValue(usd, code, rates);
  if (value == null || !Number.isFinite(value)) return '—';

  const d = displayDecimals(value, code, digits);
  const opts = {
    style: 'currency',
    currency: code,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    ...(compact ? { notation: 'compact', compactDisplay: 'short' } : {})
  };

  try {
    return new Intl.NumberFormat(lang, opts).format(value);
  } catch {
    // A runtime that rejects the currency code or the options: fall back to a
    // locale-correct number plus the code, never a hard-coded symbol.
    try {
      const n = new Intl.NumberFormat(lang, {
        minimumFractionDigits: d, maximumFractionDigits: d,
        ...(compact ? { notation: 'compact' } : {})
      }).format(value);
      return `${n} ${code}`;
    } catch {
      return `${value.toFixed(d)} ${code}`;
    }
  }
}

const CurrencyContext = createContext(null);
export const useCurrency = () => useContext(CurrencyContext);

export function CurrencyProvider({ children }) {
  const [code, setCodeState] = useState(() => {
    const stored = lsGet('cx_currency', null);
    if (stored && currencyByCode(stored)) return stored;
    // Fall back to a country default rather than assuming USD.
    const region = lsGet('cx_region', null);
    return region ? defaultCurrencyFor(region) : 'USD';
  });

  const cacheRef = useRef(null);
  const auditRef = useRef(null);
  if (!cacheRef.current) cacheRef.current = new RateCache();
  if (!auditRef.current) auditRef.current = new RateAuditTrail(200);

  const [table, setTable] = useState({ base: 'USD', rates: FALLBACK_RATES, asOf: null, source: 'fallback' });

  /* The currencies worth quoting: the user's choice plus the majors. */
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let alive = true;
    const quotes = [...new Set([code, 'EUR', 'GBP', 'JPY', 'INR', 'PKR', 'AED', ...PRIMARY_CURRENCIES])]
      .filter((q) => q !== 'USD');
    (async () => {
      const next = await fetchRates({
        base: 'USD',
        quotes,
        cache: cacheRef.current,
        audit: auditRef.current
      });
      if (alive) setTable(next);
    })();
    return () => { alive = false; };
  }, [code, refreshKey]);

  const value = useMemo(() => {
    const entry = currencyByCode(code);
    return {
      code,
      symbol: symbolFor(code),
      decimals: decimalsFor(code),
      currency: entry,
      rates: table.rates,
      base: table.base,
      /* Provenance, so the UI can label a converted figure honestly. */
      source: table.source,
      provider: table.provider,
      asOf: table.asOf,
      fetchedAt: table.fetchedAt,
      stale: !!table.stale,
      audit: auditRef.current,
      setCode: (next) => {
        if (!currencyByCode(next)) return;
        setCodeState(next);
        lsSet('cx_currency', next);
      },
      refresh: () => setRefreshKey((k) => k + 1),
      convert: (usd) => convert(usd, 'USD', code, table),
      round: (amount) => roundToCurrency(amount, code),
      format: (usd, opts) => formatMoney(usd, { code, rates: table, ...(opts || {}) })
    };
  }, [code, table]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}
