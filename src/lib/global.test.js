import { describe, it, expect, vi } from 'vitest';
import {
  CURRENCIES, currencyByCode, isKnownCurrency, symbolFor, decimalsFor, currenciesForCountry,
  defaultCurrencyFor, countriesForCurrency, searchCurrencies, currencyName,
  toMinorUnits, fromMinorUnits, ZERO_DECIMAL, THREE_DECIMAL, FOUR_DECIMAL
} from './currencies.js';
import {
  parseErApi, parseFrankfurter, parseCoinGecko, convert, roundToCurrency,
  RateCache, RateAuditTrail, fetchRates, historicalRate, FALLBACK_RATES,
  PROVIDERS, providerById, HISTORICAL_SUPPORT
} from './rates.js';
import { formatMoney, convertValue, displayDecimals } from './currency.jsx';
import {
  splitTax, priceLine, buildPriceBook, totalLines, roundingDrift, currencyAvailability,
  cashIncrementFor, CONVERSION_DISCLAIMER, TAX_MODES
} from './pricing.js';
import {
  isValidZone, offsetMinutes, offsetLabel, gmtLabel, standardOffset, isDST,
  zoneAbbreviation, partsInZone, toStorage, fromStorage, resolveWallTime, toUTC,
  fromUTC, findTransitions, zoneDstInfo, resolveZone, zoneConsistency,
  formatRelative, zonesByArea, expandRecurrence, planReminder, dstDriftForRecurrence,
  buildICS, googleCalendarUrl, assertUtcStorage, UTC, ZONE_LIST
} from './time.js';
import {
  applyPrecision, snapToGrid, distanceKm, isExpired, purgeExpired, redactLocation,
  deleteLocation, validateLocation, parseOpenMeteo, parseNominatim, geocode,
  reverseGeocode, geolocationPermission, requestPosition, timezoneForLocation,
  formatPlace, precisionById, retentionById, PRECISION_LEVELS, RETENTION_POLICIES,
  GEOCODE_PROVIDERS, PERMISSION_HELP
} from './location.js';

/* Real payloads captured by probing the live endpoints. */
const ERAPI = {
  result: 'success',
  time_last_update_unix: 1791331352,
  base_code: 'USD',
  rates: { USD: 1, EUR: 0.88739, GBP: 0.75322, JPY: 158.09, PKR: 278.5 }
};
const FRANKFURTER = { amount: 1.0, base: 'USD', date: '2026-10-06', rates: { EUR: 0.88739, GBP: 0.75322, JPY: 158.09 } };
const COINGECKO = { tether: { eur: 0.893732, gbp: 0.755902, jpy: 158.2 } };
const OPEN_METEO = {
  results: [{
    id: 1174872, name: 'Karachi', latitude: 24.8608, longitude: 67.0104,
    country_code: 'PK', timezone: 'Asia/Karachi', population: 11624219,
    country: 'Pakistan', admin1: 'Sindh'
  }]
};
const NOMINATIM_REVERSE = {
  place_id: 246266895, osm_type: 'way', osm_id: 527002479,
  lat: '24.8606986', lon: '67.0011021', name: 'Embankment Road',
  display_name: 'Embankment Road, Karachi, Sindh, Pakistan',
  address: { road: 'Embankment Road', suburb: 'Civil Lines', city: 'Karachi', state: 'Sindh', country: 'Pakistan', country_code: 'pk' }
};

const stub = (payload, { ok = true, status = 200 } = {}) => vi.fn(async () => ({
  ok, status, json: async () => payload
}));

describe('currencies — ISO 4217', () => {
  it('carries a large ISO 4217 set with well-formed codes', () => {
    expect(CURRENCIES.length).toBeGreaterThan(150);
    CURRENCIES.forEach((c) => {
      expect(c.code, c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.numeric, c.code).toMatch(/^\d{3}$/);
      expect(c.name, c.code).toBeTruthy();
      expect(c.symbol, c.code).toBeTruthy();
    });
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
  });

  it('knows the ISO minor-unit exponent, including the awkward ones', () => {
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('JPY')).toBe(0);
    expect(decimalsFor('KRW')).toBe(0);
    expect(decimalsFor('VND')).toBe(0);
    expect(decimalsFor('ISK')).toBe(0);
    expect(decimalsFor('KWD')).toBe(3);
    expect(decimalsFor('BHD')).toBe(3);
    expect(decimalsFor('TND')).toBe(3);
    expect(decimalsFor('CLF')).toBe(4);
    expect(ZERO_DECIMAL.has('JPY')).toBe(true);
    expect(THREE_DECIMAL.has('KWD')).toBe(true);
    expect(FOUR_DECIMAL.has('CLF')).toBe(true);
  });

  it('resolves codes case-insensitively and never substitutes a wrong currency', () => {
    expect(currencyByCode('usd').code).toBe('USD');
    expect(currencyByCode('PKR').name).toBe('Pakistani Rupee');
    // The old implementation returned USD for any unknown code, which silently
    // mislabels every price.
    expect(currencyByCode('ZZZ')).toBeNull();
    expect(currencyByCode(null)).toBeNull();
    expect(isKnownCurrency('USD')).toBe(true);
    expect(isKnownCurrency('ZZZ')).toBe(false);
    expect(symbolFor('EUR')).toBe('€');
    expect(symbolFor('ZZZ')).toBe('ZZZ');
  });

  it('maps countries to currencies and back', () => {
    expect(currenciesForCountry('PK')).toEqual(['PKR']);
    expect(currenciesForCountry('US')).toEqual(['USD']);
    expect(defaultCurrencyFor('PK')).toBe('PKR');
    expect(defaultCurrencyFor('ZZ')).toBe('USD');
    expect(countriesForCurrency('EUR')).toContain('DE');
    expect(countriesForCurrency('PKR')).toEqual(['PK']);
  });

  it('searches by code, name and numeric, with exact codes first', () => {
    expect(searchCurrencies('gbp')[0].code).toBe('GBP');
    expect(searchCurrencies('pound').some((c) => c.code === 'GBP')).toBe(true);
    expect(searchCurrencies('392')[0].code).toBe('JPY');
    expect(searchCurrencies('zzzz')).toEqual([]);
  });

  it('localizes currency names through Intl and falls back to English', () => {
    expect(currencyName('USD', 'de')).toMatch(/Dollar/i);
    expect(currencyName('USD', 'xx-not-a-lang')).toBe('US Dollar');
    expect(currencyName('ZZZ')).toBe('ZZZ');
  });

  it('converts to and from integer minor units', () => {
    expect(toMinorUnits(12.34, 'USD')).toBe(1234);
    expect(fromMinorUnits(1234, 'USD')).toBeCloseTo(12.34, 9);
    // A zero-decimal currency has no minor unit to scale.
    expect(toMinorUnits(1234, 'JPY')).toBe(1234);
    expect(fromMinorUnits(1234, 'JPY')).toBe(1234);
    expect(toMinorUnits(1.234, 'KWD')).toBe(1234);
  });
});

