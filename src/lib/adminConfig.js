/* Admin control-plane rules (Section 23).
 *
 * An admin panel is the most dangerous screen in a trading product: it can widen
 * a fee, raise a leverage cap, list a market or release a withdrawal. So the
 * rules live here, in testable functions, rather than in the panel's JSX where
 * they would be a set of `if` statements nobody can unit-test.
 *
 * Three principles:
 *   · Every numeric control has documented BOUNDS. A fee of 10,000 bps is a
 *     typo, not a business decision, and it must be refused rather than saved.
 *   · Configuration changes produce a DIFF with a reason per field, because the
 *     audit log needs to say what changed and why, not just "settings updated".
 *   · Queues (KYC, support, withdrawals) report age and SLA breaches. A queue
 *     that only shows a count hides the item that has waited three days.
 *
 * Nothing here reads another user's data. Cross-user reads belong to a
 * privileged-role console; `REQUIRES_PRIVILEGED_ROLE` lists exactly which panel
 * sections cannot be filled from a browser session.
 */

/** Maker rebates are allowed to be negative (a rebate); taker fees are not. */
export const FEE_BOUNDS = {
  makerBps: { min: -10, max: 50, label: 'Maker fee (bps)' },
  takerBps: { min: 0, max: 100, label: 'Taker fee (bps)' },
  withdrawalBps: { min: 0, max: 200, label: 'Withdrawal fee (bps)' },
  settlementMinutes: { min: 0, max: 1440, label: 'Settlement delay (minutes)' }
};

export const RISK_BOUNDS = {
  maxLeverage: { min: 1, max: 20, label: 'Maximum leverage' },
  maxOrderNotionalUsd: { min: 100, max: 100000000, label: 'Max order notional (USD)' },
  maxDailyWithdrawalUsd: { min: 100, max: 100000000, label: 'Max daily withdrawal (USD)' },
  circuitBreakerPct: { min: 1, max: 50, label: 'Circuit breaker move (%)' }
};

/** Panel sections that cannot be served from a browser session, and why. */
export const REQUIRES_PRIVILEGED_ROLE = [
  { section: 'Users', reason: 'Reading other accounts requires the privileged role; RLS exposes only your own row.' },
  { section: 'Trading volume', reason: 'Aggregated volume comes from the settlement ledger, not from a client query.' },
  { section: 'Deposits & withdrawals', reason: 'Custody movements are written by the wallet service, never by a client.' },
  { section: 'Revenue & fees', reason: 'Revenue is derived from the double-entry ledger; a client cannot total it.' },
  { section: 'Assets', reason: 'Treasury balances are held in custody systems outside this application.' }
];

/**
 * Validate a fee configuration.
 * Bounds are refused, not clamped: silently turning 10,000 bps into 100 bps
 * would let a fat-fingered save look successful.
 */
export function validateFeeConfig(config = {}) {
  const errors = [];
  const values = {};
  for (const [key, bound] of Object.entries(FEE_BOUNDS)) {
    const raw = config[key];
    if (raw === undefined || raw === null || raw === '') {
      errors.push(`${bound.label} is required.`);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push(`${bound.label} must be a number.`);
      continue;
    }
    if (n < bound.min || n > bound.max) {
      errors.push(`${bound.label} must be between ${bound.min} and ${bound.max} (received ${n}).`);
      continue;
    }
    values[key] = n;
  }
  if (values.makerBps != null && values.takerBps != null && values.takerBps < values.makerBps) {
    errors.push('Taker fee is below the maker fee — the venue would pay traders to take liquidity.');
  }
  return { valid: errors.length === 0, errors, values };
}

export function validateRiskConfig(config = {}) {
  const errors = [];
  const values = {};
  for (const [key, bound] of Object.entries(RISK_BOUNDS)) {
    const raw = config[key];
    if (raw === undefined || raw === null || raw === '') {
      errors.push(`${bound.label} is required.`);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push(`${bound.label} must be a number.`);
      continue;
    }
    if (n < bound.min || n > bound.max) {
      errors.push(`${bound.label} must be between ${bound.min} and ${bound.max} (received ${n}).`);
      continue;
    }
    values[key] = n;
  }
  if (values.maxLeverage > 10 && values.maxDailyWithdrawalUsd > 1000000) {
    errors.push('High leverage combined with a seven-figure daily withdrawal limit is an unacceptable risk pairing.');
  }
  return { valid: errors.length === 0, errors, values };
}

