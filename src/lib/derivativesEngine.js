/* Paper derivatives engine: futures/perpetual margin, leverage, liquidation,
 * funding accrual, ADL priority and an insurance fund.
 *
 * Pure functions/classes — fully unit tested. This models the mechanics; it does
 * not place real futures orders (that needs a licensed venue and custody).
 */

export const CONTRACTS = [
  {
    symbol: 'BTCUSDT',
    base: 'BTC',
    tickSize: 0.1,
    lotSize: 0.001,
    maxLeverage: 125,
    maintenanceTiers: [
      { upToNotional: 50000, mmr: 0.004, maintenanceAmount: 0 },
      { upToNotional: 250000, mmr: 0.005, maintenanceAmount: 50 },
      { upToNotional: 1000000, mmr: 0.01, maintenanceAmount: 1300 },
      { upToNotional: Infinity, mmr: 0.025, maintenanceAmount: 16300 }
    ]
  },
  {
    symbol: 'ETHUSDT',
    base: 'ETH',
    tickSize: 0.01,
    lotSize: 0.01,
    maxLeverage: 100,
    maintenanceTiers: [
      { upToNotional: 20000, mmr: 0.005, maintenanceAmount: 0 },
      { upToNotional: 100000, mmr: 0.0075, maintenanceAmount: 50 },
      { upToNotional: Infinity, mmr: 0.02, maintenanceAmount: 1300 }
    ]
  }
];

export const contractBySymbol = (symbol) => CONTRACTS.find((c) => c.symbol === symbol) || CONTRACTS[0];

/** Maintenance margin rate + amount for a position notional (tiered). */
export function maintenanceRequirement(notional, contract = CONTRACTS[0]) {
  const abs = Math.abs(notional);
  const tier = contract.maintenanceTiers.find((t) => abs <= t.upToNotional) || contract.maintenanceTiers[contract.maintenanceTiers.length - 1];
  return { mmr: tier.mmr, maintenanceAmount: tier.maintenanceAmount, maintenanceMargin: abs * tier.mmr - tier.maintenanceAmount };
}

export const initialMargin = (notional, leverage) => Math.abs(notional) / Math.max(1, leverage);

export function unrealizedPnl({ side, entry, mark, qty }) {
  const dir = side === 'long' ? 1 : -1;
  return (mark - entry) * dir * qty;
}

export const roe = (pnl, margin) => (margin > 0 ? (pnl / margin) * 100 : 0);

/**
 * Liquidation price.
 *  isolated: only this position's margin backs it.
 *  cross:    the whole wallet balance backs it.
 */
export function liquidationPrice({ side, entry, qty, leverage, mode = 'isolated', walletBalance = 0, contract = CONTRACTS[0] }) {
  const notional = entry * qty;
  const { mmr } = maintenanceRequirement(notional, contract);
  const margin = mode === 'cross' ? initialMargin(notional, leverage) + walletBalance : initialMargin(notional, leverage);
  const dir = side === 'long' ? 1 : -1;
  // price where equity equals maintenance margin
  const liq = entry - (dir * (margin - notional * mmr)) / qty;
  return Math.max(0, liq);
}

export function marginRatio({ maintenanceMargin, marginBalance }) {
  if (marginBalance <= 0) return Infinity;
  return maintenanceMargin / marginBalance;
}

export function riskLevel(marginRatioValue) {
  if (!Number.isFinite(marginRatioValue)) return 'liquidated';
  if (marginRatioValue >= 1) return 'liquidated';
  if (marginRatioValue >= 0.8) return 'danger';
  if (marginRatioValue >= 0.5) return 'warning';
  return 'safe';
}

/** Funding: positive rate means longs pay shorts. */
export function fundingPayment({ side, notional, rate }) {
  const dir = side === 'long' ? -1 : 1;
  return notional * rate * dir;
}

