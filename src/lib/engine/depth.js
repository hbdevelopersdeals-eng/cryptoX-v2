/* Order-book depth helpers: bucketing, cumulative depth, liquidity metrics and
 * snapshot replay. Pure functions — unit tested. */

const num = (v) => (Number.isFinite(v) ? v : null);

/** Bucket price levels into percentage bands, merging small levels together. */
export function aggregateDepth(levels = [], bucketPct = 0.05) {
  if (!levels.length || bucketPct <= 0) return [];
  const rows = [...levels].sort((a, b) => a.price - b.price);
  const first = rows[0].price;
  if (!first) return [];
  const buckets = new Map();
  rows.forEach((lvl) => {
    const band = Math.floor(((lvl.price - first) / first) * 100 / bucketPct);
    const key = band * bucketPct;
    const entry = buckets.get(key) || { bandPct: key, qty: 0, notional: 0, levels: 0 };
    entry.qty += lvl.qty;
    entry.notional += lvl.qty * lvl.price;
    entry.levels += 1;
    buckets.set(key, entry);
  });
  return [...buckets.values()].sort((a, b) => a.bandPct - b.bandPct);
}

/** Running totals from the top of the book downwards (for depth charts). */
export function cumulative(levels = []) {
  let qty = 0;
  let notional = 0;
  return levels.map((l) => {
    qty += l.qty;
    notional += l.qty * l.price;
    return { ...l, cumQty: qty, cumNotional: notional };
  });
}

/** Spread, mid, near-book liquidity and bid/ask imbalance. */
export function bookMetrics(l2 = { bids: [], asks: [] }, { depthPct = 0.5 } = {}) {
  const bestBid = l2.bids?.[0]?.price ?? null;
  const bestAsk = l2.asks?.[0]?.price ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const band = mid ? (mid * depthPct) / 100 : null;

  const within = (levels, side) =>
    band == null
      ? 0
      : levels.reduce((acc, l) => {
          const near = side === 'bid' ? mid - l.price <= band : l.price - mid <= band;
          return acc + (near ? l.qty * l.price : 0);
        }, 0);

  const bidLiquidity = num(within(l2.bids || [], 'bid'));
  const askLiquidity = num(within(l2.asks || [], 'ask'));
  const total = (bidLiquidity || 0) + (askLiquidity || 0);
  const imbalance = total > 0 ? ((bidLiquidity || 0) - (askLiquidity || 0)) / total : null;

  return {
    bestBid,
    bestAsk,
    mid,
    spread,
    spreadPct: spread != null && mid ? (spread / mid) * 100 : null,
    bidLiquidity,
    askLiquidity,
    imbalance,
    depthPct
  };
}

/** 0–100 liquidity score: tighter spread and deeper book score higher. */
export function liquidityScore(metrics) {
  if (!metrics || metrics.mid == null) return 0;
  const spreadScore = Math.max(0, 60 - (metrics.spreadPct || 0) * 200);
  const depth = Math.min(1, ((metrics.bidLiquidity || 0) + (metrics.askLiquidity || 0)) / 500000);
  const depthScore = depth * 40;
  return Math.round(Math.max(0, Math.min(100, spreadScore + depthScore)));
}

/** Extract a comparable series from recorded snapshots (replay / charting). */
export function snapshotSeries(snapshots = [], key = 'lastPrice') {
  return snapshots
    .filter((s) => s && (s[key] != null || s.l1))
    .map((s) => ({ at: s.at, value: s[key] ?? s.l1?.mid ?? null }))
    .filter((p) => p.value != null);
}

/** Convenience wrapper for stepping through a replay buffer. */
export function replayWindow(snapshots = [], index = 0, span = 30) {
  if (!snapshots.length) return { slice: [], index: 0, total: 0 };
  const max = snapshots.length - 1;
  const end = Math.max(0, Math.min(max, index));
  const start = Math.max(0, end - span + 1);
  return { slice: snapshots.slice(start, end + 1), index: end, total: snapshots.length };
}
