/* Exchange aggregator: best buy/sell venues, global average, cross-venue
 * arbitrage and a venue leaderboard — built from the normalized last-price
 * quotes of the market-data layer. Pure functions — unit tested.
 *
 * IMPORTANT — these quotes are cross-venue LAST TRADES, not order-book sides.
 * A real order book always has bestAsk >= bestBid; here the highest venue price
 * is the best place to SELL and the lowest venue price is the best place to BUY.
 * The API is therefore named bestBuy / bestSell rather than bid / ask to avoid
 * implying a book that does not exist.
 *
 * Arbitrage figures here are GROSS price differences between public tickers.
 * They ignore depth, latency, withdrawal limits and transfer costs, so a
 * positive net figure is an indicator to investigate, not a tradeable edge.
 */

const num = (v) => (Number.isFinite(v) ? v : null);

const positive = (q) => {
  const p = num(q?.price);
  return p != null && p > 0;
};

/**
 * Best venue to buy (lowest price) and to sell (highest price) for one asset.
 * spread is always >= 0; spreadPct is the spread relative to the mid price.
 */
export function bestQuotes(quotes = []) {
  const valid = (quotes || []).filter(positive);
  if (!valid.length) return { bestBuy: null, bestSell: null, spread: null, spreadPct: null, venues: 0 };
  const bestBuy = valid.reduce((a, b) => (b.price < a.price ? b : a));
  const bestSell = valid.reduce((a, b) => (b.price > a.price ? b : a));
  const spread = bestSell.price - bestBuy.price;
  const mid = (bestSell.price + bestBuy.price) / 2;
  return {
    bestBuy: { venue: bestBuy.venue, price: bestBuy.price },
    bestSell: { venue: bestSell.venue, price: bestSell.price },
    spread,
    spreadPct: mid ? (spread / mid) * 100 : null,
    venues: valid.length
  };
}

/**
 * Mean / median of the venue prices plus dispersion, where dispersion is the
 * full range expressed as a percentage of the LOWEST venue price (the price a
 * buyer would actually pay at the best venue).
 */
export function globalAverage(quotes = []) {
  const prices = (quotes || []).map((q) => num(q?.price)).filter((p) => p != null && p > 0);
  if (!prices.length) return { mean: null, median: null, dispersionPct: null, count: 0 };
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const lowest = sorted[0];
  const dispersionPct = lowest ? ((sorted[sorted.length - 1] - lowest) / lowest) * 100 : null;
  return { mean, median, dispersionPct, count: prices.length };
}

/**
 * Cross-venue arbitrage candidates.
 * grossPct = (sell - buy) / buy * 100
 * netPct   = grossPct - round-trip fees (taker on both legs)
 */
