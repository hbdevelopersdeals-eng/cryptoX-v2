/* Locale-aware formatting: numbers, dates, currencies and measurements.
 *
 * Everything routes through Intl so the platform does not carry its own
 * hand-rolled date/number tables, and every call is guarded — an unknown or
 * unsupported tag degrades to English instead of throwing mid-render.
 */

import { languageByCode, measurementFor } from './locales.js';

/** Build a safe Intl locale tag, falling back to English when unknown. */
export function tagFor(lang, region) {
  const entry = languageByCode(lang);
  if (!entry) return 'en';
  // zh-Hans / zh-Hant are valid BCP-47; other codes are plain language subtags.
  return region ? `${entry.code}-${region}` : entry.code;
}

const safe = (fn, fallback) => {
  try {
    const out = fn();
    return out == null ? fallback : out;
  } catch {
    return fallback;
  }
};

/* ---------------------------------------------------------------------------
 * Numbers
 * ------------------------------------------------------------------------ */

/** The decimal and grouping separators a locale actually uses. */
export function separators(lang, numbering) {
  const opts = numbering ? { numberingSystem: numbering } : undefined;
  const parts = safe(
    () => new Intl.NumberFormat(tagFor(lang), opts).formatToParts(1234567.89),
    null
  );
  if (!parts) return { decimal: '.', group: ',' };
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ','
  };
}

export function formatNumber(value, { lang = 'en', numbering, digits, compact = false, percent = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const opts = {
    ...(numbering ? { numberingSystem: numbering } : {}),
    ...(compact ? { notation: 'compact', compactDisplay: 'short' } : {}),
    ...(percent ? { style: 'percent' } : {})
  };
  if (digits != null) {
    opts.minimumFractionDigits = digits;
    opts.maximumFractionDigits = digits;
  }
  return safe(
    () => new Intl.NumberFormat(tagFor(lang), opts).format(Number(value)),
    String(value)
  );
}

export function formatPercent(fraction, { lang = 'en', digits = 2, numbering } = {}) {
  return formatNumber(fraction, { lang, digits, percent: true, numbering });
}

/** Currency using the locale's own placement and symbol conventions. */
export function formatCurrency(value, { lang = 'en', currency = 'USD', digits, numbering } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const opts = {
    style: 'currency',
    currency,
    ...(numbering ? { numberingSystem: numbering } : {})
  };
  if (digits != null) {
    opts.minimumFractionDigits = digits;
    opts.maximumFractionDigits = digits;
  }
  return safe(
    () => new Intl.NumberFormat(tagFor(lang), opts).format(Number(value)),
    `${currency} ${value}`
  );
}

/* ---------------------------------------------------------------------------
 * Dates and times
 * ------------------------------------------------------------------------ */

export function formatDate(value, { lang = 'en', style = 'medium', timeZone, numbering } = {}) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = {
    dateStyle: style,
    ...(timeZone ? { timeZone } : {}),
    ...(numbering ? { numberingSystem: numbering } : {})
  };
  return safe(() => new Intl.DateTimeFormat(tagFor(lang), opts).format(d), d.toISOString().slice(0, 10));
}

export function formatTime(value, { lang = 'en', timeZone, seconds = false } = {}) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return safe(
    () => new Intl.DateTimeFormat(tagFor(lang), {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      ...(timeZone ? { timeZone } : {})
    }).format(d),
    '—'
  );
}

export function formatDateTime(value, { lang = 'en', style = 'medium', timeZone } = {}) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return safe(
    () => new Intl.DateTimeFormat(tagFor(lang), {
      dateStyle: style, timeStyle: 'short', ...(timeZone ? { timeZone } : {})
    }).format(d),
    '—'
  );
}

/** The short date pattern this locale would produce, for a settings preview. */
export function datePattern(lang) {
  return safe(() => {
    const parts = new Intl.DateTimeFormat(tagFor(lang), { dateStyle: 'short' })
      .formatToParts(new Date(Date.UTC(2026, 0, 31)));
    return parts.map((p) => ({ day: 'DD', month: 'MM', year: 'YYYY', literal: p.value }[p.type] ?? p.value)).join('');
  }, 'YYYY-MM-DD');
}

