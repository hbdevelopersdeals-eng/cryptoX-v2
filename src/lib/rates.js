/* Exchange-rate engine: provider abstraction, caching, failover, timestamps and
 * an audit trail.
 *
 * Design rules
 *  - Providers are pluggable and each one's payload parser is a pure function,
 *    so the parsing is unit-tested against real captured payloads rather than
 *    exercised only when the network happens to be up.
 *  - The fetch function is injected (`fetchImpl`), so tests never touch the wire.
 *  - Every rate set carries `asOf` (when the provider says it was published) and
 *    `fetchedAt` (when we retrieved it). A rate with no timestamp is treated as
 *    untrustworthy for anything but display.
 *  - Cache misses fall through the provider list, then to a static table. The
 *    result always reports which layer answered, so the UI can label it.
 */

import { CURRENCIES, currencyByCode, isKnownCurrency, decimalsFor } from './currencies.js';

/* ---------------------------------------------------------------------------
 * Fallback table — USD base, used only when every provider fails.
 * ------------------------------------------------------------------------ */
export const FALLBACK_RATES = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 158.2, CNY: 7.1, INR: 84, PKR: 278,
  AED: 3.6725, SAR: 3.75, CAD: 1.37, AUD: 1.5, CHF: 0.88, TRY: 34, BRL: 5.4,
  ZAR: 18.2, NGN: 1550, BDT: 120, IDR: 15800, MYR: 4.4, SGD: 1.32, THB: 34,
  VND: 25400, KRW: 1380, RUB: 92, PLN: 3.95, SEK: 10.6, NOK: 10.8, DKK: 6.9,
  HKD: 7.8, TWD: 32.3, MXN: 18.5, ARS: 980, CLP: 950, COP: 4200, EGP: 48,
  ILS: 3.7, KES: 129, GHS: 15, MAD: 9.9, TND: 3.12, KWD: 0.307, BHD: 0.376,
  OMR: 0.3845, QAR: 3.64, JOD: 0.709, LKR: 295, NPR: 134, PHP: 57, CZK: 23.2
};

export const FALLBACK_AS_OF = '2026-01-01T00:00:00.000Z';

/* ---------------------------------------------------------------------------
 * Providers
 * ------------------------------------------------------------------------ */

/*
 * Parsers are exported so the test suite can pin them against real payloads.
 * `pick` maps a provider payload to { base, rates, asOf }.
 */
export const parseErApi = (json) => {
  if (!json || json.result !== 'success' || !json.rates) return null;
  const asOf = json.time_last_update_unix
    ? new Date(json.time_last_update_unix * 1000).toISOString()
    : null;
  return { base: json.base_code || 'USD', rates: json.rates, asOf };
};

export const parseFrankfurter = (json) => {
  if (!json || !json.rates) return null;
  return { base: json.base || 'USD', rates: json.rates, asOf: json.date ? `${json.date}T16:00:00.000Z` : null };
};

export const parseCoinGecko = (json, quotes = []) => {
  const tether = json?.tether;
  if (!tether) return null;
  // CoinGecko quotes crypto against fiat: 1 USDT = N units of fiat.
  const rates = { USD: 1 };
  quotes.forEach((q) => {
    const v = tether[q.toLowerCase()];
    if (typeof v === 'number' && v > 0) rates[q.toUpperCase()] = v;
  });
  if (Object.keys(rates).length < 2) return null;
  // The payload carries no publication time; stamp it at fetch time.
  return { base: 'USD', rates, asOf: null };
};

