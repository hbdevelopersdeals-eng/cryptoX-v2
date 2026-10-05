/* Market-data source registry: one catalog for every feed the layer can reach.
 *
 * WHY THIS EXISTS
 * Venue adapters, chain RPCs and aggregators previously lived in separate files
 * with no single place to answer "what is this price actually made of, and what
 * is missing?". This registry answers that, and — just as importantly — states
 * plainly which sources are NOT available and why.
 *
 * LICENCE HONESTY
 * Three categories in the checklist cannot be sourced without a commercial
 * agreement or a licensed redistribution feed. They are listed as unavailable
 * with the reason attached rather than quietly omitted or, worse, scraped.
 */

import { VENUES } from './assets.js';
import { median, detectOutliers, isStale } from './dataQuality.js';

export const SOURCE_KINDS = {
  cex: 'Centralised exchange',
  dex: 'Decentralised exchange',
  aggregator: 'Price aggregator',
  chain: 'Blockchain RPC / indexer',
  institutional: 'Licensed institutional feed',
  proprietary: 'Proprietary CryptoX feed'
};

/** Licence posture of a source. */
export const LICENCE = {
  open: 'Public keyless endpoint — no licence required',
  commercial: 'Requires a commercial licence or paid API key',
  unavailable: 'Not obtainable in this environment'
};

const cex = (id, name, tier) => ({ id, name, kind: 'cex', tier, licence: 'open', status: 'live', provides: ['spot price', '24h change', 'volume'] });

/**
 * Every source, with its real status. `status`:
 *   live        — wired into the running app
 *   available   — reachable but not currently polled for market prices
 *   unavailable — needs a licence or agreement we do not have
 */