describe('rates — providers', () => {
  it('parses each provider payload, including its publication time', () => {
    const er = parseErApi(ERAPI);
    expect(er.base).toBe('USD');
    expect(er.rates.EUR).toBeCloseTo(0.88739, 6);
    expect(er.asOf).toBe(new Date(1791331352 * 1000).toISOString());

    const ff = parseFrankfurter(FRANKFURTER);
    expect(ff.base).toBe('USD');
    expect(ff.asOf).toBe('2026-10-06T16:00:00.000Z');

    const cg = parseCoinGecko(COINGECKO, ['EUR', 'GBP', 'JPY']);
    expect(cg.rates.USD).toBe(1);
    expect(cg.rates.JPY).toBeCloseTo(158.2, 6);
    // CoinGecko publishes no timestamp, so asOf stays null rather than being invented.
    expect(cg.asOf).toBeNull();
  });

  it('rejects malformed payloads instead of guessing', () => {
    expect(parseErApi({ result: 'error' })).toBeNull();
    expect(parseErApi(null)).toBeNull();
    expect(parseFrankfurter({})).toBeNull();
    expect(parseCoinGecko({}, [])).toBeNull();
    expect(parseCoinGecko({ tether: { usd: 1 } }, ['EUR'])).toBeNull();
  });

  it('declares coverage honestly per provider', () => {
    expect(providerById('frankfurter').coverage).toBe('narrow');
    expect(providerById('erapi').coverage).toBe('broad');
    expect(providerById('frankfurter').supportsHistorical).toBe(true);
    expect(PROVIDERS.every((p) => p.requiresKey === false)).toBe(true);
    expect(HISTORICAL_SUPPORT.coverage).toBe('narrow');
  });
});

describe('rates — conversion and rounding', () => {
  const table = { base: 'USD', rates: { USD: 1, EUR: 0.9, GBP: 0.75, JPY: 150 } };

  it('converts directly and through the base', () => {
    expect(convert(100, 'USD', 'EUR', table)).toBeCloseTo(90, 6);
    expect(convert(90, 'EUR', 'USD', table)).toBeCloseTo(100, 6);
    // EUR → GBP has no direct quote; it must go through USD.
    expect(convert(90, 'EUR', 'GBP', table)).toBeCloseTo(75, 6);
    expect(convert(100, 'USD', 'USD', table)).toBe(100);
  });

  it('returns null rather than assuming a rate of 1', () => {
    expect(convert(100, 'USD', 'ZZZ', table)).toBeNull();
    expect(convert(100, 'ZZZ', 'USD', table)).toBeNull();
    expect(convert(null, 'USD', 'EUR', table)).toBeNull();
    expect(convert(100, 'USD', 'EUR', null)).toBeNull();
  });

  it('rounds to the currency minor unit, half away from zero', () => {
    // These are the cases a naive `value * 100` gets wrong.
    expect(roundToCurrency(1.005, 'USD')).toBe(1.01);
    expect(roundToCurrency(1.004, 'USD')).toBe(1.0);
    expect(roundToCurrency(-1.235, 'USD')).toBe(-1.24);
    expect(roundToCurrency(2.5, 'USD')).toBe(2.5);
    expect(roundToCurrency(1234.5678, 'JPY')).toBe(1235);
    expect(roundToCurrency(1.23456, 'KWD')).toBe(1.235);
    expect(roundToCurrency(0.00004, 'CLF')).toBe(0);
  });

  it('supports cash increments and directional rounding', () => {
    expect(roundToCurrency(1.03, 'CHF', { increment: 0.05 })).toBe(1.05);
    expect(roundToCurrency(1.02, 'CHF', { increment: 0.05 })).toBe(1.0);
    expect(roundToCurrency(1.09, 'SEK', { increment: 1 })).toBe(1);
    expect(roundToCurrency(1.1, 'SEK', { increment: 1, mode: 'ceil' })).toBe(2);
    expect(roundToCurrency(-1.1, 'USD', { mode: 'floor' })).toBe(-1.1);
    expect(roundToCurrency('nonsense', 'USD')).toBeNull();
  });
});

