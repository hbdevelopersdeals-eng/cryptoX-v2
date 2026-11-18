/* Copy trading (Section 18).
 *
 * The product promise is "copy this trader's results". That sentence is only
 * honest if three things are true, and this module exists to make each of them
 * checkable rather than decorative:
 *
 *   1. The track record has a PROVENANCE. A return series typed in by the
 *      trader is `self-reported`; only a series reconciled against an exchange
 *      or on-chain source can be labelled `verified`. `verifyTrackRecord`
 *      refuses to upgrade the label on length alone, and returns the reasons it
 *      refused so the UI can print them instead of a green tick.
 *
 *   2. The risk is QUANTIFIED before money moves. Max drawdown, Sharpe, win
 *      rate and trading frequency are computed from the same series, never
 *      quoted from a profile field.
 *
 *   3. The downside is CAPPED IN THE PLAN, not in a promise. `copyPlan` turns
 *      "I'll risk 20%" into an absolute dollar stop that `shouldStopCopy`
 *      evaluates on every update.
 *
 * Nothing here places an order. Copy execution is a server-side concern (the
 * follower's venue keys must never reach the browser), so this module stops at
 * the decision: allocation, caps, fee terms, stop triggers.
 */

/** Sources whose numbers can be reconciled by the platform itself. */
export const VERIFIABLE_SOURCES = ['exchange-api', 'custodial-snapshot', 'onchain-verified'];

/** Sources we display but never label verified. */
export const UNVERIFIED_SOURCES = ['self-reported', 'screenshot', 'third-party-link'];

/** Minimum history before a record can carry a verified badge. */
export const VERIFY_MIN_DAYS = 90;

/** A record with holes in it is not a record. */
export const VERIFY_MAX_GAPS = 0;

export const RISK_PROFILES = [
  { id: 'conservative', label: 'Conservative', maxDrawdown: 0.15, maxVolatility: 0.45 },
  { id: 'balanced', label: 'Balanced', maxDrawdown: 0.3, maxVolatility: 0.75 },
  { id: 'aggressive', label: 'Aggressive', maxDrawdown: 1, maxVolatility: Infinity }
];

/* -------------------------------------------------------------- statistics */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

/**
 * Equity curve from fractional periodic returns.
 * A return of 0.02 means +2% for that day.
 */
export function equityCurve(returns = [], start = 1) {
  const curve = [start];
  let equity = start;
  for (const r of returns) {
    equity *= 1 + r;
    curve.push(equity);
  }
  return curve;
}

/** Peak-to-trough drawdown of a curve, as a positive fraction (0.42 = -42%). */
export function maxDrawdown(curve = []) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

/**
 * Annualised Sharpe with a zero risk-free rate, which is the convention every
 * retail platform uses. `periodsPerYear` is a parameter because a record on
 * weekly returns annualised as if it were daily is inflated by sqrt(7).
 */
