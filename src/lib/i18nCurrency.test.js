import { describe, it, expect } from 'vitest';
import { translate, TRANSLATIONS, LANGUAGES, languageByCode } from './i18n.jsx';
import { CURRENCIES, FALLBACK_RATES, convertValue, formatMoney, currencyByCode } from './currency.jsx';

describe('i18n', () => {
  it('translates known keys in both languages', () => {
    expect(translate('en', 'nav.markets')).toBe('Markets');
    expect(translate('ur', 'nav.markets')).toBe('مارکیٹس');
  });

  it('falls back to English, then to the key itself', () => {
    expect(translate('ur', 'common.loading')).toBe('لوڈ ہو رہا ہے…');
    expect(translate('fr', 'nav.markets')).toBe('Markets'); // unknown lang → en
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates placeholders', () => {
    expect(translate('en', 'greeting', { name: 'Ali' })).toBe('greeting'); // key missing → key
    TRANSLATIONS.en.greeting = 'Hello {name}';
    expect(translate('en', 'greeting', { name: 'Ali' })).toBe('Hello Ali');
    delete TRANSLATIONS.en.greeting;
  });

  it('keeps language metadata consistent', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ur']);
    expect(languageByCode('ur').dir).toBe('rtl');
    expect(languageByCode('zz').code).toBe('en'); // safe default
  });

  it('has no empty strings in either table', () => {
    Object.entries(TRANSLATIONS).forEach(([lang, table]) => {
      Object.entries(table).forEach(([key, value]) => {
        expect(value, `${lang}:${key}`).toBeTruthy();
      });
    });
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