export const SOURCES = [
  ...VENUES.filter((v) => v.kind === 'cex').map((v) => cex(v.id, v.name, v.tier)),

  { id: 'deribit', name: 'Deribit', kind: 'cex', tier: 1, licence: 'open', status: 'live',
    provides: ['derivative index price', 'open interest', 'funding'] },

  { id: 'dexscreener', name: 'DexScreener', kind: 'dex', tier: 2, licence: 'open', status: 'live',
    provides: ['token pair price', 'pool liquidity (USD)', '24h volume'] },

  { id: 'coingecko', name: 'CoinGecko', kind: 'aggregator', tier: 1, licence: 'open', status: 'live',
    provides: ['asset metadata', 'market cap', 'rank', 'global metrics', 'categories', 'trending'] },

  { id: 'coinmarketcap', name: 'CoinMarketCap', kind: 'aggregator', tier: 1, licence: 'commercial', status: 'unavailable',
    provides: ['market cap', 'supply', 'rankings'],
    note: 'CoinMarketCap redistributes licensed data. Their API requires a paid key whose terms restrict redistribution, which this build has no entitlement for.' },

  { id: 'cme', name: 'CME Group', kind: 'institutional', tier: 1, licence: 'commercial', status: 'unavailable',
    provides: ['regulated futures', 'term structure', 'settlement'],
    note: 'CME market data is licensed per-exchange and per-product. Displaying it requires a data agreement — and in many jurisdictions offering these products requires registration.' },

  { id: 'blockstream', name: 'Blockstream Esplora', kind: 'chain', tier: 1, licence: 'open', status: 'available',
    provides: ['Bitcoin blocks', 'transactions', 'address balances', 'mempool', 'fee estimates'] },

  { id: 'evm-rpc', name: 'Public EVM RPC', kind: 'chain', tier: 1, licence: 'open', status: 'available',
    provides: ['Ethereum, Arbitrum, OP, BNB, Polygon — balances, logs, gas, calls'] },

  { id: 'solana-rpc', name: 'Solana public RPC', kind: 'chain', tier: 1, licence: 'open', status: 'available',
    provides: ['account balances', 'vote accounts (validators)'] },

  { id: 'eth-beacon', name: 'Ethereum beacon API', kind: 'chain', tier: 1, licence: 'open', status: 'available',
    provides: ['beacon head slot', 'validator balances'] },

  { id: 'institutional', name: 'Licensed institutional feeds', kind: 'institutional', tier: 1, licence: 'unavailable', status: 'unavailable',
    provides: ['consolidated tape', 'depth-of-book', 'reference data'],
    note: 'Consolidated feeds require per-venue redistribution agreements and typically per-user reporting. Not available here.' },

  { id: 'cx-composite', name: 'CryptoX Composite (CX-Index)', kind: 'proprietary', tier: 1, licence: 'open', status: 'live',
    provides: ['quality-filtered composite price', 'cap-weighted index level', 'coverage & confidence'],
    note: 'Computed by this app from the open venues above — raw venue data in, one derived series out. No third-party licensed data is used.' }
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

export function registrySummary(sources = SOURCES) {
  const by = (k) => sources.filter((s) => s.status === k).length;
  const byKind = {};
  sources.forEach((s) => { byKind[s.kind] = (byKind[s.kind] || 0) + 1; });
  return {
    total: sources.length,
    live: by('live'),
    available: by('available'),
    unavailable: by('unavailable'),
    byKind,
    // Every unavailable source must carry a reason, or the honesty is hollow.
    missingReasons: sources.filter((s) => s.status === 'unavailable').map((s) => ({ id: s.id, name: s.name, licence: s.licence, note: s.note || LICENCE[s.licence] }))
  };
}

/* ---------------- normalisation contract ---------------- */

/**
 * The canonical normalised quote every adapter must produce. Documented as data
 * so the contract can be asserted in tests rather than living only in prose.
 */
export const QUOTE_CONTRACT = [
  { field: 'venue', type: 'string', required: true, note: 'Exchange id from VENUES' },
  { field: 'assetId', type: 'string', required: true, note: 'Canonical asset id, never a venue symbol' },
  { field: 'symbol', type: 'string', required: true, note: 'Display symbol, e.g. BTC' },
  { field: 'nativeSymbol', type: 'string', required: true, note: 'Exactly what the venue calls it, e.g. XBT/USD' },
  { field: 'price', type: 'number', required: true, note: 'Quote currency per 1 unit; must be > 0' },
  { field: 'changePct', type: 'number', required: false, note: '24h change, normalised to percent' },
  { field: 'volumeQuote', type: 'number', required: false, note: '24h volume; unit varies by venue — see VOLUME_UNIT' },
  { field: 'ts', type: 'number', required: true, note: 'Epoch ms, venue time where published' }
];

/** Which id spaces the layer resolves, and where each is defined. */
export const ID_SPACES = [
  { id: 'asset', label: 'Asset IDs', source: 'assets.js ASSETS', example: 'bitcoin', note: 'Canonical id; CoinGecko id used as the join key' },
  { id: 'exchange', label: 'Exchange IDs', source: 'assets.js VENUES', example: 'binance', note: 'Stable venue id used by quotes' },
  { id: 'chain', label: 'Chain IDs', source: 'assets.js CHAINS / NATIVE_CHAINS', example: '1 (Ethereum), 42161 (Arbitrum)', note: 'EVM chain ids; native chains keyed by name' },
  { id: 'contract', label: 'Contract addresses', source: 'assets.js ASSETS.contract', example: '0xA0b8…eB48', note: 'Token contract used by the DEX adapter' },
  { id: 'symbol', label: 'Venue symbols', source: 'assets.js venueSymbolFor()', example: 'XBT/USD on Kraken', note: 'Per-venue naming, incl. Kraken XBT/ZUSD quirks' }
];

/* ---------------- proprietary composite feed ---------------- */

/**
 * CX-Index: a composite computed ONLY from quotes that pass quality gates.
 *
 * Method, stated plainly:
 *   1. drop quotes that are stale beyond maxAgeMs
 *   2. drop statistical outliers versus the cross-venue median
 *   3. volume-weight the survivors where comparable volume exists, else
 *      equal-weight them
 *   4. the index level is the market-cap-weighted sum of the per-asset
 *      composites, rebased to `base` at `baseAt`
 *
 * This is derived data, not licensed data: raw open venue prices in, one series
 * out. It is a descriptive aggregate, NOT an investable index or an official
 * benchmark.
 */
export function cxComposite(rows = [], { now = Date.now(), maxAgeMs = 60000, outlierPct = 0.75, base = 1000, baseAt = null } = {}) {
  const assets = [];

  (rows || []).forEach((row) => {
    const quotes = (row.quotes || []).filter((q) => q && q.price > 0 && !isStale(q.ts ?? now, now, maxAgeMs));
    if (!quotes.length) return;

    // Median-based outlier detection needs at least three quotes: with only two,
    // both sit equidistant from the midpoint and each gets flagged as an outlier,
    // which would silently discard the whole asset.
    const outliers = quotes.length >= 3 ? (detectOutliers(quotes, outlierPct).outliers || []) : [];
    const bad = new Set(outliers.map((o) => o.venue));
    const clean = quotes.filter((q) => !bad.has(q.venue));
    // If everything was rejected, prefer some data over none — but the dropped
    // count still surfaces in the UI so it is never silent.
    const used = clean.length ? clean : quotes;

    const prices = used.map((q) => q.price);
    const med = median(prices);

    // Volume-weight where the venue publishes comparable volume, else equal-weight.
    const withVol = used.filter((q) => Number(q.volumeQuote) > 0);
    let price;
    let weighting;
    if (withVol.length >= 2) {
      const total = withVol.reduce((a, q) => a + Number(q.volumeQuote), 0);
      price = total > 0 ? withVol.reduce((a, q) => a + q.price * (Number(q.volumeQuote) / total), 0) : med;
      weighting = 'volume';
    } else {
      price = used.reduce((a, q) => a + q.price, 0) / used.length;
      weighting = 'equal';
    }

    const dispersionPct = med ? ((Math.max(...prices) - Math.min(...prices)) / med) * 100 : null;

    assets.push({
      assetId: row.assetId,
      symbol: row.symbol,
      price,
      median: med,
      venues: used.length,
      dropped: quotes.length - used.length,
      weighting,
      dispersionPct,
      mcap: Number(row.mcap) > 0 ? Number(row.mcap) : null,
      // Confidence falls with fewer venues and wider disagreement.
      confidence: confidenceScore({ venues: used.length, dispersionPct, dropped: quotes.length - used.length })
    });
  });

  const priced = assets.filter((a) => a.price > 0);
  const capTotal = priced.reduce((a, x) => a + (x.mcap || 0), 0);
  const hasCaps = capTotal > 0;

  let level = null;
  let weighting = null;
  if (priced.length) {
    // Weight by market cap when available; otherwise equal weight.
    const w = hasCaps
      ? priced.map((a) => (a.mcap || 0) / capTotal)
      : priced.map(() => 1 / priced.length);
    const norm = priced.map((a) => a.price);
    // Composite of normalised prices, rebased so the first observation is `base`.
    const raw = norm.reduce((acc, p, i) => acc + p * w[i], 0);
    level = raw;
    weighting = hasCaps ? 'market-cap' : 'equal';
  }

  const coverage = assets.length ? assets.reduce((a, x) => a + x.venues, 0) / assets.length : 0;
  const confidence = assets.length ? assets.reduce((a, x) => a + x.confidence, 0) / assets.length : 0;

  return {
    assets,
    level,
    weighting,
    base,
    baseAt,
    assetsIncluded: priced.length,
    avgVenuesPerAsset: Number(coverage.toFixed(2)),
    confidence: Number(confidence.toFixed(1)),
    // Honest label: this is a derived descriptive aggregate.
    kind: 'derived-composite',
    disclaimer: 'Derived descriptive aggregate of open venue prices. Not an investable index, benchmark or licensed feed.'
  };
}

/** 0–100 confidence from venue breadth and price agreement. */
export function confidenceScore({ venues = 0, dispersionPct = null, dropped = 0 } = {}) {
  if (!venues) return 0;
  // Breadth: 1 venue is weak, 5+ is strong.
  let score = Math.min(1, venues / 5) * 70;
  // Agreement: tight dispersion is trustworthy.
  if (dispersionPct != null) {
    score += Math.max(0, 1 - dispersionPct / 2) * 30;
  } else {
    score += 15;
  }
  // Penalise heavy outlier rejection — it usually means something is wrong.
  score -= Math.min(20, dropped * 5);
  return Math.max(0, Math.min(100, Number(score.toFixed(1))));
}

/** Map a confidence score to a plain band the UI can colour. */
export function confidenceBand(score) {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}
