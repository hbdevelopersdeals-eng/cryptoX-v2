/* Launchpad (Section 35).
 *
 * A launchpad's job is to be the place where a token sale is REFUSED. Everything
 * here exists to make a refusal defensible and auditable:
 *
 *   · Applications are validated against a fixed schema, not read as prose.
 *   · Due diligence is a weighted score with hard gates that cap the verdict —
 *     no audit means "review" at best, whatever the team slide deck says.
 *   · Tokenomics must sum to 100%, and concentration limits are warnings the
 *     applicant can see before submission rather than rejections afterwards.
 *   · Allocation is integer-arithmetic pro-rata with an explicit refund of the
 *     remainder, so an oversubscribed sale cannot create fractional tokens or
 *     lose a participant's money in rounding.
 *
 * The listing workflow is a state machine because a sale has irreversible steps
 * (funds taken, tokens distributed). Illegal transitions return a reason, so a
 * retry cannot double-distribute.
 */

/** Fields a project must supply before it can be screened. */
export const APPLICATION_SCHEMA = [
  { id: 'projectName', label: 'Project name', required: true, max: 80 },
  { id: 'ticker', label: 'Token ticker', required: true, pattern: /^[A-Z0-9]{2,10}$/ },
  { id: 'chain', label: 'Chain', required: true },
  { id: 'contractAddress', label: 'Contract address', required: false },
  { id: 'website', label: 'Website', required: true, url: true },
  { id: 'whitepaper', label: 'Whitepaper', required: true, url: true },
  { id: 'description', label: 'Description', required: true, min: 120, max: 2000 },
  { id: 'team', label: 'Team', required: true, minItems: 1 },
  { id: 'totalSupply', label: 'Total supply', required: true, positive: true },
  { id: 'raiseTarget', label: 'Raise target (USD)', required: true, positive: true }
];

export const DUE_DILIGENCE_WEIGHTS = {
  team: 25,
  product: 20,
  tokenomics: 20,
  legal: 15,
  security: 20
};

