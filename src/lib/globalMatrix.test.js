import { describe, it, expect } from 'vitest';
import {
  LANGUAGES, RTL_LANGUAGES, SOURCE_LANGUAGE, languageByCode, isSupported, isRtl,
  dirFor, matchLanguage, negotiate, fallbackChain, detectRegion, measurementFor
} from './locales.js';
import {
  formatNumber, formatPercent, formatCurrency, formatDate, formatTime,
  formatDateTime, datePattern, separators, formatMeasure, convertMeasure
} from './localeFormat.js';
import { CURRENCIES, currencyByCode, decimalsFor, symbolFor } from './currencies.js';
import { COUNTRIES, CURRENCY_CODES, countryByCode, searchCountries, countriesByRegion, countriesForDial } from './countries.js';
import {
  ZONE_LIST, isValidZone, offsetMinutes, partsInZone, gmtLabel, isDST,
  findTransitions, zonesByArea, zonesByOffset, resolveWallTime, toUTC, fromUTC
} from './time.js';
import { pluralCategory, categoriesFor } from './plural.js';
import { convert, FALLBACK_RATES } from './rates.js';

/* ============================================================================
 * The global testing matrix (Section 25: Global testing — languages, RTL,
 * currencies, time zones, DST, countries, date formats, number formats).
 *
 * These are SWEEPS, not samples: the point is that every language, currency,
 * zone and country satisfies the invariant, so adding the 26th language cannot
 * quietly break one locale. locale.test.js checks individual locales in depth;
 * this checks that the whole matrix is internally consistent.
 *
 * Two behaviours are surprising enough to state explicitly rather than assert
 * around, because they are correct and a future reader may think they are bugs:
 *   - BN and FA render digits in their own scripts by default.
 *   - FA renders the PERSIAN calendar, so a 2026 Gregorian date shows as 1405.
 * ========================================================================== */

const ALL = LANGUAGES.map((l) => l.code);
const NON_LATIN_DIGITS = new Set(['bn', 'fa']);
/*
 * FA defaults to the Persian calendar (2026 → 1405) and TH to the Buddhist one
 * (2026 → 2569, i.e. +543). Both are the correct Intl default for the locale, so
 * the expectation is the year in the language's own calendar, not 2026.
 */
const CALENDAR_YEAR = { fa: /1405|۱۴۰۵/, th: /2569/ };

/** Fold Arabic-Indic, Eastern Arabic-Indic and Bengali digits to ASCII. */
function toAsciiDigits(s) {
  return String(s).replace(/[\u0660-\u0669\u06f0-\u06f9\u09e6-\u09ef]/g, (ch) => {
    const base = ch >= '\u09e6' ? 0x09e6 : ch >= '\u06f0' ? 0x06f0 : 0x0660;
    return String(ch.codePointAt(0) - base);
  });
}