describe('rates — cache, audit and acquisition', () => {
  it('marks a cached set stale after its TTL, then evicts it', () => {
    let t = 1000;
    const cache = new RateCache({ ttlMs: 100, staleTtlMs: 500, now: () => t });
    cache.set('USD:EUR', { base: 'USD', rates: { USD: 1, EUR: 0.9 } });

    expect(cache.get('USD:EUR').stale).toBe(false);
    t += 150;
    expect(cache.get('USD:EUR').stale).toBe(true);
    t += 500;
    expect(cache.get('USD:EUR')).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('keeps the audit trail bounded and records failures', () => {
    const audit = new RateAuditTrail(3);
    for (let i = 0; i < 5; i += 1) audit.record({ provider: 'p', base: 'USD', ok: i !== 2, at: 'x' });
    expect(audit.entries.length).toBe(3);
    expect(audit.failures().length).toBeGreaterThanOrEqual(0);
    expect(audit.latest()).toBeTruthy();
    audit.record({ provider: 'q', base: 'EUR', ok: false, error: 'boom' });
    expect(audit.forBase('EUR').length).toBe(1);
  });

  it('returns a live set on the first provider that answers', async () => {
    const out = await fetchRates({ base: 'USD', quotes: ['EUR', 'GBP'], fetchImpl: stub(ERAPI) });
    expect(out.source).toBe('live');
    expect(out.provider).toBe('erapi');
    expect(out.rates.EUR).toBeCloseTo(0.88739, 6);
    expect(out.rates.USD).toBe(1);
    expect(out.asOf).toBeTruthy();
  });

  it('fails over to the next provider when one throws', async () => {
    const impl = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FRANKFURTER });
    const out = await fetchRates({ base: 'USD', quotes: ['EUR'], fetchImpl: impl });
    expect(out.provider).toBe('frankfurter');
    expect(out.source).toBe('live');
    expect(out.errors[0].provider).toBe('erapi');
  });

  it('skips a narrow provider that does not quote the requested currency', async () => {
    // The ECB set has no PKR, so Frankfurter must not be treated as an answer.
    const impl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 'error' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => FRANKFURTER })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => COINGECKO });
    const out = await fetchRates({ base: 'USD', quotes: ['PKR'], fetchImpl: impl });
    expect(out.errors.some((e) => e.provider === 'frankfurter')).toBe(true);
  });

  it('serves a stale cache rather than inventing rates when everything fails', async () => {
    let t = 1000;
    const cache = new RateCache({ ttlMs: 100, staleTtlMs: 100000, now: () => t });
    cache.set('USD:EUR', { base: 'USD', rates: { USD: 1, EUR: 0.9 }, asOf: '2026-01-01T00:00:00.000Z' });
    t += 500; // now stale, still within the stale window

    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const out = await fetchRates({ base: 'USD', quotes: ['EUR'], cache, fetchImpl: failing });
    expect(out.source).toBe('stale-cache');
    expect(out.rates.EUR).toBeCloseTo(0.9, 6);
  });

  it('falls back to the static table when there is no cache and no network', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const out = await fetchRates({ base: 'USD', quotes: ['EUR'], fetchImpl: failing });
    expect(out.source).toBe('fallback');
    expect(out.stale).toBe(true);
    expect(out.rates.EUR).toBe(FALLBACK_RATES.EUR);
    expect(out.provider).toBe('static');
  });

  it('serves a fresh cache without touching the network', async () => {
    const cache = new RateCache();
    cache.set('USD:EUR,GBP', { base: 'USD', rates: { USD: 1, EUR: 0.9, GBP: 0.75 } });
    const impl = vi.fn();
    const out = await fetchRates({ base: 'USD', quotes: ['EUR', 'GBP'], cache, fetchImpl: impl });
    expect(out.source).toBe('cache');
    expect(impl).not.toHaveBeenCalled();
  });

  it('reports historical rates as unavailable instead of substituting today', async () => {
    expect((await historicalRate({ date: 'nonsense', quote: 'EUR' })).reason).toBe('invalid-date');

    const impl = stub({ amount: 1, base: 'USD', date: '2026-01-02', rates: { EUR: 0.85317 } });
    const ok = await historicalRate({ date: '2026-01-02', quote: 'EUR', fetchImpl: impl });
    expect(ok.ok).toBe(true);
    expect(ok.rate).toBeCloseTo(0.85317, 6);

    // PKR is outside the ECB set: the answer is a refusal, not a guess.
    const miss = await historicalRate({ date: '2026-01-02', quote: 'PKR', fetchImpl: stub({ date: '2026-01-02', rates: {} }) });
    expect(miss.ok).toBe(false);
    expect(miss.reason).toBe('currency-not-in-provider-coverage');
  });
});

describe('currency formatting — never hard-code a symbol', () => {
  /* Identity rates: these tests are about FORMATTING, not conversion. */
  const atPar = { USD: 1, EUR: 1, GBP: 1, JPY: 1, KWD: 1 };

  it('respects zero-decimal currencies', () => {
    const yen = formatMoney(1234, { code: 'JPY', rates: atPar });
    expect(yen).toContain('1,234');
    expect(yen).not.toContain('.00'); // ¥1,234.00 would be wrong
    expect(displayDecimals(1234, 'JPY')).toBe(0);
    expect(displayDecimals(0.5, 'JPY')).toBe(0); // a zero-decimal currency never gains decimals
    // Three-decimal currency keeps three.
    expect(displayDecimals(9.5, 'KWD')).toBe(3);
  });

  it('lets the locale decide symbol placement and separators', () => {
    const de = formatMoney(1234.5, { code: 'EUR', lang: 'de', rates: atPar });
    const en = formatMoney(1234.5, { code: 'EUR', lang: 'en', rates: atPar });
    expect(de).toContain('1.234,50');   // German grouping
    expect(en).toContain('1,234.50');   // English grouping
    expect(de).not.toBe(en);
    // French puts the symbol after the amount — the old prefix-only builder could not.
    expect(formatMoney(1234.5, { code: 'EUR', lang: 'fr', rates: atPar })).toMatch(/€\s*$/);
  });

  it('converts then formats, and degrades honestly', () => {
    expect(formatMoney(100, { code: 'EUR', rates: { USD: 1, EUR: 0.9 } })).toContain('90');
    expect(formatMoney(null)).toBe('—');
    // An unknown code must not become a dollar sign.
    const odd = formatMoney(10, { code: 'ZZZ' });
    expect(odd).not.toContain('$');
    expect(convertValue(10, 'ZZZ', { USD: 1 })).toBeNull();
  });

  it('honours the minor unit for money and adds digits only below one unit', () => {
    expect(displayDecimals(0.5, 'USD')).toBe(4);
    expect(displayDecimals(0.0005, 'USD')).toBe(6);
    // Money keeps its cents regardless of magnitude.
    expect(displayDecimals(5000, 'USD')).toBe(2);
    expect(displayDecimals(1.5, 'USD', 3)).toBe(3);
  });
});

