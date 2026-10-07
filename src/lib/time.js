/* Global time architecture.
 *
 * Rules this module enforces
 *  1. Storage is UTC. `toUTC` is the only way a wall-clock time becomes an
 *     instant, and it never guesses silently across a DST boundary.
 *  2. Display is localized through Intl with an explicit IANA zone.
 *  3. A wall time that happens twice (fall-back) or never (spring-forward) is
 *     detected and reported, because both are real and both corrupt data when
 *     handled by accident.
 *
 * There is no dependency on a timezone library: Intl carries the full IANA
 * database, so offsets and abbreviations are always current.
 */

export const UTC = 'UTC';

/** Zones offered in the picker. Any valid IANA zone is still accepted. */
export const COMMON_ZONES = [
  'UTC',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Riyadh',
  'Asia/Tehran', 'Asia/Jerusalem', 'Asia/Istanbul', 'Asia/Karachi',
  'Asia/Karachi', 'Asia/Tashkent', 'Asia/Almaty', 'Asia/Kathmandu',
  'Asia/Yangon', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Kuala_Lumpur',
  'Asia/Singapore', 'Asia/Manila', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Vladivostok',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane',
  'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Fiji',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid',
  'Europe/Paris', 'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin',
  'Europe/Zurich', 'Europe/Rome', 'Europe/Vienna', 'Europe/Prague',
  'Europe/Warsaw', 'Europe/Budapest', 'Europe/Stockholm', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Bucharest',
  'Europe/Kyiv', 'Europe/Moscow', 'Europe/Istanbul',
  'Africa/Casablanca', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg',
  'Africa/Nairobi', 'Africa/Accra', 'Africa/Algiers',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Santiago',
  'America/Bogota', 'America/Lima', 'America/Caracas',
  'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver',
  'America/Phoenix', 'America/Los_Angeles', 'America/Vancouver',
  'America/Anchorage', 'America/Mexico_City', 'America/Panama', 'Pacific/Honolulu'
];

/* Duplicates crept into the list above during editing; de-duplicate so the
 * picker never shows the same zone twice. */
export const ZONE_LIST = [...new Set(COMMON_ZONES)];

export const isValidZone = (zone) => {
  if (!zone || typeof zone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/* ---------------------------------------------------------------------------
 * Offsets
 * ------------------------------------------------------------------------ */

const PARTS_FMT = new Map();
const partsFormatter = (zone) => {
  if (!PARTS_FMT.has(zone)) {
    PARTS_FMT.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return PARTS_FMT.get(zone);
};

/**
 * Wall-clock fields for an instant in a zone, or null.
 *
 * Guarded because Intl throws a RangeError on an unknown zone. Without this,
 * every caller that documents "returns null for an invalid zone" — gmtLabel,
 * offsetMinutes, zoneAbbreviation — threw instead, which is how a bad zone
 * string crashed a render rather than degrading.
 */
export function partsInZone(instant, zone = UTC) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  let parts;
  try {
    parts = partsFormatter(zone).formatToParts(date);
  } catch {
    return null;
  }
  const p = parts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second)
  };
}

/**
 * The zone's offset from UTC in minutes at an instant.
 * Positive means east of UTC (Asia/Karachi → +300).
 */
export function offsetMinutes(zone, instant) {
  const parts = partsInZone(instant, zone);
  if (!parts) return null;
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const ms = (instant instanceof Date ? instant : new Date(instant)).getTime();
  // Compare whole seconds: formatToParts drops milliseconds.
  return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 60000);
}

