import { describe, it, expect } from 'vitest';
import {
  normaliseProtocol, topProtocols, categoryBreakdown, chainBreakdown, concentration,
  normalisePool, topYields, yieldQuality, peggedAssets, defiRisk,
  DEFI_CAPABILITIES, DEFI_SOURCE
} from './defi.js';
import {
  normaliseCollection, topCollections, byPlatform, valuePortfolio, nftAnalytics,
  NFT_CAPABILITIES
} from './nftMarket.js';

const proto = (over = {}) => ({
  id: '1', name: 'A', slug: 'a', symbol: 'A', category: 'Dexes', chains: ['Ethereum'],
  tvl: 1000, change_1d: 1, change_7d: -2, mcap: 5000, ...over
});

describe('DeFi protocols', () => {
  it('normalises a protocol row', () => {
    const p = normaliseProtocol(proto());
    expect(p.tvl).toBe(1000);
    expect(p.category).toBe('Dexes');
    expect(p.chainCount).toBe(1);
    expect(p.tvlMcapRatio).toBeCloseTo(0.2, 6);
  });

  it('tolerates missing fields without producing NaN', () => {
    const p = normaliseProtocol({ name: 'Bare' });
    expect(p.tvl).toBe(0);
    expect(p.category).toBe('Uncategorised');
    expect(p.tvlMcapRatio).toBeNull();
    expect(Number.isNaN(p.change1d)).toBe(false);
  });

  it('ranks by TVL and filters by category', () => {
    const rows = [proto({ name: 'Small', tvl: 10 }), proto({ name: 'Big', tvl: 900 }), proto({ name: 'Lend', tvl: 500, category: 'Lending' })];
    expect(topProtocols(rows, { limit: 2 }).map((p) => p.name)).toEqual(['Big', 'Lend']);
    expect(topProtocols(rows, { category: 'Lending' }).map((p) => p.name)).toEqual(['Lend']);
  });

  it('breaks TVL down by category with shares', () => {
    const rows = [proto({ tvl: 750, category: 'Dexes' }), proto({ tvl: 250, category: 'Lending' })];
    const out = categoryBreakdown(rows);
    expect(out[0].category).toBe('Dexes');
    expect(out[0].sharePct).toBeCloseTo(75, 6);
    expect(out[1].sharePct).toBeCloseTo(25, 6);
  });

  it('breaks TVL down by chain, dropping zero-TVL chains', () => {
    const out = chainBreakdown([{ name: 'Ethereum', tvl: 300 }, { name: 'Solana', tvl: 100 }, { name: 'Dead', tvl: 0 }]);
    expect(out.map((c) => c.name)).toEqual(['Ethereum', 'Solana']);
    expect(out[0].sharePct).toBeCloseTo(75, 6);
  });
});

describe('concentration index', () => {
  it('reports a perfectly even split as zero concentration', () => {
    const c = concentration([{ tvl: 25 }, { tvl: 25 }, { tvl: 25 }, { tvl: 25 }]);
    expect(c.normalised).toBeCloseTo(0, 4);
    expect(c.top1SharePct).toBeCloseTo(25, 6);
    expect(c.effective).toBeCloseTo(4, 6);
  });

  it('reports a single holder as fully concentrated', () => {
    const c = concentration([{ tvl: 100 }, { tvl: 0 }]);
    expect(c.top1SharePct).toBeCloseTo(100, 6);
    expect(c.normalised).toBe(1);
  });

  it('rises as the distribution skews', () => {
    const even = concentration([{ tvl: 50 }, { tvl: 50 }]);
    const skew = concentration([{ tvl: 95 }, { tvl: 5 }]);
    expect(skew.normalised).toBeGreaterThan(even.normalised);
  });

  it('returns nulls rather than dividing by zero', () => {
    const c = concentration([]);
    expect(c.hhi).toBeNull();
    expect(c.normalised).toBeNull();
  });
});

