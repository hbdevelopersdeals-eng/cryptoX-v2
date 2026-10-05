/* Market intelligence helpers — pure and unit tested.
 * Input rows are CoinGecko /coins/markets records (already normalised to USD). */

export const MARKET_FIELDS = [
  'id', 'symbol', 'name', 'image', 'market_cap_rank', 'current_price',
  'market_cap', 'fully_diluted_valuation', 'total_volume', 'high_24h', 'low_24h',
  'ath', 'ath_date', 'atl', 'atl_date', 'circulating_supply', 'total_supply', 'max_supply',
  'price_change_percentage_1h_in_currency', 'price_change_percentage_24h_in_currency',
  'price_change_percentage_7d_in_currency', 'price_change_percentage_30d_in_currency',
  'price_change_percentage_1y_in_currency'
];

export const SECTOR_BUCKETS = [
  { id: 'layer1', label: 'Layer 1', match: [/layer 1/i, /layers?1/i, /smart contract platform/i, /proof of stake/i] },
  { id: 'layer2', label: 'Layer 2', match: [/layer 2/i, /layers?2/i, /rollup/i, /zero knowledge/i, /scaling/i] },
  { id: 'defi', label: 'DeFi', match: [/defi/i, /decentralized finance/i, /\bdex\b/i, /lending/i, /yield/i, /liquid staking/i] },
  { id: 'stablecoins', label: 'Stablecoins', match: [/stablecoin/i, /usd pegged/i] },
  { id: 'meme', label: 'Meme', match: [/meme/i, /dog/i, /cat/i] },
  { id: 'ai', label: 'AI', match: [/artificial intelligence/i, /\bai\b/i, /ai agent/i, /machine learning/i, /big data/i] },
  { id: 'depin', label: 'DePIN', match: [/depin/i, /physical infrastructure/i, /infrastructure network/i] },
  { id: 'rwa', label: 'RWA', match: [/real world assets?/i, /\brwa\b/i, /tokenized/i, /treasury/i] },
  { id: 'gaming', label: 'Gaming', match: [/gaming/i, /gamefi/i, /metaverse/i, /play to earn/i, /nft game/i] },
  { id: 'infrastructure', label: 'Infrastructure', match: [/infrastructure/i, /oracle/i, /interoperability/i, /storage/i, /privacy/i, /identity/i] }
];

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** FDV / market-cap ratio — >1 means future supply overhang. */
export function fdvRatio(fdv, marketCap) {
  const f = num(fdv);
  const m = num(marketCap);
  if (f == null || m == null || m <= 0) return null;
  return f / m;
}

/** How far below the all-time high the price sits, in percent. */
export function distanceFromAth(price, ath) {
  const p = num(price);
  const a = num(ath);
  if (p == null || a == null || a <= 0) return null;
  return ((a - p) / a) * 100;
}

/** Circulating share of max supply, in percent. */
export function supplyRatio(circulating, max) {
  const c = num(circulating);
  const m = num(max);
  if (c == null || m == null || m <= 0) return null;
  return Math.min(100, (c / m) * 100);
}

export function sortBy(list = [], key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = num(a?.[key]);
    const bv = num(b?.[key]);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sign;
  });
}

const byKey = (key) => (row) => num(row?.[key]) ?? -Infinity;

export function topGainers(list = [], n = 10) {
  return [...list]
    .filter((r) => num(r?.price_change_percentage_24h_in_currency) != null)
    .sort((a, b) => byKey('price_change_percentage_24h_in_currency')(b) - byKey('price_change_percentage_24h_in_currency')(a))
    .slice(0, n);
}

export function topLosers(list = [], n = 10) {
  return [...list]
    .filter((r) => num(r?.price_change_percentage_24h_in_currency) != null)
    .sort((a, b) => byKey('price_change_percentage_24h_in_currency')(a) - byKey('price_change_percentage_24h_in_currency')(b))
    .slice(0, n);
}

export function topVolume(list = [], n = 10) {
  return sortBy(list.filter((r) => num(r?.total_volume) != null), 'total_volume', 'desc').slice(0, n);
}

export function searchCoins(list = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((r) => String(r?.name || '').toLowerCase().includes(q) || String(r?.symbol || '').toLowerCase().includes(q));
}

/** Group CoinGecko categories into the requested sector buckets. */
export function bucketCategories(categories = []) {
  return SECTOR_BUCKETS.map((bucket) => {
    const matched = categories.filter((c) => bucket.match.some((re) => re.test(String(c?.name || ''))));
    const marketCap = matched.reduce((acc, c) => acc + (num(c.market_cap) || 0), 0);
    const volume = matched.reduce((acc, c) => acc + (num(c.volume_24h) || 0), 0);
    const weighted = matched.reduce(
      (acc, c) => acc + ((num(c.market_cap_change_24h) || 0) * (num(c.market_cap) || 0) / (marketCap || 1)),
      0
    );
    return {
      id: bucket.id,
      label: bucket.label,
      marketCap,
      volume,
      change24h: marketCap > 0 ? weighted : null,
      count: matched.length,
      members: matched.map((c) => c.name).slice(0, 6)
    };
  }).filter((b) => b.count > 0);
}

/** Supply/valuation view for the detail table. */
export function valuationRow(row) {
  return {
    id: row.id,
    symbol: String(row.symbol || '').toUpperCase(),
    name: row.name,
    price: num(row.current_price),
    marketCap: num(row.market_cap),
    fdv: num(row.fully_diluted_valuation),
    fdvRatio: fdvRatio(row.fully_diluted_valuation, row.market_cap),
    circulating: num(row.circulating_supply),
    total: num(row.total_supply),
    max: num(row.max_supply),
    supplyPct: supplyRatio(row.circulating_supply, row.max_supply),
    ath: num(row.ath),
    athDate: row.ath_date || null,
    belowAthPct: distanceFromAth(row.current_price, row.ath),
    atl: num(row.atl),
    perf30d: num(row.price_change_percentage_30d_in_currency),
    perf1y: num(row.price_change_percentage_1y_in_currency)
  };
}

export function universeStats(list = []) {
  const caps = list.map((r) => num(r?.market_cap)).filter((v) => v != null);
  const vols = list.map((r) => num(r?.total_volume)).filter((v) => v != null);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  return {
    coins: list.length,
    totalMarketCap: sum(caps),
    totalVolume: sum(vols),
    gainers: list.filter((r) => (num(r?.price_change_percentage_24h_in_currency) || 0) > 0).length,
    losers: list.filter((r) => (num(r?.price_change_percentage_24h_in_currency) || 0) < 0).length
  };
}