/**
 * Field-level diff for the audit log.
 * A change with no reason is refused by the caller's confirmation step; the diff
 * itself only reports what moved.
 */
export function diffConfig(current = {}, next = {}) {
  const changes = [];
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const before = current[key];
    const after = next[key];
    if (Number(before) === Number(after)) continue;
    changes.push({
      key,
      before: before ?? null,
      after: after ?? null,
      direction: Number(after) > Number(before) ? 'increase' : 'decrease'
    });
  }
  return changes;
}

/* ------------------------------------------------------------------ health */

/** Aggregate service health. Unknown statuses count as degraded, not healthy. */
export function healthSummary(services = []) {
  const rows = services.map((s) => ({
    id: s.id,
    label: s.label || s.id,
    status: ['ok', 'degraded', 'down'].includes(s.status) ? s.status : 'degraded',
    latencyMs: Number.isFinite(s.latencyMs) ? s.latencyMs : null,
    lastCheckAt: s.lastCheckAt || null
  }));
  const down = rows.filter((r) => r.status === 'down');
  const degraded = rows.filter((r) => r.status === 'degraded');
  const ok = rows.filter((r) => r.status === 'ok');
  const latencies = rows.map((r) => r.latencyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  return {
    overall: down.length ? 'down' : degraded.length ? 'degraded' : rows.length ? 'ok' : 'unknown',
    total: rows.length,
    ok: ok.length,
    degraded: degraded.length,
    down: down.length,
    p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null,
    rows
  };
}

/* --------------------------------------------------------------- listing */

/**
 * What must be true before a market is listed. `critical` items block; the rest
 * are warnings, because a market with thin liquidity can launch and grow, while
 * a market with no legal opinion cannot.
 */
export const MARKET_LISTING_CHECKLIST = [
  { id: 'legal', label: 'Legal opinion for the jurisdiction', critical: true },
  { id: 'audit', label: 'Contract or token audit on file', critical: true },
  { id: 'sanctions', label: 'Issuer passed sanctions screening', critical: true },
  { id: 'liquidity', label: 'Committed liquidity or market maker', critical: false },
  { id: 'oracle', label: 'Price source and fallback defined', critical: true },
  { id: 'disclosures', label: 'Risk disclosures published', critical: false },
  { id: 'support', label: 'Support runbook and escalation path', critical: false }
];

export function listingReadiness(flags = {}) {
  const items = MARKET_LISTING_CHECKLIST.map((i) => ({ ...i, done: Boolean(flags[i.id]) }));
  const blockers = items.filter((i) => i.critical && !i.done).map((i) => i.label);
  const warnings = items.filter((i) => !i.critical && !i.done).map((i) => i.label);
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    items,
    completed: items.filter((i) => i.done).length,
    total: items.length
  };
}

/* ----------------------------------------------------------------- queues */

/**
 * Queue health: counts plus the age of the oldest item and SLA breaches.
 * `slaHours` is per queue because a withdrawal review and a support reply do not
 * deserve the same clock.
 */
export function queueSummary(items = [], { slaHours = 24, now = Date.now() } = {}) {
  const rows = (items || []).map((i) => {
    const openedAt = i.openedAt ? new Date(i.openedAt).getTime() : null;
    const ageHours = openedAt ? (now - openedAt) / 3600000 : null;
    return {
      id: i.id,
      status: i.status || 'open',
      ageHours,
      breached: ageHours != null && ageHours > slaHours
    };
  });
  const open = rows.filter((r) => r.status !== 'closed' && r.status !== 'resolved');
  const ages = open.map((r) => r.ageHours).filter((n) => n != null);
  return {
    total: rows.length,
    open: open.length,
    breaches: open.filter((r) => r.breached).length,
    oldestHours: ages.length ? Math.max(...ages) : null,
    slaHours,
    rows
  };
}

/* ------------------------------------------------------------ guard rails */

/**
 * Screen a destructive admin action.
 * `confirmText` must equal the object's identifier: an operator who has to type
 * the market symbol cannot click through a modal by reflex.
 */
export function confirmDestructive({ action, target, confirmText, expected }) {
  if (!expected) return { ok: false, reason: 'No confirmation target supplied.' };
  if (String(confirmText || '').trim() !== String(expected).trim()) {
    return { ok: false, reason: `Type “${expected}” exactly to confirm ${action} on ${target}.` };
  }
  return { ok: true };
}
