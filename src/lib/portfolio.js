/* Portfolio engine: FIFO cost basis, realized/unrealized P&L, allocation,
 * calendar, tax lots and risk. Pure functions — unit tested.
 *
 * Cost-basis method: FIFO (first in, first out) per coin.
 *   - a BUY adds a lot; its fee is added to the cost basis
 *   - a SELL consumes lots oldest-first; its fee reduces the proceeds
 *   - TRANSFER_IN / TRANSFER_OUT move units without realising a gain; a
 *     transfer-in must carry the original cost so basis is preserved
 *
 * Integrity rules:
 *   - Selling more than you hold is reported as an explicit `oversold` warning
 *     rather than being silently satisfied with phantom units.
 *   - Annualised figures are labelled as a naive holding-period annualisation,
 *     never presented as a money-weighted return.
 */

export const SIDES = ['buy', 'sell', 'transfer_in', 'transfer_out'];
export const INFLOW = new Set(['buy', 'transfer_in']);
export const OUTFLOW = new Set(['sell', 'transfer_out']);

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const pos = (v) => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** Coerce a stored transaction into a well-formed, sortable record. */
export function normaliseTx(t) {
  if (!t) return null;
  const amount = pos(t.amount);
  const at = num(t.at) || 0;
  if (!t.coinId || !SIDES.includes(t.side) || amount == null) return null;
  const price = num(t.price);
  return {
    id: t.id,
    coinId: t.coinId,
    symbol: t.symbol || null,
    side: t.side,
    amount,
    // Transfers carry no price of their own unless the user supplied a basis.
    price: price != null && price >= 0 ? price : null,
    fee: num(t.fee) || 0,
    at,
    venue: t.venue || null,
    chain: t.chain || null,
    note: t.note || null
  };
}

/**
 * FIFO lot matching across a transaction history.
 * @returns {{
 *   lotsByCoin: Record<string, Array>,
 *   disposals: Array,
 *   realizedByCoin: Record<string, {proceeds:number, costBasis:number, gain:number, count:number}>,
 *   totals: {proceeds:number, costBasis:number, realized:number},
 *   warnings: Array<{kind:string, coinId:string, message:string}>
 * }}
 */