export function validateApplication(app = {}) {
  const errors = [];
  const warnings = [];

  for (const field of APPLICATION_SCHEMA) {
    const value = app[field.id];
    const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      errors.push(`${field.label} is required.`);
      continue;
    }
    if (empty) continue;

    if (field.pattern && !field.pattern.test(String(value))) {
      errors.push(`${field.label} must match ${field.pattern}.`);
    }
    if (field.url) {
      try {
        const u = new URL(String(value));
        if (!/^https?:$/.test(u.protocol)) errors.push(`${field.label} must be an http(s) URL.`);
      } catch {
        errors.push(`${field.label} is not a valid URL.`);
      }
    }
    if (field.min && String(value).length < field.min) {
      errors.push(`${field.label} must be at least ${field.min} characters.`);
    }
    if (field.max && String(value).length > field.max) {
      errors.push(`${field.label} must be at most ${field.max} characters.`);
    }
    if (field.positive && !(Number(value) > 0)) errors.push(`${field.label} must be a positive number.`);
  }

  if (app.contractAddress && !/^0x[a-fA-F0-9]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(app.contractAddress))) {
    warnings.push('Contract address does not look like an EVM or Solana address.');
  }
  if (app.team && Array.isArray(app.team) && app.team.length && !app.team.some((m) => m?.linkedin || m?.github)) {
    warnings.push('No team member has a verifiable LinkedIn or GitHub profile.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------ tokenomics */

/**
 * Allocation sanity. Sum must be 100 (±0.01 for decimal rounding), and the
 * concentration rules that matter to a buyer are checked here rather than in a
 * reviewer's head.
 */
export function validateTokenomics({ allocations = [], tgeUnlockPct = null, teamCliffMonths = null } = {}) {
  const errors = [];
  const warnings = [];

  if (!allocations.length) {
    return { valid: false, errors: ['At least one allocation bucket is required.'], warnings, total: 0 };
  }

  let total = 0;
  for (const a of allocations) {
    const pct = Number(a.pct);
    if (!Number.isFinite(pct)) errors.push(`Allocation "${a.label || a.id}" has a non-numeric percentage.`);
    else if (pct < 0) errors.push(`Allocation "${a.label || a.id}" is negative.`);
    else total += pct;
  }

  if (Math.abs(total - 100) > 0.01) errors.push(`Allocations sum to ${total.toFixed(2)}%, not 100%.`);

  const team = allocations.find((a) => /team|founder|advisor/i.test(`${a.id} ${a.label}`));
  if (team && Number(team.pct) > 30) {
    warnings.push(`Team and advisors hold ${Number(team.pct).toFixed(1)}% — above the 30% concentration guideline.`);
  }
  if (tgeUnlockPct != null && tgeUnlockPct > 25) {
    warnings.push(`TGE unlocks ${tgeUnlockPct}% of supply — above the 25% guideline and a common source of day-one sell pressure.`);
  }
  if (team && (teamCliffMonths == null || teamCliffMonths < 6)) {
    warnings.push('Team allocation has no cliff of at least 6 months.');
  }

  return { valid: errors.length === 0, errors, warnings, total };
}

/**
 * Monthly vesting with a cliff.
 * Returns one row per period so the UI and the CSV export agree. `tgePct` is
 * released immediately at T0; the remainder is linear after the cliff.
 */
export function vestingSchedule({
  totalTokens,
  tgePct = 0,
  cliffMonths = 0,
  vestMonths = 12,
  startDate = Date.now()
} = {}) {
  const total = Number(totalTokens);
  if (!Number.isFinite(total) || total <= 0) return { error: 'Total tokens must be positive.' };
  if (vestMonths <= 0) return { error: 'Vest months must be positive.' };
  if (tgePct < 0 || tgePct > 100) return { error: 'TGE percentage must be between 0 and 100.' };

  const start = new Date(startDate);
  const tgeTokens = Math.floor((total * tgePct) / 100);
  const vestingTokens = total - tgeTokens;
  const perMonth = Math.floor(vestingTokens / vestMonths);
  const rows = [{ month: 0, date: start.toISOString().slice(0, 10), unlock: tgeTokens, cumulative: tgeTokens, note: 'TGE' }];

  let cumulative = tgeTokens;
  for (let m = 1; m <= vestMonths; m += 1) {
    const date = new Date(start);
    date.setMonth(date.getMonth() + m + cliffMonths);
    const isLast = m === vestMonths;
    /* The final row absorbs integer division dust so the schedule sums exactly. */
    const unlock = isLast ? vestingTokens - perMonth * (vestMonths - 1) : perMonth;
    cumulative += unlock;
    rows.push({
      month: m,
      date: date.toISOString().slice(0, 10),
      unlock,
      cumulative,
      note: m <= cliffMonths ? 'cliff — locked' : 'linear'
    });
  }

  return {
    rows,
    tgeTokens,
    vestingTokens,
    totalsTo: cumulative,
    balanced: cumulative === total,
    durationMonths: vestMonths + cliffMonths
  };
}

/* ------------------------------------------------------------ allocation */

/**
 * Whole-token pro-rata for an oversubscribed sale.
 * `participants` items: { id, requested (USD) }.
 * Tokens are integers; cash taken is recomputed from the tokens actually
 * allocated, and unspent cash is reported per participant, not retained.
 */
export function allocate({ participants = [], raiseCapUsd = 0, pricePerToken = 1 } = {}) {
  const cap = Number(raiseCapUsd);
  const price = Number(pricePerToken);
  if (!(cap > 0)) return { ok: false, error: 'Raise cap must be positive.', allocations: [] };
  if (!(price > 0)) return { ok: false, error: 'Token price must be positive.', allocations: [] };

  const requested = participants.reduce((a, p) => a + (Number(p.requested) || 0), 0);
  if (requested <= 0) return { ok: false, error: 'No participant requested an allocation.', allocations: [] };

  const oversubscribed = requested > cap;
  const scale = oversubscribed ? cap / requested : 1;

  const allocations = participants.map((p) => {
    const want = Math.max(0, Number(p.requested) || 0);
    const cash = want * scale;
    const tokens = Math.floor(cash / price);
    return {
      id: p.id,
      requested: want,
      cash: Number((tokens * price).toFixed(2)),
      tokens,
      refund: Number((want - tokens * price).toFixed(2)),
      fillPct: want > 0 ? (cash / want) * 100 : 0
    };
  });

  const raised = allocations.reduce((a, x) => a + x.cash, 0);
  return {
    ok: true,
    oversubscribed,
    scale,
    requested,
    raised: Number(raised.toFixed(2)),
    tokensSold: allocations.reduce((a, x) => a + x.tokens, 0),
    dust: Number((cap - raised).toFixed(2)),
    allocations
  };
}

/** Gate who may subscribe at all. Each check names the reason it failed. */
export function subscriptionEligibility({
  whitelisted = false,
  kycStatus = 'none',
  country = null,
  restrictedCountries = [],
  alreadySubscribed = false,
  opensAt = null,
  closesAt = null,
  now = Date.now()
} = {}) {
  const blockers = [];
  if (!whitelisted) blockers.push('Address is not on the whitelist.');
  if (kycStatus !== 'approved') blockers.push('Identity verification is not approved.');
  if (country && restrictedCountries.map((c) => c.toUpperCase()).includes(String(country).toUpperCase())) {
    blockers.push(`Residents of ${country} cannot participate in this offering.`);
  }
  if (alreadySubscribed) blockers.push('This account already has a subscription in this sale.');
  if (opensAt && now < new Date(opensAt).getTime()) blockers.push('The subscription window has not opened.');
  if (closesAt && now > new Date(closesAt).getTime()) blockers.push('The subscription window has closed.');
  return { eligible: blockers.length === 0, blockers };
}

/* ------------------------------------------------------------- workflow */

export const LISTING_STATES = [
  'applied', 'screening', 'due_diligence', 'approved', 'whitelist',
  'subscription', 'distribution', 'listed', 'rejected', 'withdrawn'
];

/**
 * Allowed transitions. Terminal states have no exits: a rejected project must
 * submit a new application so the audit trail keeps the first decision intact.
 */
export const TRANSITIONS = {
  applied: ['screening', 'withdrawn'],
  screening: ['due_diligence', 'rejected', 'withdrawn'],
  due_diligence: ['approved', 'rejected'],
  approved: ['whitelist', 'withdrawn'],
  whitelist: ['subscription', 'withdrawn'],
  subscription: ['distribution', 'withdrawn'],
  distribution: ['listed'],
  listed: [],
  rejected: [],
  withdrawn: []
};

export function transition(state, next) {
  const allowed = TRANSITIONS[state] || [];
  if (!LISTING_STATES.includes(next)) return { ok: false, reason: `Unknown state "${next}".` };
  if (!allowed.includes(next)) {
    return { ok: false, reason: `Cannot move from "${state}" to "${next}". Allowed: ${allowed.join(', ') || 'none (terminal)'}.` };
  }
  return { ok: true, state: next };
}

/* ---------------------------------------------------------- due diligence */

/**
 * Weighted due diligence. Each criterion is 0–100 and the weights sum to 100.
 * Hard gates cap the verdict so a perfect deck cannot paper over a missing
 * audit or an unresolved sanctions match.
 */
export function scoreDueDiligence(report = {}) {
  const scores = {};
  let total = 0;

  for (const [key, weight] of Object.entries(DUE_DILIGENCE_WEIGHTS)) {
    const raw = Number(report[key]);
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    scores[key] = value;
    total += (value / 100) * weight;
  }

  const blockers = [];
  if (report.audit === false || report.audit == null) blockers.push('No independent smart-contract audit on file.');
  if (report.sanctionsHit) blockers.push('Sanctions screening returned a potential match.');
  if (report.anonymousTeam) blockers.push('Team cannot be identified.');
  if (report.tokenomicsValid === false) blockers.push('Tokenomics failed validation.');

  let verdict;
  if (blockers.length) verdict = total >= 70 ? 'review' : 'reject';
  else if (total >= 75) verdict = 'approve';
  else if (total >= 55) verdict = 'review';
  else verdict = 'reject';

  return {
    score: Number(total.toFixed(1)),
    maxScore: 100,
    scores,
    blockers,
    verdict,
    explanation:
      verdict === 'approve'
        ? 'Clears every hard gate and scores above the approval threshold.'
        : verdict === 'review'
          ? 'Requires committee review before any allocation is opened.'
          : 'Below the threshold for this programme.'
  };
}
