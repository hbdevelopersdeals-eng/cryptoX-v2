/* Referral and affiliate programme (Section 34).
 *
 * The commercial risk in an affiliate programme is not the commission rate, it
 * is paying commission on revenue that never existed. So the model here is
 * built around three refusals:
 *
 *   · Attribution needs a CLICK before the signup. A conversion with no prior
 *     click in the window is unattributed, not "probably from the link".
 *   · Commission is EARNED at payment and only PAYABLE after the refund window
 *     and the KYC check. A refund claws back the earning rather than adjusting
 *     a balance silently.
 *   · Fraud signals are scored against explicit, documented weights and the
 *     outcome is one of approve / review / block. Nothing is auto-approved
 *     because it "looks fine".
 *
 * Rates are cost-of-acquisition decisions, so they live in one table and every
 * surface (portal, API, payout ledgers) reads that table.
 */

import { SITE_URL } from './seo.js';

/** Attribution window: a click is good for 60 days. */
export const ATTRIBUTION_WINDOW_DAYS = 60;

/** Held before commission becomes payable, so refunds settle first. */
export const PAYOUT_HOLD_DAYS = 30;

/** Below this, payouts accumulate to the next cycle rather than costing a transfer. */
export const MIN_PAYOUT_USD = 50;

/**
 * Tier ladder. `minConversions` counts paying customers in the trailing 12
 * months — not clicks, not signups — so a tier is earned by revenue.
 */
export const REFERRAL_TIERS = [
  { id: 'starter', label: 'Starter', minConversions: 0, ratePct: 20, recurring: false },
  { id: 'growth', label: 'Growth', minConversions: 10, ratePct: 25, recurring: true },
  { id: 'partner', label: 'Partner', minConversions: 50, ratePct: 30, recurring: true, dedicatedSupport: true }
];

/** Plans the programme pays on. Excluded: none today, but the list is explicit. */
export const COMMISSIONABLE_PLANS = ['pro', 'business', 'enterprise'];

/** UTM parameters we accept; anything else is dropped to keep reporting clean. */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export function tierFor(conversions = 0) {
  let tier = REFERRAL_TIERS[0];
  for (const t of REFERRAL_TIERS) {
    if (conversions >= t.minConversions) tier = t;
  }
  return tier;
}

/* ------------------------------------------------------------------ codes */

/**
 * Deterministic, human-readable referral code.
 * Not a security token: it is public by design, so a plain 32-bit hash rendered
 * in base 36 is sufficient and stays stable for a given account.
 */
