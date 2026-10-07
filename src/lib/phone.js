/* International phone numbers: parsing, validation and E.164 storage.
 *
 * The platform stores E.164 ("+923001234567") and displays the national format.
 * Validation is deliberately two-tier:
 *   - a hard rule that always applies (E.164 caps a number at 15 digits)
 *   - a per-country national-length rule, used only where we know the range
 * A country with no known range yields `possible: true, confident: false` rather
 * than a confident yes or no.
 */

import { COUNTRIES, countryByCode } from './countries.js';

/* A dialling prefix may be 1-3 digits, so match longest-first. */
const DIALS = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length);

/* Countries that write a national trunk prefix ("0") before the subscriber
 * number. It must be dropped before building E.164. */
export const TRUNK_PREFIX = new Set([
  'AL', 'AM', 'AT', 'AU', 'AZ', 'BD', 'BE', 'BG', 'BY', 'CH', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FR', 'GB', 'GE', 'GR', 'HR', 'HU', 'ID', 'IE', 'IL', 'IN',
  'IR', 'IS', 'IT', 'JP', 'KE', 'KG', 'KR', 'KZ', 'LT', 'LU', 'LV', 'MD', 'ME',
  'MK', 'MT', 'MY', 'NG', 'NL', 'NO', 'NP', 'NZ', 'PK', 'PL', 'PT', 'RO', 'RS',
  'RU', 'SE', 'SI', 'SK', 'TH', 'TR', 'TW', 'UA', 'UZ', 'VN', 'ZA'
]);

/* National significant number length ranges, where known. */
const NATIONAL_LENGTH = {
  US: [10, 10], CA: [10, 10], GB: [10, 10], IE: [7, 9], DE: [5, 11], FR: [9, 9],
  ES: [9, 9], IT: [6, 11], PT: [9, 9], NL: [9, 9], BE: [8, 9], AT: [4, 13],
  CH: [9, 9], DK: [8, 8], NO: [8, 8], SE: [7, 9], FI: [5, 12], PL: [9, 9],
  CZ: [9, 9], SK: [9, 9], HU: [8, 9], RO: [9, 9], GR: [10, 10], RU: [10, 10],
  UA: [9, 9], TR: [10, 10], IN: [10, 10], PK: [10, 10], BD: [6, 10], LK: [9, 9],
  NP: [7, 10], CN: [11, 11], JP: [10, 10], KR: [9, 10], TW: [8, 9], HK: [8, 8],
  SG: [8, 8], MY: [9, 10], ID: [9, 12], TH: [9, 9], VN: [9, 10], PH: [10, 10],
  AU: [9, 9], NZ: [8, 10], BR: [10, 11], MX: [10, 10], AR: [10, 10], CL: [9, 9],
  CO: [10, 10], PE: [9, 9], ZA: [9, 9], NG: [10, 10], EG: [10, 10], KE: [9, 9],
  SA: [9, 9], AE: [9, 9], QA: [8, 8], KW: [8, 8], BH: [8, 8], OM: [8, 8],
  IL: [9, 9], IR: [10, 10]
};

export const E164_MAX_DIGITS = 15;

const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

/** Longest dialling prefix matching the start of a digit string. */
export function splitDial(digits) {
  for (const dial of DIALS) {
    if (digits.startsWith(dial)) return { dial, rest: digits.slice(dial.length) };
  }
  return { dial: null, rest: digits };
}

/*
 * Shared dialling prefixes resolve to the largest market, explicitly. Falling
 * back to list order returned Canada for "+1" purely because CA sorts earlier —
 * a silent wrong answer for every North American number.
 */
const PREFERRED_REGION = {
  1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 64: 'NZ',
  212: 'MA', 262: 'RE', 358: 'FI', 500: 'FK', 590: 'GP', 599: 'CW', 672: 'NF'
};

/** The region a dialling prefix belongs to. */
export function regionForDial(dial) {
  if (PREFERRED_REGION[dial]) return PREFERRED_REGION[dial];
  const matches = COUNTRIES.filter((c) => c.dial === dial);
  if (!matches.length) return null;
  return matches[0].alpha2;
}

/**
 * Parse a phone number into E.164 plus display parts.
 *
 * @param input         what the user typed
 * @param defaultRegion ISO alpha-2 used when the input has no explicit prefix
 * @returns { e164, valid, possible, confident, reason, region, dial, national }
 */
