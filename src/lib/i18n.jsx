import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { lsGet, lsSet } from './storage.js';

/* Multi-language layer.
 * English is the source of truth; missing keys fall back to English, then to the
 * key itself, so a partially translated build never renders blanks. */

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' }
];

export const TRANSLATIONS = {
  en: {
    'app.tagline': 'Real-time crypto markets, charting and trading lab',
    'nav.markets': 'Markets',
    'nav.marketIntel': 'Market Intelligence',
    'nav.dataSources': 'Data Sources',
    'nav.rsi': 'RSI Scanner',
    'nav.portfolio': 'Portfolio',
    'nav.watchlist': 'Watchlist',
    'nav.alerts': 'Alerts',
    'nav.tools': 'Trading & Tools',
    'nav.charting': 'Pro Charting',
    'nav.exchange': 'Exchange (Paper)',
    'nav.derivatives': 'Derivatives (Paper)',
    'nav.strategies': 'Strategy Engine',
    'nav.paper': 'Paper Trader',
    'nav.calculator': 'Calculator',
    'nav.news': 'Market Pulse',
    'nav.status': 'System Status',
    'common.signOut': 'Sign out',
    'common.search': 'Search coins',
    'common.language': 'Language',
    'common.currency': 'Currency',
    'common.live': 'Live',
    'common.loading': 'Loading…'
  },
  ur: {
    'app.tagline': 'ریئل ٹائم کریپٹو مارکیٹ، چارٹنگ اور ٹریڈنگ لیب',
    'nav.markets': 'مارکیٹس',
    'nav.marketIntel': 'مارکیٹ انٹیلیجنس',
    'nav.dataSources': 'ڈیٹا ذرائع',
    'nav.rsi': 'آر ایس آئی اسکینر',
    'nav.portfolio': 'پورٹ فولیو',
    'nav.watchlist': 'واچ لسٹ',
    'nav.alerts': 'الرٹس',
    'nav.tools': 'ٹریڈنگ اور ٹولز',
    'nav.charting': 'پروفیشنل چارٹنگ',
    'nav.exchange': 'ایکسچینج (پیپر)',
    'nav.derivatives': 'ڈیریویٹوز (پیپر)',
    'nav.strategies': 'اسٹریٹجی انجن',
    'nav.paper': 'پیپر ٹریڈر',
    'nav.calculator': 'کیلکولیٹر',
    'nav.news': 'مارکیٹ پلس',
    'nav.status': 'سسٹم اسٹیٹس',
    'common.signOut': 'سائن آؤٹ',
    'common.search': 'کوائن تلاش کریں',
    'common.language': 'زبان',
    'common.currency': 'کرنسی',
    'common.live': 'لائیو',
    'common.loading': 'لوڈ ہو رہا ہے…'
  }
};

export const languageByCode = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];

/** Translate a key with optional {placeholders}; falls back en → key. */
export function translate(lang, key, vars) {
  const table = TRANSLATIONS[lang] || {};
  let value = table[key];
  if (value == null) value = TRANSLATIONS.en[key];
  if (value == null) return key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
    });
  }
  return value;
}

const I18nContext = createContext(null);
export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const stored = lsGet('cx_lang', 'en');
    return LANGUAGES.some((l) => l.code === stored) ? stored : 'en';
  });
  const dir = languageByCode(lang).dir;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = useMemo(
    () => ({
      lang,
      dir,
      setLang: (next) => {
        if (!LANGUAGES.some((l) => l.code === next)) return;
        setLangState(next);
        lsSet('cx_lang', next);
      },
      t: (key, vars) => translate(lang, key, vars)
    }),
    [lang, dir]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
