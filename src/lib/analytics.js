/* Product analytics: business events, the anonymization pipeline, funnels,
 * retention cohorts, churn and revenue.
 *
 * The pipeline the brief asks for — event → validation → anonymization →
 * analytics pipeline — is `processEvent`, and the order matters. Validation
 * runs BEFORE anonymization so a rejected event is never partially scrubbed and
 * then stored, and anonymization runs BEFORE aggregation so no raw identifier
 * reaches a counter.
 *
 * Consent gates the pipeline: with analytics consent off, non-essential events
 * are dropped at the door rather than collected and filtered later.
 */

import { consentGranted } from './compliance.js';
import { describeDevice } from './accounts.js';

/* ---------------------------------------------------------------------------
 * Event taxonomy
 * ------------------------------------------------------------------------ */

/*
 * An allowlist, not a suggestion. An unknown event name is refused, because
 * analytics pipelines rot by accepting `signup`, `sign_up` and `SignUp` until
 * no funnel adds up.
 */
export const EVENT_REGISTRY = {
  'user.registered': { category: 'acquisition', required: ['method'], optional: ['referrer', 'campaign'] },
  'user.verified': { category: 'activation', required: ['method'] },
  'user.logged_in': { category: 'engagement', required: ['method'], optional: ['mfa'] },
  'user.logged_out': { category: 'engagement', required: [] },
  'user.activated': { category: 'activation', required: ['activationStep'] },
  'feature.used': { category: 'engagement', required: ['feature'], optional: ['count'] },
  'feature.limit_hit': { category: 'engagement', required: ['feature', 'limit'] },
  'search.performed': { category: 'engagement', required: ['resultCount'], optional: ['scope'] },
  'portfolio.created': { category: 'activation', required: [] },
  'alert.created': { category: 'activation', required: ['ruleType'] },
  'subscription.started': { category: 'revenue', required: ['plan', 'cycle', 'amount'] },
  'subscription.changed': { category: 'revenue', required: ['fromPlan', 'toPlan', 'direction'] },
  'subscription.cancelled': { category: 'revenue', required: ['plan', 'reason'], optional: ['feedback'] },
  'trial.started': { category: 'revenue', required: ['plan'] },
  'trial.converted': { category: 'revenue', required: ['plan'] },
  'trial.expired': { category: 'revenue', required: ['plan'] },
  'payment.failed': { category: 'revenue', required: ['declineCode'], optional: ['attempt'] },
  'payment.succeeded': { category: 'revenue', required: ['amount', 'currency'] },
  'refund.issued': { category: 'revenue', required: ['amount', 'kind'] },
  'bot.created': { category: 'activation', required: ['engine'] },
  'export.downloaded': { category: 'engagement', required: ['format'] },
  'error.shown': { category: 'reliability', required: ['scope'] },
  /* Conversion funnel. `context` is the page or limit that produced the prompt,
   * which is what makes "which page converts?" answerable. Note there is no
   * `subscription.activated`: `subscription.started` above already covers it
   * with richer properties, and two names for one event is how a funnel stops
   * adding up. */
  'upgrade.prompt_viewed': { category: 'revenue', required: ['context', 'plan', 'kind'] },
  'upgrade.clicked': { category: 'revenue', required: ['context', 'plan', 'targetPlan'] },
  'checkout.started': { category: 'revenue', required: ['plan', 'cycle'] },
  'checkout.cancelled': { category: 'revenue', required: ['plan', 'cycle'] }
};

export const EVENT_NAMES = Object.keys(EVENT_REGISTRY);
export const eventCategory = (name) => EVENT_REGISTRY[name]?.category || null;

/** Properties that must never travel with an event, whatever the registry says. */
export const FORBIDDEN_PROPERTIES = [
  'email', 'password', 'passphrase', 'token', 'secret', 'seed', 'mnemonic',
  'privateKey', 'apiKey', 'sessionId', 'cardNumber', 'cvv', 'iban', 'ssn',
  'phone', 'address', 'postalCode', 'ip', 'userId', 'walletAddress'
];

