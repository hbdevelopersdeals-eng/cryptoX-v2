/* DeFi data layer and analytics.
 *
 * Source: DefiLlama — fully public and keyless (verified before use). Their
 * endpoints moved once already (api.llama.fi/pools → yields.llama.fi/pools), so
 * a 404 is surfaced as a source error rather than silently returning nothing.
 *
 * Every function is either a thin fetch or a PURE analytics helper, so the maths
 * is testable without the network.
 *
 * WHAT CANNOT BE SOURCED HERE, and why:
 *   swap routing / DEX aggregation — 1inch, 0x and Paraswap all require API keys
 *                                    and none permit keyless redistribution
 *   liquidations                   — no keyless protocol-level feed exists
 *   bridges                        — volume data is licensed per provider
 * Those are declared, never approximated.
 */

const LLAMA = 'https://api.llama.fi';
const YIELDS = 'https://yields.llama.fi';
const STABLES = 'https://stablecoins.llama.fi';

export const DEFI_SOURCE = {
  name: 'DefiLlama',
  licence: 'open',
  endpoints: {
    protocols: `${LLAMA}/protocols`,
    chains: `${LLAMA}/chains`,
    protocol: `${LLAMA}/protocol/{slug}`,
    pools: `${YIELDS}/pools`,
    stablecoins: `${STABLES}/stablecoins`,
    stablecoinChains: `${STABLES}/stablecoinchains`
  },
  note: 'Public and keyless. Verified reachable at build time; a moved endpoint surfaces as an error, not as empty data.'
};

/** Capabilities this layer can and cannot provide, for honest UI display. */
export const DEFI_CAPABILITIES = [
  { id: 'dex_aggregation', label: 'DEX aggregation', status: 'unavailable', note: '1inch / 0x / Paraswap all require API keys.' },
  { id: 'swap_routing', label: 'Swap routing', status: 'unavailable', note: 'Routing needs a quote API key; no keyless router exists.' },
  { id: 'liquidity_pools', label: 'Liquidity pools', status: 'supported', note: 'Live pool list with TVL and APY.' },
  { id: 'tvl', label: 'TVL', status: 'supported', note: 'Protocol and per-chain TVL.' },
  { id: 'apy', label: 'APR / APY', status: 'supported', note: 'Base and reward APY, plus 1d/7d/30d change.' },
  { id: 'lending', label: 'Lending / borrowing', status: 'supported', note: 'Lending pools appear as pools; borrow-side rates are not published keylessly.' },
  { id: 'liquidations', label: 'Liquidations', status: 'unavailable', note: 'No keyless protocol-level liquidation feed.' },
  { id: 'yield_farming', label: 'Yield farming', status: 'supported', note: 'Reward-bearing pools are identified by reward APY.' },
  { id: 'staking', label: 'Staking / restaking', status: 'supported', note: 'Liquid-staking and restaking pools appear as pools.' },
  { id: 'bridges', label: 'Bridges', status: 'unavailable', note: 'Bridge volume is licensed per provider.' },
  { id: 'vaults', label: 'Vaults', status: 'partial', note: 'Vault-style pools appear, but no first-class vault model.' },
  { id: 'stablecoins', label: 'Stablecoins', status: 'supported', note: 'Circulating supply, peg type and mechanism.' },
  { id: 'protocol_analytics', label: 'Protocol analytics', status: 'supported', note: 'Per-protocol TVL history and metadata.' },
  { id: 'wallet_exposure', label: 'Wallet exposure', status: 'partial', note: 'Token balances are readable; a full position index needs an indexer.' },
  { id: 'risk_dashboard', label: 'DeFi risk dashboard', status: 'supported', note: 'Derived here: concentration, APY outliers, peg health.' }
];

/* ---------------- fetch ---------------- */

const j = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429) return { ok: false, error: 'Rate limited by the source — try again shortly', status: 429 };
  if (!res.ok) return { ok: false, error: `Source returned HTTP ${res.status}`, status: res.status };
  const data = await res.json();
  return { ok: true, data };
};

export async function fetchProtocols() {
  const r = await j(DEFI_SOURCE.endpoints.protocols);
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function fetchChains() {
  const r = await j(DEFI_SOURCE.endpoints.chains);
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data) ? r.data : [] };
}

export async function fetchPools() {
  const r = await j(DEFI_SOURCE.endpoints.pools);
  if (!r.ok) return r;
  // Shape is { status, data: [...] }
  const list = Array.isArray(r.data) ? r.data : (r.data?.data || []);
  return { ok: true, data: list };
}

export async function fetchStablecoins() {
  const r = await j(DEFI_SOURCE.endpoints.stablecoins);
  if (!r.ok) return r;
  return { ok: true, data: r.data?.peggedAssets || [] };
}

export async function fetchProtocol(slug) {
  const r = await j(DEFI_SOURCE.endpoints.protocol.replace('{slug}', encodeURIComponent(slug)));
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}

