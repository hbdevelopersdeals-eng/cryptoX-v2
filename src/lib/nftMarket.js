/* NFT market data and analytics.
 *
 * Source: CoinGecko's public NFT endpoints — keyless, but on the same free-tier
 * quota as the rest of the app, so a 429 is common and is surfaced as a
 * rate-limit message rather than being rendered as "no collections".
 *
 * WHAT CANNOT BE SOURCED keylessly, and why:
 *   marketplace (listing/bidding) — OpenSea, Blur and Reservoir all require keys
 *   rarity / traits              — needs per-token metadata for the whole supply
 *   sales history                — needs an indexer over every Transfer log
 *   ownership beyond a balance   — needs the same indexer
 * Those are declared, never estimated.
 */

const CG = 'https://api.coingecko.com/api/v3';

export const NFT_CAPABILITIES = [
  { id: 'marketplace', label: 'NFT marketplace', status: 'unavailable', note: 'Listing and bidding data needs an OpenSea / Blur / Reservoir key.' },
  { id: 'portfolio', label: 'NFT portfolio', status: 'supported', note: 'Owned counts (on-chain balanceOf) valued at live floor price.' },
  { id: 'floor', label: 'Floor price', status: 'supported', note: 'Live floor per collection.' },
  { id: 'volume', label: 'Volume', status: 'supported', note: '24h volume plus market cap.' },
  { id: 'collections', label: 'Collections', status: 'supported', note: 'Ranked collection list across chains.' },
  { id: 'rarity', label: 'Rarity', status: 'unavailable', note: 'Needs every token\u2019s traits for the full supply; not published keylessly.' },
  { id: 'traits', label: 'Traits', status: 'unavailable', note: 'Same constraint as rarity \u2014 requires a full metadata index.' },
  { id: 'ownership', label: 'Ownership', status: 'partial', note: 'Balance per collection is readable on-chain; a full inventory needs an indexer.' },
  { id: 'sales', label: 'Sales history', status: 'unavailable', note: 'Requires an indexer over all Transfer logs; public RPC serves bounded ranges only.' },
  { id: 'analytics', label: 'NFT analytics', status: 'supported', note: 'Derived here: floor-to-volume turnover, market cap coverage.' },
  { id: 'multichain', label: 'Multi-chain NFTs', status: 'supported', note: 'Collections carry their asset platform, so chains can be compared.' }
];

const j = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429) return { ok: false, rateLimited: true, error: 'CoinGecko rate limit reached — the free tier shares a quota with the rest of the app. Try again in a minute.' };
  if (!res.ok) return { ok: false, error: `CoinGecko returned HTTP ${res.status}` };
  const data = await res.json();
  return { ok: true, data };
};

/* ---------------- fetch ---------------- */