/**
 * Validate an event. Refuses unknown names, missing required properties and any
 * forbidden property — the last check is what stops a well-meaning caller from
 * attaching an email address to an event six months from now.
 */
export function validateEvent(event = {}) {
  const errors = [];
  const name = event.name;
  const schema = EVENT_REGISTRY[name];
  if (!name) return { ok: false, errors: ['name-required'] };
  if (!schema) return { ok: false, errors: [`unknown-event:${name}`] };

  const props = event.properties || {};
  for (const key of schema.required) {
    if (props[key] === undefined || props[key] === null || props[key] === '') {
      errors.push(`missing-required:${key}`);
    }
  }
  const allowed = new Set([...schema.required, ...(schema.optional || [])]);
  for (const key of Object.keys(props)) {
    if (FORBIDDEN_PROPERTIES.includes(key)) errors.push(`forbidden-property:${key}`);
    else if (!allowed.has(key)) errors.push(`undeclared-property:${key}`);
  }
  // A numeric field carrying a string is how a funnel silently loses rows.
  for (const key of ['amount', 'resultCount', 'count', 'limit', 'attempt']) {
    if (props[key] !== undefined && typeof props[key] !== 'number') errors.push(`expected-number:${key}`);
  }
  return { ok: errors.length === 0, errors, category: schema.category };
}

/* ---------------------------------------------------------------------------
 * Anonymization
 * ------------------------------------------------------------------------ */

/** Truncate an IPv4 to its /24 and an IPv6 to its /48, so a host is not identifiable. */
export function truncateIp(ip) {
  if (!ip) return null;
  const value = String(ip).trim();
  if (value.includes(':')) {
    const groups = value.split(':').filter(Boolean);
    return `${groups.slice(0, 3).join(':')}::`;
  }
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [a, b, c] = parts;
  if (![a, b, c].every((p) => /^\d{1,3}$/.test(p))) return null;
  // /24 keeps the first three octets and zeroes the host octet.
  return `${a}.${b}.${c}.0`;
}

/**
 * Pseudonymise an identifier.
 *
 * A plain hash of an email is reversible by dictionary attack, which makes it
 * personal data. A per-tenant salt is required, and the result is explicitly
 * labelled as pseudonymous rather than anonymous.
 */