export function parsePhone(input, defaultRegion = 'US') {
  const result = {
    e164: null, valid: false, possible: false, confident: false,
    reason: null, region: null, dial: null, national: null
  };

  const raw = String(input ?? '').trim();
  if (!raw) { result.reason = 'empty'; return result; }

  const explicit = raw.startsWith('+');
  const international = /^00/.test(raw.replace(/[\s()-.]/g, ''));
  let digits = digitsOnly(raw);
  if (!digits) { result.reason = 'no-digits'; return result; }

  let region = null;
  if (explicit || international) {
    if (international) digits = digits.replace(/^00/, '');
    const { dial, rest } = splitDial(digits);
    if (!dial) { result.reason = 'unknown-country-code'; return result; }
    region = regionForDial(dial);
    result.dial = dial;
    result.national = rest;
  } else {
    region = defaultRegion || null;
    const country = countryByCode(region);
    if (!country) { result.reason = 'no-region'; return result; }
    result.dial = country.dial;
    // Drop the trunk prefix before treating the rest as the national number.
    let rest = digits;
    if (TRUNK_PREFIX.has(region) && rest.startsWith('0')) rest = rest.replace(/^0+/, '');
    result.national = rest;
  }

  if (!region) { result.reason = 'unknown-country-code'; return result; }
  result.region = region;

  const national = result.national || '';
  if (!national) { result.reason = 'missing-national-number'; return result; }

  const totalDigits = (result.dial + national).length;
  if (totalDigits > E164_MAX_DIGITS) {
    result.reason = 'too-long';
    return result;
  }

  result.e164 = `+${result.dial}${national}`;

  const range = NATIONAL_LENGTH[region];
  if (!range) {
    // No rule for this country: possible, but we cannot promise it is valid.
    result.possible = national.length >= 4;
    result.valid = false;
    result.confident = false;
    result.reason = 'no-length-rule';
    return result;
  }

  /*
   * A rule exists, so we ARE confident in the verdict — whether it comes back
   * valid or not. Leaving `confident` false here made a wrong-length number for
   * Pakistan render as "no length rule for Pakistan", which is both wrong and
   * unhelpful.
   */
  result.confident = true;
  result.possible = true;

  const [min, max] = range;
  if (national.length < min) {
    result.reason = national.length < min - 2 ? 'too-short' : 'incomplete';
    return result;
  }
  if (national.length > max) {
    result.reason = 'too-long-for-country';
    return result;
  }

  result.valid = true;
  result.possible = true;
  result.confident = true;
  result.reason = 'valid';
  return result;
}

/** Digits after the dialling prefix, grouped for readability. */
export function formatNational(input, defaultRegion = 'US') {
  const parsed = parsePhone(input, defaultRegion);
  if (!parsed.national) return String(input ?? '').trim();
  const n = parsed.national;
  if (parsed.region === 'US' || parsed.region === 'CA') {
    if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (parsed.region === 'GB' && n.length === 10) {
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  }
  if (parsed.region === 'IN' && n.length === 10) {
    return `${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (parsed.region === 'PK' && n.length === 10) {
    return `${n.slice(0, 3)} ${n.slice(3)}`;
  }
  // Generic grouping in threes reads acceptably for most numbering plans.
  return n.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** Display string with the country code, e.g. "+92 300 1234567". */
export function formatInternational(input, defaultRegion = 'US') {
  const parsed = parsePhone(input, defaultRegion);
  if (!parsed.dial) return String(input ?? '').trim();
  const nat = parsed.national ? formatNational(parsed.e164, parsed.region) : '';
  return `+${parsed.dial} ${nat}`.trim();
}

/**
 * As-you-type helper: keeps only characters legal in a phone number and keeps a
 * leading "+" so a pasted international number survives.
 */
export function sanitiseInput(value, { allowPlus = true } = {}) {
  const raw = String(value ?? '');
  const plus = allowPlus && raw.trimStart().startsWith('+') ? '+' : '';
  // The hyphen must sit last in the class. Written as `[^\d\s()-.]` it defines
  // the range )-. which includes "+", so a pasted "+92…" came back as "++92…".
  return plus + raw.replace(/[^\d\s().-]/g, '');
}