describe('DeFi yields', () => {
  const pool = (over = {}) => ({ pool: 'p', project: 'aave', chain: 'Ethereum', symbol: 'USDC', tvlUsd: 5_000_000, apy: 10, apyBase: 10, apyReward: null, stablecoin: true, ...over });

  it('normalises a pool', () => {
    const p = normalisePool(pool({ apy: 20, apyReward: 5 }));
    expect(p.tvl).toBe(5_000_000);
    expect(p.rewardSharePct).toBeCloseTo(25, 6);
    expect(p.stablecoin).toBe(true);
  });

  it('excludes thin and zero-APY pools and reports why', () => {
    const pools = [
      pool({ pool: 'keep', tvlUsd: 5_000_000, apy: 10 }),
      pool({ pool: 'thin', tvlUsd: 100_000, apy: 50 }),
      pool({ pool: 'zero', tvlUsd: 2_000_000, apy: 0 }),
      pool({ pool: 'nul', tvlUsd: 3_000_000, apy: null }),
      pool({ pool: 'wild', tvlUsd: 4_000_000, apy: 900 })
    ];
    const r = topYields(pools, { minTvl: 1_000_000 });
    expect(r.scanned).toBe(5);
    expect(r.eligible).toBe(2);
    expect(r.excluded.lowTvl).toBe(1);
    expect(r.excluded.noApy).toBe(2);
    // Sorted by APY descending.
    expect(r.pools[0].apy).toBe(900);
  });

  it('can cap an implausible APY', () => {
    const pools = [pool({ pool: 'a', apy: 10 }), pool({ pool: 'wild', apy: 900 })];
    const r = topYields(pools, { minTvl: 0, maxApy: 100 });
    expect(r.pools).toHaveLength(1);
    expect(r.excluded.overMax).toBe(1);
  });

  it('filters by chain and stablecoin-only', () => {
    const pools = [pool({ pool: 'e', chain: 'Ethereum' }), pool({ pool: 's', chain: 'Solana', stablecoin: false })];
    expect(topYields(pools, { minTvl: 0, chain: 'Solana' }).pools).toHaveLength(1);
    expect(topYields(pools, { minTvl: 0, stableOnly: true }).pools).toHaveLength(1);
  });

  it('bands yield by how much depends on emissions', () => {
    expect(yieldQuality(pool({ apy: 10, apyReward: 1 }))).toBe('organic');
    expect(yieldQuality(pool({ apy: 10, apyReward: 5 }))).toBe('mixed');
    expect(yieldQuality(pool({ apy: 10, apyReward: 9 }))).toBe('emission-dependent');
    expect(yieldQuality(pool({ apy: null }))).toBe('unknown');
  });
});

