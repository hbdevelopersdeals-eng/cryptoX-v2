/* Liquidation heatmap helpers.
 *
 * Two honest data sources:
 *  1. Observed liquidations (live !forceOrder stream) bucketed by price level.
 *  2. An ESTIMATED cluster map derived from open interest and typical leverage
 *     bands — clearly labelled as an estimate, never presented as fact.
 */

export const LEVERAGE_BANDS = [5, 10, 25, 50, 100];

const num = (v) => (Number.isFinite(v) ? v : null);

/** Bucket observed liquidation events by price level. */
export function bucketLiquidations(events = [], { bins = 24, min = null, max = null } = {}) {
  const priced = events.filter((e) => num(e?.price) && num(e?.notional));
  if (!priced.length) return { rows: [], min: 0, max: 0 };
  const prices = priced.map((e) => e.price);
  const lo = min ?? Math.min(...prices);
  const hi = max ?? Math.max(...prices);
  const span = hi - lo || 1;
  const bucket = span / bins;
  const rows = Array.from({ length: bins }, (_, i) => ({
    price: lo + bucket * (i + 0.5),
    low: lo + bucket * i,
    high: lo + bucket * (i + 1),
    long: 0,
    short: 0,
    total: 0,
    count: 0
  }));
  priced.forEach((e) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((e.price - lo) / bucket)));
    const row = rows[idx];
    if (e.side === 'long_liquidation') row.long += e.notional;
    else row.short += e.notional;
    row.total += e.notional;
    row.count += 1;
  });
  return { rows, min: lo, max: hi };
}

/** Largest observed clusters, biggest first. */
export function clusterLevels(rows = [], topN = 5) {
  return [...rows]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, topN);
}

/**
 * Estimated liquidation density from open interest.
 * Assumes open interest spread across the given leverage bands, with the
 * liquidation level of each band placed relative to the mark price.
 * Returns normalised weights (0..1), not notional amounts.
 */
export function estimateHeatmap({ markPrice, openInterest = 0, bands = LEVERAGE_BANDS, levels = 40, spanPct = 30 } = {}) {
  const mark = num(markPrice);
  if (!mark) return { rows: [], estimated: true, totalWeight: 0 };
  const span = (mark * spanPct) / 100;
  const step = (span * 2) / levels;
  const rows = Array.from({ length: levels }, (_, i) => {
    const price = mark - span + step * (i + 0.5);
    return { price, long: 0, short: 0, total: 0 };
  });
  const perBand = openInterest / Math.max(1, bands.length);
  bands.forEach((lev, bi) => {
    const distance = mark / lev; // liquidation distance for that leverage
    const longLiq = mark - distance;
    const shortLiq = mark + distance;
    const weight = perBand * (1 - bi / (bands.length + 2)); // nearer bands hold more
    rows.forEach((row) => {
      const closenessLong = Math.max(0, 1 - Math.abs(row.price - longLiq) / (step * 1.5));
      const closenessShort = Math.max(0, 1 - Math.abs(row.price - shortLiq) / (step * 1.5));
      row.long += weight * closenessLong;
      row.short += weight * closenessShort;
      row.total = row.long + row.short;
    });
  });
  const peak = Math.max(...rows.map((r) => r.total), 1e-9);
  return {
    rows: rows.map((r) => ({ ...r, weight: r.total / peak })),
    estimated: true,
    totalWeight: peak
  };
}

/** Colour for an intensity 0..1 (dark → amber → red). */
export function heatColor(value, max = 1) {
  const v = Math.max(0, Math.min(1, max ? value / max : 0));
  if (v < 0.34) return `rgba(255,193,5,${0.15 + v * 0.5})`;
  if (v < 0.67) return `rgba(251,146,60,${0.35 + v * 0.4})`;
  return `rgba(248,113,113,${0.5 + v * 0.5})`;
}

/** Group a heatmap into a compact grid for canvas/SVG rendering. */
export function heatmapGrid(rows = [], cols = 12) {
  if (!rows.length) return [];
  const per = Math.ceil(rows.length / cols);
  const out = [];
  for (let i = 0; i < rows.length; i += per) {
    out.push(rows.slice(i, i + per));
  }
  return out;
}
