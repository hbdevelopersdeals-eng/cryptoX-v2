/* Cross-source data quality: consensus, outlier rejection, staleness and
 * source confidence scoring. Pure functions — fully unit tested.
 *
 * Confidence model (0–100), documented so it can be audited:
 *   base     = venue tier 1 ? 55 : 45            (exchange quality tier)
 *   fresh    = max(0, 25 - ageSeconds / 4)       (25 pts at 0s, 0 at 100s)
 *   coverage = min(20, 4 * quotesReturned)       (breadth of the response)
 *   agreement= up to 10, scaled by how close the venue is to the consensus
 * A source that errors scores 0 and is reported as unavailable.
 */

export function median(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function deviationPct(value, reference) {
  if (typeof value !== 'number' || typeof reference !== 'number' || !reference) return null;
  return Math.abs((value - reference) / reference) * 100;
}

export function isStale(timestamp, now = Date.now(), maxAgeMs = 60000) {
  if (!timestamp) return true;
  return now - timestamp > maxAgeMs;
}

/** Quotes deviating from the median by more than `thresholdPct` are outliers. */
export function detectOutliers(quotes = [], thresholdPct = 0.75) {
  const clean = quotes.filter((q) => typeof q?.price === 'number' && Number.isFinite(q.price) && q.price > 0);
  const ref = median(clean.map((q) => q.price));
  if (ref == null) return { reference: null, outliers: [], kept: [] };
  const outliers = [];
  const kept = [];
  clean.forEach((q) => {
    const dev = deviationPct(q.price, ref);
    if (dev != null && dev > thresholdPct) outliers.push({ ...q, deviationPct: dev });
    else kept.push({ ...q, deviationPct: dev });
  });
  return { reference: ref, outliers, kept };
}

export function sourceConfidence({ tier = 2, ageSeconds = 0, quotesReturned = 0, agreementPct = null, failed = false }) {
  if (failed) return 0;
  const base = tier === 1 ? 55 : 45;
  const fresh = Math.max(0, 25 - ageSeconds / 4);
  const coverage = Math.min(20, 4 * quotesReturned);
  const agreement = agreementPct == null ? 0 : Math.max(0, Math.min(10, 10 - agreementPct));
  return Math.round(Math.max(0, Math.min(100, base + fresh + coverage + agreement)));
}

/** Aggregate every quote for one asset into a consensus row. */
export function aggregateAsset(assetId, quotes = [], { now = Date.now(), maxAgeMs = 60000, outlierPct = 0.75 } = {}) {
  const fresh = quotes.filter((q) => !isStale(q.ts, now, maxAgeMs));
  const stale = quotes.filter((q) => isStale(q.ts, now, maxAgeMs));
  const { reference, outliers, kept } = detectOutliers(fresh, outlierPct);
  const prices = kept.map((q) => q.price);
  const consensus = median(prices);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const spreadPct = min && max ? ((max - min) / min) * 100 : null;
  const avgDeviation = kept.length
    ? kept.reduce((acc, q) => acc + (q.deviationPct || 0), 0) / kept.length
    : null;

  let confidence = 0;
  if (consensus != null) {
    const base = Math.min(70, 25 * kept.length);
    const tight = spreadPct == null ? 0 : Math.max(0, 30 - spreadPct * 10);
    confidence = Math.round(Math.max(0, Math.min(100, base + tight)));
  }

  return {
    assetId,
    consensus,
    min,
    max,
    spreadPct,
    sources: kept.length,
    totalQuotes: quotes.length,
    staleCount: stale.length,
    outliers,
    quotes: kept,
    avgDeviationPct: avgDeviation,
    confidence
  };
}

export function qualitySummary(rows = [], sources = []) {
  return {
    assets: rows.length,
    assetsWithConsensus: rows.filter((r) => r.consensus != null).length,
    sourcesLive: sources.filter((s) => s.status === 'live').length,
    sourcesDown: sources.filter((s) => s.status !== 'live').length,
    outliersFlagged: rows.reduce((acc, r) => acc + (r.outliers?.length || 0), 0),
    staleRejected: rows.reduce((acc, r) => acc + (r.staleCount || 0), 0),
    quotesIngested: rows.reduce((acc, r) => acc + (r.totalQuotes || 0), 0),
    duplicatesMerged: rows.reduce((acc, r) => acc + Math.max(0, (r.totalQuotes || 0) - (r.quotes?.length || 0)), 0)
  };
}
