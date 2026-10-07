import { describe, it, expect } from 'vitest';
import {
  COUNTRIES, countryByCode, searchCountries, countriesByRegion, CURRENCY_CODES, SHARED_DIALS
} from './countries.js';
import {
  LANGUAGES, languageByCode, isRtl, dirFor, matchLanguage, negotiate, fallbackChain,
  detectRegion, measurementFor, SOURCE_LANGUAGE
} from './locales.js';
import { pluralCategory, categoriesFor } from './plural.js';
import { translate, coverage, missingKeys, orphanKeys, interpolate, isUntranslated } from './translate.js';
import { parsePhone, formatInternational, splitDial, sanitiseInput, E164_MAX_DIGITS } from './phone.js';
import { validatePostal, usesPostalCodes, formatAddress, addressFormat, subdivisionsFor, citiesFor } from './address.js';
import { separators, convertMeasure, convertTemperature, formatMeasure, formatNumber } from './localeFormat.js';
import { localePath, stripLocale, hreflangLinks, siteJsonLd } from './seo.js';
import { renderTemplate, renderAll, TEMPLATE_LIST, DELIVERY_CHANNELS, channelStatus } from './transactional.js';

/* Every catalog, loaded the same way the app loads them. */
const modules = import.meta.glob('../locales/*.js', { eager: true });
const tables = Object.keys(modules).reduce((acc, path) => {
  acc[path.split('/').pop().replace('.js', '')] = modules[path].default || modules[path];
  return acc;
}, {});

describe('country data', () => {
  it('covers ISO 3166-1 exactly', () => {
    // The dataset was diffed against the ISO reference: 249 entries, no gaps.
    expect(COUNTRIES.length).toBe(249);
    expect(new Set(COUNTRIES.map((c) => c.alpha2)).size).toBe(249);
    expect(new Set(COUNTRIES.map((c) => c.alpha3)).size).toBe(249);
  });

  it('every entry carries a usable dial prefix, currency and region', () => {
    COUNTRIES.forEach((c) => {
      expect(c.dial, c.alpha2).toMatch(/^\d{1,4}$/);
      expect(c.currency, c.alpha2).toMatch(/^[A-Z]{3}$/);
      expect(c.regionLabel, c.alpha2).toBeTruthy();
    });
  });

  it('resolves by alpha-2 and alpha-3, case-insensitively', () => {
    expect(countryByCode('pk').name).toBe('Pakistan');
    expect(countryByCode('PAK').name).toBe('Pakistan');
    expect(countryByCode('ZZ')).toBeNull();
    expect(countryByCode(null)).toBeNull();
  });

  it('searches by name, code and dial prefix, ranking exact hits first', () => {
    expect(searchCountries('pak')[0].alpha2).toBe('PK');
    expect(searchCountries('PK')[0].alpha2).toBe('PK');
    expect(searchCountries('92')[0].alpha2).toBe('PK');
    expect(searchCountries('united').some((c) => c.alpha2 === 'US')).toBe(true);
    expect(searchCountries('', 5).length).toBe(5);
    expect(searchCountries('zzzznope')).toEqual([]);
  });

  it('groups every country into exactly one region', () => {
    const grouped = countriesByRegion();
    const total = Object.values(grouped).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(249);
  });

  it('flags shared dialling prefixes instead of silently picking one', () => {
    expect(SHARED_DIALS.has('1')).toBe(true);   // NANP
    expect(SHARED_DIALS.has('44')).toBe(true);  // UK + crown dependencies
    expect(SHARED_DIALS.has('92')).toBe(false); // Pakistan only
    expect(CURRENCY_CODES.length).toBeGreaterThan(100);
  });
});