export function buildLots(transactions = []) {
  const txs = (transactions || [])
    .map(normaliseTx)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);

  const queues = new Map(); // coinId -> FIFO lot list
  const disposals = [];
  const realizedByCoin = {};
  const warnings = [];
  let seq = 0;

  const queueFor = (coinId) => {
    if (!queues.has(coinId)) queues.set(coinId, []);
    return queues.get(coinId);
  };

  const held = (coinId) => queueFor(coinId).reduce((a, l) => a + l.remaining, 0);

  const realise = (coinId) => {
    if (!realizedByCoin[coinId]) realizedByCoin[coinId] = { proceeds: 0, costBasis: 0, gain: 0, count: 0 };
    return realizedByCoin[coinId];
  };

  txs.forEach((tx) => {
    const queue = queueFor(tx.coinId);

    if (INFLOW.has(tx.side)) {
      // A transfer-in without a stated basis is recorded at 0 and flagged: we do
      // not invent a purchase price for units that were moved in.
      const unitCost = tx.price != null ? tx.price : 0;
      if (tx.side === 'transfer_in' && tx.price == null) {
        warnings.push({
          kind: 'transfer_without_basis',
          coinId: tx.coinId,
          message: 'Transfer in without a stated cost basis — recorded at 0. Add the original cost for accurate P&L.'
        });
      }
      queue.push({
        seq: seq += 1,
        amount: tx.amount,
        remaining: tx.amount,
        unitCost,
        feeAllocated: INFLOW.has(tx.side) && tx.side === 'buy' ? tx.fee : 0,
        at: tx.at,
        venue: tx.venue,
        txId: tx.id
      });
      return;
    }

    // OUTFLOW
    let toConsume = tx.amount;
    const available = held(tx.coinId);
    if (toConsume > available + 1e-12) {
      warnings.push({
        kind: 'oversold',
        coinId: tx.coinId,
        message: `Sold ${tx.amount} but only ${available} was held. The excess is ignored — check your entries.`
      });
      toConsume = available;
    }

    const consumed = [];
    let costBasis = 0;
    let earliestAt = null;
    let remaining = toConsume;
    while (remaining > 1e-12 && queue.length) {
      const lot = queue[0];
      const take = Math.min(lot.remaining, remaining);
      lot.remaining -= take;
      remaining -= take;
      costBasis += take * lot.unitCost;
      consumed.push({ lotSeq: lot.seq, amount: take, unitCost: lot.unitCost, acquiredAt: lot.at });
      if (earliestAt == null || lot.at < earliestAt) earliestAt = lot.at;
      if (lot.remaining <= 1e-12) queue.shift();
    }

    const unitProceeds = tx.price != null ? tx.price : null;
    const proceeds = unitProceeds != null ? toConsume * unitProceeds - tx.fee : null;
    const gain = proceeds != null ? proceeds - costBasis : null;

    const isDisposal = tx.side === 'sell';
    if (isDisposal) {
      const r = realise(tx.coinId);
      if (proceeds != null) {
        r.proceeds += proceeds;
        r.costBasis += costBasis;
        r.gain += gain;
        r.count += 1;
      }
    }

    disposals.push({
      txId: tx.id,
      coinId: tx.coinId,
      symbol: tx.symbol,
      side: tx.side,
      at: tx.at,
      amount: toConsume,
      unitProceeds,
      fee: tx.fee,
      proceeds,
      costBasis,
      gain,
      gainPct: proceeds != null && costBasis > 0 ? (gain / costBasis) * 100 : null,
      holdingDays: earliestAt != null && tx.at ? Math.max(0, Math.round((tx.at - earliestAt) / 86400000)) : null,
      longTerm: earliestAt != null && tx.at ? (tx.at - earliestAt) >= 365 * 86400000 : null,
      basisKnown: !(consumed.length === 0 && toConsume > 0) && consumed.every((c) => c.unitCost > 0 || tx.side === 'transfer_out'),
      consumed
    });
  });

  const lotsByCoin = {};
  queues.forEach((q, coinId) => {
    const open = q.filter((l) => l.remaining > 1e-12);
    if (open.length) lotsByCoin[coinId] = open;
  });

  const totals = Object.values(realizedByCoin).reduce(
    (a, r) => ({ proceeds: a.proceeds + r.proceeds, costBasis: a.costBasis + r.costBasis, realized: a.realized + r.gain }),
    { proceeds: 0, costBasis: 0, realized: 0 }
  );

  return { lotsByCoin, disposals, realizedByCoin, totals, warnings };
}

/**
 * Open positions with cost basis, average entry, unrealized and realized P&L.
 * @param transactions raw history
 * @param priceById    { [coinId]: currentPrice }
 * @param metaById     optional { [coinId]: { symbol, name, image } }
 */