export function arbitrageOpportunities(quotes = [], { minGrossPct = 0.05, feePct = 0.1 } = {}) {
  const valid = (quotes || []).filter(positive);
  if (valid.length < 2) return [];
  const out = [];
  for (const buy of valid) {
    for (const sell of valid) {
      if (buy.venue === sell.venue) continue;
      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      if (grossPct < minGrossPct) continue;
      out.push({
        buyVenue: buy.venue,
        sellVenue: sell.venue,
        buyPrice: buy.price,
        sellPrice: sell.price,
        grossPct,
        netPct: grossPct - feePct * 2,
        notionalPer10k: (grossPct / 100) * 10000
      });
    }
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

/** Per-venue stats across all assets: coverage, average spread, best-price wins. */
export function venueLeaderboard(assetRows = []) {
  const stats = new Map();
  (assetRows || []).forEach((row) => {
    const quotes = row?.quotes || [];
    if (!quotes.length) return;
    const { bestBuy, bestSell } = bestQuotes(quotes);
    const mid = bestBuy && bestSell ? (bestBuy.price + bestSell.price) / 2 : null;
    quotes.forEach((q) => {
      if (!positive(q)) return;
      const entry = stats.get(q.venue) || { venue: q.venue, assets: 0, spreadBpsTotal: 0, wins: 0, volumeUsd: 0, volumeUnit: VOLUME_UNIT[q.venue] ?? 'unknown' };
      entry.assets += 1;
      if (mid) entry.spreadBpsTotal += Math.abs((q.price - mid) / mid) * 10000;
      if (bestBuy?.venue === q.venue || bestSell?.venue === q.venue) entry.wins += 1;
      // Only comparable (quote-currency) volume is accumulated.
      if (VOLUME_UNIT[q.venue] === 'quote') {
        const v = num(q.volumeQuote);
        if (v != null && v > 0) entry.volumeUsd += v;
      }
      stats.set(q.venue, entry);
    });
  });
  return [...stats.values()]
    .map((s) => ({
      ...s,
      avgSpreadBps: s.assets ? s.spreadBpsTotal / s.assets : null,
      volumeUsd: s.volumeUsd > 0 ? s.volumeUsd : null
    }))
    .sort((a, b) => b.wins - a.wins || a.avgSpreadBps - b.avgSpreadBps);
}

/**
 * What each venue's `volumeQuote` field actually represents, so 24h volume is
 * never totalled across incompatible units.
 *   'quote'   — already in quote currency (USD/USDT); safe to total
 *   'base'    — denominated in the BASE asset; NOT comparable to the above
 *   'unknown' — field semantics vary; excluded from totals
 *   null      — the endpoint we call does not publish volume at all
 */
export const VOLUME_UNIT = {
  binance: 'quote',   // quoteVolume
  kraken: 'quote',    // volBase × last
  bybit: 'quote',     // turnover24h
  kucoin: 'quote',    // volValue
  bitget: 'quote',    // quoteVolume
  gate: 'quote',      // quote_volume
  mexc: 'quote',      // quoteVolume
  okx: 'base',        // volCcy24h — base asset for spot
  htx: 'base',        // amount — base asset
  cryptocom: 'unknown',
  coinbase: null,
  gemini: null,
  bitfinex: null,
  deribit: null,
  dexscreener: null   // publishes on-chain pool liquidity instead
};

/**
 * Per-exchange price comparison for every asset: one column per venue, plus a
 * cross-venue average and the spread between the cheapest and dearest venue.
 */
export function priceMatrix(rows = [], { venueIds = null } = {}) {
  const ids = venueIds && venueIds.length
    ? [...venueIds]
    : [...new Set((rows || []).flatMap((r) => (r.quotes || []).map((q) => q.venue)))];

  const out = (rows || []).map((row) => {
    const prices = {};
    ids.forEach((id) => { prices[id] = null; });
    (row.quotes || []).filter(positive).forEach((q) => { prices[q.venue] = q.price; });

    const values = ids.map((id) => prices[id]).filter((v) => v != null);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const lowest = values.length ? Math.min(...values) : null;
    const highest = values.length ? Math.max(...values) : null;

    return {
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      prices,
      venueCount: values.length,
      average,
      lowest,
      highest,
      lowestVenue: values.length ? ids.find((id) => prices[id] === lowest) : null,
      highestVenue: values.length ? ids.find((id) => prices[id] === highest) : null,
      // Mid-based, matching bestQuotes().spreadPct so "spread %" means the same
      // thing everywhere in the app (it is NOT the lowest-based dispersion %).
      spreadPct: lowest != null && highest != null ? ((highest - lowest) / ((highest + lowest) / 2)) * 100 : null
    };
  });

  return { venueIds: ids, rows: out };
}

/**
 * Volume + liquidity coverage for one asset.
 *
 * IMPORTANT: order-book depth is not published by these public tickers, so this
 * reports *coverage and reported volume*, never a depth score. Venues whose
 * volume unit is not comparable are listed by name instead of being summed.
 */
export function liquidityProfile(quotes = []) {
  const valid = (quotes || []).filter(positive);

  const venues = valid.map((q) => {
    const unit = Object.prototype.hasOwnProperty.call(VOLUME_UNIT, q.venue) ? VOLUME_UNIT[q.venue] : 'unknown';
    return {
      venue: q.venue,
      price: q.price,
      volumeUnit: unit || 'none',
      reportedVolumeUsd: unit === 'quote' ? num(q.volumeQuote) : null,
      liquidityUsd: num(q.liquidityUsd)
    };
  });

  const withVolume = venues.filter((v) => v.reportedVolumeUsd != null && v.reportedVolumeUsd > 0);
  const totalVolumeUsd = withVolume.reduce((a, b) => a + b.reportedVolumeUsd, 0);
  const ranked = [...withVolume].sort((a, b) => b.reportedVolumeUsd - a.reportedVolumeUsd);
  const top = ranked[0];
  const poolLiquidity = venues.reduce((a, v) => a + (v.liquidityUsd || 0), 0);

  return {
    venues,
    venuesQuoted: valid.length,
    volumeVenues: withVolume.length,
    totalVolumeUsd: totalVolumeUsd || null,
    topVenue: top ? top.venue : null,
    topSharePct: top && totalVolumeUsd ? (top.reportedVolumeUsd / totalVolumeUsd) * 100 : null,
    nonComparableVenues: venues.filter((v) => v.volumeUnit !== 'quote').map((v) => v.venue),
    poolLiquidityUsd: poolLiquidity || null,
    depthDisclosed: false
  };
}

/**
 * Best execution venue for one side of the trade: the venue with the most
 * favourable price, plus how that price compares to the cross-venue average.
 */
export function bestExecutionVenue(quotes = [], { side = 'buy' } = {}) {
  const valid = (quotes || []).filter(positive);
  if (!valid.length) {
    return { side, venue: null, price: null, average: null, deltaPct: null, considered: 0, volumeVenues: 0, reportedVolumeUsd: null, note: 'no quotes' };
  }

  const average = valid.reduce((a, q) => a + q.price, 0) / valid.length;
  const pick = valid.reduce((a, b) => (side === 'sell' ? (b.price > a.price ? b : a) : (b.price < a.price ? b : a)));

  const withVolume = valid.filter((q) => VOLUME_UNIT[q.venue] === 'quote' && num(q.volumeQuote) > 0);
  const pickVolume = withVolume.find((q) => q.venue === pick.venue);

  return {
    side,
    venue: pick.venue,
    price: pick.price,
    average,
    deltaPct: average ? ((pick.price - average) / average) * 100 : null,
    considered: valid.length,
    volumeVenues: withVolume.length,
    reportedVolumeUsd: pickVolume ? num(pickVolume.volumeQuote) : null,
    note: withVolume.length
      ? 'cheapest/most favourable price; volume reported by this venue'
      : 'best price only — venue volume not comparable across sources'
  };
}

/** Mean / median / dispersion across every venue price of every asset. */
export function globalAverageAcrossAssets(perAsset = []) {
  const prices = (perAsset || []).flatMap((r) => (r.quotes || []).filter(positive).map((q) => q.price));
  if (!prices.length) return { mean: null, median: null, dispersionPct: null, count: 0, assets: 0 };
  const g = globalAverage(prices.map((p) => ({ price: p })));
  return { ...g, assets: (perAsset || []).length };
}

/** Full aggregation pass used by the UI. */
export function aggregateVenues(rows = [], { assetMeta = () => ({}), arbitrage = {} } = {}) {
  const perAsset = (rows || []).map((row) => {
    const quotes = row.quotes || [];
    return {
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      ...assetMeta(row.assetId),
      quotes: [...quotes].sort((a, b) => b.price - a.price),
      best: bestQuotes(quotes),
      average: globalAverage(quotes),
      liquidity: liquidityProfile(quotes),
      execution: {
        buy: bestExecutionVenue(quotes, { side: 'buy' }),
        sell: bestExecutionVenue(quotes, { side: 'sell' })
      },
      opportunities: arbitrageOpportunities(quotes, arbitrage)
    };
  });
  const opportunities = perAsset
    .flatMap((row) => row.opportunities.map((o) => ({ ...o, assetId: row.assetId, symbol: row.symbol })))
    .sort((a, b) => b.netPct - a.netPct);
  return { perAsset, opportunities, leaderboard: venueLeaderboard(rows) };
}

export function summariseAggregate(result) {
  const withVenues = result?.perAsset?.filter((r) => r.best?.venues > 1) || [];
  const profitable = (result?.opportunities || []).filter((o) => o.netPct > 0);
  const tightest = withVenues.reduce(
    (best, r) => (r.best.spreadPct != null && (best == null || r.best.spreadPct < best.best.spreadPct) ? r : best),
    null
  );
  const totalVolumeUsd = (result?.perAsset || [])
    .reduce((a, r) => a + (r.liquidity?.totalVolumeUsd || 0), 0);
  const poolLiquidityUsd = (result?.perAsset || [])
    .reduce((a, r) => a + (r.liquidity?.poolLiquidityUsd || 0), 0);

  // Mean cross-venue spread across multi-venue assets: a real market-structure
  // measure. (Averaging the *prices* of different coins would mean nothing, so
  // that is deliberately not a headline figure.)
  const spreads = withVenues.map((r) => r.best?.spreadPct).filter((v) => v != null);
  const avgCrossVenueSpreadPct = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;

  return {
    assets: result?.perAsset?.length || 0,
    multiVenueAssets: withVenues.length,
    opportunities: result?.opportunities?.length || 0,
    profitableAfterFees: profitable.length,
    bestNetPct: profitable.length ? profitable[0].netPct : null,
    tightestSpread: tightest ? { symbol: tightest.symbol || tightest.assetId, spreadPct: tightest.best.spreadPct } : null,
    avgCrossVenueSpreadPct,
    global: globalAverageAcrossAssets(result?.perAsset || []),
    comparableVolumeUsd: totalVolumeUsd || null,
    poolLiquidityUsd: poolLiquidityUsd || null
  };
}