export const FUNDING_INTERVAL_MS = 8 * 3600 * 1000;
export const nextFundingTime = (now = Date.now()) => Math.ceil(now / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS;

/** Rank positions for auto-deleveraging (highest profit × leverage first). */
export function adlQueue(positions = []) {
  return [...positions]
    .map((p) => ({
      ...p,
      adlScore: p.margin > 0 ? (p.unrealizedPnl / p.margin) * (p.leverage || 1) : 0
    }))
    .sort((a, b) => b.adlScore - a.adlScore);
}

/** Insurance fund: absorbs liquidation shortfalls, triggers ADL when depleted. */
export class InsuranceFund {
  constructor(balance = 250000) {
    this.balance = balance;
    this.initial = balance;
    this.events = [];
  }
  absorb(amount) {
    const absorbed = Math.min(this.balance, Math.max(0, amount));
    this.balance -= absorbed;
    this.events.push({ type: 'absorb', amount: absorbed, at: Date.now(), balance: this.balance });
    return absorbed;
  }
  credit(amount) {
    this.balance += Math.max(0, amount);
    this.events.push({ type: 'credit', amount, at: Date.now(), balance: this.balance });
    return this.balance;
  }
  needsAdl() {
    return this.balance <= this.initial * 0.1;
  }
}

/** Full position view used by the UI. */
export function positionView(position, mark, walletBalance = 0) {
  const contract = contractBySymbol(position.symbol);
  const notional = mark * position.qty;
  const upnl = unrealizedPnl({ side: position.side, entry: position.entry, mark, qty: position.qty });
  const margin = initialMargin(position.entry * position.qty, position.leverage);
  const { maintenanceMargin, mmr, maintenanceAmount } = maintenanceRequirement(notional, contract);
  const marginBalance = margin + upnl;
  const ratio = marginRatio({ maintenanceMargin, marginBalance });
  const liq = liquidationPrice({
    side: position.side,
    entry: position.entry,
    qty: position.qty,
    leverage: position.leverage,
    mode: position.mode,
    walletBalance,
    contract
  });
  const distancePct = mark ? (Math.abs(mark - liq) / mark) * 100 : null;
  return {
    contract,
    notional,
    unrealizedPnl: upnl,
    realizedPnl: position.realizedPnl || 0,
    margin,
    maintenanceMargin,
    mmr,
    maintenanceAmount,
    marginBalance,
    marginRatio: Number.isFinite(ratio) ? ratio : 1,
    risk: riskLevel(ratio),
    liquidationPrice: liq,
    distancePct,
    roe: roe(upnl, margin)
  };
}

/** Simulate one funding settlement on a position. */
export function applyFunding(position, rate) {
  const payment = fundingPayment({ side: position.side, notional: position.entry * position.qty, rate });
  return { payment, realizedPnl: (position.realizedPnl || 0) + payment };
}

/** Liquidate a position: return the loss taken and the shortfall for the fund. */
export function liquidate(position, mark) {
  const view = positionView(position, mark);
  const loss = Math.min(0, view.marginBalance);
  // The fund covers the gap between the maintenance requirement and the
  // (possibly negative) margin balance: max(0, MM - marginBalance). The previous
  // expression added the loss a second time and overstated the shortfall.
  const shortfall = Math.max(0, view.maintenanceMargin - view.marginBalance);
  return {
    ...position,
    closedAt: Date.now(),
    closePrice: mark,
    realizedPnl: (position.realizedPnl || 0) + view.unrealizedPnl,
    loss: Math.abs(loss),
    shortfall: Math.max(0, shortfall),
    liquidated: true
  };
}

/* =====================================================================
 * Section 2 additions: dated futures, mark/index price modelling,
 * realized PnL on partial close, and cross-margin wallet aggregation.
 * ===================================================================== */

/* ---------------- dated (expiry) futures ---------------- */

/** Last Friday of a given month (UTC) — the standard quarterly expiry. */
export function lastFriday(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0)); // last day of month
  const back = (d.getUTCDay() - 5 + 7) % 7;              // walk back to Friday
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

/**
 * The next two quarterly expiries (Mar/Jun/Sep/Dec), derived from the calendar.
 * These are computed, not hard-coded, so they never go stale.
 */