export function referralCode(accountId) {
  const input = String(accountId ?? '');
  if (!input) return null;
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const body = (h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
  return `CX${body}`;
}

/* Default host comes from `seo.js` rather than being typed here.
 *
 * It used to be the literal `https://cryptox.site.accio.ai`, which was the
 * published host months ago and is not the origin the canonical tags, sitemap
 * and robots.txt use. A referral link is copied into a tweet and outlives the
 * deployment that generated it, so a stale default here is the most expensive
 * kind: every link ever shared points at a host the marketing site no longer
 * claims. One constant, one truth. */
export function referralLink(code, { base = SITE_URL, campaign = null } = {}) {
  if (!code) return null;
  const url = new URL('/register', String(base).replace(/\/+$/, ''));
  url.searchParams.set('ref', code);
  if (campaign) url.searchParams.set('utm_campaign', String(campaign));
  return url.toString();
}

/** Pull the referral code out of a URL search string. */
export function codeFromSearch(search = '') {
  const params = new URLSearchParams(String(search).replace(/^[?#]/, ''));
  const raw = params.get('ref');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^CX[0-9A-Z]{7}$/.test(code) ? code : null;
}

/* ------------------------------------------------------------ attribution */

/**
 * Decide attribution for a signup.
 * Last click wins inside the window; an expired click is reported as expired
 * rather than silently ignored, because "why did my referral not track" is a
 * support ticket either way.
 */
export function attributeSignup({
  code = null,
  referrerAccountId = null,
  newAccountId = null,
  clicks = [],
  now = Date.now(),
  windowDays = ATTRIBUTION_WINDOW_DAYS
} = {}) {
  if (!code) return { attributed: false, reason: 'no-code' };
  if (referrerAccountId && newAccountId && String(referrerAccountId) === String(newAccountId)) {
    return { attributed: false, reason: 'self-referral' };
  }

  const mine = clicks
    .filter((c) => c.code === code)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (!mine.length) return { attributed: false, reason: 'no-click' };

  const last = mine[0];
  const clickedAt = new Date(last.at).getTime();
  /* A malformed timestamp makes the age NaN, and every comparison against NaN is
     false — so an unparseable click used to pass the window check and attribute
     the signup. Attribution is a payment decision here, so it fails closed. */
  if (!Number.isFinite(clickedAt)) {
    return { attributed: false, reason: 'invalid-click-time', code };
  }

  const ageDays = (now - clickedAt) / 86400000;
  if (ageDays > windowDays) {
    return { attributed: false, reason: 'window-expired', ageDays, code };
  }
  return { attributed: true, reason: 'last-click', code, clickId: last.id ?? null, ageDays };
}

/* -------------------------------------------------------------- commission */

/**
 * Commission for one payment event.
 * Refunds are negative revenue and produce a negative commission, which is the
 * only way a clawback can be represented without a second ledger.
 */
export function commissionFor({
  planId,
  amount = 0,
  conversions = 0,
  refunded = false,
  monthsActive = 1
} = {}) {
  if (!COMMISSIONABLE_PLANS.includes(planId)) {
    return { payable: 0, reason: `Plan "${planId}" is not commissionable.`, tier: tierFor(conversions) };
  }
  const tier = tierFor(conversions);
  const base = Number(amount) || 0;
  /* Recurring tiers earn on renewals; starter earns on the first payment only. */
  const multiplier = tier.recurring ? Math.max(1, monthsActive) : 1;
  const gross = base * (tier.ratePct / 100) * multiplier;
  const value = refunded ? -gross : gross;
  return {
    payable: Number(value.toFixed(2)),
    reason: refunded ? 'refund-clawback' : tier.recurring ? 'recurring' : 'first-payment',
    tier: tier.id,
    ratePct: tier.ratePct
  };
}

/* ------------------------------------------------------------------ payout */

export function payoutStatus({
  earned = 0,
  paid = 0,
  pending = 0,
  firstEarningAt = null,
  kycVerified = false,
  now = Date.now(),
  holdDays = PAYOUT_HOLD_DAYS,
  minPayout = MIN_PAYOUT_USD
} = {}) {
  const available = Math.max(0, earned - paid - pending);
  const blocked = [];
  if (!kycVerified) blocked.push('Identity verification is required before payout.');
  if (available < minPayout) blocked.push(`Balance is below the $${minPayout} minimum.`);
  if (firstEarningAt) {
    const days = (now - new Date(firstEarningAt).getTime()) / 86400000;
    if (days < holdDays) blocked.push(`Refund hold: ${Math.ceil(holdDays - days)} day(s) remaining.`);
  } else if (available > 0) {
    blocked.push('No earning date recorded.');
  }
  return {
    available,
    payable: blocked.length === 0 ? available : 0,
    blocked,
    eligible: blocked.length === 0
  };
}

/* ------------------------------------------------------------------- fraud */

/**
 * Fraud signals with documented weights. A score is a review trigger, never a
 * verdict on its own: `decision` encodes the threshold so two reviewers
 * looking at the same account reach the same conclusion.
 */
export const FRAUD_WEIGHTS = {
  'self-referral': 100,
  'same-payment-instrument': 80,
  'ip-cluster': 45,
  'disposable-email': 40,
  'no-click-conversion': 35,
  'velocity': 30,
  'high-refund-ratio': 30,
  'mismatched-geo': 15
};

export function fraudCheck({
  ipSignups = 0,
  samePaymentInstrument = false,
  disposableEmail = false,
  selfReferral = false,
  attributed = true,
  signupsLastHour = 0,
  refundRatio = 0,
  geoMismatch = false
} = {}) {
  const signals = [];
  if (selfReferral) signals.push('self-referral');
  if (samePaymentInstrument) signals.push('same-payment-instrument');
  if (ipSignups >= 5) signals.push('ip-cluster');
  if (disposableEmail) signals.push('disposable-email');
  if (!attributed) signals.push('no-click-conversion');
  if (signupsLastHour >= 10) signals.push('velocity');
  if (refundRatio >= 0.3) signals.push('high-refund-ratio');
  if (geoMismatch) signals.push('mismatched-geo');

  const score = Math.min(100, signals.reduce((acc, s) => acc + (FRAUD_WEIGHTS[s] || 0), 0));
  const decision = score >= 80 ? 'block' : score >= 40 ? 'review' : 'approve';

  return {
    score,
    decision,
    signals: signals.map((s) => ({ id: s, weight: FRAUD_WEIGHTS[s] || 0 })),
    note:
      decision === 'block'
        ? 'Commission is held and the account is suspended from the programme pending review.'
        : decision === 'review'
          ? 'Commission accrues but payout waits for manual approval.'
          : 'No material signals; standard hold applies.'
  };
}

/* ---------------------------------------------------------------- campaign */

/** Normalise UTM parameters: lowercase, trimmed, unknown keys dropped. */
export function parseUtm(search = '') {
  const params = new URLSearchParams(String(search).replace(/^[?#]/, ''));
  const out = {};
  for (const key of UTM_KEYS) {
    const v = params.get(key);
    if (v) out[key] = v.trim().toLowerCase().slice(0, 64);
  }
  return out;
}

/* ---------------------------------------------------------------- summary */

/**
 * Aggregate a referral event stream.
 * `events` items: { type: 'click'|'signup'|'conversion'|'refund', at, code, revenue? }
 */
export function affiliateSummary(events = []) {
  const clicks = events.filter((e) => e.type === 'click');
  const signups = events.filter((e) => e.type === 'signup');
  const conversions = events.filter((e) => e.type === 'conversion');
  const refunds = events.filter((e) => e.type === 'refund');

  const revenue = conversions.reduce((a, e) => a + (Number(e.revenue) || 0), 0);
  const refunded = refunds.reduce((a, e) => a + (Number(e.revenue) || 0), 0);
  const net = revenue - refunded;

  const perCode = new Map();
  for (const e of events) {
    const code = e.code || 'direct';
    if (!perCode.has(code)) {
      perCode.set(code, { code, clicks: 0, signups: 0, conversions: 0, revenue: 0, refunds: 0 });
    }
    const row = perCode.get(code);
    if (e.type === 'click') row.clicks += 1;
    if (e.type === 'signup') row.signups += 1;
    if (e.type === 'conversion') {
      row.conversions += 1;
      row.revenue += Number(e.revenue) || 0;
    }
    if (e.type === 'refund') row.refunds += Number(e.revenue) || 0;
  }

  const rows = [...perCode.values()]
    .map((r) => ({
      ...r,
      netRevenue: r.revenue - r.refunds,
      conversionRate: r.clicks ? r.conversions / r.clicks : 0,
      earningsPerClick: r.clicks ? (r.revenue - r.refunds) / r.clicks : 0
    }))
    .sort((a, b) => b.netRevenue - a.netRevenue);

  return {
    clicks: clicks.length,
    signups: signups.length,
    conversions: conversions.length,
    revenue,
    refunded,
    netRevenue: net,
    conversionRate: clicks.length ? conversions.length / clicks.length : 0,
    refundRate: revenue > 0 ? refunded / revenue : 0,
    rows
  };
}
