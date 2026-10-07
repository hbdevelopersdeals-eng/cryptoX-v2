/* Translation core — pure functions, no React.
 *
 * Resolution order for a key: the requested language, then each language in its
 * fallback chain, then the source language, then the key itself. A partially
 * translated catalog therefore never renders a blank.
 *
 * Plural and gender entries are objects and are resolved before interpolation:
 *   { one: '{count} alert', other: '{count} alerts' }  → chosen by CLDR category
 *   { male: 'Sir', female: 'Madam', other: 'Hello' }   → chosen by vars.gender
 */

import { fallbackChain, SOURCE_LANGUAGE, languageByCode } from './locales.js';
import { selectPlural } from './plural.js';

/** Keys whose value is an object of plural forms rather than gender variants. */
const looksPlural = (entry) =>
  entry && typeof entry === 'object' && ('other' in entry) &&
  Object.keys(entry).every((k) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(k));

const looksGendered = (entry) =>
  entry && typeof entry === 'object' && !looksPlural(entry) && ('other' in entry || 'male' in entry);

/**
 * Replace {name} tokens.
 * A token with no matching variable is left visible on purpose: a silently
 * blanked value hides a missing-variable bug, while "{count}" on screen does not.
 */
export function interpolate(text, vars) {
  if (vars == null) return text;
  return String(text).replace(/\{(\w+)\}/g, (whole, name) =>
    (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/** Look a key up across a fallback chain. Returns null when nothing matches. */
export function lookup(tables, lang, key) {
  for (const code of fallbackChain(lang)) {
    const table = tables[code];
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  }
  return null;
}

/**
 * Translate a key.
 * @param tables  { [lang]: catalog }
 * @param lang    requested language
 * @param key     catalog key
 * @param vars    interpolation values; `count` drives plurals, `gender` drives
 *                gendered forms and is removed from the interpolation set
 */
export function translate(tables, lang, key, vars) {
  const entry = lookup(tables, lang, key);
  if (entry == null) return key;

  let value = entry;
  if (looksPlural(entry)) {
    value = selectPlural(lang, entry, vars?.count, vars) ?? entry.other ?? key;
  } else if (looksGendered(entry)) {
    const wanted = vars?.gender;
    value = (wanted && entry[wanted]) || entry.other || entry.male || entry.female || key;
  }

  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

/**
 * How complete a catalog is. English is the reference, so a missing key in any
 * other language counts as untranslated rather than as the key itself.
 */
export function coverage(tables, lang) {
  const source = tables[SOURCE_LANGUAGE] || {};
  const total = Object.keys(source).length;
  if (!total) return { translated: 0, total: 0, percent: 0 };
  const table = tables[lang] || {};
  const translated = Object.keys(source).filter((k) => {
    const v = table[k];
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    // An object must carry at least an `other` form to count as usable.
    return typeof v.other === 'string' && v.other.trim().length > 0;
  }).length;
  return { translated, total, percent: Math.round((translated / total) * 100) };
}

/** Keys present in the source but absent from a catalog. */
export function missingKeys(tables, lang) {
  const source = tables[SOURCE_LANGUAGE] || {};
  const table = tables[lang] || {};
  return Object.keys(source).filter((k) => !(k in table));
}

/** Keys a catalog defines that the source does not — usually a typo. */
export function orphanKeys(tables, lang) {
  const source = tables[SOURCE_LANGUAGE] || {};
  return Object.keys(tables[lang] || {}).filter((k) => !(k in source));
}

/** Whether every fallback language before English is missing this key. */
export function isUntranslated(tables, lang, key) {
  if (lang === SOURCE_LANGUAGE) return false;
  const table = tables[lang];
  return !(table && Object.prototype.hasOwnProperty.call(table, key));
}

/** Metadata describing a language for the settings UI. */
export function describeLanguage(tables, lang) {
  const entry = languageByCode(lang);
  if (!entry) return null;
  const stats = coverage(tables, lang);
  return {
    ...entry,
    ...stats,
    translated: stats.percent === 100,
    // Only the source language is human-reviewed; everything else is a draft.
    reviewed: lang === SOURCE_LANGUAGE
  };
}
