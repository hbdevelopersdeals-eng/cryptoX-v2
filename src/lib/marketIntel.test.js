import { describe, it, expect } from 'vitest';
import {
  fdvRatio, distanceFromAth, supplyRatio, sortBy, topGainers, topLosers, topVolume,
  searchCoins, bucketCategories, valuationRow, universeStats
} from './marketIntel.js';

const coin = (over = {}) => ({
  id: 'x', symbol: 'x', name: 'X', current_price: 100, market_cap: 1000, total_volume: 50,
  fully_diluted_valuation: 2000, circulating_supply: 10, total_supply: 20, max_supply: 20,
  ath: 200, ath_date: '2021-11-10T00:00:00.000Z', atl: 1,
  price_change_percentage_24h_in_currency: 5, price_change_percentage_30d_in_currency: 12,
  price_change_percentage_1y_in_currency: -20,
  ...over
});

describe('valuation maths', () => {
  it('computes FDV ratio', () => {
    expect(fdvRatio(2000, 1000)).toBe(2);
    expect(fdvRatio(null, 1000)).toBeNull();
    expect(fdvRatio(2000, 0)).toBeNull();
  });
  it('computes distance below ATH', () => {
    expect(distanceFromAth(150, 200)).toBeCloseTo(25, 5);
    expect(distanceFromAth(200, 200)).toBe(0);
    expect(distanceFromAth(null, 200)).toBeNull();
  });
  it('computes circulating share of max supply, capped at 100', () => {
    expect(supplyRatio(10, 20)).toBe(50);
    expect(supplyRatio(30, 20)).toBe(100);
    expect(supplyRatio(10, null)).toBeNull();
  });
});

describe('sorting and leaderboards', () => {
  const list = [
    coin({ id: 'a', price_change_percentage_24h_in_currency: 10, total_volume: 5 }),
    coin({ id: 'b', price_change_percentage_24h_in_currency: -8, total_volume: 500 }),
    coin({ id: 'c', price_change_percentage_24h_in_currency: 3, total_volume: 90 }),
    coin({ id: 'd', price_change_percentage_24h_in_currency: null, total_volume: null })
  ];

  it('sorts descending and pushes nulls last', () => {
    expect(sortBy(list, 'total_volume').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortBy(list, 'total_volume', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('builds gainer and loser boards', () => {
    expect(topGainers(list).map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(topLosers(list).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('respects the requested size', () => {
    expect(topGainers(list, 1).map((r) => r.id)).toEqual(['a']);
    expect(topVolume(list, 2).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('searches by name or symbol, case-insensitively', () => {
    const coins = [coin({ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' }), coin({ id: 'eth', name: 'Ethereum', symbol: 'eth' })];
    expect(searchCoins(coins, 'BIT').map((c) => c.id)).toEqual(['bitcoin']);
    expect(searchCoins(coins, 'eth').map((c) => c.id)).toEqual(['eth']);
    expect(searchCoins(coins, '')).toHaveLength(2);
  });
});

describe('sector bucketing', () => {
  const categories = [
    { name: 'DeFi', market_cap: 1000, market_cap_change_24h: 2, volume_24h: 100 },
    { name: 'Decentralized Finance (DeFi)', market_cap: 1000, market_cap_change_24h: 4, volume_24h: 100 },
    { name: 'Meme', market_cap: 500, market_cap_change_24h: -3, volume_24h: 50 },
    { name: 'Artificial Intelligence (AI)', market_cap: 400, market_cap_change_24h: 6, volume_24h: 40 },
    { name: 'Layer 1 (L1)', market_cap: 3000, market_cap_change_24h: 1, volume_24h: 300 },
    { name: 'Stablecoins', market_cap: 900, market_cap_change_24h: 0.1, volume_24h: 900 },
    { name: 'Gaming (GameFi)', market_cap: 200, market_cap_change_24h: -1, volume_24h: 20 },
    { name: 'Real World Assets (RWA)', market_cap: 150, market_cap_change_24h: 3, volume_24h: 15 }
  ];

  it('groups categories into the requested sectors', () => {
    const buckets = bucketCategories(categories);
    const defi = buckets.find((b) => b.id === 'defi');
    expect(defi.count).toBe(2);
    expect(defi.marketCap).toBe(2000);
    expect(defi.change24h).toBeCloseTo(3, 5); // market-cap weighted
    expect(buckets.find((b) => b.id === 'meme').count).toBe(1);
    expect(buckets.find((b) => b.id === 'ai').count).toBe(1);
    expect(buckets.find((b) => b.id === 'rwa').count).toBe(1);
    expect(buckets.find((b) => b.id === 'gaming').count).toBe(1);
  });

  it('drops empty buckets and survives junk input', () => {
    const buckets = bucketCategories([{ name: 'Unrelated Nonsense', market_cap: 5 }]);
    expect(buckets).toHaveLength(0);
    expect(bucketCategories()).toEqual([]);
  });
});

describe('valuationRow / universeStats', () => {
  it('flattens a market row for the table', () => {
    const row = valuationRow(coin({ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }));
    expect(row.symbol).toBe('BTC');
    expect(row.fdvRatio).toBe(2);
    expect(row.supplyPct).toBe(50);
    expect(row.belowAthPct).toBeCloseTo(50, 5);
    expect(row.perf1y).toBe(-20);
  });

  it('summarises the universe', () => {
    const stats = universeStats([
      coin({ market_cap: 100, total_volume: 10, price_change_percentage_24h_in_currency: 1 }),
      coin({ market_cap: 200, total_volume: 20, price_change_percentage_24h_in_currency: -1 })
    ]);
    expect(stats.coins).toBe(2);
    expect(stats.totalMarketCap).toBe(300);
    expect(stats.totalVolume).toBe(30);
    expect(stats.gainers).toBe(1);
    expect(stats.losers).toBe(1);
  });
});