describe('language registry and matching', () => {
  it('ships the 25 launch languages', () => {
    expect(LANGUAGES.length).toBe(25);
    expect(LANGUAGES[0].code).toBe(SOURCE_LANGUAGE);
  });

  it('marks exactly the right languages as RTL', () => {
    expect([...LANGUAGES.filter((l) => isRtl(l.code)).map((l) => l.code)].sort())
      .toEqual(['ar', 'fa', 'he', 'ur']);
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('ja')).toBe('ltr');
  });

  it('matches BCP-47 tags, with script winning over region for Chinese', () => {
    expect(matchLanguage('en-GB')).toBe('en');
    expect(matchLanguage('pt_BR')).toBe('pt');
    expect(matchLanguage('zh-Hant-TW')).toBe('zh-Hant');
    expect(matchLanguage('zh-CN')).toBe('zh-Hans');
    expect(matchLanguage('zh-TW')).toBe('zh-Hant');
    expect(matchLanguage('zh')).toBe('zh-Hans');
    expect(matchLanguage('de-AT')).toBe('de');
    expect(matchLanguage('xx-YY')).toBeNull();
    expect(matchLanguage('')).toBeNull();
  });

  it('negotiates the first supported preference', () => {
    expect(negotiate(['sv-SE', 'fr-CA', 'en'])).toBe('fr');
    expect(negotiate([])).toBe('en');
    expect(negotiate(['zz'])).toBe('en');
  });

  it('gives every language a fallback chain ending in English', () => {
    expect(fallbackChain('zh-Hant')).toEqual(['zh-Hant', 'zh-Hans', 'en']);
    expect(fallbackChain('ur')).toEqual(['ur', 'en']);
    expect(fallbackChain('en')).toEqual(['en']);
  });

  it('detects a region from the tag first and the time zone second', () => {
    expect(detectRegion({ language: 'en-PK' })).toBe('PK');
    expect(detectRegion({ language: 'en', timeZone: 'Asia/Karachi' })).toBe('PK');
    expect(detectRegion({ language: 'en' })).toBeNull();
  });

  it('only the US, Liberia and Myanmar are imperial by default', () => {
    expect(measurementFor('US')).toBe('imperial');
    expect(measurementFor('LR')).toBe('imperial');
    expect(measurementFor('MM')).toBe('imperial');
    expect(measurementFor('GB')).toBe('metric');
  });
});