export function positions(transactions = [], priceById = {}, metaById = {}) {
  const { lotsByCoin, realizedByCoin, totals: realizedTotals, warnings } = buildLots(transactions);

  const list = Object.keys(lotsByCoin).map((coinId) => {
    const lots = lotsByCoin[coinId];
    const amount = lots.reduce((a, l) => a + l.remaining, 0);
    const costBasis = lots.reduce((a, l) => a + l.remaining * l.unitCost, 0);
    const avgEntry = amount > 0 ? costBasis / amount : null;
    const price = num(priceById[coinId]);
    const value = price != null ? amount * price : null;
    const unrealized = value != null ? value - costBasis : null;
    const realized = realizedByCoin[coinId]?.gain || 0;
    const totalPnl = unrealized != null ? unrealized + realized : null;
    const firstAt = lots.reduce((a, l) => (a == null || l.at < a ? l.at : a), null);
    return {
      coinId,
      symbol: metaById[coinId]?.symbol || null,
      name: metaById[coinId]?.name || null,
      image: metaById[coinId]?.image || null,
      amount,
      costBasis,
      avgEntry,
      price,
      value,
      unrealized,
      unrealizedPct: unrealized != null && costBasis > 0 ? (unrealized / costBasis) * 100 : null,
      realized,
      totalPnl,
      roiPct: totalPnl != null && costBasis > 0 ? (totalPnl / costBasis) * 100 : null,
      lots: lots.length,
      firstAt,
      holdingDays: firstAt ? Math.max(0, Math.round((Date.now() - firstAt) / 86400000)) : null,
      priced: price != null
    };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const valueTotal = list.reduce((a, p) => a + (p.value || 0), 0);
  const costTotal = list.reduce((a, p) => a + p.costBasis, 0);
  const unrealizedTotal = list.reduce((a, p) => a + (p.unrealized || 0), 0);
  const withWeight = list.map((p) => ({
    ...p,
    weightPct: valueTotal > 0 && p.value != null ? (p.value / valueTotal) * 100 : null
  }));

  const pricedAll = list.length > 0 && list.every((p) => p.priced);

  return {
    positions: withWeight,
    totals: {
      value: valueTotal,
      costBasis: costTotal,
      unrealized: unrealizedTotal,
      realized: realizedTotals.realized,
      totalPnl: unrealizedTotal + realizedTotals.realized,
      roiPct: costTotal > 0 ? ((unrealizedTotal + realizedTotals.realized) / costTotal) * 100 : null,
      positions: list.length,
      pricedAll
    },
    warnings
  };
}

/**
 * Naive annualisation of a holding-period return.
 * APR = linear scaling; APY = compounded scaling. This is NOT a money-weighted
 * return (IRR) and ignores deposits/withdrawals over the period.
 */
export function annualised({ roiPct, days }) {
  const roi = num(roiPct);
  const d = num(days);
  if (roi == null || d == null || d < 1) return { apr: null, apy: null, days: d ?? null, annualisable: false };
  const factor = 365 / d;
  const apr = roi * factor;
  const growth = 1 + roi / 100;
  const apy = growth > 0 ? (Math.pow(growth, factor) - 1) * 100 : null;
  return { apr, apy, days: d, annualisable: true };
}

/** Group open positions by a key so allocation can be shown by asset/chain/venue. */
export function allocation(positionsList = [], keyFn = (p) => p.coinId) {
  const total = positionsList.reduce((a, p) => a + (p.value || 0), 0);
  const buckets = new Map();
  positionsList.forEach((p) => {
    const key = keyFn(p) || 'Other';
    const cur = buckets.get(key) || { key, value: 0, costBasis: 0, coins: 0 };
    cur.value += p.value || 0;
    cur.costBasis += p.costBasis || 0;
    cur.coins += 1;
    buckets.set(key, cur);
  });
  const rows = [...buckets.values()]
    .map((b) => ({
      ...b,
      weightPct: total > 0 ? (b.value / total) * 100 : null,
      unrealized: b.value - b.costBasis,
      roiPct: b.costBasis > 0 ? ((b.value - b.costBasis) / b.costBasis) * 100 : null
    }))
    .sort((a, b) => b.value - a.value);
  return { rows, total };
}

/** Realized P&L per calendar day, for the profit/loss calendar. */
export function pnlCalendar(disposals = [], { year, month } = {}) {
  const days = {};
  let monthly = { proceeds: 0, costBasis: 0, gain: 0, count: 0 };

  (disposals || []).forEach((d) => {
    if (d.gain == null || !d.at) return;
    const dt = new Date(d.at);
    if (year != null && dt.getFullYear() !== year) return;
    if (month != null && dt.getMonth() !== month) return;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const cell = days[key] || { key, gain: 0, proceeds: 0, costBasis: 0, count: 0, at: dt.getTime() };
    cell.gain += d.gain;
    cell.proceeds += d.proceeds || 0;
    cell.costBasis += d.costBasis || 0;
    cell.count += 1;
    days[key] = cell;
    monthly.proceeds += d.proceeds || 0;
    monthly.costBasis += d.costBasis || 0;
    monthly.gain += d.gain;
    monthly.count += 1;
  });

  return { days, monthly, activeDays: days };
}

/** Build a display grid for one month: 6 weeks × 7 days, Monday-first. */
export function calendarGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, key });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Tax-lot rows: one per disposal, with holding period and gain. */
export function taxLots(disposals = []) {
  return (disposals || [])
    .filter((d) => d.side === 'sell')
    .map((d) => ({
      disposedAt: d.at,
      coinId: d.coinId,
      symbol: d.symbol,
      amount: d.amount,
      proceeds: d.proceeds,
      costBasis: d.costBasis,
      gain: d.gain,
      gainPct: d.gainPct,
      holdingDays: d.holdingDays,
      term: d.longTerm == null ? 'unknown' : d.longTerm ? 'long' : 'short',
      basisKnown: d.basisKnown
    }))
    .sort((a, b) => b.disposedAt - a.disposedAt);
}