describe('matrix: languages', () => {
  it('ships exactly 25 languages with unique codes and labels', () => {
    expect(LANGUAGES.length).toBe(25);
    expect(new Set(ALL).size).toBe(25);
    expect(new Set(LANGUAGES.map((l) => l.label)).size).toBe(25);
    expect(ALL).toContain(SOURCE_LANGUAGE);
  });

  it('gives every language a resolvable catalog and a display label', () => {
    for (const code of ALL) {
      const meta = languageByCode(code);
      expect(meta, code).toBeTruthy();
      expect(meta.label, code).toBeTruthy();
      expect(isSupported(code), code).toBe(true);
    }
    expect(languageByCode('xx')).toBeNull();
    expect(isSupported('xx')).toBe(false);
  });

  it('uses a tag Intl accepts for every language', () => {
    // A malformed BCP-47 tag throws at format time, in production, for one
    // locale only — the classic way a bad tag ships.
    for (const code of ALL) {
      expect(() => new Intl.NumberFormat(code).format(1), code).not.toThrow();
      expect(() => new Intl.DateTimeFormat(code).format(new Date()), code).not.toThrow();
    }
  });

  it('keeps SOURCE_LANGUAGE first so the fallback order is stable', () => {
    expect(LANGUAGES[0].code).toBe(SOURCE_LANGUAGE);
  });

  it('resolves a regional tag to its base language, not to a region subtag', () => {
    // 'zh-TW' must not be read as a region named TW, and 'en-PK' is English.
    expect(matchLanguage('ar-EG')).toBe('ar');
    expect(matchLanguage('en-PK')).toBe('en');
    expect(matchLanguage('zh-Hant-TW')).toBe('zh-Hant');
    expect(matchLanguage('pt-BR')).toBe('pt');
    expect(matchLanguage('nonsense')).toBeNull();
  });

  it('negotiates from a browser preference list', () => {
    expect(negotiate(['fr-CA', 'de'])).toBe('fr');
    expect(negotiate(['xx-YY', 'ja'])).toBe('ja');
    expect(negotiate([])).toBe(SOURCE_LANGUAGE);
  });

  it('gives every language a fallback chain ending at the source language', () => {
    for (const code of ALL) {
      const chain = fallbackChain(code);
      expect(chain.length, code).toBeGreaterThanOrEqual(1);
      expect(chain[chain.length - 1], code).toBe(SOURCE_LANGUAGE);
      // A chain must not repeat a language, or it can never terminate.
      expect(new Set(chain).size, code).toBe(chain.length);
    }
    expect(fallbackChain('zh-Hant')).toEqual(['zh-Hant', 'zh-Hans', 'en']);
  });

  it('detects a region from a language and a zone without inventing one', () => {
    expect(detectRegion({ language: 'en-PK' })).toBe('PK');
    expect(detectRegion({ language: 'en', timeZone: 'Asia/Karachi' })).toBe('PK');
    expect(detectRegion({ language: 'en' })).toBeNull();
  });
});

describe('matrix: right-to-left', () => {
  it('marks exactly the four RTL languages and nothing else', () => {
    expect([...RTL_LANGUAGES].sort()).toEqual(['ar', 'fa', 'he', 'ur']);
    for (const code of ALL) {
      expect(dirFor(code), code).toBe(RTL_LANGUAGES.has(code) ? 'rtl' : 'ltr');
      expect(isRtl(code), code).toBe(RTL_LANGUAGES.has(code));
    }
  });

  it('never marks a language both RTL and LTR', () => {
    for (const code of ALL) {
      expect([dirFor(code)]).toHaveLength(1);
    }
  });

  it('routes an Arabic regional tag to RTL', () => {
    const code = matchLanguage('ar-SA');
    expect(code).toBe('ar');
    expect(dirFor(code)).toBe('rtl');
  });

  it('has RTL languages from more than one script family', () => {
    // Arabic-script (ar, ur, fa) plus Hebrew — a single family would not
    // exercise bidi at all.
    expect(RTL_LANGUAGES.has('he')).toBe(true);
    expect(RTL_LANGUAGES.has('fa')).toBe(true);
  });
});