/* ---------------- pure analytics ---------------- */

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Normalise a DefiLlama protocol row. */
export function normaliseProtocol(p) {
  const tvl = n(p?.tvl) ?? 0;
  return {
    id: p?.id ?? null,
    name: p?.name ?? 'Unknown',
    slug: p?.slug ?? null,
    symbol: p?.symbol ?? null,
    category: p?.category ?? 'Uncategorised',
    chains: Array.isArray(p?.chains) ? p.chains : [],
    chainCount: Array.isArray(p?.chains) ? p.chains.length : 0,
    tvl,
    change1d: n(p?.change_1d),
    change7d: n(p?.change_7d),
    mcap: n(p?.mcap),
    // TVL/mcap below 1 indicates the protocol holds less than its own token's value.
    tvlMcapRatio: n(p?.mcap) > 0 ? tvl / n(p.mcap) : null
  };
}

export function topProtocols(protocols = [], { limit = 20, category = null } = {}) {
  return protocols
    .map(normaliseProtocol)
    .filter((p) => (category ? p.category === category : true))
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, limit);
}

export function categoryBreakdown(protocols = []) {
  const rows = protocols.map(normaliseProtocol);
  const total = sum(rows.map((r) => r.tvl));
  const by = new Map();
  rows.forEach((r) => {
    const cur = by.get(r.category) || { category: r.category, tvl: 0, protocols: 0 };
    cur.tvl += r.tvl;
    cur.protocols += 1;
    by.set(r.category, cur);
  });
  return [...by.values()]
    .map((c) => ({ ...c, sharePct: total > 0 ? (c.tvl / total) * 100 : null }))
    .sort((a, b) => b.tvl - a.tvl);
}

/** Chain-level TVL share. */
export function chainBreakdown(chains = []) {
  const rows = chains.map((c) => ({ name: c?.name ?? 'Unknown', tvl: n(c?.tvl) ?? 0 })).filter((c) => c.tvl > 0);
  const total = sum(rows.map((r) => r.tvl));
  return rows
    .map((r) => ({ ...r, sharePct: total > 0 ? (r.tvl / total) * 100 : null }))
    .sort((a, b) => b.tvl - a.tvl);
}

/**
 * Concentration via the Herfindahl-Hirschman index, normalised to 0–1 relative
 * to a perfectly even split. 1 means a single protocol holds everything.
 */
export function concentration(rows = [], key = 'tvl') {
  const values = rows.map((r) => Number(r?.[key])).filter((v) => Number.isFinite(v) && v > 0);
  const total = sum(values);
  if (!values.length || total <= 0) return { hhi: null, normalised: null, top1SharePct: null, effective: null };
  const shares = values.map((v) => v / total);
  const hhi = sum(shares.map((s) => s * s));
  const evenness = 1 / values.length;
  const sorted = [...shares].sort((a, b) => b - a);
  return {
    hhi: Number(hhi.toFixed(6)),
    // 0 = perfectly even, 1 = fully concentrated.
    normalised: values.length > 1 ? Number(((hhi - evenness) / (1 - evenness)).toFixed(4)) : 1,
    top1SharePct: Number((sorted[0] * 100).toFixed(2)),
    effective: Number((1 / hhi).toFixed(2))
  };
}

/** Normalise a yield pool row. */
export function normalisePool(p) {
  const tvl = n(p?.tvlUsd) ?? 0;
  const apyBase = n(p?.apyBase);
  const apyReward = n(p?.apyReward);
  const apy = n(p?.apy);
  return {
    pool: p?.pool ?? null,
    project: p?.project ?? 'unknown',
    chain: p?.chain ?? 'Unknown',
    symbol: p?.symbol ?? '?',
    tvl,
    apy,
    apyBase,
    apyReward,
    // A large reward component means the yield depends on token emissions.
    rewardSharePct: apy && apy > 0 && apyReward ? (apyReward / apy) * 100 : null,
    apyPct1D: n(p?.apyPct1D),
    apyPct7D: n(p?.apyPct7D),
    apyPct30D: n(p?.apyPct30D),
    stablecoin: p?.stablecoin === true,
    ilRisk: p?.ilRisk ?? null,
    exposure: p?.exposure ?? null,
    predictions: p?.predictions ?? null
  };
}

/**
 * Yield opportunities, filtered for sanity.
 * A pool advertising a huge APY on trivial TVL is not an opportunity — it is
 * usually a farm about to be drained, so a minimum TVL is applied by default and
 * the reason for every exclusion is reported.
 */
export function topYields(pools = [], { limit = 20, minTvl = 1_000_000, chain = null, stableOnly = false, maxApy = null } = {}) {
  const all = pools.map(normalisePool);
  const excluded = { lowTvl: 0, noApy: 0, chain: 0, unstable: 0, overMax: 0 };

  const kept = all.filter((p) => {
    if (chain && p.chain !== chain) { excluded.chain += 1; return false; }
    if (stableOnly && !p.stablecoin) { excluded.unstable += 1; return false; }
    if (p.apy == null || p.apy <= 0) { excluded.noApy += 1; return false; }
    if (p.tvl < minTvl) { excluded.lowTvl += 1; return false; }
    if (maxApy != null && p.apy > maxApy) { excluded.overMax += 1; return false; }
    return true;
  });

  return {
    pools: kept.sort((a, b) => b.apy - a.apy).slice(0, limit),
    scanned: all.length,
    eligible: kept.length,
    excluded
  };
}