/**
 * Portfolio risk from position weights and optional per-coin return history.
 * Concentration uses the Herfindahl-Hirschman index (sum of squared weights).
 * Volatility is the weighted average of per-coin daily-return volatility —
 * it ignores correlation, so it understates true portfolio risk.
 */
export function riskMetrics(positionsList = [], { returnsByCoin = {} } = {}) {
  const weights = positionsList
    .filter((p) => p.value != null && p.value > 0)
    .map((p) => ({ coinId: p.coinId, symbol: p.symbol, weight: p.weightPct / 100, value: p.value }));

  const totalWeight = weights.reduce((a, w) => a + w.weight, 0);
  const normalised = totalWeight > 0 ? weights.map((w) => ({ ...w, weight: w.weight / totalWeight })) : [];

  const hhi = normalised.reduce((a, w) => a + w.weight * w.weight, 0);
  const sorted = [...normalised].sort((a, b) => b.weight - a.weight);

  const effectivePositions = hhi > 0 ? 1 / hhi : null;

  let volContribution = 0;
  let volCovered = 0;
  let volTotal = 0;
  normalised.forEach((w) => {
    volTotal += w.weight;
    const series = returnsByCoin[w.coinId];
    if (Array.isArray(series) && series.length > 2) {
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length - 1);
      volContribution += w.weight * Math.sqrt(variance);
      volCovered += w.weight;
    }
  });

  return {
    hhi,
    effectivePositions,
    top1Pct: sorted[0] ? sorted[0].weight * 100 : null,
    top1: sorted[0]?.symbol || sorted[0]?.coinId || null,
    top3Pct: sorted.slice(0, 3).reduce((a, w) => a + w.weight, 0) * 100 || null,
    concentrationLabel: hhi >= 0.5 ? 'highly concentrated' : hhi >= 0.25 ? 'concentrated' : hhi > 0 ? 'diversified' : null,
    // Weighted average of per-coin daily volatility (ignores correlation).
    weightedDailyVolPct: volCovered > 0 ? (volContribution / volCovered) * 100 : null,
    volCoveragePct: volTotal > 0 ? (volCovered / volTotal) * 100 : null,
    coverageNote: 'Weighted average of per-coin volatility; correlation between coins is not modelled, so true portfolio risk will be higher.'
  };
}

/**
 * Portfolio equity series → drawdown statistics.
 * @param series [{ t, v }]
 */
