/* CLDR plural rules for the 25 supported languages.
 *
 * Written out by hand rather than delegated to Intl.PluralRules so the
 * behaviour is deterministic, testable offline and identical in every runtime.
 * The test suite cross-checks each rule against Intl.PluralRules where the
 * engine provides it, so a wrong operand fails loudly instead of quietly
 * mis-pluralising a string.
 *
 * Operands (CLDR):
 *   n — absolute value of the number
 *   i — integer digits of n
 *   v — number of visible fraction digits (with trailing zeros)
 *   f — visible fraction digits as an integer
 */

const operands = (value) => {
  const n = Math.abs(Number(value));
  const s = String(value);
  const dot = s.indexOf('.');
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  return {
    n: Number.isFinite(n) ? n : 0,
    i: Math.floor(Number.isFinite(n) ? n : 0),
    v: frac.length,
    f: frac ? Number(frac) : 0
  };
};

/* Each entry returns the CLDR category for the operands. */
const RULES = {
  /* one: i = 1 and v = 0 */
  englishish: ({ i, v }) => (i === 1 && v === 0 ? 'one' : 'other'),
  /* one: i = 0 or n = 1 */
  indian: ({ i, n }) => (i === 0 || n === 1 ? 'one' : 'other'),
  /* one: i = 0,1 */
  frenchish: ({ i }) => (i === 0 || i === 1 ? 'one' : 'other'),
  /* one: n = 1 */
  turkish: ({ n }) => (n === 1 ? 'one' : 'other'),
  /* no distinction */
  none: () => 'other',
  /* Russian / Ukrainian family */
  slavic: ({ i, v, f }) => {
    const i10 = i % 10;
    const i100 = i % 100;
    if (v === 0 && i10 === 1 && i100 !== 11) return 'one';
    if (v === 0 && i10 >= 2 && i10 <= 4 && (i100 < 12 || i100 > 14)) return 'few';
    if (v === 0 && (i10 === 0 || (i10 >= 5 && i10 <= 9) || (i100 >= 11 && i100 <= 14))) return 'many';
    if (v !== 0 || f === 0) return 'other';
    return 'other';
  },
  /* Polish */
  polish: ({ i, v }) => {
    const i10 = i % 10;
    const i100 = i % 100;
    if (v === 0 && i === 1) return 'one';
    if (v === 0 && i10 >= 2 && i10 <= 4 && (i100 < 12 || i100 > 14)) return 'few';
    // CLDR's many covers i % 10 = 0..1, not just 0. Omitting the `i10 === 1`
    // case sent 11, 21, 31 … to `other` instead of `many`.
    if (v === 0 && i !== 1 &&
        (i10 === 0 || i10 === 1 || (i10 >= 5 && i10 <= 9) || (i100 >= 12 && i100 <= 14))) {
      return 'many';
    }
    return 'other';
  },
  /* Arabic — the only language here using all six categories */
  arabic: ({ n, i }) => {
    const i100 = i % 100;
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    if (i100 >= 3 && i100 <= 10) return 'few';
    if (i100 >= 11 && i100 <= 99) return 'many';
    return 'other';
  },
  /* Hebrew: one (i=1, v=0), two (i=2, v=0) */
  hebrew: ({ i, v }) => {
    if (i === 1 && v === 0) return 'one';
    if (i === 2 && v === 0) return 'two';
    return 'other';
  }
};

const RULE_KEY = {
  en: 'englishish', es: 'englishish', it: 'englishish',
  de: 'englishish', nl: 'englishish', ur: 'englishish',
  // Portuguese counts 0 as a singular form (i = 0..1), like French.
  pt: 'frenchish',
  hi: 'indian', bn: 'indian', pa: 'indian', fa: 'indian',
  fr: 'frenchish', tr: 'turkish',
  id: 'none', ms: 'none', ja: 'none', ko: 'none', th: 'none', vi: 'none',
  'zh-Hans': 'none', 'zh-Hant': 'none',
  ru: 'slavic', pl: 'polish',
  ar: 'arabic', he: 'hebrew'
};

/** Languages that actually distinguish more than `one` / `other`. */
export const PLURAL_CATEGORIES = {
  englishish: ['one', 'other'],
  indian: ['one', 'other'],
  frenchish: ['one', 'other'],
  turkish: ['one', 'other'],
  none: ['other'],
  slavic: ['one', 'few', 'many', 'other'],
  polish: ['one', 'few', 'many', 'other'],
  arabic: ['zero', 'one', 'two', 'few', 'many', 'other'],
  hebrew: ['one', 'two', 'other']
};

/** The CLDR category for `value` in `lang`. */
export function pluralCategory(lang, value) {
  const key = RULE_KEY[lang] || 'englishish';
  return RULES[key](operands(value));
}

/** The categories a language can produce — used to validate a catalog. */
export function categoriesFor(lang) {
  return PLURAL_CATEGORIES[RULE_KEY[lang] || 'englishish'];
}

/** Expand an entry into a category -> text map. A bare string covers 'other'. */
export function pluralForms(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return { other: entry };
  return entry;
}

/**
 * Pick the right plural form.
 * `count` is used for the category; `vars` may still override {count}.
 */
export function selectPlural(lang, entry, count, vars = {}) {
  const forms = pluralForms(entry);
  if (!forms) return null;
  const category = pluralCategory(lang, count);
  return forms[category] ?? forms.other ?? Object.values(forms)[0] ?? null;
}