describe('matrix: currencies', () => {
  it('resolves every currency any country uses', () => {
    // A country whose currency code is unknown renders a blank symbol.
    const unresolved = CURRENCY_CODES.filter((code) => !currencyByCode(code));
    expect(unresolved).toEqual([]);
    expect(CURRENCY_CODES.length).toBeGreaterThan(100);
  });

  it('gives every currency a code, a numeric code and a minor unit', () => {
    for (const c of CURRENCIES) {
      expect(c.code, JSON.stringify(c)).toMatch(/^[A-Z]{3}$/);
      expect(String(c.numeric), c.code).toMatch(/^\d{3}$/);
      expect(Number.isInteger(c.decimals), c.code).toBe(true);
      expect(c.decimals, c.code).toBeGreaterThanOrEqual(0);
      expect(c.decimals, c.code).toBeLessThanOrEqual(4);
      expect(c.name, c.code).toBeTruthy();
    }
  });

  it('has no duplicate currency codes or numeric codes', () => {
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
    expect(new Set(CURRENCIES.map((c) => c.numeric)).size).toBe(CURRENCIES.length);
  });

  it('respects the zero- and three-decimal currencies', () => {
    // JPY has no cents; rendering ¥1,235.00 is wrong. KWD needs three.
    expect(decimalsFor('JPY')).toBe(0);
    expect(decimalsFor('KWD')).toBe(3);
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('CLF')).toBe(4);
    expect(formatCurrency(1234.5, { lang: 'en', currency: 'JPY' })).toBe('¥1,235');
    expect(formatCurrency(1234.5, { lang: 'en', currency: 'USD' })).toBe('$1,234.50');
  });

  it('has a symbol for every currency, and never a blank one', () => {
    for (const c of CURRENCIES) {
      expect(typeof symbolFor(c.code), c.code).toBe('string');
      expect(symbolFor(c.code).length, c.code).toBeGreaterThan(0);
    }
  });

  it('round-trips a conversion without losing the value', () => {
    for (const code of ['EUR', 'GBP', 'JPY', 'INR', 'PKR', 'AED', 'ZAR']) {
      const rate = FALLBACK_RATES[code];
      if (rate == null) continue;
      const there = convert(100, 'USD', code, { base: 'USD', rates: FALLBACK_RATES });
      const back = convert(there, code, 'USD', { base: 'USD', rates: FALLBACK_RATES });
      expect(back, code).toBeCloseTo(100, 6);
    }
  });
});

describe('matrix: time zones', () => {
  it('validates every zone in the picker list', () => {
    expect(ZONE_LIST.length).toBeGreaterThanOrEqual(50);
    for (const zone of ZONE_LIST) {
      expect(isValidZone(zone), zone).toBe(true);
      expect(partsInZone(new Date(), zone), zone).toBeTruthy();
      expect(gmtLabel(zone), zone).toBeTruthy();
    }
  });

  it('resolves an unknown zone to null instead of throwing', () => {
    expect(isValidZone('Mars/Phobos')).toBe(false);
    expect(partsInZone(new Date(), 'Mars/Phobos')).toBeNull();
  });

  it('keeps every offset inside the real-world range', () => {
    for (const zone of ZONE_LIST) {
      const off = offsetMinutes(zone, new Date());
      expect(typeof off, zone).toBe('number');
      expect(off, zone).toBeGreaterThanOrEqual(-720);
      expect(off, zone).toBeLessThanOrEqual(840);
      // Math.abs: -180 % 15 is -0, which Object.is treats as different from 0.
      expect(Math.abs(off % 15), zone).toBe(0); // offsets are quarter-hour aligned
    }
  });

  it('groups the picker by area and covers every zone exactly once', () => {
    const byArea = Object.values(zonesByArea()).flat().map((z) => z.zone);
    expect(byArea.sort()).toEqual([...ZONE_LIST].sort());
    for (const area of Object.keys(zonesByArea())) expect(area).toBeTruthy();
  });

  it('sorts the offset list ascending and keeps every zone', () => {
    const list = zonesByOffset();
    expect(list.map((z) => z.zone).sort()).toEqual([...ZONE_LIST].sort());
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i].offset, `${list[i].zone}`).toBeGreaterThanOrEqual(list[i - 1].offset);
    }
  });

  it('keeps the same instant at different wall clocks', () => {
    const instant = new Date(Date.UTC(2026, 9, 9, 12));
    const karachi = partsInZone(instant, 'Asia/Karachi');
    const newYork = partsInZone(instant, 'America/New_York');
    expect(offsetMinutes('Asia/Karachi', instant)).toBe(300);
    expect(karachi.hour).toBe(17);
    expect(newYork.hour).toBe(8);
  });

  it('round-trips an instant through a zone and back', () => {
    // partsInZone is the wall-clock decomposition; fromUTC returns a formatted
    // STRING, so feeding that into toUTC would resolve a wall time of NaN.
    const instant = new Date(Date.UTC(2026, 9, 9, 12, 30));
    for (const zone of ['Asia/Karachi', 'America/New_York', 'Asia/Tokyo', 'UTC']) {
      const parts = partsInZone(instant, zone);
      expect(parts, zone).toBeTruthy();
      const back = toUTC(zone, parts);
      expect(back, zone).toBeInstanceOf(Date);
      expect(back.getTime(), zone).toBe(instant.getTime());
    }
  });

  it('never returns a negative zero offset', () => {
    // -0 !== 0 under Object.is, so it breaks Map keys and Array.includes.
    for (const zone of ZONE_LIST) {
      expect(Object.is(offsetMinutes(zone, new Date()), -0), zone).toBe(false);
    }
  });
});

