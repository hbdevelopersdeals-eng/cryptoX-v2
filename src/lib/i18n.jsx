import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState
} from 'react';
import { lsGet, lsSet } from './storage.js';
import {
  LANGUAGES, languageByCode, isRtl, dirFor, negotiate, detectLocaleSettings,
  measurementFor, CATALOG_STATUS, SOURCE_LANGUAGE, NUMBERING_SYSTEMS, matchLanguage
} from './locales.js';
import { translate as coreTranslate, coverage } from './translate.js';
import {
  formatNumber, formatCurrency, formatDate, formatTime, formatDateTime, formatMeasure
} from './localeFormat.js';
import { countryByCode } from './countries.js';
import en from '../locales/en.js';

/* Re-exported for existing consumers (Shell renders the language picker). */
export { LANGUAGES, languageByCode, isRtl, dirFor, NUMBERING_SYSTEMS };

/*
 * English is bundled eagerly so the first paint never waits on a network chunk.
 * Every other catalog is a lazily-imported module, so a Ukrainian visitor does
 * not download 24 unused translation files.
 */
const EAGER = { en };
const LOADERS = import.meta.glob('../locales/*.js');

const codeFromPath = (path) => {
  const file = path.split('/').pop().replace(/\.js$/, '');
  const hit = LANGUAGES.find((l) => l.code === file);
  return hit ? hit.code : file;
};

const LOADER_BY_CODE = Object.keys(LOADERS).reduce((acc, path) => {
  acc[codeFromPath(path)] = LOADERS[path];
  return acc;
}, {});

const I18nContext = createContext(null);
export const useI18n = () => useContext(I18nContext);

/** Country from an explicit choice, else the detected value. */
const resolveRegion = (stored, detected) => (stored && countryByCode(stored) ? stored : detected);

export function I18nProvider({ children }) {
  /* Detection runs once, and only as the default when nothing is stored. */
  const detected = useMemo(() => detectLocaleSettings(), []);

  const [lang, setLangState] = useState(() => {
    const stored = lsGet('cx_lang', null);
    if (stored && languageByCode(stored)) return stored;
    if (stored) {
      const matched = matchLanguage(stored);
      if (matched) return matched;
    }
    return detected.lang;
  });

  const [region, setRegionState] = useState(() =>
    resolveRegion(lsGet('cx_region', null), detected.region || 'US'));

  const [numbering, setNumberingState] = useState(() => {
    const stored = lsGet('cx_numbering', null);
    if (stored) return stored;
    return languageByCode(detected.lang)?.numbering || 'latn';
  });

  const [measurement, setMeasurementState] = useState(() => {
    const stored = lsGet('cx_measurement', null);
    if (stored) return stored;
    return measurementFor(resolveRegion(null, detected.region || 'US'));
  });

  const [timeZone, setTimeZone] = useState(detected.timeZone || undefined);
  const [tables, setTables] = useState(EAGER);
  const [loading, setLoading] = useState(false);

  const dir = dirFor(lang);

  /* Load a catalog on demand. English is already in memory. */
  useEffect(() => {
    if (tables[lang]) return undefined;
    const load = LOADER_BY_CODE[lang];
    if (!load) return undefined;
    let alive = true;
    setLoading(true);
    load()
      .then((mod) => {
        if (!alive) return;
        setTables((prev) => ({ ...prev, [lang]: mod.default || mod }));
      })
      .catch(() => { /* leave the fallback chain to cover this language */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lang, tables]);

  /* Direction and language must be on <html> for CSS logical properties. */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const t = useCallback((key, vars) => coreTranslate(tables, lang, key, vars), [tables, lang]);

  /* Document metadata is owned by <SeoManager>, which is the only place that
   * knows BOTH the current route and the language. It used to live here, where
   * it read `location.hash` and re-applied one global title on every language
   * change — so every route ended up sharing the home page's canonical. */

  const stats = useMemo(() => coverage(tables, lang), [tables, lang]);

  const value = useMemo(() => ({
    lang,
    dir,
    rtl: isRtl(lang),
    loading,
    t,
    tables,
    stats,
    catalogStatus: CATALOG_STATUS[lang] || null,
    sourceLanguage: SOURCE_LANGUAGE,

    /* Settings */
    region,
    measurement,
    numbering,
    timeZone,
    detected,

    setLang: (next) => {
      const matched = languageByCode(next) ? next : matchLanguage(next);
      if (!matched) return;
      setLangState(matched);
      lsSet('cx_lang', matched);
    },
    setRegion: (next) => {
      if (!countryByCode(next)) return;
      setRegionState(next);
      lsSet('cx_region', next);
      // Measurement follows the country unless it was explicitly chosen.
      setMeasurementState(measurementFor(next));
      lsSet('cx_measurement', measurementFor(next));
    },
    setNumbering: (next) => {
      if (!NUMBERING_SYSTEMS.some((n) => n.id === next)) return;
      setNumberingState(next);
      lsSet('cx_numbering', next);
    },
    setMeasurement: (next) => {
      if (!['metric', 'imperial'].includes(next)) return;
      setMeasurementState(next);
      lsSet('cx_measurement', next);
    },
    setTimeZone,

    /* Locale-bound formatters, so callers never pass the language by hand. */
    fmtNumber: (v, o) => formatNumber(v, { lang, numbering, ...(o || {}) }),
    fmtCurrency: (v, o) => formatCurrency(v, { lang, numbering, ...(o || {}) }),
    fmtDate: (v, o) => formatDate(v, { lang, timeZone, ...(o || {}) }),
    fmtTime: (v, o) => formatTime(v, { lang, timeZone, ...(o || {}) }),
    fmtDateTime: (v, o) => formatDateTime(v, { lang, timeZone, ...(o || {}) }),
    fmtMeasure: (v, from, o) => formatMeasure(v, from, { lang, system: measurement, ...(o || {}) })
  }), [lang, dir, loading, t, tables, stats, region, measurement, numbering, timeZone, detected]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Standalone translate for non-React callers (tests, transactional render). */
export const translateWith = (lang, key, vars, tables = EAGER) => coreTranslate(tables, lang, key, vars);
export const TRANSLATIONS = EAGER;