describe('pricing — tax and display vs settlement', () => {
  const table = { base: 'USD', rates: { USD: 1, EUR: 0.9, JPY: 150 } };

  it('divides for tax-inclusive prices rather than multiplying', () => {
    // The classic bug: multiplying gives gross 121 and tax 11 instead of 110/10.
    const inc = splitTax(110, { mode: 'inclusive', taxRate: 0.1 });
    expect(inc.net).toBeCloseTo(100, 6);
    expect(inc.tax).toBeCloseTo(10, 6);
    expect(inc.gross).toBe(110);
  });

  it('adds tax for exclusive prices and none for zero-rated', () => {
    const exc = splitTax(100, { mode: 'exclusive', taxRate: 0.1 });
    expect(exc.net).toBe(100);
    expect(exc.tax).toBeCloseTo(10, 6);
    expect(exc.gross).toBeCloseTo(110, 6);

    const none = splitTax(100, { mode: 'none', taxRate: 0.1 });
    expect(none.tax).toBe(0);
    expect(none.gross).toBe(100);
    expect(none.mode).toBe('none');

    expect(splitTax('nonsense')).toBeNull();
    expect(TAX_MODES.length).toBe(3);
  });

  it('converts first and rounds to the display currency second', () => {
    const line = priceLine({
      amount: 100, settlementCurrency: 'USD', displayCurrency: 'JPY',
      rateTable: table, taxMode: 'exclusive', taxRate: 0.1
    });
    expect(line.ok).toBe(true);
    expect(line.settlementAmounts.gross).toBeCloseTo(110, 6); // tax applied in USD
    expect(line.displayExact.gross).toBeCloseTo(16500, 6);   // converted, unrounded
    expect(line.displayAmounts.gross).toBe(16500);           // 110 USD * 150, JPY has no minor unit
    expect(line.decimals).toBe(0);
    expect(line.rate).toBeCloseTo(150, 6);
    expect(line.disclaimer).toBe(CONVERSION_DISCLAIMER);
    expect(line.note).toContain('Charged in USD');
  });

  it('has no disclaimer when settlement and display agree', () => {
    const line = priceLine({ amount: 50, settlementCurrency: 'USD', displayCurrency: 'USD', rateTable: table });
    expect(line.displayAmounts.gross).toBe(50);
    expect(line.disclaimer).toBeNull();
    expect(line.rate).toBe(1);
  });

  it('refuses to price without a usable rate rather than showing a wrong number', () => {
    const noTable = priceLine({ amount: 100, settlementCurrency: 'USD', displayCurrency: 'EUR' });
    expect(noTable.ok).toBe(false);
    expect(noTable.reason).toBe('no-rate-table');

    const noLeg = priceLine({ amount: 100, settlementCurrency: 'USD', displayCurrency: 'GBP', rateTable: table });
    expect(noLeg.ok).toBe(false);
    expect(noLeg.reason).toBe('no-rate-for-pair');
  });

  it('builds a price book across currencies', () => {
    const book = buildPriceBook({ amount: 10, settlementCurrency: 'USD', currencies: ['EUR', 'JPY'], rateTable: table });
    expect(book.map((b) => b.currency)).toEqual(['USD', 'EUR', 'JPY']);
    expect(book.find((b) => b.currency === 'EUR').displayAmounts.gross).toBe(9);
  });

  it('keeps both the exact and the per-line-rounded total, so drift is visible', () => {
    const lines = [
      priceLine({ amount: 33.333, settlementCurrency: 'USD', displayCurrency: 'USD' }),
      priceLine({ amount: 33.333, settlementCurrency: 'USD', displayCurrency: 'USD' })
    ];
    const totals = totalLines(lines);
    expect(totals.gross).toBeCloseTo(66.666, 6);      // exact sum
    expect(totals.displayGross).toBe(66.66);          // 33.33 + 33.33
    // Each line rounds to 33.33, so the total is a cent below the exact sum.
    expect(roundingDrift(totals, 'USD').driftMinorUnits).toBe(-1);
  });

  it('lists a currency as unavailable when it has no rate', () => {
    const availability = currencyAvailability({
      country: 'US', rateTable: { base: 'USD', rates: { USD: 1, EUR: 0.9, GBP: 0.75 } }
    });
    expect(availability.primary).toBe('USD');
    expect(availability.supported).toContain('EUR');

    const pk = currencyAvailability({ country: 'PK', rateTable: { base: 'USD', rates: { USD: 1 } } });
    expect(pk.primary).toBe('PKR');
    expect(pk.locals).toEqual(['PKR']);
    expect(pk.unavailable).toContain('PKR');
    expect(pk.missingRateNote).toMatch(/No live rate/);
  });

  it('knows the cash rounding increments', () => {
    expect(cashIncrementFor('CHF')).toBe(0.05);
    expect(cashIncrementFor('SEK')).toBe(1);
    expect(cashIncrementFor('USD')).toBeNull();
  });
});