export const PROVIDERS = [
  {
    id: 'erapi',
    label: 'ExchangeRate-API (open)',
    kind: 'fiat',
    url: (base) => `https://open.er-api.com/v6/latest/${base}`,
    parse: parseErApi,
    // Broad coverage (~160 currencies) and publishes its own timestamp.
    coverage: 'broad',
    supportsHistorical: false,
    requiresKey: false
  },
  {
    id: 'frankfurter',
    label: 'Frankfurter (ECB reference)',
    kind: 'fiat',
    url: (base, quotes) => `https://api.frankfurter.app/latest?from=${base}${quotes?.length ? `&to=${quotes.join(',')}` : ''}`,
    parse: parseFrankfurter,
    // Authoritative but only the ~30 ECB reference currencies.
    coverage: 'narrow',
    supportsHistorical: true,
    requiresKey: false
  },
  {
    id: 'coingecko',
    label: 'CoinGecko (crypto ↔ fiat)',
    kind: 'crypto',
    url: (_base, quotes) => `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=${(quotes || []).map((q) => q.toLowerCase()).join(',')}`,
    parse: parseCoinGecko,
    coverage: 'broad',
    supportsHistorical: false,
    requiresKey: false
  }
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

/* ---------------------------------------------------------------------------
 * Cache
 * ------------------------------------------------------------------------ */

export const RATE_TTL_MS = 10 * 60 * 1000;      // refresh successful live rates
export const STALE_TTL_MS = 24 * 60 * 60 * 1000; // keep serving a stale set for a day

/** A tiny TTL cache with explicit staleness, not just presence. */
export class RateCache {
  constructor({ ttlMs = RATE_TTL_MS, staleTtlMs = STALE_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.staleTtlMs = staleTtlMs;
    this.now = now;
    this.entries = new Map();
  }

  set(key, value) {
    this.entries.set(key, { value, storedAt: this.now() });
    return value;
  }

  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    const age = this.now() - hit.storedAt;
    if (age > this.staleTtlMs) {
      this.entries.delete(key);
      return null;
    }
    return { ...hit.value, age, stale: age > this.ttlMs };
  }

  size() { return this.entries.size; }
  clear() { this.entries.clear(); }
}

/* ---------------------------------------------------------------------------
 * Audit trail
 * ------------------------------------------------------------------------ */

/**
 * Append-only record of every rate acquisition. Bounded so a long-running tab
 * cannot grow without limit. Each entry answers "where did this number come
 * from, when, and was it live or cached?".
 */
export class RateAuditTrail {
  constructor(limit = 200) {
    this.limit = limit;
    this.entries = [];
  }

  record(entry) {
    this.entries.push({ at: new Date().toISOString(), ...entry });
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    return entry;
  }

  forBase(base) { return this.entries.filter((e) => e.base === base); }
  failures() { return this.entries.filter((e) => !e.ok); }
  latest() { return this.entries[this.entries.length - 1] || null; }
  clear() { this.entries = []; }
}

/* ---------------------------------------------------------------------------
 * Acquisition
 * ------------------------------------------------------------------------ */

/*
 * Normalise the requested quote list: upper-case, de-duplicate, drop the base
 * and drop anything that is not an ISO 4217 code we know. The previous version
 * mixed `&&`/`||` without parentheses, which read as a filter but silently
 * changed meaning depending on which term was truthy.
 */
const quoteList = (base, quotes) => [...new Set((quotes || []).map((q) => String(q).toUpperCase()))]
  .filter((q) => q && q !== base && isKnownCurrency(q));

/**
 * Fetch a rate set, walking the provider list then the static fallback.
 * Returns { base, rates, asOf, fetchedAt, provider, source, stale, errors }.
 *   source: 'live' | 'cache' | 'stale-cache' | 'fallback'
 */
export async function fetchRates({
  base = 'USD',
  quotes = [],
  cache = null,
  audit = null,
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  now = () => new Date(),
  timeoutMs = 8000,
  providers = PROVIDERS
} = {}) {
  const want = quoteList(base, quotes);
  const key = `${base}:${want.join(',')}`;
  const cached = cache?.get(key);
  if (cached && !cached.stale) {
    return { ...cached, source: 'cache', errors: [] };
  }

  const errors = [];

  if (fetchImpl) {
    for (const provider of providers) {
      const url = provider.url(base, want);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await fetchImpl(url, {
          headers: { accept: 'application/json' },
          ...(controller ? { signal: controller.signal } : {})
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = provider.parse(json, want);
        if (!parsed) throw new Error('payload not recognised');

        // Narrow providers may simply not quote the requested currency.
        const missing = want.filter((q) => !(q in parsed.rates));
        if (missing.length && provider.coverage === 'narrow') {
          errors.push({ provider: provider.id, error: `no rate for ${missing.join(', ')}` });
          audit?.record({ provider: provider.id, base, ok: false, requested: want.length, error: `missing ${missing.join(',')}` });
          continue;
        }

        const value = {
          base,
          rates: { ...parsed.rates, [base]: 1 },
          asOf: parsed.asOf,
          fetchedAt: now().toISOString(),
          provider: provider.id,
          coverage: provider.coverage,
          stale: false
        };
        audit?.record({ provider: provider.id, base, ok: true, requested: want.length, received: Object.keys(parsed.rates).length, asOf: value.asOf });
        cache?.set(key, value);
        return { ...value, source: 'live', errors };
      } catch (err) {
        errors.push({ provider: provider.id, error: err?.message || 'failed' });
        audit?.record({ provider: provider.id, base, ok: false, error: err?.message || 'failed' });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  // Provideless or every provider failed: serve a stale cache set before guessing.
  if (cached) {
    audit?.record({ provider: 'cache(stale)', base, ok: true, error: 'serving stale after provider failure' });
    return { ...cached, source: 'stale-cache', errors };
  }

  audit?.record({ provider: 'static', base, ok: true, error: 'static fallback table' });
  const rates = { ...FALLBACK_RATES, [base]: 1 };
  return {
    base,
    rates,
    asOf: FALLBACK_AS_OF,
    fetchedAt: now().toISOString(),
    provider: 'static',
    coverage: 'fallback',
    source: 'fallback',
    stale: true,
    errors
  };
}

/* ---------------------------------------------------------------------------
 * Conversion
 * ------------------------------------------------------------------------ */

/**
 * Convert between two currencies using a rate set quoted against one base.
 * Goes through the base, so any pair works without a direct quote:
 *   amount(base) = amount / rate[from] ; result = amount(base) * rate[to]
 * A missing leg returns null rather than silently treating the rate as 1.
 */
export function convert(amount, from, to, table) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  const rates = table?.rates;
  const base = table?.base || 'USD';
  if (!rates) return null;
  const src = from === base ? 1 : rates[from];
  const dst = to === base ? 1 : rates[to];
  if (!(src > 0) || !(dst > 0)) return null;
  return (Number(amount) / src) * dst;
}

/*
 * Decimal shifting without float error.
 * Number('1.005e2') is exactly 100.5, whereas 1.005 * 100 is 100.49999999999999.
 * Doing the arithmetic in the shifted integer domain is what makes half-way
 * values round the way a person expects.
 */
const shiftDecimal = (value, places) => {
  const [mantissa, exponent] = String(value).split('e');
  return Number(`${mantissa}e${(exponent ? Number(exponent) : 0) + places}`);
};

const stepDecimals = (step) => {
  if (Number.isInteger(step)) return 0;
  const s = String(step);
  const exp = s.indexOf('e-');
  if (exp !== -1) return Number(s.slice(exp + 2));
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};

/**
 * Round to the currency's own minor unit.
 *
 * Half-away-from-zero, which is what invoicing expects; Math.round alone rounds
 * half toward +∞ and would give -1.23 for -1.235. `increment` supports cash
 * rounding (CHF 0.05, SEK 1).
 */
export function roundToCurrency(amount, code, { increment = null, mode = 'half-up' } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const d = decimalsFor(code);
  const step = increment || (d === 0 ? 1 : 1 / 10 ** d);
  if (!(step > 0)) return null;

  const places = stepDecimals(step);
  const scaled = shiftDecimal(n, places) / shiftDecimal(step, places);
  const magnitude = Math.abs(scaled);

  const rounded = mode === 'floor' ? Math.floor(scaled)
    : mode === 'ceil' ? Math.ceil(scaled)
      : Math.sign(scaled) * Math.round(magnitude);

  // Back to the original scale, then clean up any residual representation noise.
  const out = shiftDecimal(rounded * shiftDecimal(step, places), -places);
  return Number(out.toFixed(Math.min(12, Math.max(d, places, 6))));
}

/* ---------------------------------------------------------------------------
 * Historical
 * ------------------------------------------------------------------------ */

export const HISTORICAL_SUPPORT = {
  available: true,
  providers: ['frankfurter'],
  coverage: 'narrow',
  note: 'Historical rates come from the ECB reference set, which covers about 30 currencies. '
      + 'Currencies outside it (PKR, AED, NGN …) have no free historical source here and are '
      + 'reported as unavailable rather than interpolated.'
};

/**
 * A rate for a past date. Returns null with a reason when the provider cannot
 * answer, which the caller must surface rather than substituting today's rate.
 */
export async function historicalRate({
  date, base = 'USD', quote, fetchImpl = typeof fetch === 'function' ? fetch : null, timeoutMs = 8000
} = {}) {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { ok: false, reason: 'invalid-date', date: iso };

  const provider = providerById('frankfurter');
  if (!provider.supportsHistorical) return { ok: false, reason: 'provider-cannot-do-history', date: iso };
  if (!fetchImpl) return { ok: false, reason: 'no-fetch-available', date: iso };

  const url = `https://api.frankfurter.app/${iso}?from=${base}&to=${quote}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const value = json?.rates?.[quote];
    if (!(value > 0)) {
      return { ok: false, reason: 'currency-not-in-provider-coverage', date: json?.date || iso, base, quote };
    }
    return { ok: true, date: json.date, base, quote, rate: value, provider: 'frankfurter' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'failed', date: iso };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Metadata for the UI
 * ------------------------------------------------------------------------ */

export const CURRENCY_COVERAGE = {
  total: CURRENCIES.length,
  note: `${CURRENCIES.length} ISO 4217 currencies are recognised for display and rounding. `
      + 'Live conversion depends on the provider: broad coverage for ~160 fiat currencies, '
      + 'ECB reference rates for ~30, and a static table if every provider is unreachable.'
};
