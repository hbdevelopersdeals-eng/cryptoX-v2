#!/usr/bin/env node
/* Translation catalog guard.
 *
 * Compares every catalog against the English source of truth by PARSING each
 * file and comparing values, never by slicing the raw text. A text-window check
 * produced false failures on a byte-identical copy, which is exactly the kind of
 * guard that trains people to ignore it.
 *
 * Checks, per language:
 *   1. the file exists
 *   2. the key set matches English exactly (no missing, no extra)
 *   3. the value shape matches (string vs plural object vs gender object)
 *   4. every {placeholder} in the English value appears in the translation
 *   5. plural objects expose an `other` form, and cover the categories the
 *      language's CLDR rules can produce
 *   6. gender objects expose male / female / other
 *
 * Usage:
 *   node scripts/check-locales.mjs              # all languages
 *   node scripts/check-locales.mjs ur ar hi     # only these
 *   node scripts/check-locales.mjs --strict     # missing catalogs are failures
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LOCALES = join(ROOT, 'src', 'locales');

const ALL = [
  'en', 'ur', 'ar', 'hi', 'es', 'fr', 'de', 'pt', 'it', 'tr', 'id', 'ms',
  'bn', 'pa', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'ru', 'nl', 'pl', 'vi', 'th', 'fa', 'he'
];

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const requested = args.filter((a) => !a.startsWith('--'));
const targets = (requested.length ? requested : ALL).filter((l) => l !== 'en');

const placeholders = (value) => {
  const found = String(value).match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return found.slice().sort().join(',');
};

const shape = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'object';
  return 'string';
};

/* Mirrors src/lib/plural.js so the guard stays dependency-free. */
const NEEDED = {
  ru: ['one', 'few', 'many', 'other'],
  pl: ['one', 'few', 'many', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  he: ['one', 'two', 'other'],
  ja: ['other'], ko: ['other'], th: ['other'], vi: ['other'],
  id: ['other'], ms: ['other'], 'zh-Hans': ['other'], 'zh-Hant': ['other']
};

const load = async (lang) => {
  const path = join(LOCALES, `${lang}.js`);
  try {
    readFileSync(path, 'utf8');
  } catch {
    return { missing: true, path };
  }
  // On Windows an absolute path must be a file:// URL before it can be imported.
  const mod = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
  return { table: mod.default || mod, path };
};

const en = await load('en');
const source = en.table;
const keys = Object.keys(source);

const failures = [];
const notes = [];
let checked = 0;

for (const lang of targets) {
  const { table, missing, path } = await load(lang);
  if (missing) {
    const rel = path.replace(ROOT, '.');
    if (strict) failures.push(`${rel} is missing`);
    else notes.push(`${rel} not written yet`);
    continue;
  }
  checked += 1;

  const got = Object.keys(table);
  const absent = keys.filter((k) => !(k in table));
  const extra = got.filter((k) => !(k in source));
  if (absent.length) failures.push(`${lang}: missing keys → ${absent.join(', ')}`);
  if (extra.length) failures.push(`${lang}: unknown keys → ${extra.join(', ')}`);

  for (const key of keys) {
    if (!(key in table)) continue;
    const ref = source[key];
    const val = table[key];

    if (shape(ref) !== shape(val)) {
      failures.push(`${lang}.${key}: expected a ${shape(ref)}, got a ${shape(val)}`);
      continue;
    }

    if (shape(ref) === 'string') {
      if (typeof val !== 'string' || !val.trim()) {
        failures.push(`${lang}.${key}: empty translation`);
        continue;
      }
      const a = placeholders(ref);
      const b = placeholders(val);
      if (a !== b) failures.push(`${lang}.${key}: placeholders [${b}] should be [${a}]`);
      continue;
    }

    // Object-valued: plural forms or gender variants.
    /*
     * A plural object is validated against the categories its OWN language can
     * produce, not against English's. English has {one, other}; Arabic needs six
     * categories and Russian four, so comparing to English would make those
     * catalogs impossible to satisfy either way — reject the correct forms, or
     * demand categories that English never had.
     */
    const isPlural = key.startsWith('plural.');
    const allowed = isPlural ? (NEEDED[lang] || ['one', 'other']) : Object.keys(ref);
    const members = Object.keys(val);

    for (const m of members) {
      if (!allowed.includes(m)) {
        failures.push(
          `${lang}.${key}: "${m}" is not a valid ${isPlural ? `plural category for ${lang}` : 'form'}`
        );
      }
    }
    if (isPlural) {
      const lack = allowed.filter((c) => !members.includes(c));
      if (lack.length) failures.push(`${lang}.${key}: ${lang} needs plural categories ${lack.join(', ')}`);
    } else {
      for (const m of Object.keys(ref)) {
        if (!(m in val)) failures.push(`${lang}.${key}: missing "${m}" form`);
      }
    }
    if (!(val.other || '').trim()) failures.push(`${lang}.${key}: empty "other" form`);

    for (const m of members) {
      if (!val[m] || !String(val[m]).trim()) failures.push(`${lang}.${key}.${m}: empty`);
      if (isPlural) {
        const a = placeholders(ref.other);
        const b = placeholders(val[m]);
        if (a !== b) failures.push(`${lang}.${key}.${m}: placeholders [${b}] should be [${a}]`);
      }
    }
  }
}

if (failures.length) {
  console.error(`✗ Locale checks failed for ${failures.length} item(s):`);
  failures.slice(0, 40).forEach((f) => console.error('  - ' + f));
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exit(1);
}

const pending = notes.length ? `, ${notes.length} not written yet` : '';
console.log(`✓ Locale checks passed (${checked} catalogs, ${keys.length} keys each${pending})`);