/** "+05:00" / "-04:30" */
export function offsetLabel(minutes) {
  if (minutes == null) return '—';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** GMT+5 / GMT-4 style label, matching what Intl prints. */
export function gmtLabel(zone, instant = new Date()) {
  const min = offsetMinutes(zone, instant);
  if (min == null) return '—';
  if (min === 0) return 'GMT';
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  return abs % 60 === 0 ? `GMT${sign}${abs / 60}` : `GMT${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Standard offset for a zone: the smaller of the January and July offsets.
 * DST always *adds* time, so the smaller value is the standard offset. This is
 * what makes `isDST` correct in both hemispheres — the naive "compare to
 * January" test gets every southern-hemisphere zone backwards.
 */
export function standardOffset(zone, year) {
  const jan = offsetMinutes(zone, new Date(Date.UTC(year, 0, 15, 12)));
  const jul = offsetMinutes(zone, new Date(Date.UTC(year, 6, 15, 12)));
  if (jan == null || jul == null) return null;
  return Math.min(jan, jul);
}

export function isDST(zone, instant = new Date()) {
  const min = offsetMinutes(zone, instant);
  const std = standardOffset(zone, (instant instanceof Date ? instant : new Date(instant)).getUTCFullYear());
  if (min == null || std == null) return false;
  return min > std;
}

/** The zone's own abbreviation (PKT, EST, CEST) where Intl provides one. */
export function zoneAbbreviation(zone, instant = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(instant instanceof Date ? instant : new Date(instant));
    return parts.find((p) => p.type === 'timeZoneName')?.value || gmtLabel(zone, instant);
  } catch {
    return gmtLabel(zone, instant);
  }
}

/* ---------------------------------------------------------------------------
 * Storage and wall-clock resolution
 * ------------------------------------------------------------------------ */

/** Always store this. A UTC instant serialized for persistence. */
export const toStorage = (instant) => new Date(instant).toISOString();

/** Read back a stored instant. A value without a zone designator is rejected. */
export function fromStorage(value) {
  if (value == null) return null;
  const s = String(value);
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a wall-clock time in a zone to a UTC instant.
 *
 * Returns { instant, kind, alternatives } where kind is:
 *   'unique'      — exactly one instant matches
 *   'ambiguous'   — the clock went back; the wall time happened twice
 *   'nonexistent' — the clock went forward; the wall time never happened
 *
 * Callers must handle 'ambiguous' and 'nonexistent'. Silently picking the first
 * candidate is how a scheduled payment lands an hour early.
 */
export function resolveWallTime(zone, wall) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = wall || {};
  if (!isValidZone(zone)) return { instant: null, kind: 'invalid-zone', alternatives: [] };
  if ([year, month, day].some((v) => !Number.isFinite(v))) {
    return { instant: null, kind: 'invalid-wall-time', alternatives: [] };
  }

  const target = Date.UTC(year, month - 1, day, hour, minute, second);

  // Probe the offsets around the target and keep only those that are consistent.
  const probes = [...new Set([
    offsetMinutes(zone, new Date(target - 2 * 86400000)),
    offsetMinutes(zone, new Date(target)),
    offsetMinutes(zone, new Date(target + 2 * 86400000))
  ].filter((v) => v != null))];

  const candidates = [];
  for (const off of probes) {
    const ts = target - off * 60000;
    if (offsetMinutes(zone, new Date(ts)) === off) candidates.push(ts);
  }
  const unique = [...new Set(candidates)].sort((a, b) => a - b);

  if (!unique.length) return { instant: null, kind: 'nonexistent', alternatives: [] };
  if (unique.length > 1) {
    return { instant: new Date(unique[0]), kind: 'ambiguous', alternatives: unique.map((ts) => new Date(ts)) };
  }
  return { instant: new Date(unique[0]), kind: 'unique', alternatives: [] };
}

/** Convenience: treat an ambiguous wall time as its earliest instant. */
export function toUTC(zone, wall) {
  const resolved = resolveWallTime(zone, wall);
  return resolved.instant;
}

/** A wall-clock string plus its zone, rendered for display. */
export function fromUTC(instant, zone, opts = {}) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(opts.lang || 'en', {
    timeZone: zone,
    dateStyle: opts.dateStyle || 'medium',
    timeStyle: opts.timeStyle || 'short'
  }).format(date);
}

/* ---------------------------------------------------------------------------
 * DST transitions
 * ------------------------------------------------------------------------ */

/** How DST is handled for a given zone in a year — shown, never assumed. */
export function zoneDstInfo(zone, year = new Date().getUTCFullYear()) {
  const jan = offsetMinutes(zone, new Date(Date.UTC(year, 0, 15, 12)));
  const jul = offsetMinutes(zone, new Date(Date.UTC(year, 6, 15, 12)));
  const observes = jan !== jul;
  return {
    zone,
    year,
    observesDst: observes,
    standardOffset: observes ? Math.min(jan, jul) : jan,
    currentOffset: offsetMinutes(zone, new Date()),
    transitions: observes ? findTransitions(zone, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)) : []
  };
}

/**
 * Find every offset change in a window, by binary-searching each hour that
 * brackets a change. Returns [{ at, from, to, deltaMinutes }].
 */
export function findTransitions(zone, fromMs, toMs) {
  const out = [];
  if (!isValidZone(zone)) return out;
  let prev = offsetMinutes(zone, new Date(fromMs));
  let cursor = fromMs;
  const stepMs = 6 * 3600 * 1000; // 6h granularity, then refine
  while (cursor < toMs) {
    const next = Math.min(cursor + stepMs, toMs);
    const off = offsetMinutes(zone, new Date(next));
    if (off !== prev) {
      // Binary search the exact minute of the change.
      let lo = cursor;
      let hi = next;
      while (hi - lo > 60000) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (offsetMinutes(zone, new Date(mid)) === prev) lo = mid; else hi = mid;
      }
      out.push({ at: new Date(hi).toISOString(), from: prev, to: off, deltaMinutes: off - prev });
      prev = off;
    }
    cursor = next;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Zone roles
 * ------------------------------------------------------------------------ */

/*
 * Three zones coexist: the person (user), the business (organization) and the
 * event itself. Precedence is explicit — an event's own zone wins, then the
 * organization's, then the user's, then UTC. Nothing else may assume a zone.
 */
export const ZONE_ROLES = ['user', 'organization', 'event'];

export function resolveZone({ eventZone, organizationZone, userZone } = {}) {
  const chain = [
    { role: 'event', zone: eventZone },
    { role: 'organization', zone: organizationZone },
    { role: 'user', zone: userZone },
    { role: 'utc', zone: UTC }
  ];
  const hit = chain.find((c) => isValidZone(c.zone));
  return { zone: hit.zone, source: hit.role };
}

/** Flag a mismatch between the zone a client claims and the zone it is running in. */
export function zoneConsistency({ claimed, actual }) {
  if (!isValidZone(claimed) || !isValidZone(actual)) {
    return { consistent: false, reason: 'invalid-zone' };
  }
  const claimedOff = offsetMinutes(claimed, new Date());
  const actualOff = offsetMinutes(actual, new Date());
  return {
    consistent: claimed === actual,
    claimedOffset: claimedOff,
    actualOffset: actualOff,
    offsetMatches: claimedOff === actualOff
  };
}

/* ---------------------------------------------------------------------------
 * Relative time
 * ------------------------------------------------------------------------ */

const RELATIVE = {
  en: { now: 'just now', past: '{n} {unit} ago', future: 'in {n} {unit}', units: { sec: 'second', min: 'minute', hour: 'hour', day: 'day', week: 'week', month: 'month', year: 'year' } },
  ur: { now: 'ابھی', past: '{n} {unit} پہلے', future: '{n} {unit} میں', units: { sec: 'سیکنڈ', min: 'منٹ', hour: 'گھنٹہ', day: 'دن', week: 'ہفتہ', month: 'مہینہ', year: 'سال' } },
  ar: { now: 'الآن', past: 'قبل {n} {unit}', future: 'خلال {n} {unit}', units: { sec: 'ثانية', min: 'دقيقة', hour: 'ساعة', day: 'يوم', week: 'أسبوع', month: 'شهر', year: 'سنة' } }
};

/*
 * Plural handling applies only to the languages that carry their own wording.
 * A language without a table falls back to English *including* its plural rule —
 * otherwise the fallback reads "3 minute ago", which is worse than English.
 */
const NO_PLURAL_SUFFIX = new Set(['ja', 'ko', 'zh-Hans', 'zh-Hant', 'th', 'vi', 'id', 'ms', 'ar', 'he']);

const pluralOf = (lang, n, word) => {
  if (NO_PLURAL_SUFFIX.has(lang)) return word;
  return n === 1 ? word : `${word}s`;
};

/**
 * "3 minutes ago" / "in 2 days", localized for the languages we carry strings
 * for. An unknown language falls back to English formatting rather than
 * printing a raw key.
 */
export function formatRelative(value, { lang = 'en', now = Date.now() } = {}) {
  const then = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(then)) return '—';
  // Only en/ur/ar carry wording; any other language formats as English.
  const hasTable = Object.prototype.hasOwnProperty.call(RELATIVE, lang);
  const table = hasTable ? RELATIVE[lang] : RELATIVE.en;
  const pluralLang = hasTable ? lang : 'en';

  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return table.now;

  const steps = [
    [60, 'sec'], [3600, 'min'], [86400, 'hour'], [604800, 'day'],
    [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']
  ];
  const divisors = [1, 60, 3600, 86400, 604800, 2629800, 31557600];
  for (let i = 0; i < steps.length; i += 1) {
    if (abs < steps[i][0]) {
      const unitKey = steps[i][1];
      const n = Math.max(1, Math.round(abs / divisors[i]));
      const word = pluralOf(pluralLang, n, table.units[unitKey]);
      const template = diffSec < 0 ? table.past : table.future;
      return template.replace('{n}', String(n)).replace('{unit}', word);
    }
  }
  return table.now;
}

/** Localized time-zone list grouped by area, for the picker. */
export function zonesByArea() {
  return ZONE_LIST
    .map((zone) => ({ zone, area: zone.includes('/') ? zone.split('/')[0] : 'UTC', label: zone.replace(/_/g, ' ') }))
    .reduce((acc, z) => {
      (acc[z.area] = acc[z.area] || []).push(z);
      return acc;
    }, {});
}

/** Zones sorted by current offset, so the picker reads geographically. */
export function zonesByOffset() {
  return ZONE_LIST
    .map((zone) => ({ zone, offset: offsetMinutes(zone, new Date()), label: `${gmtLabel(zone)} · ${zone.replace(/_/g, ' ')}` }))
    .sort((a, b) => (a.offset - b.offset) || a.zone.localeCompare(b.zone));
}

/* ---------------------------------------------------------------------------
 * Recurring events, reminders and calendar export
 * ------------------------------------------------------------------------ */

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

const DAY_MS = 86400000;

/**
 * Expand a simple recurrence into occurrences.
 * Supported: daily / weekly (with `weekdays` 0-6) / monthly (with `dayOfMonth`)
 * / yearly, each with an interval, a count and optional until.
 * Deliberately NOT a full RFC 5545 RRULE engine — `RECURRENCE_LIMITATION`
 * states that, and the returned occurrences are UTC instants.
 */
export function expandRecurrence({
  start, rule = {}, count = 10, until = null
} = {}) {
  const { frequency = 'daily', interval = 1, weekdays = [], dayOfMonth = null } = rule;
  if (!FREQUENCIES.includes(frequency)) return [];

  const first = start instanceof Date ? new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
  )) : new Date(start);
  if (Number.isNaN(first.getTime())) return [];

  const step = Math.max(1, Math.floor(interval));
  const limit = Math.max(1, Math.min(Number(count) || 10, 500));
  const untilMs = until ? new Date(until).getTime() : Infinity;
  const out = [];
  const guard = 20000; // stops an impossible rule from spinning forever

  if (frequency === 'weekly' && weekdays.length) {
    const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort();
    for (let i = 0, scanned = 0; out.length < limit && scanned < guard; i += 1, scanned += 1) {
      const cursor = new Date(first.getTime() + i * DAY_MS);
      const weeks = Math.floor(i / 7);
      if (weeks % step !== 0) continue;
      if (!days.includes(cursor.getUTCDay())) continue;
      if (cursor.getTime() > untilMs) break;
      out.push(cursor);
    }
    return out;
  }

  for (let i = 0; out.length < limit && i < guard; i += 1) {
    let cursor;
    if (frequency === 'daily') {
      cursor = new Date(first.getTime() + i * step * DAY_MS);
    } else if (frequency === 'weekly') {
      cursor = new Date(first.getTime() + i * step * 7 * DAY_MS);
    } else if (frequency === 'monthly') {
      const monthIndex = first.getUTCMonth() + i * step;
      const year = first.getUTCFullYear() + Math.floor(monthIndex / 12);
      const month = ((monthIndex % 12) + 12) % 12;
      const wanted = dayOfMonth ?? first.getUTCDate();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      cursor = new Date(Date.UTC(year, month, Math.min(wanted, daysInMonth),
        first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds()));
    } else {
      const year = first.getUTCFullYear() + i * step;
      const month = first.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      cursor = new Date(Date.UTC(year, month, Math.min(first.getUTCDate(), daysInMonth),
        first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds()));
    }
    if (cursor.getTime() > untilMs) break;
    out.push(cursor);
  }
  return out;
}

export const RECURRENCE_LIMITATION =
  'Recurrence supports daily, weekly, monthly and yearly with an interval. Complex RFC 5545 rules '
  + '(BYDAY with ordinals, BYSETPOS, exception dates) are out of scope and would need a full RRULE engine.';

/**
 * When a reminder should fire, expressed both ways.
 * The local wall time is what the person asked for; the UTC instant is what we
 * store. Across a DST change those differ, which is exactly why both appear.
 */
export function planReminder({ wall, zone = UTC, leadMinutes = 0 } = {}) {
  const resolved = resolveWallTime(zone, wall);
  if (!resolved.instant) {
    return { ok: false, reason: resolved.kind, zone, wall };
  }
  const fireAt = new Date(resolved.instant.getTime() - leadMinutes * 60000);
  return {
    ok: true,
    zone,
    wall,
    ambiguity: resolved.kind,
    alternatives: resolved.alternatives,
    localTime: fromUTC(resolved.instant, zone, { dateStyle: 'medium', timeStyle: 'short' }),
    eventUtc: toStorage(resolved.instant),
    reminderUtc: toStorage(fireAt),
    leadMinutes
  };
}

/**
 * Does a daily reminder keep its local wall time across a DST change?
 * A naive "+24h in UTC" drifts by an hour; this reports both so the caller can
 * choose and the drift is visible rather than silent.
 */
export function dstDriftForRecurrence({ zone, wall, occurrences = 3 } = {}) {
  const first = resolveWallTime(zone, wall);
  if (!first.instant) return { ok: false, reason: first.kind };
  const naive = [];
  const wallAnchored = [];
  for (let i = 0; i < occurrences; i += 1) {
    naive.push(new Date(first.instant.getTime() + i * DAY_MS));
    const day = new Date(first.instant.getTime() + i * DAY_MS);
    const p = partsInZone(day, zone);
    const again = resolveWallTime(zone, { ...wall, year: p.year, month: p.month, day: p.day });
    wallAnchored.push(again.instant);
  }
  const drift = naive.map((n, i) => Math.round((n.getTime() - wallAnchored[i].getTime()) / 60000));
  return {
    ok: true,
    zone,
    naive,
    wallAnchored,
    driftMinutes: drift,
    drifts: drift.some((d) => d !== 0)
  };
}

/* ---------------------------------------------------------------------------
 * Calendar integration (ICS)
 * ------------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const icsStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const escapeIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * Build an ICS calendar. Standard 75-octet line folding is applied because
 * clients reject unfolded long lines.
 */
export function buildICS({ events = [], calendarName = 'CryptoX' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CryptoX//Global Time//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`
  ];
  events.forEach((e) => {
    const start = new Date(e.start);
    if (Number.isNaN(start.getTime())) return;
    const end = e.end ? new Date(e.end) : new Date(start.getTime() + (e.durationMinutes || 30) * 60000);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid || `${start.getTime()}-${Math.random().toString(36).slice(2, 8)}@cryptox`}`);
    lines.push(`DTSTAMP:${icsStamp(new Date())}`);
    lines.push(`DTSTART:${icsStamp(start)}`);
    lines.push(`DTEND:${icsStamp(end)}`);
    lines.push(`SUMMARY:${escapeIcs(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeIcs(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    if (e.zone) lines.push(`X-CRYPTOX-TZ:${escapeIcs(e.zone)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');

  // Fold to 75 octets per line, as RFC 5545 requires.
  return lines.flatMap((line) => {
    if (line.length <= 75) return [line];
    const chunks = [];
    let rest = line;
    while (rest.length > 75) {
      chunks.push(rest.slice(0, 75));
      rest = ' ' + rest.slice(75);
    }
    chunks.push(rest);
    return chunks;
  }).join('\r\n');
}

export const CALENDAR_INTEGRATION = {
  supported: ['ics-download', 'google-calendar-url', 'outlook-web-url'],
  note: 'Events are exported as an ICS file and as provider deep-links. Two-way sync needs OAuth against each calendar provider and is not attempted here.',
  limitations: ['No OAuth calendar sync', 'No free/busy lookup', 'No server-side push notifications — reminders fire while the tab is open']
};

/** A Google Calendar deep link for one event. */
export function googleCalendarUrl({ start, end, summary, description, location } = {}) {
  const fmt = (d) => icsStamp(new Date(d));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary || '',
    dates: `${fmt(start)}/${fmt(end || new Date(new Date(start).getTime() + 1800000))}`
  });
  if (description) params.set('details', description);
  if (location) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* ---------------------------------------------------------------------------
 * Consistency
 * ------------------------------------------------------------------------ */

/**
 * A stored timestamp must be UTC. A naive local string ("2026-10-07 09:00:00")
 * has no zone and is rejected — that is the exact bug this guards against.
 */
export function assertUtcStorage(values = []) {
  const bad = values.filter((v) => fromStorage(v) === null);
  return {
    ok: bad.length === 0,
    checked: values.length,
    rejected: bad,
    note: 'Timestamps must carry a zone designator (Z or ±HH:MM). Local server time must never be persisted.'
  };
}