export async function fetchNftMarkets({ perPage = 50, page = 1, order = 'market_cap_usd_desc' } = {}) {
  const r = await j(`${CG}/nfts/markets?per_page=${perPage}&page=${page}&order=${order}`);
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function fetchNftList({ perPage = 100 } = {}) {
  const r = await j(`${CG}/nfts/list?per_page=${perPage}`);
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function fetchNftCollection(id) {
  const r = await j(`${CG}/nfts/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}

export async function fetchNftByContract(platform, address) {
  const r = await j(`${CG}/nfts/${encodeURIComponent(platform)}/contract/${encodeURIComponent(address)}`);
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}

/* ---------------- pure analytics ---------------- */

const num = (v) => {
  const x = typeof v === 'object' && v !== null ? v.usd ?? v.native ?? null : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

export function normaliseCollection(c) {
  const floor = num(c?.floor_price);
  const vol = num(c?.volume_24h);
  const mcap = num(c?.market_cap);
  return {
    id: c?.id ?? null,
    name: c?.name ?? 'Unknown',
    symbol: c?.symbol ?? null,
    platform: c?.asset_platform_id ?? 'unknown',
    contract: c?.contract_address ?? null,
    floor,
    volume24h: vol,
    mcap,
    change24h: num(c?.floor_price_24h_percentage_change),
    // Turnover: how many times the collection's floor value changes hands daily.
    turnover: floor && vol ? vol / (floor * (mcap && floor ? mcap / floor : 1) || 1) : null,
    // How many times the floor price the daily volume represents.
    volToFloorMultiple: floor && vol ? vol / floor : null,
    image: c?.image?.small ?? c?.image ?? null,
    updatedAt: c?.updated_at ?? null
  };
}

export function topCollections(collections = [], { limit = 24, platform = null, minMcap = 0 } = {}) {
  return collections
    .map(normaliseCollection)
    .filter((c) => (platform ? c.platform === platform : true))
    .filter((c) => (c.mcap ?? 0) >= minMcap)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
    .slice(0, limit);
}

/** Group collections by chain so multi-chain coverage is visible. */
export function byPlatform(collections = []) {
  const rows = collections.map(normaliseCollection);
  const map = new Map();
  rows.forEach((c) => {
    const cur = map.get(c.platform) || { platform: c.platform, collections: 0, mcap: 0, volume24h: 0 };
    cur.collections += 1;
    cur.mcap += c.mcap ?? 0;
    cur.volume24h += c.volume24h ?? 0;
    map.set(c.platform, cur);
  });
  const total = [...map.values()].reduce((a, b) => a + b.mcap, 0);
  return [...map.values()]
    .map((p) => ({ ...p, sharePct: total > 0 ? (p.mcap / total) * 100 : null }))
    .sort((a, b) => b.mcap - a.mcap);
}

/**
 * Value an NFT portfolio.
 *
 * This is the piece that makes the NFT item real rather than decorative: the
 * owned COUNT comes from an on-chain balanceOf (section 9), and the FLOOR PRICE
 * comes from the market feed. Floor x count is a LOWER BOUND on value, which is
 * stated explicitly — a rare token in a collection is worth more than floor, and
 * a collection with no live floor cannot be valued at all.
 */
export function valuePortfolio(holdings = [], collections = []) {
  const byContract = new Map();
  collections.forEach((c) => {
    const norm = normaliseCollection(c);
    if (norm.contract) byContract.set(norm.contract.toLowerCase(), norm);
    if (norm.id) byContract.set(norm.id.toLowerCase(), norm);
  });

  let floorValue = 0;
  let unvalued = 0;
  const rows = holdings.map((h) => {
    const key = String(h.contract || h.id || '').toLowerCase();
    const col = byContract.get(key) || null;
    const count = Number(h.balance ?? h.count ?? 0) || 0;
    const floor = col?.floor ?? null;
    const value = floor != null ? floor * count : null;
    if (value == null && count > 0) unvalued += count;
    if (value != null) floorValue += value;
    return {
      contract: h.contract ?? null,
      name: col?.name ?? h.name ?? 'Unrecognised collection',
      platform: col?.platform ?? h.platform ?? 'unknown',
      count,
      floor,
      floorValue: value,
      collection: col
    };
  }).sort((a, b) => (b.floorValue ?? -1) - (a.floorValue ?? -1));

  return {
    rows,
    floorValue,
    totalTokens: rows.reduce((a, r) => a + r.count, 0),
    unvaluedTokens: unvalued,
    note: 'Floor price \u00d7 quantity. A LOWER BOUND on value \u2014 any token above floor is worth more, and collections without a live floor are excluded rather than guessed.'
  };
}

/** Collection-level analytics derived from floor, volume and market cap. */
export function nftAnalytics(collections = []) {
  const rows = collections.map(normaliseCollection).filter((c) => c.mcap != null);
  if (!rows.length) return { collections: 0, totalMcap: null, totalVolume24h: null, medianFloor: null, mostTraded: null };
  const mcaps = rows.map((c) => c.mcap).filter((v) => v != null).sort((a, b) => a - b);
  const floors = rows.map((c) => c.floor).filter((v) => v != null).sort((a, b) => a - b);
  const mid = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
  const mostTraded = [...rows].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))[0] || null;
  return {
    collections: rows.length,
    totalMcap: mcaps.reduce((a, b) => a + b, 0),
    totalVolume24h: rows.reduce((a, c) => a + (c.volume24h ?? 0), 0),
    medianFloor: mid(floors),
    mostTraded: mostTraded ? { name: mostTraded.name, turnover: mostTraded.turnover } : null
  };
}
