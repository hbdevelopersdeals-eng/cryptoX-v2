/* Locale registry: the 25 launch languages, their direction, numbering system,
 * fallback chain and catalog version.
 *
 * Adding a language is a data change only — nothing in the application logic
 * branches on a specific language code. A new entry here plus a catalog file is
 * the entire job.
 */

export const RTL_LANGUAGES = new Set(['ar', 'ur', 'fa', 'he']);

/** Numbering systems a locale may render digits in. */
export const NUMBERING_SYSTEMS = [
  { id: 'latn', label: 'Western (0-9)' },
  { id: 'arab', label: 'Arabic-Indic (٠-٩)' },
  { id: 'arabext', label: 'Extended Arabic-Indic (۰-۹)' }
];

/*
 * `catalogs` is the version of the translation file; `reviewed` records whether
 * a native speaker has signed it off. Machine-drafted catalogs are labelled as
 * such rather than presented as professionally translated.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', dir: 'ltr', numbering: 'latn', fallback: [] },
  { code: 'ur', label: 'Urdu', nativeLabel: 'اردو', dir: 'rtl', numbering: 'latn', fallback: ['en'] },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl', numbering: 'arab', fallback: ['en'] },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'fr', label: 'French', nativeLabel: 'Français', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'ms', label: 'Malay', nativeLabel: 'Bahasa Melayu', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', nativeLabel: '简体中文', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', nativeLabel: '繁體中文', dir: 'ltr', numbering: 'latn', fallback: ['zh-Hans', 'en'] },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย', dir: 'ltr', numbering: 'latn', fallback: ['en'] },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی', dir: 'rtl', numbering: 'arabext', fallback: ['en'] },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', dir: 'rtl', numbering: 'latn', fallback: ['en'] }
];

export const SOURCE_LANGUAGE = 'en';

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const languageByCode = (code) => BY_CODE.get(code) || null;

export const isSupported = (code) => BY_CODE.has(code);

export const isRtl = (code) => RTL_LANGUAGES.has(code);

export const dirFor = (code) => (isRtl(code) ? 'rtl' : 'ltr');

/** Regions that are not on the metric system. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

export const measurementFor = (region) => (IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric');

/* ---------------------------------------------------------------------------
 * Locale matching
 * ------------------------------------------------------------------------ */

/**
 * Match a BCP-47 tag ("zh-Hant-TW", "pt-BR", "en") to a supported language.
 * Script subtags win over region, because zh-Hant and zh-Hans are distinct
 * catalogs while zh-CN and zh-TW are not.
 */
export function matchLanguage(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const parts = tag.replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts.length) return null;
  const base = parts[0].toLowerCase();
  /*
   * Only subtags AFTER the base count as script/region. Searching the whole tag
   * finds the base itself ("zh-TW" → region "zh"), which silently sent every
   * Traditional Chinese tag to the Simplified catalog.
   */
  const rest = parts.slice(1);
  const script = rest.find((p) => /^[A-Za-z]{4}$/.test(p));
  const region = rest.find((p) => /^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p));

  if (base === 'zh') {
    const s = (script || '').toLowerCase();
    if (s === 'hant') return 'zh-Hant';
    if (s === 'hans') return 'zh-Hans';
    // No script given: derive from the region, the common CLDR behaviour.
    const traditional = ['TW', 'HK', 'MO'];
    if (region && traditional.includes(region.toUpperCase())) return 'zh-Hant';
    return 'zh-Hans';
  }
  const exact = parts.length >= 2 ? `${base}-${script || region}` : base;
  if (BY_CODE.has(exact)) return exact;
  if (BY_CODE.has(base)) return base;
  return null;
}

/**
 * Negotiate the best supported language from an ordered preference list
 * (navigator.languages, an Accept-Language header, or a saved choice).
 */
export function negotiate(preferences = []) {
  for (const p of preferences) {
    const hit = matchLanguage(p);
    if (hit) return hit;
  }
  return SOURCE_LANGUAGE;
}

/** The ordered chain of catalogs to consult for a language. */
export function fallbackChain(lang) {
  const entry = languageByCode(lang);
  const chain = [lang];
  if (entry) chain.push(...entry.fallback);
  if (!chain.includes(SOURCE_LANGUAGE)) chain.push(SOURCE_LANGUAGE);
  return [...new Set(chain)];
}

/* ---------------------------------------------------------------------------
 * Detection
 * ------------------------------------------------------------------------ */

/**
 * Best-effort region detection. The language tag is authoritative when it
 * carries a region ("pt-BR"); the timezone is only a hint for tags like "en"
 * and is intentionally a short list rather than a full tz database.
 */
const TZ_REGION = {
  'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Dhaka': 'BD', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
  'Asia/Shanghai': 'CN', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Asia/Jakarta': 'ID', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH', 'Asia/Tehran': 'IR', 'Asia/Jerusalem': 'IL',
  'Europe/London': 'GB', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT', 'Europe/Amsterdam': 'NL', 'Europe/Warsaw': 'PL',
  'Europe/Istanbul': 'TR', 'Europe/Moscow': 'RU', 'America/New_York': 'US',
  'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX', 'America/Toronto': 'CA'
};

export function detectRegion({ language, timeZone } = {}) {
  const parts = String(language || '').replace(/_/g, '-').split('-').filter(Boolean);
  // Skip the base subtag: "en-PK" must yield PK, not EN.
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  if (region) return region.toUpperCase();
  if (timeZone && TZ_REGION[timeZone]) return TZ_REGION[timeZone];
  return null;
}

/** A settings object derived from the browser, used only as a first-run default. */
export function detectLocaleSettings(nav = typeof navigator === 'undefined' ? null : navigator) {
  const prefs = [];
  if (nav) {
    if (Array.isArray(nav.languages)) prefs.push(...nav.languages);
    if (nav.language) prefs.push(nav.language);
  }
  const lang = negotiate(prefs);
  let timeZone = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    timeZone = null;
  }
  const region = detectRegion({ language: prefs[0], timeZone });
  return { lang, region, timeZone, measurement: measurementFor(region) };
}

/* ---------------------------------------------------------------------------
 * Catalog metadata (translation versioning)
 * ------------------------------------------------------------------------ */

export const CATALOG_VERSION = 1;

/**
 * Per-language translation status. `drafted` means the catalog was authored by
 * tooling and has not been signed off by a native speaker — the UI says so
 * instead of claiming a professional translation.
 */
export const CATALOG_STATUS = LANGUAGES.reduce((acc, l) => {
  acc[l.code] = l.code === 'en'
    ? { version: CATALOG_VERSION, reviewed: true, drafted: false }
    : { version: CATALOG_VERSION, reviewed: false, drafted: true };
  return acc;
}, {});
