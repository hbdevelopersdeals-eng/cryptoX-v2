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
  const shortfall = Math.max(0, view.maintenanceMargin + loss * -1 - view.marginBalance);
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