/** Split pools by whether the yield survives without token emissions. */
export function yieldQuality(pool) {
  const p = normalisePool(pool);
  if (p.apy == null) return 'unknown';
  const rewardShare = p.rewardSharePct ?? 0;
  if (rewardShare >= 80) return 'emission-dependent';
  if (rewardShare >= 40) return 'mixed';
  return 'organic';
}

/**
 * Stablecoin peg health.
 * A de-peg is the single most important DeFi risk signal, so deviation from
 * $1.00 is computed explicitly rather than left to the reader.
 */
export function peggedAssets(assets = []) {
  return assets.map((a) => {
    const circKey = a?.circulating ? Object.keys(a.circulating)[0] : null;
    const circulating = circKey ? n(a.circulating[circKey]) : null;
    const price = n(a?.price);
    const prev = a?.circulatingPrevDay ? n(a.circulatingPrevDay[circKey]) : null;
    const change24hPct = circulating != null && prev != null && prev > 0
      ? ((circulating - prev) / prev) * 100
      : null;
    return {
      id: a?.id,
      name: a?.name ?? 'Unknown',
      symbol: a?.symbol ?? '?',
      pegType: a?.pegType ?? null,
      pegMechanism: a?.pegMechanism ?? null,
      circulating,
      price,
      // Signed deviation from the peg, in percent.
      pegDeviationPct: price != null ? (price - 1) * 100 : null,
      offPeg: price != null ? Math.abs(price - 1) > 0.01 : false,
      change24hPct,
      chains: Array.isArray(a?.chains) ? a.chains : []
    };
  }).sort((x, y) => (y.circulating || 0) - (x.circulating || 0));
}

/**
 * DeFi risk dashboard — derived, and each row states the evidence behind it.
 * This is a heuristic read of public data, NOT a safety rating.
 */
export function defiRisk({ protocols = [], pools = [], stablecoins = [] } = {}) {
  const protos = protocols.map(normaliseProtocol).filter((p) => p.tvl > 0);
  const poolRows = pools.map(normalisePool).filter((p) => p.tvl > 0);
  const pegs = peggedAssets(stablecoins);

  const conc = concentration(protos);
  const chainConc = concentration(chainBreakdown(
    // chains come in separately in the UI; here we only have what was passed
    protos.flatMap((p) => p.chains.map((c) => ({ name: c, tvl: p.tvl / Math.max(1, p.chainCount) })))
  ));

  const highApy = poolRows.filter((p) => (p.apy ?? 0) >= 100);
  const emissionHeavy = poolRows.filter((p) => yieldQuality(p) === 'emission-dependent');
  const offPeg = pegs.filter((s) => s.offPeg);

  const findings = [];
  if (conc.normalised != null && conc.normalised > 0.9) {
    findings.push({ severity: 'high', code: 'protocol-concentration', detail: `TVL concentration index ${conc.normalised} — the top protocol holds ${conc.top1SharePct}% of tracked TVL.` });
  }
  if (chainConc.normalised != null && chainConc.normalised > 0.9) {
    findings.push({ severity: 'medium', code: 'chain-concentration', detail: `Chain TVL is concentrated (index ${chainConc.normalised}); a single-chain outage would be systemic.` });
  }
  if (offPeg.length) {
    findings.push({ severity: 'high', code: 'peg-deviation', detail: `${offPeg.length} stablecoin(s) are more than 1% off peg: ${offPeg.slice(0, 3).map((s) => s.symbol).join(', ')}.` });
  }
  if (emissionHeavy.length) {
    findings.push({ severity: 'medium', code: 'emission-yield', detail: `${emissionHeavy.length} of ${poolRows.length} pools earn 80%+ of their yield from token emissions, which can end abruptly.` });
  }
  if (highApy.length) {
    findings.push({ severity: 'medium', code: 'high-apy', detail: `${highApy.length} pool(s) advertise APY above 100% — usually unsustainable or predatory.` });
  }
  if (!findings.length) findings.push({ severity: 'info', code: 'none', detail: 'No concentration or peg anomaly crossed its threshold in the current data.' });

  const rank = { high: 3, medium: 2, info: 1 };
  return {
    findings: findings.sort((a, b) => rank[b.severity] - rank[a.severity]),
    concentration: conc,
    chainConcentration: chainConc,
    counts: { protocols: protos.length, pools: poolRows.length, stablecoins: pegs.length, offPeg: offPeg.length, emissionHeavy: emissionHeavy.length, highApy: highApy.length },
    disclaimer: 'A heuristic read of public TVL, yield and peg data. Not a safety rating, audit, or investment advice.'
  };
}