/* ---------------------------------------------------------------------------
 * Measurements
 * ------------------------------------------------------------------------ */

/*
 * Only the conversions the platform actually presents. Factors are exact
 * definitions, not rounded approximations:
 *   1 in = 25.4 mm exactly, 1 lb = 0.45359237 kg exactly.
 */
export const MEASURES = {
  kg: { system: 'metric', dimension: 'mass', toBase: (v) => v, fromBase: (v) => v, label: 'kg' },
  lb: { system: 'imperial', dimension: 'mass', toBase: (v) => v * 0.45359237, fromBase: (v) => v / 0.45359237, label: 'lb' },
  km: { system: 'metric', dimension: 'distance', toBase: (v) => v, fromBase: (v) => v, label: 'km' },
  mi: { system: 'imperial', dimension: 'distance', toBase: (v) => v * 1.609344, fromBase: (v) => v / 1.609344, label: 'mi' },
  cm: { system: 'metric', dimension: 'length', toBase: (v) => v, fromBase: (v) => v, label: 'cm' },
  in: { system: 'imperial', dimension: 'length', toBase: (v) => v * 2.54, fromBase: (v) => v / 2.54, label: 'in' },
  g: { system: 'metric', dimension: 'mass', toBase: (v) => v / 1000, fromBase: (v) => v * 1000, label: 'g' },
  oz: { system: 'imperial', dimension: 'mass', toBase: (v) => v * 0.028349523125, fromBase: (v) => v / 0.028349523125, label: 'oz' }
};

/** The unit pair for a dimension in a measurement system. */
export const UNIT_FOR = {
  metric: { mass: 'kg', distance: 'km', length: 'cm', temperature: 'C' },
  imperial: { mass: 'lb', distance: 'mi', length: 'in', temperature: 'F' }
};

/*
 * `Number(null)` is 0 and `Number('')` is 0, so a missing reading would convert
 * to a confident "0.00 kg". Every numeric entry point rejects nullish and empty
 * input before coercing.
 */
const toNumber = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Convert a value between two units of the same dimension. */
export function convertMeasure(value, from, to) {
  const a = MEASURES[from];
  const b = MEASURES[to];
  if (!a || !b || a.dimension !== b.dimension) return null;
  const n = toNumber(value);
  if (n == null) return null;
  return b.fromBase(a.toBase(n));
}

export function convertTemperature(value, from, to) {
  const n = toNumber(value);
  if (n == null) return null;
  if (from === to) return n;
  if (from === 'C' && to === 'F') return (n * 9) / 5 + 32;
  if (from === 'F' && to === 'C') return ((n - 32) * 5) / 9;
  return null;
}

/**
 * Format a measurement for a measurement system.
 *
 * `from` is the unit the caller holds and is REQUIRED. An earlier version
 * assumed the incoming value was metric, so an imperial value was converted
 * anyway and "1 mi" rendered as "0.62 mi". The dimension is derived from `from`
 * rather than passed separately, so the two can never disagree.
 *
 * Temperature is converted with its offset — the usual bug is scaling °C by 1.8
 * and forgetting the +32.
 */
export function formatMeasure(value, from, { system = 'metric', lang = 'en', digits = 2 } = {}) {
  const n = toNumber(value);
  if (n == null) return '—';

  if (from === 'C' || from === 'F') {
    const target = UNIT_FOR[system]?.temperature;
    const out = convertTemperature(n, from, target);
    return out == null ? '—' : `${formatNumber(out, { lang, digits })}°${target}`;
  }

  const src = MEASURES[from];
  if (!src) return '—';
  const target = UNIT_FOR[system]?.[src.dimension];
  if (!target) return '—';
  const out = convertMeasure(n, from, target);
  if (out == null) return '—';
  return `${formatNumber(out, { lang, digits })} ${MEASURES[target]?.label ?? target}`;
}

/** Default measurement system for a region — US, LR and MM are imperial. */
export const defaultMeasurement = measurementFor;