describe('stablecoin peg health', () => {
  const asset = (over = {}) => ({ id: '1', name: 'T', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', price: 1, circulating: { peggedUSD: 1000 }, circulatingPrevDay: { peggedUSD: 900 }, chains: [], ...over });

  it('computes deviation from the peg', () => {
    expect(peggedAssets([asset({ price: 0.98 })])[0].pegDeviationPct).toBeCloseTo(-2, 6);
    expect(peggedAssets([asset({ price: 1.005 })])[0].offPeg).toBe(false);
    expect(peggedAssets([asset({ price: 0.98 })])[0].offPeg).toBe(true);
  });

  it('computes the 24h supply change', () => {
    expect(peggedAssets([asset()])[0].change24hPct).toBeCloseTo(11.111, 3);
  });

  it('handles a missing price without flagging a de-peg', () => {
    const r = peggedAssets([asset({ price: null })])[0];
    expect(r.pegDeviationPct).toBeNull();
    expect(r.offPeg).toBe(false);
  });

  it('sorts by circulating supply', () => {
    const out = peggedAssets([asset({ symbol: 'SMALL', circulating: { peggedUSD: 10 } }), asset({ symbol: 'BIG', circulating: { peggedUSD: 9999 } })]);
    expect(out[0].symbol).toBe('BIG');
  });
});

describe('DeFi risk dashboard', () => {
  it('flags protocol concentration and states the evidence', () => {
    const protocols = [proto({ name: 'Whale', tvl: 999 }), proto({ name: 'Minnow', tvl: 1 })];
    const r = defiRisk({ protocols, pools: [], stablecoins: [] });
    const f = r.findings.find((x) => x.code === 'protocol-concentration');
    expect(f).toBeDefined();
    expect(f.detail).toMatch(/concentration index/);
    expect(r.concentration.top1SharePct).toBeCloseTo(99.9, 1);
  });

  it('flags de-pegs', () => {
    const r = defiRisk({ protocols: [], pools: [], stablecoins: [{ id: '1', symbol: 'X', price: 0.9, circulating: { peggedUSD: 1 } }] });
    expect(r.findings.some((f) => f.code === 'peg-deviation')).toBe(true);
    expect(r.counts.offPeg).toBe(1);
  });

  it('flags emission-dependent and absurd yields', () => {
    const pools = [
      { pool: 'a', tvlUsd: 5e6, apy: 200, apyReward: 199, chain: 'Ethereum' },
      { pool: 'b', tvlUsd: 5e6, apy: 5, apyReward: 0, chain: 'Ethereum' }
    ];
    const r = defiRisk({ protocols: [], pools, stablecoins: [] });
    expect(r.findings.some((f) => f.code === 'emission-yield')).toBe(true);
    expect(r.findings.some((f) => f.code === 'high-apy')).toBe(true);
    expect(r.counts.highApy).toBe(1);
  });

  it('says so plainly when nothing crosses a threshold', () => {
    const protocols = Array.from({ length: 40 }, (_, i) => proto({ name: `P${i}`, tvl: 1000 }));
    const r = defiRisk({ protocols, pools: [], stablecoins: [] });
    expect(r.findings[0].code).toBe('none');
    expect(r.findings[0].severity).toBe('info');
  });

  it('always carries the not-advice disclaimer', () => {
    const r = defiRisk({});
    expect(r.disclaimer).toMatch(/not a safety rating/i);
  });
});

describe('DeFi capability honesty', () => {
  it('lists every checked capability with a status and a note', () => {
    DEFI_CAPABILITIES.forEach((c) => {
      expect(['supported', 'partial', 'unavailable']).toContain(c.status);
      expect(c.note.length).toBeGreaterThan(15);
      // "TVL" is a legitimate three-character label.
      expect(c.label.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('explains each unsupported capability rather than omitting it', () => {
    const missing = DEFI_CAPABILITIES.filter((c) => c.status === 'unavailable');
    expect(missing.length).toBeGreaterThanOrEqual(3);
    missing.forEach((c) => expect(c.note).toMatch(/key|indexer|licensed|require/i));
  });

  it('declares its source and licence', () => {
    expect(DEFI_SOURCE.licence).toBe('open');
    expect(DEFI_SOURCE.note).toMatch(/error, not as empty data/i);
  });
});

/* ------------------------------ NFT ------------------------------ */

const col = (over = {}) => ({
  id: 'bayc', name: 'BAYC', symbol: 'BAYC', asset_platform_id: 'ethereum',
  contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
  floor_price: { usd: 10 }, market_cap: { usd: 100000 }, volume_24h: { usd: 500 },
  floor_price_24h_percentage_change: 1.5, ...over
});

describe('NFT collections', () => {
  it('unwraps the {usd} money shape and derives turnover', () => {
    const c = normaliseCollection(col());
    expect(c.floor).toBe(10);
    expect(c.volume24h).toBe(500);
    expect(c.mcap).toBe(100000);
    expect(c.volToFloorMultiple).toBe(50);
    expect(c.change24h).toBe(1.5);
  });

  it('accepts a bare number as well as a money object', () => {
    expect(normaliseCollection(col({ floor_price: 7 })).floor).toBe(7);
  });

  it('ranks by market cap and filters by platform', () => {
    const rows = [col({ id: 'a', name: 'A', market_cap: { usd: 10 } }), col({ id: 'b', name: 'B', market_cap: { usd: 99 } }), col({ id: 'c', name: 'C', market_cap: { usd: 50 }, asset_platform_id: 'solana' })];
    expect(topCollections(rows, { limit: 2 }).map((c) => c.name)).toEqual(['B', 'C']);
    expect(topCollections(rows, { platform: 'solana' }).map((c) => c.name)).toEqual(['C']);
  });

  it('groups collections by chain for multi-chain coverage', () => {
    const rows = [col({ asset_platform_id: 'ethereum', market_cap: { usd: 75 } }), col({ asset_platform_id: 'solana', market_cap: { usd: 25 } })];
    const out = byPlatform(rows);
    expect(out[0].platform).toBe('ethereum');
    expect(out[0].sharePct).toBeCloseTo(75, 6);
    expect(out).toHaveLength(2);
  });

  it('computes collection analytics', () => {
    const rows = [col({ market_cap: { usd: 100 }, floor_price: { usd: 2 } }), col({ id: 'z', market_cap: { usd: 300 }, floor_price: { usd: 8 } })];
    const a = nftAnalytics(rows);
    expect(a.collections).toBe(2);
    expect(a.totalMcap).toBe(400);
    expect(a.medianFloor).toBe(8);
  });
});

describe('NFT portfolio valuation', () => {
  it('values held tokens at floor and says it is a lower bound', () => {
    const holdings = [{ contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', balance: 2 }];
    const r = valuePortfolio(holdings, [col({ floor_price: { usd: 5 } })]);
    expect(r.rows[0].count).toBe(2);
    expect(r.rows[0].floorValue).toBe(10);
    expect(r.floorValue).toBe(10);
    expect(r.note).toMatch(/lower bound/i);
  });

  it('counts a holding it cannot value instead of inventing a price', () => {
    const r = valuePortfolio([{ contract: '0xdead', balance: 3 }], [col()]);
    expect(r.rows[0].floorValue).toBeNull();
    expect(r.floorValue).toBe(0);
    expect(r.unvaluedTokens).toBe(3);
    expect(r.rows[0].name).toMatch(/Unrecognised/);
  });

  it('matches a collection by id as well as contract address', () => {
    const r = valuePortfolio([{ id: 'bayc', balance: 1 }], [col({ floor_price: { usd: 4 } })]);
    expect(r.floorValue).toBe(4);
  });

  it('handles an empty portfolio', () => {
    const r = valuePortfolio([], []);
    expect(r.rows).toEqual([]);
    expect(r.floorValue).toBe(0);
    expect(r.totalTokens).toBe(0);
  });
});

describe('NFT capability honesty', () => {
  it('lists rarity, traits and sales as unavailable with reasons', () => {
    const ids = NFT_CAPABILITIES.map((c) => c.id);
    ['rarity', 'traits', 'sales', 'marketplace'].forEach((id) => expect(ids, id).toContain(id));
    NFT_CAPABILITIES.filter((c) => ['rarity', 'traits', 'sales', 'marketplace'].includes(c.id))
      .forEach((c) => {
        expect(c.status).toBe('unavailable');
        expect(c.note.length).toBeGreaterThan(20);
      });
  });

  it('marks the portfolio as supported and explains what it is built from', () => {
    const p = NFT_CAPABILITIES.find((c) => c.id === 'portfolio');
    expect(p.status).toBe('supported');
    expect(p.note).toMatch(/balanceOf|floor/i);
  });
});