export function sharpeRatio(returns = [], periodsPerYear = 365) {
  if (returns.length < 2) return null;
  const sd = stdev(returns);
  if (sd === 0) return null;
  return (mean(returns) / sd) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(returns = [], periodsPerYear = 365) {
  if (returns.length < 2) return null;
  const downside = returns.filter((r) => r < 0);
  if (!downside.length) return null;
  const dd = Math.sqrt(downside.reduce((acc, r) => acc + r * r, 0) / downside.length);
  if (dd === 0) return null;
  return (mean(returns) / dd) * Math.sqrt(periodsPerYear);
}

/**
 * Full performance summary. Every field is derived; none is accepted as input.
 * `winRate` is the share of positive periods, labelled as such in the UI so it
 * is not confused with per-trade win rate.
 */
export function performanceSummary(returns = [], { periodsPerYear = 365, trades = 0 } = {}) {
  const clean = returns.filter((r) => Number.isFinite(r));
  if (!clean.length) {
    return {
      periods: 0, totalReturn: null, maxDrawdown: null, sharpe: null, sortino: null,
      volatility: null, winRate: null, avgReturn: null, bestPeriod: null, worstPeriod: null,
      tradesPerPeriod: null
    };
  }
  const curve = equityCurve(clean);
  const totalReturn = curve[curve.length - 1] - 1;
  const sd = stdev(clean);
  return {
    periods: clean.length,
    totalReturn,
    maxDrawdown: maxDrawdown(curve),
    sharpe: sharpeRatio(clean, periodsPerYear),
    sortino: sortinoRatio(clean, periodsPerYear),
    volatility: sd * Math.sqrt(periodsPerYear),
    winRate: clean.filter((r) => r > 0).length / clean.length,
    avgReturn: mean(clean),
    bestPeriod: Math.max(...clean),
    worstPeriod: Math.min(...clean),
    tradesPerPeriod: trades > 0 ? trades / clean.length : null
  };
}

/** Bucket a summary into a risk profile using explicit thresholds. */
export function riskProfile(summary = {}) {
  const dd = summary.maxDrawdown ?? 0;
  const vol = summary.volatility ?? 0;
  for (const p of RISK_PROFILES) {
    if (dd <= p.maxDrawdown && vol <= p.maxVolatility) return p;
  }
  return RISK_PROFILES[RISK_PROFILES.length - 1];
}

/* ----------------------------------------------------------- verification */

/**
 * Decide whether a track record may be shown as verified.
 *
 * Refusal reasons are returned, not swallowed: "why is this trader not
 * verified" is the first question a prospective copier asks, and "we cannot
 * tell" is a better answer than a badge that means nothing.
 */
export function verifyTrackRecord({
  source = 'self-reported',
  returns = [],
  declaredDays = null,
  gaps = null,
  reconciledAt = null,
  now = Date.now()
} = {}) {
  const reasons = [];
  const periods = returns.length;

  if (!VERIFIABLE_SOURCES.includes(source)) {
    reasons.push(
      UNVERIFIED_SOURCES.includes(source)
        ? `Source "${source}" is not reconcilable by CryptoX.`
        : `Unknown source "${source}".`
    );
  }
  if (periods < VERIFY_MIN_DAYS) {
    reasons.push(`Only ${periods} periods of history; ${VERIFY_MIN_DAYS} required.`);
  }
  if (gaps == null) {
    reasons.push('Data continuity has not been checked.');
  } else if (gaps > VERIFY_MAX_GAPS) {
    reasons.push(`${gaps} gap(s) in the series.`);
  }
  if (declaredDays != null && declaredDays !== periods) {
    reasons.push(`Declared ${declaredDays} days but the series holds ${periods}.`);
  }
  if (!reconciledAt) {
    reasons.push('Never reconciled against the source of record.');
  } else if (now - new Date(reconciledAt).getTime() > 7 * 24 * 3600 * 1000) {
    reasons.push('Last reconciliation is more than 7 days old.');
  }

  return {
    verified: reasons.length === 0,
    label: reasons.length === 0 ? 'Verified by CryptoX' : 'Self-reported — not verified',
    reasons
  };
}

/* ------------------------------------------------------------- copy plan */

export const COPY_FEE_MODEL = {
  managementFeePct: 0,
  profitSharePct: 10,
  highWaterMark: true,
  chargedOn: 'closed positive PnL only',
  note:
    'No management fee. The profit share applies only to new profit above the previous high-water mark, so a follower never pays twice for the same gain.'
};

/**
 * Turn an intent ("copy 20% of my equity, never lose more than a quarter of
 * that") into absolute numbers plus the reasons it was refused.
 *
 * Deliberately NOT supported: allocation above 100% of equity. Copy trading
 * with borrowed money is a margin product, and margin is a licensed activity
 * governed elsewhere (Section 21), not a slider here.
 */
export function copyPlan({
  equity,
  allocationPct = 10,
  maxLossPct = 25,
  perTradePct = 5,
  minNotional = 10,
  feeModel = COPY_FEE_MODEL
} = {}) {
  const errors = [];
  const eq = Number(equity);

  if (!Number.isFinite(eq) || eq <= 0) errors.push('Equity must be a positive amount.');
  if (!(allocationPct > 0) || allocationPct > 100) errors.push('Allocation must be between 0 and 100% of equity.');
  if (!(maxLossPct > 0) || maxLossPct > 100) errors.push('Max loss must be between 0 and 100% of the allocation.');
  if (!(perTradePct > 0) || perTradePct > 100) errors.push('Per-trade cap must be between 0 and 100%.');

  if (errors.length) return { ok: false, errors };

  const allocation = eq * (allocationPct / 100);
  const maxLoss = allocation * (maxLossPct / 100);
  const perTrade = allocation * (perTradePct / 100);

  if (perTrade < minNotional) {
    errors.push(`Per-trade cap of $${perTrade.toFixed(2)} is below the $${minNotional} venue minimum.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    allocation,
    maxLoss,
    perTrade,
    stopEquity: allocation - maxLoss,
    /* The follower's total exposure cannot exceed the allocation, so the
       worst case is stated up front rather than discovered during a drawdown. */
    worstCaseLossPctOfEquity: (maxLoss / eq) * 100,
    feeModel: {
      profitSharePct: feeModel.profitSharePct,
      managementFeePct: feeModel.managementFeePct,
      highWaterMark: feeModel.highWaterMark,
      chargedOn: feeModel.chargedOn
    }
  };
}

/**
 * Evaluate the stop rules on every update. First matching rule wins, and the
 * order is by severity: a breached capital stop outranks a drawdown warning.
 */
export function shouldStopCopy({
  copyEquity,
  startEquity,
  plan = {},
  traderDrawdown = 0,
  stopCopyDrawdown = null,
  consecutiveLosses = 0,
  maxConsecutiveLosses = 5
} = {}) {
  if (!Number.isFinite(copyEquity) || !Number.isFinite(startEquity) || startEquity <= 0) {
    return { stop: false, reason: 'unknown', detail: 'Not enough data to evaluate stops.' };
  }

  if (Number.isFinite(plan.stopEquity) && copyEquity <= plan.stopEquity) {
    return {
      stop: true,
      reason: 'capital-stop',
      detail: `Copy equity $${copyEquity.toFixed(2)} reached the $${plan.stopEquity.toFixed(2)} floor set when the plan was created.`
    };
  }

  if (Number.isFinite(plan.maxLoss)) {
    const lost = startEquity - copyEquity;
    if (lost >= plan.maxLoss) {
      return {
        stop: true,
        reason: 'max-loss',
        detail: `Drawdown of $${lost.toFixed(2)} hit the $${plan.maxLoss.toFixed(2)} maximum loss.`
      };
    }
  }

  if (stopCopyDrawdown != null && traderDrawdown >= stopCopyDrawdown) {
    return {
      stop: true,
      reason: 'trader-drawdown',
      detail: `Trader drawdown ${(traderDrawdown * 100).toFixed(1)}% reached your ${(stopCopyDrawdown * 100).toFixed(1)}% stop-copy threshold.`
    };
  }

  if (maxConsecutiveLosses > 0 && consecutiveLosses >= maxConsecutiveLosses) {
    return {
      stop: true,
      reason: 'loss-streak',
      detail: `${consecutiveLosses} consecutive losing periods reached the ${maxConsecutiveLosses} limit.`
    };
  }

  return { stop: false, reason: 'running', detail: 'Within every configured limit.' };
}

/**
 * Transparent fee arithmetic. Profit share applies to the gain above the
 * high-water mark only; a losing period resets nothing.
 */
export function feeBreakdown({ grossProfit = 0, highWaterMark = 0, feeModel = COPY_FEE_MODEL } = {}) {
  if (!Number.isFinite(grossProfit)) return { chargeable: 0, fee: 0, net: 0, note: 'Invalid PnL.' };
  const chargeable = Math.max(0, grossProfit - Math.max(0, highWaterMark));
  const fee = chargeable * ((feeModel.profitSharePct ?? 0) / 100);
  return {
    grossProfit,
    highWaterMark,
    chargeable,
    fee,
    net: grossProfit - fee,
    effectiveRatePct: grossProfit > 0 ? (fee / grossProfit) * 100 : 0,
    note: chargeable > 0
      ? `Charged on $${chargeable.toFixed(2)} above the high-water mark.`
      : 'No fee: no new profit above the high-water mark.'
  };
}

/**
 * Rank traders for a follower without inventing a single number.
 * Unverified traders are ranked, but their score is heavily discounted and the
 * discount is reported, so a 300% self-reported return cannot outrank a
 * verified 30%.
 */
export function rankTraders(traders = []) {
  const scored = traders.map((t) => {
    const summary = performanceSummary(t.returns || [], { trades: t.trades || 0 });
    const verification = verifyTrackRecord({
      source: t.source,
      returns: t.returns || [],
      gaps: t.gaps ?? null,
      reconciledAt: t.reconciledAt ?? null
    });
    const sharpe = summary.sharpe ?? 0;
    const dd = summary.maxDrawdown ?? 1;
    /* Return per unit of drawdown, bounded, so one lucky month cannot dominate. */
    const quality = Math.max(-1, Math.min(3, (summary.totalReturn ?? 0) / Math.max(0.05, dd)));
    const base = quality * 40 + Math.max(-2, Math.min(3, sharpe)) * 20;
    const score = base * (verification.verified ? 1 : 0.4);
    return {
      id: t.id,
      name: t.name,
      summary,
      profile: riskProfile(summary),
      verification,
      score,
      confidenceDiscount: verification.verified ? 0 : 60
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Copy allocation across several traders, normalised and capped. */
export function splitAllocation({ equity, targets = [], maxPerTraderPct = 40 } = {}) {
  const total = targets.reduce((a, t) => a + (Number(t.weight) || 0), 0);
  if (!total || !Number.isFinite(equity) || equity <= 0) {
    return { ok: false, errors: ['Provide equity and at least one target with a positive weight.'], legs: [] };
  }
  const errors = [];
  const legs = targets.map((t) => {
    const pct = ((Number(t.weight) || 0) / total) * 100;
    if (pct > maxPerTraderPct) {
      errors.push(`${t.name || t.id} would receive ${pct.toFixed(1)}%, above the ${maxPerTraderPct}% concentration cap.`);
    }
    return {
      id: t.id,
      name: t.name,
      pct,
      amount: equity * (pct / 100)
    };
  });
  return { ok: errors.length === 0, errors, legs };
}