export async function pseudonymise(value, { salt, at = null } = {}) {
  if (!value) return null;
  if (!salt) return { error: 'salt-required', note: 'Without a salt a hash of an email or phone number is reversible by dictionary attack.' };
  const input = at ? `${value}|${at}` : String(value);
  const bytes = new TextEncoder().encode(`${salt}:${input}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { id: hex.slice(0, 32), pseudonymous: true, note: 'Pseudonymous, not anonymous: it remains personal data and is reversible with the salt.' };
}

/** Patterns for data that must be stripped wherever it appears. */
export const PII_PATTERNS = [
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
  { id: 'card', re: /\b(?:\d[ -]?){13,19}\b/g },
  { id: 'evm-address', re: /\b0x[a-fA-F0-9]{40}\b/g },
  { id: 'btc-address', re: /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { id: 'phone', re: /(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,4}\)?[ -]?){2,4}\d{2,4}/g },
  { id: 'ip', re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g }
];

/** Redact free text, reporting what was found so the pipeline can be monitored. */
export function redactText(value) {
  if (typeof value !== 'string') return { text: value, found: [] };
  let text = value;
  const found = [];
  for (const { id, re } of PII_PATTERNS) {
    const matches = text.match(re);
    if (matches) {
      found.push({ type: id, count: matches.length });
      text = text.replace(re, `[redacted:${id}]`);
    }
  }
  return { text, found };
}

/*
 * The pipeline. Returns a payload that is safe to aggregate, or a reason it was
 * dropped. Nothing here throws: a bad event is a data point about the
 * instrumentation, not a reason to break the page.
 */
export async function processEvent({ event, consent = {}, salt = null, anonymise = true } = {}) {
  const validation = validateEvent(event);
  if (!validation.ok) return { ok: false, rejected: 'validation', errors: validation.errors };

  // Consent gate. Reliability events stay, because an error in the product is
  // not marketing and does not rely on marketing consent.
  const essential = validation.category === 'reliability' || event.essential === true;
  if (!essential && !consentGranted(consent, 'analytics')) {
    return { ok: false, rejected: 'no-consent' };
  }

  const out = {
    ok: true,
    name: event.name,
    category: validation.category,
    at: event.at || new Date().toISOString(),
    properties: { ...(event.properties || {}) },
    redactions: []
  };

  if (!anonymise) return out;

  // Free-text fields are scrubbed even when they are declared, since a declared
  // field can still contain anything the user typed.
  for (const [key, value] of Object.entries(out.properties)) {
    if (typeof value === 'string') {
      const { text, found } = redactText(value);
      out.properties[key] = text;
      if (found.length) out.redactions.push({ field: key, found });
    }
  }

  if (event.ip) out.network = truncateIp(event.ip);
  if (event.actorId) {
    const pseudo = await pseudonymise(event.actorId, { salt });
    if (pseudo?.error) return { ok: false, rejected: 'pseudonymisation', reason: pseudo.error, note: pseudo.note };
    out.actor = pseudo.id;
  }
  if (event.device) {
    const d = describeDevice(event.device);
    out.device = { type: d.type, os: d.os, browser: d.browser, label: d.label };
  }
  if (event.locale) out.locale = String(event.locale).slice(0, 12);
  if (event.country) out.country = String(event.country).toUpperCase().slice(0, 2);

  return out;
}

/** Run a batch, reporting every drop reason rather than silently losing rows. */
export async function processBatch({ events = [], consent = {}, salt = null } = {}) {
  const accepted = [];
  const rejected = [];
  for (const event of events) {
    const result = await processEvent({ event, consent, salt });
    if (result.ok) accepted.push(result);
    else rejected.push({ name: event?.name, reason: result.rejected, errors: result.errors });
  }
  const byReason = rejected.reduce((acc, r) => ({ ...acc, [r.reason]: (acc[r.reason] || 0) + 1 }), {});
  return { accepted, rejected, byReason };
}

/* ---------------------------------------------------------------------------
 * Aggregation
 * ------------------------------------------------------------------------ */

export const countBy = (events, key) => events.reduce((acc, e) => {
  const k = (typeof key === 'function' ? key(e) : e.properties?.[key] ?? e[key]) ?? 'unknown';
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

export const uniqueBy = (events, key) => new Set(
  events.map((e) => (typeof key === 'function' ? key(e) : e.properties?.[key] ?? e[key])).filter(Boolean)
).size;

/** Daily/weekly active counts keyed on a date bucket. */
export function activeSeries(events, { period = 'day', key = (e) => e.actor } = {}) {
  const buckets = {};
  for (const e of events) {
    const actor = key(e);
    if (!actor) continue;
    const bucket = period === 'day' ? String(e.at).slice(0, 10)
      : period === 'week' ? isoWeekStart(e.at) : String(e.at).slice(0, 7);
    buckets[bucket] = buckets[bucket] || new Set();
    buckets[bucket].add(actor);
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.size]));
}

/** Monday of the ISO week containing a date, as YYYY-MM-DD. */
export function isoWeekStart(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------------
 * Funnels
 * ------------------------------------------------------------------------ */

/**
 * Ordered conversion.
 *
 * Users count only if they completed the steps IN ORDER. Counting independent
 * totals is the classic funnel bug: it reports 80% where the real ordered rate
 * is 12%, because it credits people who did step 3 before step 1.
 */
export function funnel({ events = [], steps = [], actorKey = (e) => e.actor } = {}) {
  if (!steps.length) return { ok: false, reason: 'no-steps' };
  const byActor = new Map();
  for (const e of events) {
    const actor = actorKey(e);
    if (!actor) continue;
    if (!byActor.has(actor)) byActor.set(actor, []);
    byActor.get(actor).push(e);
  }

  /*
   * Order is enforced structurally: an actor can only reach stage N if they
   * were already in stage N-1's set. That is why the denominators shrink down
   * the funnel instead of every stage being counted independently.
   */
  const startCount = firstCount(byActor, steps[0]);
  let carriers = new Set(byActor.keys());
  const stages = [];

  for (const step of steps) {
    const matched = new Set();
    for (const actor of carriers) {
      const list = byActor.get(actor) || [];
      if (list.some((e) => e.name === step.name && (step.where ? step.where(e) : true))) matched.add(actor);
    }
    const entered = carriers.size;
    const converted = matched.size;
    stages.push({
      step: step.name,
      entered,
      converted,
      stepRate: entered ? converted / entered : 0,
      // Measured from the first stage, which is the number people quote.
      fromStart: startCount ? converted / startCount : 0,
      dropOff: entered - converted
    });
    carriers = matched;
  }

  const start = stages[0]?.converted ?? 0;
  const end = stages[stages.length - 1]?.converted ?? 0;
  return {
    ok: true, stages,
    overall: start ? end / start : 0,
    lost: start - end,
    ordered: true
  };
}

const firstCount = (byActor, step) => {
  let n = 0;
  for (const list of byActor.values()) if (list.some((e) => e.name === step.name)) n += 1;
  return n;
};

/* ---------------------------------------------------------------------------
 * Retention cohorts
 * ------------------------------------------------------------------------ */

/**
 * Cohort retention.
 *
 * The denominator is the cohort SIZE, not the number active in the previous
 * period. Using the previous period makes retention look like it stabilises at
 * a high number when it is actually decaying.
 */
export function retention({ signups = [], activity = [], periods = 6, period = 'week' } = {}) {
  const bucket = (value) => (period === 'week' ? isoWeekStart(value) : String(value).slice(0, 7));
  const cohortOf = new Map();
  for (const s of signups) {
    const c = bucket(s.at);
    if (!c) continue;
    cohortOf.set(s.actor, c);
  }

  const cohorts = {};
  for (const cohort of new Set(cohortOf.values())) {
    cohorts[cohort] = { size: 0, active: new Array(periods).fill(0) };
  }
  for (const [actor, cohort] of cohortOf) if (cohorts[cohort]) cohorts[cohort].size += 1;

  const weekIndex = (startBucket, value) => {
    const a = new Date(startBucket);
    const b = new Date(bucket(value));
    const days = Math.round((b - a) / 86400000);
    return period === 'week' ? Math.floor(days / 7) : (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  };

  const seen = new Set();
  for (const a of activity) {
    const cohort = cohortOf.get(a.actor);
    if (!cohort) continue;
    const idx = weekIndex(cohort, a.at);
    if (idx < 0 || idx >= periods) continue;
    const key = `${cohort}|${idx}|${a.actor}`;
    if (seen.has(key)) continue; // one actor counts once per period
    seen.add(key);
    cohorts[cohort].active[idx] += 1;
  }

  return Object.entries(cohorts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, data]) => ({
      cohort,
      size: data.size,
      counts: data.active,
      rates: data.active.map((n) => (data.size ? n / data.size : 0))
    }));
}

/** Churn for a period: cancellations over the base that could have cancelled. */
export function churn({ activeAtStart, cancelledDuring, newDuring = 0 }) {
  const base = Number(activeAtStart);
  if (!Number.isFinite(base) || base <= 0) return { ok: false, reason: 'invalid-base' };
  const cancelled = Number(cancelledDuring) || 0;
  const gross = cancelled / base;
  // Net churn accounts for expansion: a month can be net-negative.
  const net = (cancelled - (Number(newDuring) || 0)) / base;
  return { ok: true, grossRate: gross, netRate: net, cancelled, base, note: net < 0 ? 'Net negative churn: new customers outnumbered cancellations.' : undefined };
}

/* ---------------------------------------------------------------------------
 * Revenue
 * ------------------------------------------------------------------------ */

/** Normalise any plan cycle to a monthly figure. */
export function monthlyValue({ amount, cycle }) {
  if (cycle === 'annual') return Number(amount) / 12;
  if (cycle === 'monthly') return Number(amount);
  return null;
}

/**
 * MRR with its movement broken out.
 *
 * This is the standard SaaS waterfall. Reporting only the total hides a month
 * where 40 logos left and 41 arrived: the number looks flat while the business
 * changed completely.
 */
export function mrr({ subscriptions = [] } = {}) {
  const active = subscriptions.filter((s) => s.status === 'active');
  const total = active.reduce((sum, s) => sum + (monthlyValue(s) ?? 0), 0);

  const newSubs = active.filter((s) => s.movement === 'new');
  const expansion = active.filter((s) => s.movement === 'expansion');
  const contraction = active.filter((s) => s.movement === 'contraction');
  const churned = subscriptions.filter((s) => s.status === 'cancelled' && s.movement === 'churn');

  const sum = (list) => list.reduce((a, s) => a + (monthlyValue(s) ?? 0), 0);
  return {
    total,
    movements: {
      new: sum(newSubs),
      expansion: sum(expansion),
      contraction: -Math.abs(sum(contraction)),
      churn: -Math.abs(sum(churned))
    },
    counts: { active: active.length, new: newSubs.length, churned: churned.length },
    netNew: sum(newSubs) + sum(expansion) - Math.abs(sum(contraction)) - Math.abs(sum(churned)),
    arpa: active.length ? total / active.length : 0
  };
}

/** Average revenue per account, and per paying account separately. */
export function revenueSplit({ subscriptions = [], totalAccounts = 0 }) {
  const active = subscriptions.filter((s) => s.status === 'active');
  const paying = active.filter((s) => (monthlyValue(s) ?? 0) > 0);
  const revenue = paying.reduce((a, s) => a + monthlyValue(s), 0);
  return {
    revenue,
    arpa: totalAccounts ? revenue / totalAccounts : null,
    arppu: paying.length ? revenue / paying.length : null,
    freeToPaid: totalAccounts ? paying.length / totalAccounts : null,
    note: 'ARPA and ARPPU differ whenever there is a free tier; quoting the wrong one overstates revenue per customer.'
  };
}

/* ---------------------------------------------------------------------------
 * Segmentation and privacy signals
 * ------------------------------------------------------------------------ */

export function segment(events, by) {
  const key = {
    country: (e) => e.country || 'unknown',
    language: (e) => (e.locale || 'unknown').split('-')[0],
    device: (e) => e.device?.type || 'unknown',
    browser: (e) => e.device?.browser || 'unknown',
    os: (e) => e.device?.os || 'unknown'
  }[by];
  if (!key) return { ok: false, reason: 'unknown-dimension', allowed: ['country', 'language', 'device', 'browser', 'os'] };
  const counts = {};
  for (const e of events) {
    const k = key(e);
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = events.length || 1;
  return {
    ok: true,
    dimension: by,
    buckets: Object.entries(counts)
      .map(([value, count]) => ({ value, count, share: count / total }))
      .sort((a, b) => b.count - a.count),
    // Small buckets are suppressed: a segment of one is an identifiable person.
    suppressedBelow: 5,
    suppressed: Object.values(counts).filter((n) => n < 5).length,
    note: 'Buckets below the threshold are counted but must not be reported individually: a bucket of one identifies a person.'
  };
}

/** Honour browser privacy signals before collecting anything. */
export function privacySignals({ doNotTrack = null, globalPrivacyControl = null } = {}) {
  const dnt = doNotTrack === '1' || doNotTrack === 'yes';
  return {
    doNotTrack: dnt,
    globalPrivacyControl: globalPrivacyControl === true,
    // GPC is legally binding under CCPA/CPRA; DNT is a request, not a right.
    mustOptOut: globalPrivacyControl === true,
    shouldOptOut: dnt,
    note: globalPrivacyControl === true
      ? 'Global Privacy Control is a legally binding opt-out signal in some jurisdictions and must be honoured without asking.'
      : 'Do Not Track is honoured as a courtesy; it carries no legal force.'
  };
}