export function equityRisk(series = []) {
  const points = (series || []).filter((p) => num(p?.v) != null && num(p.v) > 0).sort((a, b) => a.t - b.t);
  if (points.length < 2) {
    return { points: points.length, peak: null, maxDrawdownPct: null, currentDrawdownPct: null, changePct: null, insufficient: true };
  }
  let peak = points[0].v;
  let peakAt = points[0].t;
  let maxDd = 0;
  let maxDdPeakAt = points[0].t;
  let maxDdTroughAt = points[0].t;
  points.forEach((p) => {
    if (p.v > peak) { peak = p.v; peakAt = p.t; }
    const dd = peak > 0 ? ((p.v - peak) / peak) * 100 : 0;
    if (dd < maxDd) { maxDd = dd; maxDdPeakAt = peakAt; maxDdTroughAt = p.t; }
  });
  const last = points[points.length - 1];
  const first = points[0];
  return {
    points: points.length,
    first,
    last,
    peak,
    maxDrawdownPct: maxDd,
    maxDrawdownPeakAt: maxDdPeakAt,
    maxDrawdownTroughAt: maxDdTroughAt,
    currentDrawdownPct: peak > 0 ? ((last.v - peak) / peak) * 100 : null,
    changePct: first.v > 0 ? ((last.v - first.v) / first.v) * 100 : null,
    insufficient: false
  };
}

/**
 * Allocation by custody venue.
 *
 * This works on LOTS, not positions: the same coin can be held on more than one
 * exchange (100 DOGE on Binance, 50 on Kraken), which a position-level roll-up
 * would silently merge.
 */
export function venueAllocation(lotsByCoin = {}, priceById = {}, labelOf = null) {
  const keyOf = (venue) => (venue ? (labelOf ? labelOf(venue) : venue) : 'Unassigned');
  const buckets = new Map();
  const coinsByKey = {};

  Object.entries(lotsByCoin || {}).forEach(([coinId, lots]) => {
    const price = num(priceById[coinId]);
    lots.forEach((l) => {
      const key = keyOf(l.venue);
      const cur = buckets.get(key) || { key, value: 0, costBasis: 0, lots: 0, unpriced: 0 };
      if (price != null) cur.value += l.remaining * price;
      else cur.unpriced += 1;
      cur.costBasis += l.remaining * l.unitCost;
      cur.lots += 1;
      buckets.set(key, cur);
      (coinsByKey[key] = coinsByKey[key] || new Set()).add(coinId);
    });
  });

  const total = [...buckets.values()].reduce((a, b) => a + b.value, 0);
  const rows = [...buckets.values()]
    .map((b) => ({
      ...b,
      coins: coinsByKey[b.key] ? coinsByKey[b.key].size : 0,
      weightPct: total > 0 ? (b.value / total) * 100 : null,
      unrealized: b.value - b.costBasis,
      roiPct: b.costBasis > 0 ? ((b.value - b.costBasis) / b.costBasis) * 100 : null
    }))
    .sort((a, b) => b.value - a.value);

  return { rows, total };
}

/** Everything the UI needs, in one pass. */
export function buildPortfolio({
  transactions = [],
  priceById = {},
  metaById = {},
  returnsByCoin = {},
  equitySeries = [],
  chainOf = null,        // (coinId) => chain display label
  venueLabelOf = null    // (venueId) => venue display label
} = {}) {
  const lotData = buildLots(transactions);
  const pos = positions(transactions, priceById, metaById);
  // NOTE: buildLots() and positions() both expose a `totals` key. Spread the lot
  // data FIRST and re-expose it as `realizedTotals`, so `totals` unambiguously
  // means the portfolio totals.
  return {
    ...lotData,
    realizedTotals: lotData.totals,
    ...pos,
    byChain: chainOf ? allocation(pos.positions, (p) => chainOf(p.coinId)) : { rows: [], total: 0 },
    byVenue: venueAllocation(lotData.lotsByCoin, priceById, venueLabelOf),
    calendar: pnlCalendar(lotData.disposals),
    tax: taxLots(lotData.disposals),
    risk: riskMetrics(pos.positions, { returnsByCoin }),
    equity: equityRisk(equitySeries)
  };
}