export function quarterlyExpiries(now = Date.now(), count = 2) {
  const out = [];
  const start = new Date(now);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (out.length < count) {
    if ([2, 5, 8, 11].includes(month)) {
      const exp = lastFriday(year, month);
      // A contract expires at 08:00 UTC on the expiry day.
      exp.setUTCHours(8, 0, 0, 0);
      if (exp.getTime() > now) out.push(exp);
    }
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}

export const daysToExpiry = (expiry, now = Date.now()) => Math.max(0, (new Date(expiry).getTime() - now) / 86400000);

/** Build dated contracts from a perpetual spec so nothing is invented. */
export function datedContracts(now = Date.now(), base = CONTRACTS[0]) {
  return quarterlyExpiries(now).map((exp) => {
    const iso = exp.toISOString().slice(0, 10);
    const code = iso.slice(2).replace(/-/g, '');
    return {
      symbol: `${base.symbol}_${code}`,
      base: base.base,
      kind: 'dated',
      expiry: exp.toISOString(),
      expiryLabel: iso,
      tickSize: base.tickSize,
      lotSize: base.lotSize,
      // Dated futures carry less leverage than the perpetual.
      maxLeverage: Math.min(50, base.maxLeverage),
      maintenanceTiers: base.maintenanceTiers
    };
  });
}

/* ---------------- mark vs index price ---------------- */

/** Mark/index divergence. Exchanges liquidate on MARK, never on last price. */
export function priceBasis({ markPrice, indexPrice }) {
  if (!(markPrice > 0) || !(indexPrice > 0)) return null;
  const abs = markPrice - indexPrice;
  return { markPrice, indexPrice, abs, pct: (abs / indexPrice) * 100 };
}

/**
 * Funding rate from the premium index, using the published
 * premium + interest-rate clamp formula.
 *   rate = premium + clamp(interest - premium, ±clamp), then capped.
 */
export function fundingFromPremium({ premiumPct, interestRate = 0.0001, clamp = 0.0005, cap = 0.0075 }) {
  const p = premiumPct ?? 0;
  const c = Math.max(-clamp, Math.min(clamp, interestRate - p));
  return Math.max(-cap, Math.min(cap, p + c));
}

/** Term-structure basis for a dated contract, annualised. */
export function annualisedBasis({ futuresPrice, indexPrice, days }) {
  if (!(futuresPrice > 0) || !(indexPrice > 0) || !(days > 0)) return null;
  const pct = ((futuresPrice - indexPrice) / indexPrice) * 100;
  return { pct, annualisedPct: pct * (365 / days), days, contango: futuresPrice > indexPrice };
}

/** Cost-of-carry fair value for a dated future, continuously compounded. */
export function fairFuturesPrice({ indexPrice, days, rate = 0 }) {
  if (!(indexPrice > 0)) return null;
  return indexPrice * Math.exp(rate * (Math.max(0, days) / 365));
}

/* ---------------- realized PnL ---------------- */

/**
 * Close all or part of a position and compute REALIZED PnL net of fees.
 * Returns the realized amount, the per-unit breakdown, and what is left open.
 */
export function closePartial(position, { qty, price, feeRate = 0.0005 } = {}) {
  const openQty = Math.abs(position?.qty ?? 0);
  const closeQty = Math.min(Math.abs(qty ?? 0), openQty);
  if (!(closeQty > 0) || !(price > 0)) return null;

  const dir = position.side === 'long' ? 1 : -1;
  const gross = (price - position.entry) * dir * closeQty;
  const fee = price * closeQty * feeRate;
  const net = gross - fee;
  const marginUsed = initialMargin(position.entry * closeQty, position.leverage);
  const remainingQty = openQty - closeQty;
  const realizedPnl = (position.realizedPnl || 0) + net;

  return {
    realizedPnl: net,
    gross,
    fee,
    closeQty,
    remainingQty,
    roe: marginUsed > 0 ? (net / marginUsed) * 100 : null,
    position: remainingQty > 0
      ? { ...position, qty: remainingQty, realizedPnl }
      : { ...position, qty: 0, realizedPnl, closedAt: Date.now(), closePrice: price, closed: true }
  };
}

/** Accrue a funding payment into realized PnL. */
export function realizeFunding(position, rate) {
  const notional = Math.abs(position.entry * position.qty);
  const payment = fundingPayment({ side: position.side, notional, rate });
  return { payment, position: { ...position, realizedPnl: (position.realizedPnl || 0) + payment } };
}

/* ---------------- cross margin ---------------- */

/**
 * Aggregate a cross-margin wallet: one collateral pool backs every position.
 * Under cross margin a single deep position can take the whole account with it,
 * so the aggregate ratio — not any single position — decides liquidation.
 */
export function crossWallet({ positions = [], walletBalance = 0, marks = {} } = {}) {
  let totalNotional = 0;
  let totalMaintenance = 0;
  let totalInitial = 0;
  let totalUnrealized = 0;

  positions.forEach((p) => {
    const mark = marks[p.symbol] ?? p.mark ?? p.entry;
    const notional = Math.abs(mark * p.qty);
    totalNotional += notional;
    totalInitial += initialMargin(p.entry * p.qty, p.leverage);
    totalMaintenance += maintenanceRequirement(notional, contractBySymbol(p.symbol)).maintenanceMargin;
    totalUnrealized += unrealizedPnl({ side: p.side, entry: p.entry, mark, qty: p.qty });
  });

  const marginBalance = walletBalance + totalUnrealized;
  const ratio = marginRatio({ maintenanceMargin: totalMaintenance, marginBalance });

  return {
    positions: positions.length,
    totalNotional,
    totalInitial,
    totalMaintenance,
    totalUnrealized,
    marginBalance,
    marginRatio: Number.isFinite(ratio) ? ratio : 1,
    risk: riskLevel(ratio),
    freeMargin: Math.max(0, marginBalance - totalMaintenance),
    // How much further the wallet can lose before maintenance is breached.
    cushion: marginBalance - totalMaintenance
  };
}
