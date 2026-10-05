import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { lsGet, lsSet } from './storage.js';

/* Multi-currency display layer.
 * Market data arrives in USD; this converts for display only (no FX trading).
 * Rates come from a public endpoint and fall back to a static table offline. */

export const CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'GBP', symbol: '£', label: 'British Pound' },
  { code: 'PKR', symbol: '₨', label: 'Pakistani Rupee' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' }
];

export const FALLBACK_RATES = { USD: 1, EUR: 0.92, GBP: 0.79, PKR: 278, AED: 3.67, INR: 83.2 };

export const currencyByCode = (code) => CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

export function convertValue(usd, code = 'USD', rates = FALLBACK_RATES) {
  if (usd == null || Number.isNaN(usd)) return null;
  return usd * (rates?.[code] ?? 1);
}

export function formatMoney(usd, { code = 'USD', rates = FALLBACK_RATES, compact = false, digits } = {}) {
  const value = convertValue(usd, code, rates);
  if (value == null) return '—';
  const symbol = currencyByCode(code).symbol;
  const abs = Math.abs(value);
  if (compact && abs >= 1000) {
    const units = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K']
    ];
    for (const [size, suffix] of units) {
      if (abs >= size) return `${value < 0 ? '-' : ''}${symbol}${(abs / size).toFixed(2)}${suffix}`;
    }
  }
  const d = digits ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : 6);
  return `${value < 0 ? '-' : ''}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

const CurrencyContext = createContext(null);
export const useCurrency = () => useContext(CurrencyContext);

export function CurrencyProvider({ children }) {
  const [code, setCodeState] = useState(() => {
    const stored = lsGet('cx_currency', 'USD');
    return CURRENCIES.some((c) => c.code === stored) ? stored : 'USD';
  });
  const [rates, setRates] = useState(FALLBACK_RATES);
  const [source, setSource] = useState('fallback');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=eur,gbp,pkr,aed,inr');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const r = json?.tether;
        if (!r || !r.eur) throw new Error('missing rates');
        if (!alive) return;
        setRates({ USD: 1, EUR: r.eur, GBP: r.gbp, PKR: r.pkr, AED: r.aed, INR: r.inr });
        setSource('live');
      } catch {
        /* keep the static fallback table */
      }
    })();
    return () => { alive = false; };
  }, []);

  const value = useMemo(
    () => ({
      code,
      symbol: currencyByCode(code).symbol,
      rates,
      source,
      setCode: (next) => {
        if (!CURRENCIES.some((c) => c.code === next)) return;
        setCodeState(next);
        lsSet('cx_currency', next);
      },
      convert: (usd) => convertValue(usd, code, rates),
      format: (usd, opts) => formatMoney(usd, { code, rates, ...(opts || {}) })
    }),
    [code, rates, source]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}