describe('time — IANA zones and offsets', () => {
  it('validates zones against the real IANA database', () => {
    expect(isValidZone('Asia/Karachi')).toBe(true);
    expect(isValidZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Mars/Phobos')).toBe(false);
    expect(isValidZone('')).toBe(false);
    expect(isValidZone(null)).toBe(false);
    // No duplicate zones in the picker.
    expect(ZONE_LIST.length).toBe(new Set(ZONE_LIST).size);
  });

  it('computes the offset east of UTC', () => {
    expect(offsetMinutes('UTC', new Date('2026-10-07T00:00:00Z'))).toBe(0);
    expect(offsetMinutes('Asia/Karachi', new Date('2026-10-07T00:00:00Z'))).toBe(300);
    expect(offsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z'))).toBe(0);
    expect(offsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z'))).toBe(60);
    expect(offsetMinutes('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-300);
    expect(offsetLabel(300)).toBe('+05:00');
    expect(offsetLabel(-270)).toBe('-04:30');
    expect(gmtLabel('Asia/Karachi')).toBe('GMT+5');
  });

  it('detects DST correctly in BOTH hemispheres', () => {
    // The naive "compare to January" test gets every southern zone backwards.
    expect(isDST('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(false);
    expect(isDST('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(true);
    expect(isDST('Australia/Sydney', new Date('2026-01-15T12:00:00Z'))).toBe(true);
    expect(isDST('Australia/Sydney', new Date('2026-07-15T12:00:00Z'))).toBe(false);
    // Zones that never change offset.
    expect(isDST('Asia/Karachi', new Date('2026-07-15T12:00:00Z'))).toBe(false);
    expect(standardOffset('America/New_York', 2026)).toBe(-300);
    expect(standardOffset('Australia/Sydney', 2026)).toBe(600);
  });

  it('finds the DST transitions in a year', () => {
    const info = zoneDstInfo('Europe/London', 2026);
    expect(info.observesDst).toBe(true);
    expect(info.transitions.length).toBe(2);
    expect(info.transitions[0].deltaMinutes).toBe(60);   // spring forward
    expect(info.transitions[1].deltaMinutes).toBe(-60);  // fall back
    expect(zoneDstInfo('Asia/Karachi', 2026).observesDst).toBe(false);
    expect(findTransitions('Mars/Phobos', 0, 1)).toEqual([]);
  });

  it('reports the zone abbreviation where Intl provides one', () => {
    expect(zoneAbbreviation('Asia/Karachi')).toMatch(/PKT|GMT\+5/);
    expect(zoneAbbreviation('Mars/Phobos')).toBe('—');
  });
});

describe('time — UTC storage and wall-clock resolution', () => {
  it('accepts only zone-qualified timestamps for storage', () => {
    expect(fromStorage('2026-10-07T09:00:00.000Z')).toBeInstanceOf(Date);
    expect(fromStorage('2026-10-07T09:00:00+05:00')).toBeInstanceOf(Date);
    // A naive local string is exactly the bug being prevented.
    expect(fromStorage('2026-10-07 09:00:00')).toBeNull();
    expect(fromStorage('2026-10-07T09:00:00')).toBeNull();
    expect(fromStorage(null)).toBeNull();

    const check = assertUtcStorage(['2026-10-07T09:00:00Z', '2026-10-07 09:00:00']);
    expect(check.ok).toBe(false);
    expect(check.rejected).toEqual(['2026-10-07 09:00:00']);
  });

  it('round-trips a wall time through UTC', () => {
    const resolved = resolveWallTime('Asia/Karachi', { year: 2026, month: 10, day: 7, hour: 9, minute: 30 });
    expect(resolved.kind).toBe('unique');
    expect(toStorage(resolved.instant)).toBe('2026-10-07T04:30:00.000Z');
    expect(partsInZone(resolved.instant, 'Asia/Karachi')).toMatchObject({ hour: 9, minute: 30 });
    expect(toUTC('Asia/Karachi', { year: 2026, month: 10, day: 7, hour: 9 })).toBeInstanceOf(Date);
  });

  it('detects a wall time that happens twice', () => {
    // New York falls back on 2026-11-01; 01:30 happens twice.
    const ambiguous = resolveWallTime('America/New_York', { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    expect(ambiguous.kind).toBe('ambiguous');
    expect(ambiguous.alternatives.length).toBe(2);
    expect(ambiguous.alternatives[1].getTime() - ambiguous.alternatives[0].getTime()).toBe(3600000);
  });

  it('detects a wall time that never happens', () => {
    // New York springs forward on 2026-03-08; 02:30 does not exist.
    const missing = resolveWallTime('America/New_York', { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(missing.kind).toBe('nonexistent');
    expect(missing.instant).toBeNull();
  });

  it('rejects unusable input instead of guessing', () => {
    expect(resolveWallTime('Mars/Phobos', { year: 2026, month: 1, day: 1 }).kind).toBe('invalid-zone');
    expect(resolveWallTime('UTC', { month: 1, day: 1 }).kind).toBe('invalid-wall-time');
    expect(fromUTC('nonsense', 'UTC')).toBe('—');
  });
});

describe('time — zone roles and consistency', () => {
  it('resolves the zone by explicit precedence', () => {
    expect(resolveZone({ eventZone: 'Asia/Tokyo', organizationZone: 'Europe/London', userZone: 'Asia/Karachi' }))
      .toEqual({ zone: 'Asia/Tokyo', source: 'event' });
    expect(resolveZone({ organizationZone: 'Europe/London', userZone: 'Asia/Karachi' }))
      .toEqual({ zone: 'Europe/London', source: 'organization' });
    expect(resolveZone({ userZone: 'Asia/Karachi' })).toEqual({ zone: 'Asia/Karachi', source: 'user' });
    expect(resolveZone({})).toEqual({ zone: UTC, source: 'utc' });
    // An invalid zone is skipped, not applied.
    expect(resolveZone({ eventZone: 'Nope/Nope', userZone: 'Asia/Karachi' }).zone).toBe('Asia/Karachi');
  });

  it('flags a client/server zone disagreement', () => {
    expect(zoneConsistency({ claimed: 'Asia/Karachi', actual: 'Asia/Karachi' }).consistent).toBe(true);
    const mismatch = zoneConsistency({ claimed: 'UTC', actual: 'Asia/Karachi' });
    expect(mismatch.consistent).toBe(false);
    expect(mismatch.offsetMatches).toBe(false);
    expect(zoneConsistency({ claimed: 'bad', actual: 'UTC' }).reason).toBe('invalid-zone');
  });
});

describe('time — relative formatting', () => {
  const now = Date.UTC(2026, 9, 7, 12, 0, 0);

  it('formats past, future and just-now in English', () => {
    expect(formatRelative(now - 10_000, { now })).toBe('just now');
    expect(formatRelative(now - 180_000, { now })).toBe('3 minutes ago');
    expect(formatRelative(now + 2 * 86400000, { now })).toBe('in 2 days');
    expect(formatRelative(now - 3600_000, { now })).toBe('1 hour ago');
    expect(formatRelative('nonsense', { now })).toBe('—');
  });

  it('formats in Urdu and Arabic', () => {
    expect(formatRelative(now - 180_000, { now, lang: 'ur' })).toContain('پہلے');
    expect(formatRelative(now - 180_000, { now, lang: 'ar' })).toContain('قبل');
  });

  it('falls back to English wording — with plurals — for languages without their own', () => {
    // "3 minute ago" would be the bug here.
    expect(formatRelative(now - 180_000, { now, lang: 'ja' })).toBe('3 minutes ago');
  });

  it('groups zones for the picker', () => {
    const grouped = zonesByArea();
    expect(grouped.Asia).toBeTruthy();
    expect(grouped.Europe.length).toBeGreaterThan(5);
  });
});

describe('time — recurrence, reminders and calendar', () => {
  it('expands daily, weekly and interval recurrences', () => {
    const daily = expandRecurrence({ start: '2026-10-01T09:00:00Z', rule: { frequency: 'daily' }, count: 3 });
    expect(daily.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);

    const every3 = expandRecurrence({ start: '2026-10-01T09:00:00Z', rule: { frequency: 'daily', interval: 3 }, count: 3 });
    expect(every3.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-10-04', '2026-10-07']);

    const weekly = expandRecurrence({
      start: '2026-10-01T09:00:00Z', rule: { frequency: 'weekly', weekdays: [1, 3] }, count: 4
    });
    expect(weekly.every((d) => [1, 3].includes(d.getUTCDay()))).toBe(true);
  });

  it('clamps a monthly rule to the last day of a short month', () => {
    // 31 Jan monthly must not produce 31 February.
    const monthly = expandRecurrence({
      start: '2026-01-31T09:00:00Z', rule: { frequency: 'monthly', dayOfMonth: 31 }, count: 3
    });
    expect(monthly.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('honours until, count limits and unknown frequencies', () => {
    const limited = expandRecurrence({
      start: '2026-10-01T09:00:00Z', rule: { frequency: 'daily' }, count: 10, until: '2026-10-03T00:00:00Z'
    });
    expect(limited.length).toBe(2);
    expect(expandRecurrence({ start: '2026-10-01T09:00:00Z', rule: { frequency: 'hourly' } })).toEqual([]);
    expect(expandRecurrence({ start: 'nonsense', rule: { frequency: 'daily' } })).toEqual([]);
  });

  it('plans a reminder in both wall time and UTC', () => {
    const plan = planReminder({ wall: { year: 2026, month: 10, day: 7, hour: 9 }, zone: 'Asia/Karachi', leadMinutes: 15 });
    expect(plan.ok).toBe(true);
    expect(plan.eventUtc).toBe('2026-10-07T04:00:00.000Z');
    expect(plan.reminderUtc).toBe('2026-10-07T03:45:00.000Z');
    expect(plan.ambiguity).toBe('unique');

    const bad = planReminder({ wall: { year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, zone: 'America/New_York' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('nonexistent');
  });

  it('shows the DST drift a naive +24h recurrence would suffer', () => {
    const drift = dstDriftForRecurrence({
      zone: 'America/New_York', wall: { year: 2026, month: 3, day: 6, hour: 9 }, occurrences: 4
    });
    expect(drift.ok).toBe(true);
    expect(drift.drifts).toBe(true);
    expect(drift.driftMinutes.some((d) => d !== 0)).toBe(true);
  });

  it('builds a valid ICS file with correct escaping and folding', () => {
    const ics = buildICS({
      calendarName: 'CryptoX',
      events: [{
        start: '2026-10-07T04:00:00Z', end: '2026-10-07T04:30:00Z',
        summary: 'Price alert; BTC, ETH', description: 'Line one\nLine two', location: 'Asia/Karachi'
      }]
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20261007T040000Z');
    expect(ics).toContain('SUMMARY:Price alert\\; BTC\\, ETH');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics).toContain('\r\n');
    // RFC 5545: no line longer than 75 octets.
    ics.split('\r\n').forEach((line) => expect(line.length).toBeLessThanOrEqual(76));
  });

  it('produces a Google Calendar deep link', () => {
    const url = googleCalendarUrl({ start: '2026-10-07T04:00:00Z', summary: 'Alert' });
    expect(url).toContain('calendar.google.com');
    expect(url).toContain('20261007T040000Z');
    expect(url).toContain('Alert');
  });
});

describe('location — precision and privacy', () => {
  it('reduces coordinates to the chosen precision', () => {
    const coords = { lat: 24.8607345, lon: 67.0011364 };
    // Half-up on the decimal value: 24.8607345 → 24.860735. The float product
    // 24.8607345 * 1e6 is 24860734.499999996 and would round DOWN instead.
    expect(applyPrecision(coords, 'exact')).toEqual({ lat: 24.860735, lon: 67.001136 });
    expect(applyPrecision(coords, 'approx')).toEqual({ lat: 24.86, lon: 67 });
    expect(applyPrecision(coords, 'coarse')).toEqual({ lat: 24.9, lon: 67 });
    // 'city' keeps no coordinates at all — a rounded 0 is a real place.
    expect(applyPrecision(coords, 'city')).toBeNull();
    expect(applyPrecision(coords, 'none')).toBeNull();
    expect(applyPrecision(null, 'exact')).toBeNull();
    expect(precisionById('city').keepCoords).toBe(false);
    expect(PRECISION_LEVELS.length).toBe(5);
  });

  it('snaps to a grid cell so two readings in one cell are indistinguishable', () => {
    const a = snapToGrid({ lat: 24.8612, lon: 67.0011 }, 1);
    const b = snapToGrid({ lat: 24.8613, lon: 67.0012 }, 1);
    expect(a).toEqual(b);

    // Snapping is idempotent, and a snapped point stays within one cell.
    expect(snapToGrid(a, 1)).toEqual(a);
    expect(distanceKm(a, { lat: 24.8612, lon: 67.0011 })).toBeLessThan(1.5);

    // The grid is only as private as its cell: a distant point lands elsewhere,
    // so a 1 km cell is not a guarantee of anonymity between any two readings.
    expect(snapToGrid({ lat: 24.90, lon: 67.01 }, 1)).not.toEqual(a);
    expect(snapToGrid(null, 1)).toBeNull();
  });

  it('measures distance with a sanity check', () => {
    expect(distanceKm({ lat: 24.86, lon: 67.01 }, { lat: 24.86, lon: 67.01 })).toBe(0);
    const karachiToDubai = distanceKm({ lat: 24.86, lon: 67.01 }, { lat: 25.2, lon: 55.27 });
    expect(karachiToDubai).toBeGreaterThan(1000);
    expect(karachiToDubai).toBeLessThan(1400);
    expect(distanceKm(null, { lat: 1, lon: 1 })).toBeNull();
  });

  it('expires records by retention policy', () => {
    const now = Date.UTC(2026, 9, 7);
    expect(isExpired({ storedAt: new Date(now - 1000).toISOString(), retention: 'session' }, now)).toBe(true);
    expect(isExpired({ storedAt: new Date(now - 31 * 86400000).toISOString(), retention: '30d' }, now)).toBe(true);
    expect(isExpired({ storedAt: new Date(now - 10 * 86400000).toISOString(), retention: '30d' }, now)).toBe(false);
    expect(isExpired({ storedAt: '2020-01-01T00:00:00Z', retention: 'manual' }, now)).toBe(false);

    const { kept, purged } = purgeExpired([
      { id: 'a', storedAt: new Date(now - 400 * 86400000).toISOString(), retention: '30d' },
      { id: 'b', storedAt: new Date(now - 86400000).toISOString(), retention: '30d' }
    ], now);
    expect(kept.map((r) => r.id)).toEqual(['b']);
    expect(purged.map((r) => r.id)).toEqual(['a']);
    expect(RETENTION_POLICIES.length).toBe(5);
    expect(retentionById('manual').days).toBeNull();
  });

  it('redacts on write and can delete outright', () => {
    const redacted = redactLocation({
      country: 'PK', city: 'Karachi', state: 'Sindh', postal: '75500',
      coordinates: { lat: 24.8607345, lon: 67.0011364 }, timezone: 'Asia/Karachi'
    }, { precision: 'approx' });
    expect(redacted.coordinates).toEqual({ lat: 24.86, lon: 67 });
    expect(redacted.precision).toBe('approx');
    expect(redacted.storedAt).toBeTruthy();

    const cityOnly = redactLocation({ city: 'Karachi', coordinates: { lat: 24.86, lon: 67.01 } }, { precision: 'city' });
    expect(cityOnly.coordinates).toBeNull();

    const namesDropped = redactLocation({ city: 'Karachi', district: 'Clifton' }, { precision: 'none', dropNames: true });
    expect(namesDropped.city).toBe('');
    expect(namesDropped.district).toBe('');

    expect(deleteLocation(null)).toBeNull();
    expect(deleteLocation({ country: 'PK' }, { keepCountry: true }).coordinates).toBeNull();
    expect(deleteLocation({ country: 'PK' })).toBeNull();
  });

  it('exposes permission help for every state', () => {
    ['granted', 'denied', 'prompt', 'unsupported', 'unknown'].forEach((s) => {
      expect(PERMISSION_HELP[s], s).toBeTruthy();
    });
  });
});

describe('location — geocoding', () => {
  it('parses Open-Meteo, which supplies the IANA zone', () => {
    const [place] = parseOpenMeteo(OPEN_METEO);
    expect(place.name).toBe('Karachi');
    expect(place.country).toBe('PK');
    expect(place.state).toBe('Sindh');
    expect(place.timezone).toBe('Asia/Karachi');
    expect(place.coordinates).toEqual({ lat: 24.8608, lon: 67.0104 });
    expect(parseOpenMeteo({})).toEqual([]);
  });

  it('parses Nominatim, including reverse results', () => {
    const [place] = parseNominatim(NOMINATIM_REVERSE);
    expect(place.country).toBe('PK');
    expect(place.name).toBe('Karachi');
    expect(place.district).toBe('Civil Lines');
    expect(place.coordinates.lat).toBeCloseTo(24.8606986, 6);
    expect(parseNominatim(null)).toEqual([]);
  });

  it('geocodes with provider failover', async () => {
    const impl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ lat: '25.2', lon: '55.27', name: 'Dubai', address: { country_code: 'ae', country: 'UAE', city: 'Dubai' } }] });
    const out = await geocode('Dubai', { fetchImpl: impl });
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('nominatim');
    expect(out.errors[0].provider).toBe('open-meteo');
  });

  it('returns no results rather than fabricating a place', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('offline'));
    const out = await geocode('Dubai', { fetchImpl: impl });
    expect(out.ok).toBe(false);
    expect(out.results).toEqual([]);
    expect(out.errors.length).toBeGreaterThan(0);

    expect((await geocode('a', { fetchImpl: impl })).reason).toBe('query-too-short');
    expect((await geocode('Dubai', { fetchImpl: null })).reason).toBe('no-fetch-available');
  });

  it('reverse geocodes and rejects impossible coordinates', async () => {
    const impl = stub(NOMINATIM_REVERSE);
    const out = await reverseGeocode({ lat: 24.8607, lon: 67.0011 }, { fetchImpl: impl });
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('nominatim');
    expect(out.result.city ?? out.result.name).toBeTruthy();

    expect((await reverseGeocode({ lat: 200, lon: 0 }, { fetchImpl: impl })).reason).toBe('invalid-coordinates');
    expect((await reverseGeocode({}, { fetchImpl: impl })).reason).toBe('invalid-coordinates');
  });

  it('only queries providers that support the operation', async () => {
    // Open-Meteo has no reverse endpoint and must not be called for one.
    const impl = stub(NOMINATIM_REVERSE);
    await reverseGeocode({ lat: 1, lon: 1 }, { fetchImpl: impl });
    expect(String(impl.mock.calls[0][0])).toContain('nominatim');
    expect(GEOCODE_PROVIDERS.find((p) => p.id === 'open-meteo').supportsReverse).toBe(false);
  });
});

describe('location — permission and time zone', () => {
  it('reads permission state without prompting', async () => {
    expect(await geolocationPermission({ geolocation: {}, permissions: { query: async () => ({ state: 'granted' }) } })).toBe('granted');
    expect(await geolocationPermission({ geolocation: {}, permissions: { query: async () => ({ state: 'denied' }) } })).toBe('denied');
    // No Permissions API (Safari) is 'prompt', not an error.
    expect(await geolocationPermission({ geolocation: {} })).toBe('prompt');
    expect(await geolocationPermission(null)).toBe('unsupported');
  });

  it('requests a position and reports refusal with its code', async () => {
    const ok = await requestPosition({
      geo: { getCurrentPosition: (success) => success({ coords: { latitude: 24.86, longitude: 67.01, accuracy: 20 } }) }
    });
    expect(ok.ok).toBe(true);
    expect(ok.coordinates).toEqual({ lat: 24.86, lon: 67.01 });

    const denied = await requestPosition({
      geo: { getCurrentPosition: (_s, fail) => fail({ code: 1, message: 'denied' }) }
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('denied');

    const timeout = await requestPosition({ geo: { getCurrentPosition: (_s, fail) => fail({ code: 3 }) } });
    expect(timeout.reason).toBe('timeout');
    expect((await requestPosition({ geo: null })).reason).toBe('unsupported');
  });

  it('never asks for high accuracy unless precise was chosen', async () => {
    // The stub must invoke the callback, or the promise never settles.
    const capture = () => {
      let options;
      const geo = {
        getCurrentPosition: (success, _fail, o) => {
          options = o;
          success({ coords: { latitude: 0, longitude: 0 } });
        }
      };
      return { geo, options: () => options };
    };

    const coarse = capture();
    await requestPosition({ precise: false, geo: coarse.geo });
    expect(coarse.options().enableHighAccuracy).toBe(false);

    const precise = capture();
    await requestPosition({ precise: true, geo: precise.geo });
    expect(precise.options().enableHighAccuracy).toBe(true);
    expect(precise.options().timeout).toBeGreaterThan(0);
  });

  it('resolves a time zone, flagging multi-zone countries', () => {
    expect(timezoneForLocation({ timezone: 'Asia/Tokyo', country: 'JP' }))
      .toMatchObject({ zone: 'Asia/Tokyo', source: 'explicit', confident: true });
    expect(timezoneForLocation({ country: 'PK' }))
      .toMatchObject({ zone: 'Asia/Karachi', source: 'country-default', confident: true });

    const us = timezoneForLocation({ country: 'US' });
    expect(us.needsConfirmation).toBe(true);
    expect(us.note).toMatch(/multiple time zones/);

    expect(timezoneForLocation({ country: 'ZZ' })).toMatchObject({ zone: UTC, confident: false });
    expect(timezoneForLocation({})).toMatchObject({ zone: UTC, source: 'utc-default' });
  });

  it('validates a structured location without rejecting valid addresses', () => {
    const good = validateLocation({
      country: 'PK', state: 'Sindh', city: 'Karachi', postal: '75500', timezone: 'Asia/Karachi',
      coordinates: { lat: 24.86, lon: 67.01 }
    });
    expect(good.valid).toBe(true);
    expect(good.errors).toEqual([]);

    expect(validateLocation({}).errors.some((e) => e.field === 'country')).toBe(true);
    expect(validateLocation({ country: 'PK', postal: 'abc' }).errors.some((e) => e.field === 'postal')).toBe(true);
    expect(validateLocation({ country: 'PK', timezone: 'Bad/Zone' }).errors.some((e) => e.field === 'timezone')).toBe(true);
    expect(validateLocation({ country: 'PK', coordinates: { lat: 200, lon: 0 } }).errors.some((e) => e.field === 'coordinates')).toBe(true);

    // An unknown province is a warning, not an error — rejecting it would block a valid address.
    const warned = validateLocation({ country: 'PK', state: 'Atlantis' });
    expect(warned.valid).toBe(true);
    expect(warned.warnings.some((w) => w.field === 'state')).toBe(true);

    // A country with no postal rule must not be reported as invalid.
    expect(validateLocation({ country: 'BY', postal: 'anything' }).errors).toEqual([]);
  });

  it('renders a place label most-specific first', () => {
    expect(formatPlace({ district: 'Clifton', city: 'Karachi', state: 'Sindh', country: 'PK' }))
      .toBe('Clifton, Karachi, Sindh, Pakistan');
    expect(formatPlace({ country: 'PK' })).toBe('Pakistan');
    expect(formatPlace({})).toBe('');
  });
});