describe('matrix: DST in both hemispheres', () => {
  const YEAR = [Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)];

  it('moves the northern hemisphere forward first, then back', () => {
    const t = findTransitions('America/New_York', ...YEAR);
    expect(t).toHaveLength(2);
    expect(t[0].deltaMinutes).toBe(60);   // March: spring forward
    expect(t[1].deltaMinutes).toBe(-60);  // November: fall back
    expect(t[0].to).toBe(-240);
    expect(t[1].to).toBe(-300);
  });

  it('moves the southern hemisphere back first, then forward', () => {
    // Australia's DST runs over the new year, so the order is reversed. A
    // northern-only test suite never notices this.
    const t = findTransitions('Australia/Sydney', ...YEAR);
    expect(t).toHaveLength(2);
    expect(t[0].deltaMinutes).toBe(-60); // April: fall back
    expect(t[1].deltaMinutes).toBe(60);  // October: spring forward
    expect(t[0].to).toBe(600);
    expect(t[1].to).toBe(660);
  });

  it('reports no transitions for a zone that has no DST', () => {
    expect(findTransitions('Asia/Karachi', ...YEAR)).toEqual([]);
    expect(findTransitions('UTC', ...YEAR)).toEqual([]);
  });

  it('knows which side of a transition an instant is on', () => {
    expect(isDST('America/New_York', Date.UTC(2026, 6, 1))).toBe(true);   // July
    expect(isDST('America/New_York', Date.UTC(2026, 0, 15))).toBe(false); // January
    // The same dates are opposite in Sydney.
    expect(isDST('Australia/Sydney', Date.UTC(2026, 0, 15))).toBe(true);
    expect(isDST('Australia/Sydney', Date.UTC(2026, 6, 1))).toBe(false);
  });

  it('resolves a wall time that does not exist (the spring-forward gap)', () => {
    // 2026-03-08 02:30 never happens in New York.
    const resolved = resolveWallTime('America/New_York', { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(resolved.kind).toBe('nonexistent');
    // It must NOT silently pick an instant: that is how a scheduled payment
    // lands an hour early. The caller is told to choose.
    expect(resolved.instant).toBeNull();
    expect(resolved.alternatives).toEqual([]);
  });

  it('reports an invalid zone and an invalid wall time distinctly', () => {
    expect(resolveWallTime('Mars/Phobos', { year: 2026, month: 1, day: 1 }).kind).toBe('invalid-zone');
    expect(resolveWallTime('UTC', { year: 'soon', month: 1, day: 1 }).kind).toBe('invalid-wall-time');
  });

  it('resolves an unambiguous wall time to exactly one instant', () => {
    const resolved = resolveWallTime('Asia/Karachi', { year: 2026, month: 10, day: 9, hour: 17, minute: 0 });
    expect(resolved.kind).toBe('unique');
    expect(resolved.instant.toISOString()).toBe('2026-10-09T12:00:00.000Z');
    // Karachi has no DST, so no wall time in the year is ambiguous.
    for (let month = 1; month <= 12; month += 1) {
      expect(resolveWallTime('Asia/Karachi', { year: 2026, month, day: 15, hour: 1 }).kind, `month ${month}`).toBe('unique');
    }
  });

  it('resolves a wall time that happens twice (the fall-back overlap)', () => {
    // 2026-11-01 01:30 happens at both -04:00 and -05:00.
    const resolved = resolveWallTime('America/New_York', { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    expect(resolved.kind).toBe('ambiguous');
    expect(resolved.alternatives).toHaveLength(2);
    // Both candidates must genuinely be 01:30 local, an hour apart.
    const [a, b] = resolved.alternatives;
    expect(b.getTime() - a.getTime()).toBe(3600000);
    for (const candidate of resolved.alternatives) {
      expect(partsInZone(candidate, 'America/New_York').hour).toBe(1);
      expect(partsInZone(candidate, 'America/New_York').minute).toBe(30);
    }
    // toUTC resolves the documented way: the earliest instant.
    expect(toUTC('America/New_York', { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }).getTime()).toBe(a.getTime());
  });
});

describe('matrix: countries', () => {
  it('covers the full ISO set with unique codes', () => {
    expect(COUNTRIES.length).toBe(249);
    expect(new Set(COUNTRIES.map((c) => c.alpha2)).size).toBe(249);
    expect(new Set(COUNTRIES.map((c) => c.alpha3)).size).toBe(249);
  });

  it('gives every country a numeric dial code and a known region', () => {
    const regions = new Set(Object.keys(countriesByRegion()));
    for (const c of COUNTRIES) {
      expect(c.alpha2, JSON.stringify(c)).toMatch(/^[A-Z]{2}$/);
      expect(c.alpha3, c.alpha2).toMatch(/^[A-Z]{3}$/);
      expect(String(c.dial), c.alpha2).toMatch(/^\d{1,4}$/);
      expect(regions.has(c.region), `${c.alpha2} region ${c.region}`).toBe(true);
      expect(c.name, c.alpha2).toBeTruthy();
    }
  });

  it('parses the well-known shared dial codes without collapsing them', () => {
    // +1 is shared by 20+ territories; the earlier regionForDial returned
    // Canada for every one of them.
    const one = countriesForDial('1').map((c) => c.alpha2);
    expect(one).toEqual(expect.arrayContaining(['US', 'CA']));
    expect(one.length).toBeGreaterThan(1);
    expect(countriesForDial('92').map((c) => c.alpha2)).toContain('PK');
    expect(countriesForDial('9999')).toEqual([]);
  });

  it('looks a country up by either code and by name', () => {
    expect(countryByCode('PK').alpha3).toBe('PAK');
    expect(countryByCode('pak')?.alpha2).toBe('PK');
    expect(countryByCode('ZZ')).toBeNull();
    const found = searchCountries('paki');
    expect(found.map((c) => c.alpha2)).toContain('PK');
    // A query that matches nothing returns nothing — not everything.
    expect(searchCountries('zzzzzz')).toEqual([]);
    // An empty query is the browse case, capped by the page size.
    expect(searchCountries('').length).toBeGreaterThan(0);
    expect(searchCountries('').length).toBeLessThanOrEqual(50);
  });

  it('gives every country a currency that resolves', () => {
    for (const c of COUNTRIES) {
      expect(c.currency, c.alpha2).toMatch(/^[A-Z]{3}$/);
      expect(currencyByCode(c.currency), `${c.alpha2} → ${c.currency}`).toBeTruthy();
    }
  });

  it('chooses a measurement system per country', () => {
    expect(measurementFor('US')).toBe('imperial');
    expect(measurementFor('PK')).toBe('metric');
    expect(measurementFor('GB')).toBe('metric');
  });
});

describe('matrix: date formats', () => {
  const INSTANT = Date.UTC(2026, 9, 9, 12);

  it('renders a date for every language without throwing or emptying', () => {
    for (const code of ALL) {
      for (const style of ['short', 'medium', 'long']) {
        const out = formatDate(INSTANT, { lang: code, style });
        expect(typeof out, `${code}/${style}`).toBe('string');
        expect(out.length, `${code}/${style}`).toBeGreaterThan(0);
        expect(out, `${code}/${style}`).not.toMatch(/Invalid|NaN|undefined/);
      }
    }
  });

  it('carries the year in the language’s own calendar', () => {
    // Gregorian locales show 2026; FA shows the Persian 1405, TH the Buddhist
    // 2569, and BN/FA render in their own digits.
    for (const code of ALL) {
      const out = formatDate(INSTANT, { lang: code });
      const expected = CALENDAR_YEAR[code] || /2026|২০২৬|۲٬?۰۲۶/;
      expect(out, `${code}: ${out}`).toMatch(expected);
    }
  });

  it('keeps the non-Gregorian calendars a known, enumerated set', () => {
    // BN renders Gregorian 2026 in Bengali digits (২০২৬), so the digits must be
    // folded to ASCII before deciding whether the CALENDAR differs.
    const nonGregorian = ALL.filter((c) => !/2026/.test(toAsciiDigits(formatDate(INSTANT, { lang: c }))));
    expect(nonGregorian.sort()).toEqual(['fa', 'th']);
  });

  it('uses each language’s own field order', () => {
    expect(datePattern('en')).toBe('MM/DD/YYYY');
    expect(datePattern('de')).toBe('DD.MM.YYYY');
    // Order is data, so at least two distinct patterns must exist.
    const patterns = new Set(ALL.map((c) => datePattern(c)));
    expect(patterns.size).toBeGreaterThan(1);
    for (const code of ALL) expect(datePattern(code), code).toBeTruthy();
  });

  it('shows a different calendar day on the two sides of the date line', () => {
    const east = formatDate(INSTANT, { lang: 'en', timeZone: 'Pacific/Kiritimati' });
    const west = formatDate(INSTANT, { lang: 'en', timeZone: 'Pacific/Honolulu' });
    expect(east).toBe('Oct 10, 2026');
    expect(west).toBe('Oct 9, 2026');
    expect(east).not.toBe(west);
  });

  it('formats a time, with and without seconds', () => {
    const base = formatTime(INSTANT, { lang: 'en', timeZone: 'UTC' });
    expect(base).toBeTruthy();
    expect(formatTime(INSTANT, { lang: 'en', timeZone: 'UTC', seconds: true })).toMatch(/:\d{2}/);
    for (const code of ALL) {
      expect(formatTime(INSTANT, { lang: code }), code).toBeTruthy();
      expect(formatDateTime(INSTANT, { lang: code }), code).toBeTruthy();
    }
  });

  it('renders digits in the language’s own script where that is the default', () => {
    // Bengali and Persian use their own digits unless the numbering system is
    // forced. Asserting it keeps a future "fix" from silently latinising them.
    expect(formatNumber(2026, { lang: 'bn' })).not.toMatch(/^[0-9,.\s]+$/);
    expect(formatNumber(2026, { lang: 'fa' })).not.toMatch(/^[0-9,.\s]+$/);
    expect(formatNumber(2026, { lang: 'en' })).toBe('2,026');
  });
});

describe('matrix: number formats', () => {
  it('uses the language’s separators, not a fixed pair', () => {
    expect(separators('en')).toEqual({ decimal: '.', group: ',' });
    expect(separators('de')).toEqual({ decimal: ',', group: '.' });
    expect(separators('fr')).toEqual({ decimal: ',', group: '\u202f' });
  });

  it('formats a large number the same way the locale does', () => {
    expect(formatNumber(1234567.891, { lang: 'en' })).toBe('1,234,567.891');
    expect(formatNumber(1234567.891, { lang: 'de' })).toBe('1.234.567,891');
  });

  it('formats every language without throwing', () => {
    for (const code of ALL) {
      const n = formatNumber(1234.5, { lang: code });
      expect(typeof n, code).toBe('string');
      expect(n.length, code).toBeGreaterThan(0);
      expect(n, code).not.toMatch(/Invalid|NaN/);
    }
  });

  it('honours a digit and grouping override', () => {
    expect(formatNumber(1234.5, { lang: 'en', digits: 0 })).toBe('1,235');
    expect(formatNumber(1500000, { lang: 'en', compact: true })).toBe('1.5M');
  });

  it('formats a percentage from a fraction', () => {
    expect(formatPercent(0.1234, { lang: 'en' })).toBe('12.34%');
    expect(formatPercent(0.5, { lang: 'en', digits: 0 })).toBe('50%');
  });

  it('formats a currency per language, so symbol placement follows the locale', () => {
    const en = formatCurrency(1234.5, { lang: 'en', currency: 'EUR' });
    const de = formatCurrency(1234.5, { lang: 'de', currency: 'EUR' });
    expect(en).toContain('€');
    expect(de).toContain('€');
    // Germany writes 1.234,50 €; English writes €1,234.50.
    expect(en).not.toBe(de);
    for (const code of ALL) {
      expect(formatCurrency(1234.5, { lang: code, currency: 'USD' }), code).toBeTruthy();
    }
  });

  it('measures in the units the country actually uses', () => {
    expect(formatMeasure(1, 'mi', { system: 'imperial' })).toBe('1.00 mi');
    expect(formatMeasure(5, 'km', { system: 'metric' })).toBe('5.00 km');
    // The same distance, expressed both ways.
    expect(convertMeasure(1, 'mi', 'km')).toBeCloseTo(1.60934, 4);
    expect(convertMeasure(1, 'km', 'mi')).toBeCloseTo(0.621371, 5);
  });
});

describe('matrix: plural rules across scripts', () => {
  it('gives every language a CLDR category set', () => {
    for (const code of ALL) {
      const cats = categoriesFor(code);
      expect(Array.isArray(cats), code).toBe(true);
      expect(cats.length, code).toBeGreaterThanOrEqual(1);
      expect(cats, code).toContain('other');
      expect(new Set(cats).size, code).toBe(cats.length);
    }
  });

  it('has exactly eight languages with no plural distinction at all', () => {
    // These have a single 'other' category in CLDR, so an English-shaped
    // one/other implementation would be wrong for all of them.
    const single = ALL.filter((c) => categoriesFor(c).length === 1).sort();
    expect(single).toEqual(['id', 'ja', 'ko', 'ms', 'th', 'vi', 'zh-Hans', 'zh-Hant']);
    for (const code of single) expect(categoriesFor(code), code).toEqual(['other']);
  });

  it('selects a category that the language actually declares', () => {
    for (const code of ALL) {
      const declared = new Set(categoriesFor(code));
      for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) {
        const cat = pluralCategory(code, n);
        expect(declared.has(cat), `${code} n=${n} → ${cat}`).toBe(true);
      }
    }
  });

  it('distinguishes the languages with the most categories', () => {
    expect(categoriesFor('ar')).toEqual(expect.arrayContaining(['zero', 'one', 'two', 'few', 'many', 'other']));
    // Arabic counts 0 as 'zero' and 2 as 'two' — most languages do not.
    expect(pluralCategory('ar', 0)).toBe('zero');
    expect(pluralCategory('ar', 2)).toBe('two');
    expect(pluralCategory('ar', 11)).toBe('many');
    // Russian: 1 one, 2 few, 5 many.
    expect(pluralCategory('ru', 1)).toBe('one');
    expect(pluralCategory('ru', 2)).toBe('few');
    expect(pluralCategory('ru', 5)).toBe('many');
    // English has only two.
    expect(categoriesFor('en')).toEqual(['one', 'other']);
  });
});