describe('plural rules', () => {
  it('agrees with Intl.PluralRules for every supported language', () => {
    // The rules are hand-written; this is the check that keeps them honest.
    LANGUAGES.forEach(({ code }) => {
      let intl;
      try {
        intl = new Intl.PluralRules(code);
      } catch {
        return; // runtime lacks this locale
      }
      for (let n = 0; n <= 30; n += 1) {
        expect(pluralCategory(code, n), `${code} n=${n}`).toBe(intl.select(n));
      }
    });
  });

  it('reports the categories each language can produce', () => {
    expect(categoriesFor('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(categoriesFor('ru')).toEqual(['one', 'few', 'many', 'other']);
    expect(categoriesFor('ja')).toEqual(['other']);
    expect(categoriesFor('en')).toEqual(['one', 'other']);
  });
});

describe('translation resolution', () => {
  it('translates, then falls back, then returns the key', () => {
    expect(translate(tables, 'en', 'nav.markets')).toBe('Markets');
    expect(translate(tables, 'de', 'nav.markets')).toBe(tables.de['nav.markets']);
    expect(translate(tables, 'zz', 'nav.markets')).toBe('Markets');
    expect(translate(tables, 'en', 'nope.missing')).toBe('nope.missing');
  });

  it('walks the fallback chain before reaching English', () => {
    const partial = { en: { k: 'english' }, 'zh-Hans': { k: '简体' }, 'zh-Hant': {} };
    expect(translate(partial, 'zh-Hant', 'k')).toBe('简体');
    expect(isUntranslated(partial, 'zh-Hant', 'k')).toBe(true);
    expect(isUntranslated(partial, 'zh-Hans', 'k')).toBe(false);
  });

  it('selects plural forms by CLDR category', () => {
    expect(translate(tables, 'en', 'plural.coinCount', { count: 1 })).toBe('1 coin');
    expect(translate(tables, 'en', 'plural.coinCount', { count: 2 })).toBe('2 coins');
    expect(translate(tables, 'en', 'plural.coinCount', { count: 0 })).toBe('0 coins');

    const ru = tables.ru['plural.coinCount'];
    expect(translate(tables, 'ru', 'plural.coinCount', { count: 1 })).toBe(ru.one.replace('{count}', '1'));
    expect(translate(tables, 'ru', 'plural.coinCount', { count: 3 })).toBe(ru.few.replace('{count}', '3'));
    expect(translate(tables, 'ru', 'plural.coinCount', { count: 7 })).toBe(ru.many.replace('{count}', '7'));

    // A language with no plural distinction always uses `other`.
    expect(translate(tables, 'ja', 'plural.coinCount', { count: 5 })).toBe(tables.ja['plural.coinCount'].other.replace('{count}', '5'));
  });

  it('selects gendered forms', () => {
    expect(translate(tables, 'en', 'gender.welcome', { gender: 'female' })).toBe('Welcome back, madam');
    expect(translate(tables, 'en', 'gender.welcome', { gender: 'male' })).toBe('Welcome back, sir');
    expect(translate(tables, 'en', 'gender.welcome', {})).toBe('Welcome back');
    expect(translate(tables, 'en', 'gender.welcome', { gender: 'nonsense' })).toBe('Welcome back');
  });

  it('leaves an unmatched placeholder visible rather than blanking it', () => {
    // A blank hides the bug; "{name}" on screen does not.
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
    expect(interpolate('Hi {name}', { name: 'Ali' })).toBe('Hi Ali');
    expect(interpolate('{a} and {b}', { a: 1, b: 2 })).toBe('1 and 2');
  });

  it('reports coverage against the English source', () => {
    expect(coverage(tables, 'en')).toEqual({ translated: 95, total: 95, percent: 100 });
    expect(coverage({ en: tables.en }, 'de')).toEqual({ translated: 0, total: 95, percent: 0 });
    expect(missingKeys(tables, 'de')).toEqual([]);
    expect(orphanKeys(tables, 'de')).toEqual([]);
  });
});

describe('catalog integrity across all 25 languages', () => {
  it('has a catalog for every registered language', () => {
    LANGUAGES.forEach(({ code }) => {
      expect(tables[code], `missing catalog for ${code}`).toBeTruthy();
    });
  });

  it('every catalog mirrors the English key set exactly', () => {
    const source = Object.keys(tables.en);
    Object.keys(tables).forEach((code) => {
      expect(Object.keys(tables[code]).sort(), code).toEqual(source.slice().sort());
    });
  });

  it('has no empty strings and no unsubstituted English placeholders', () => {
    Object.entries(tables).forEach(([code, table]) => {
      Object.entries(table).forEach(([key, value]) => {
        if (typeof value === 'string') {
          expect(value.trim(), `${code}:${key}`).toBeTruthy();
        } else {
          expect(value.other, `${code}:${key}.other`).toBeTruthy();
          Object.entries(value).forEach(([form, text]) => {
            expect(String(text).trim(), `${code}:${key}.${form}`).toBeTruthy();
          });
        }
      });
    });
  });

  it('keeps placeholders intact in every language', () => {
    const holders = (v) => (String(v).match(/\{\w+\}/g) || []).sort().join(',');
    Object.keys(tables).forEach((code) => {
      Object.entries(tables.en).forEach(([key, source]) => {
        const target = tables[code][key];
        if (typeof source === 'string') {
          expect(holders(target), `${code}:${key}`).toBe(holders(source));
        }
      });
    });
  });
});

describe('phone numbers (E.164)', () => {
  it('parses national input using the country trunk rule', () => {
    const pk = parsePhone('0300 1234567', 'PK');
    expect(pk.e164).toBe('+923001234567');
    expect(pk.valid).toBe(true);
    expect(pk.region).toBe('PK');

    const gb = parsePhone('020 7123 4567', 'GB');
    expect(gb.e164).toBe('+44207123456 7'.replace(' ', ''));
    expect(gb.valid).toBe(true);
  });

  it('parses explicit international input', () => {
    expect(parsePhone('+92 300 1234567', 'US').e164).toBe('+923001234567');
    expect(parsePhone('0092 300 1234567', 'US').e164).toBe('+923001234567');
    expect(parsePhone('+1 (415) 555-2671', 'GB').e164).toBe('+14155552671');
    expect(parsePhone('+1 (415) 555-2671', 'GB').region).toBe('US');
  });

  it('rejects impossible numbers', () => {
    expect(parsePhone('', 'US').reason).toBe('empty');
    expect(parsePhone('abc', 'US').reason).toBe('no-digits');
    expect(parsePhone('+999123456', 'US').reason).toBe('unknown-country-code');
    // 11 national digits is too long for the US 10-digit plan.
    expect(parsePhone('41555526711', 'US').reason).toBe('too-long-for-country');
    expect(parsePhone('415', 'US').reason).toBe('too-short');
    expect(parsePhone('+1234567890123456789', 'US').reason).toBe('too-long');
  });

  it('never claims validity for a country it has no length rule for', () => {
    const mv = parsePhone('+9601234567', 'US'); // Maldives has no rule here
    expect(mv.region).toBe('MV');
    expect(mv.confident).toBe(false);
    expect(mv.valid).toBe(false);
    expect(mv.reason).toBe('no-length-rule');
  });

  it('caps every number at the E.164 limit', () => {
    expect(E164_MAX_DIGITS).toBe(15);
    expect(parsePhone('+123456789012345', 'US').e164).toBe('+123456789012345');
  });

  it('splits the dialling prefix longest-first', () => {
    expect(splitDial('923001234567')).toEqual({ dial: '92', rest: '3001234567' });
    expect(splitDial('14155552671')).toEqual({ dial: '1', rest: '4155552671' });
    expect(splitDial('9991234').dial).toBeNull();
  });

  it('formats for display and sanitises as you type', () => {
    expect(formatInternational('03001234567', 'PK')).toContain('+92');
    expect(sanitiseInput('+92 (300) 123-4567')).toBe('+92 (300) 123-4567');
    expect(sanitiseInput('abc92 300', { allowPlus: false })).toBe('92 300');
    expect(sanitiseInput('12a3')).toBe('123');
  });
});

describe('postal codes and addresses', () => {
  it('validates only where a real rule exists', () => {
    expect(validatePostal('US', '94107').ok).toBe(true);
    expect(validatePostal('US', '94107-1234').ok).toBe(true);
    expect(validatePostal('US', '9410').ok).toBe(false);
    expect(validatePostal('GB', 'SW1A 1AA').ok).toBe(true);
    expect(validatePostal('GB', 'ABC').ok).toBe(false);
    expect(validatePostal('DE', '10115').ok).toBe(true);
    expect(validatePostal('JP', '100-0001').ok).toBe(true);
    expect(validatePostal('PK', '44000').ok).toBe(true);
    expect(validatePostal('NL', '1011 AB').ok).toBe(true);
  });

  it('returns "unknown" rather than "invalid" without a rule', () => {
    // null means we cannot judge — the UI must not render that as an error.
    expect(validatePostal('BY', '220030').ok).toBeNull();
    expect(validatePostal('BY', 'anything').reason).toBe('no-rule-for-country');
    expect(validatePostal(null, 'x').ok).toBeNull();
  });

  it('knows which countries use no postal code at all', () => {
    expect(usesPostalCodes('AE')).toBe(false);
    expect(validatePostal('AE', '12345').reason).toBe('country-uses-no-postal-codes');
    expect(usesPostalCodes('US')).toBe(true);
  });

  it('formats by national convention, not one universal order', () => {
    const parts = { name: 'Ali Khan', line1: '12 Main St', city: 'Karachi', state: 'Sindh', postal: '75500', country: 'Pakistan' };
    expect(formatAddress(parts, 'PK')).toEqual(['Ali Khan', '12 Main St', 'Karachi, Sindh, 75500', 'Pakistan']);

    const de = formatAddress({ name: 'A', line1: 'Str 1', city: 'Berlin', postal: '10115', country: 'Germany' }, 'DE');
    expect(de[2]).toBe('10115, Berlin'); // postcode leads the city in Germany

    const jp = formatAddress({ name: 'A', line1: '1-1', city: 'Tokyo', state: 'Tokyo', postal: '100-0001', country: 'Japan' }, 'JP');
    expect(jp[0]).toBe('Japan'); // country leads in the Japanese order
    expect(jp[1]).toBe('100-0001');
  });

  it('drops blank fields instead of leaving stray separators', () => {
    const out = formatAddress({ name: 'Ali', line1: '12 Main St', city: 'Karachi', postal: '' }, 'PK');
    expect(out).toEqual(['Ali', '12 Main St', 'Karachi']);
    expect(out.join(' ')).not.toContain(', ,');
  });

  it('ships subdivisions and cities only where we can list them accurately', () => {
    expect(subdivisionsFor('US').length).toBe(51);
    expect(subdivisionsFor('PK')).toContain('Sindh');
    expect(subdivisionsFor('ZZ')).toEqual([]);
    expect(citiesFor('PK')).toContain('Karachi');
    expect(citiesFor('ZZ')).toEqual([]);
    expect(addressFormat('US').key).toBe('us');
  });
});

describe('locale formatting', () => {
  it('uses the separators the locale actually writes', () => {
    expect(separators('en')).toEqual({ decimal: '.', group: ',' });
    expect(separators('de')).toEqual({ decimal: ',', group: '.' });
    expect(separators('fr').group).toBeTruthy();
    expect(formatNumber(1234.5, { lang: 'de', digits: 1 })).toBe('1.234,5');
    expect(formatNumber(1234.5, { lang: 'en', digits: 1 })).toBe('1,234.5');
    expect(formatNumber(null, { lang: 'en' })).toBe('—');
  });

  it('converts measurements with exact factors', () => {
    expect(convertMeasure(1, 'mi', 'km')).toBeCloseTo(1.609344, 9);
    expect(convertMeasure(1, 'km', 'mi')).toBeCloseTo(0.6213711922, 9);
    expect(convertMeasure(1, 'in', 'cm')).toBeCloseTo(2.54, 9);
    expect(convertMeasure(1, 'kg', 'lb')).toBeCloseTo(2.2046226218, 9);
    expect(convertMeasure(1, 'mile' , 'kg')).toBeNull(); // unknown unit
    expect(convertMeasure(1, 'km', 'kg')).toBeNull();    // dimension mismatch
  });

  it('converts temperature with the offset, not just the ratio', () => {
    // The classic bug is scaling by 1.8 and forgetting +32.
    expect(convertTemperature(100, 'C', 'F')).toBeCloseTo(212, 9);
    expect(convertTemperature(0, 'C', 'F')).toBeCloseTo(32, 9);
    expect(convertTemperature(32, 'F', 'C')).toBeCloseTo(0, 9);
    expect(convertTemperature(-40, 'C', 'F')).toBeCloseTo(-40, 9);
    expect(convertTemperature(5, 'C', 'C')).toBe(5);
  });

  it('renders a measurement for the target system, converting only when needed', () => {
    // The source unit is explicit, so a value already in the target unit is not
    // converted again ("1 mi" must stay 1 mi, not become 0.62 mi).
    expect(formatMeasure(1, 'mi', { system: 'imperial', lang: 'en' })).toBe('1.00 mi');
    expect(formatMeasure(1, 'km', { system: 'metric', lang: 'en' })).toBe('1.00 km');
    expect(formatMeasure(1, 'km', { system: 'imperial', lang: 'en' })).toBe('0.62 mi');
    expect(formatMeasure(1, 'kg', { system: 'imperial', lang: 'en' })).toBe('2.20 lb');
    expect(formatMeasure(20, 'C', { system: 'imperial', lang: 'en' })).toBe('68.00°F');
    expect(formatMeasure(20, 'F', { system: 'imperial', lang: 'en' })).toBe('20.00°F');
    expect(formatMeasure(null, 'kg', { system: 'metric' })).toBe('—');
    expect(formatMeasure(1, 'furlong', { system: 'metric' })).toBe('—');
  });
});

describe('localized SEO', () => {
  it('builds locale-prefixed paths both ways', () => {
    expect(localePath('ur', '/markets')).toBe('/ur/markets');
    expect(localePath('en', '/')).toBe('/en');
    expect(stripLocale('/ur/markets')).toBe('/markets');
    expect(stripLocale('/markets')).toBe('/markets');
    expect(stripLocale('/zh-Hant/markets')).toBe('/markets');
  });

  it('emits an alternate for every language plus x-default', () => {
    const links = hreflangLinks({ languages: ['en', 'ur', 'ar'], path: '/markets' });
    expect(links.length).toBe(4);
    expect(links.at(-1).hreflang).toBe('x-default');
    expect(links.find((l) => l.hreflang === 'ur').href).toContain('/#/ur/markets');
  });

  it('produces localized JSON-LD', () => {
    const ld = siteJsonLd({ lang: 'ur' });
    expect(ld.inLanguage).toBe('ur');
    expect(ld.url).toContain('/#/ur');
  });
});

describe('transactional copy', () => {
  it('renders localized subject and body with variables resolved', () => {
    const out = renderTemplate({ template: 'digest', lang: 'en', tables, vars: { name: 'Ali' } });
    expect(out.subject).toBe('Your CryptoX market digest');
    expect(out.body).toBe('Here is what moved while you were away, Ali.');
    expect(out.placeholders).toEqual([]);
  });

  it('surfaces unresolved variables instead of hiding them', () => {
    const out = renderTemplate({ template: 'digest', lang: 'en', tables, vars: {} });
    expect(out.placeholders).toContain('{name}');
  });

  it('renders in the requested language', () => {
    const out = renderTemplate({ template: 'digest', lang: 'ur', tables, vars: { name: 'علی' } });
    expect(out.body).toBe(tables.ur['notify.digestBody'].replace('{name}', 'علی'));
  });

  it('renders every template for every language without throwing', () => {
    LANGUAGES.forEach(({ code }) => {
      const all = renderAll(code, tables, { name: 'Ali', count: 2, gender: 'female', symbol: 'BTC', price: 100000 });
      expect(all.length).toBe(TEMPLATE_LIST.length);
      all.forEach((t) => {
        expect(t.subject).toBeTruthy();
        expect(t.body).toBeTruthy();
        expect(t.placeholders).toEqual([]);
      });
    });
  });

  it('states honestly what each delivery channel can do', () => {
    expect(channelStatus('inapp')).toBe('live');
    expect(channelStatus('email')).toBe('needs-setup');
    expect(channelStatus('sms')).toBe('unavailable');
    expect(channelStatus('nonsense')).toBe('unavailable');
    expect(DELIVERY_CHANNELS.filter((c) => c.status === 'live').length).toBe(1);
    // Every channel must explain itself — a bare red dot is not a reason.
    DELIVERY_CHANNELS.forEach((c) => expect(c.note, c.id).toBeTruthy());
  });
});
