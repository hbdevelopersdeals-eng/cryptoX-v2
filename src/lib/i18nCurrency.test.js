import { describe, it, expect } from 'vitest';
import { translate } from './translate.js';
import { LANGUAGES, languageByCode, dirFor } from './locales.js';
import en from '../locales/en.js';
import ur from '../locales/ur.js';
import { CURRENCIES, FALLBACK_RATES, convertValue, formatMoney, currencyByCode } from './currency.jsx';

/* The language layer is exercised in depth by locale.test.js; these are the
 * baseline behaviours the old two-language implementation also guaranteed. */
const tables = { en, ur };

describe('i18n', () => {
  it('translates known keys in both languages', () => {
    expect(translate(tables, 'en', 'nav.markets')).toBe('Markets');
    expect(translate(tables, 'ur', 'nav.markets')).toBe(ur['nav.markets']);
    expect(translate(tables, 'ur', 'nav.markets')).not.toBe('Markets');
  });

  it('falls back to English, then to the key itself', () => {
    expect(translate(tables, 'ur', 'common.loading')).toBe(ur['common.loading']);
    expect(translate(tables, 'zz', 'nav.markets')).toBe('Markets'); // unknown lang → en
    expect(translate(tables, 'en', 'does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates placeholders', () => {
    expect(translate(tables, 'en', 'greeting', { name: 'Ali' })).toBe('greeting'); // key missing → key
    tables.en.greeting = 'Hello {name}';
    expect(translate(tables, 'en', 'greeting', { name: 'Ali' })).toBe('Hello Ali');
    delete tables.en.greeting;
  });

  it('keeps language metadata consistent', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(25);
    expect(LANGUAGES.map((l) => l.code)).toContain('en');
    expect(dirFor('ur')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
    expect(languageByCode('zz')).toBeNull(); // callers must handle an unknown code
  });
});

describe('currency', () => {
  it('converts from USD using the rate table', () => {
    expect(convertValue(100, 'USD', FALLBACK_RATES)).toBe(100);
    expect(convertValue(100, 'EUR', FALLBACK_RATES)).toBeCloseTo(92, 6);
    expect(convertValue(null, 'EUR')).toBeNull();
  });

  it('formats with the right symbol and rounding', () => {
    expect(formatMoney(1234.5, { code: 'USD' })).toBe('$1,235');
    expect(formatMoney(12.345, { code: 'USD' })).toBe('$12.35');
    expect(formatMoney(1_500_000, { code: 'USD', compact: true })).toBe('$1.50M');
    expect(formatMoney(278, { code: 'PKR' })).toContain('₨');
    expect(formatMoney(null)).toBe('—');
  });

  it('handles negative values and tiny prices', () => {
    expect(formatMoney(-5, { code: 'USD' })).toBe('-$5.00');
    expect(formatMoney(0.0000123, { code: 'USD' })).toContain('$0.000012');
  });

  it('keeps the currency list unique and resolvable', () => {
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
    expect(currencyByCode('PKR').symbol).toBe('₨');
    expect(currencyByCode('NOPE').code).toBe('USD');
  });
});
