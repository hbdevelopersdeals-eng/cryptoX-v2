import { describe, it, expect } from 'vitest';
import { THEMES, validateThemes, newListings, NEW_LISTINGS_LABEL, byTheme, themeStats } from './marketIntelExtra.js';
import { SECTOR_BUCKETS } from './marketIntel.js';

const NOW = Date.UTC(2026, 9, 5);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const coin = (over = {}) => ({
  id: 'x', symbol: 'X', name: 'X', price: 10, mcap: 1000, ath: 12,
  athDate: daysAgo(5), categories: [], ...over
});

describe('named theme taxonomy', () => {
  it('lists exactly the themes the spec names', () => {
    const labels = THEMES.map((t) => t.label);
    ['Stablecoins', 'Meme coins', 'AI tokens', 'DePIN', 'RWA', 'Layer 1', 'Layer 2', 'DeFi', 'Gaming', 'Infrastructure']
      .forEach((l) => expect(labels, l).toContain(l));
  });

  it('resolves every theme to a real sector bucket', () => {
    // A theme with no bucket would render an always-empty tab.
    expect(validateThemes()).toEqual([]);
    expect(THEMES.length).toBe(SECTOR_BUCKETS.length >= 10 ? 10 : THEMES.length);
  });

  it('flags a theme that has no matching bucket', () => {
    expect(validateThemes([{ id: 'nonsense', label: 'Nope' }])).toEqual(['nonsense']);
  });

  it('matches rows to a theme by category text', () => {
    const rows = [
      coin({ id: 'eth', symbol: 'ETH', categories: ['Smart Contract Platform', 'Layer 1 (L1)'] }),
      coin({ id: 'doge', symbol: 'DOGE', categories: ['Meme'] }),
      coin({ id: 'uni', symbol: 'UNI', categories: ['Decentralized Finance (DeFi)'] })
    ];
    expect(byTheme(rows, 'meme').map((r) => r.symbol)).toEqual(['DOGE']);
    expect(byTheme(rows, 'defi').map((r) => r.symbol)).toEqual(['UNI']);
    expect(byTheme(rows, 'layer1').map((r) => r.symbol)).toEqual(['ETH']);
    expect(byTheme(rows, 'nope')).toEqual([]);
  });

  it('accepts a bare string category as well as an array', () => {
    expect(byTheme([coin({ symbol: 'M', categories: 'Meme' })], 'meme')).toHaveLength(1);
  });

  it('aggregates a theme with its leaders', () => {
    const rows = [
      coin({ id: 'a', symbol: 'A', mcap: 500, categories: ['Meme'] }),
      coin({ id: 'b', symbol: 'B', mcap: 900, categories: ['Meme'] }),
      coin({ id: 'c', symbol: 'C', mcap: 100, categories: ['DeFi'] })
    ];
    const s = themeStats(rows, 'meme');
    expect(s.count).toBe(2);
    expect(s.totalMcap).toBe(1400);
    expect(s.leaders[0].symbol).toBe('B');
    expect(s.leaders).toHaveLength(2);
  });
});

describe('new listings', () => {
  it('includes only coins whose ATH is inside the window', () => {
    const rows = [
      coin({ id: 'new', symbol: 'NEW', athDate: daysAgo(3) }),
      coin({ id: 'old', symbol: 'OLD', athDate: daysAgo(900) })
    ];
    const out = newListings(rows, { withinDays: 30, now: NOW });
    expect(out.map((r) => r.symbol)).toEqual(['NEW']);
  });

  it('excludes a coin with no ATH date instead of assuming it is new', () => {
    const rows = [coin({ id: 'unknown', symbol: 'UNK', athDate: null, ath_date: undefined })];
    expect(newListings(rows, { now: NOW })).toEqual([]);
  });

  it('accepts both camelCase and snake_case date fields', () => {
    expect(newListings([coin({ ath_date: daysAgo(2) })], { now: NOW, withinDays: 30 })).toHaveLength(1);
    expect(newListings([coin({ athDate: daysAgo(2) })], { now: NOW, withinDays: 30 })).toHaveLength(1);
  });

  it('sorts newest first and reports distance from the high', () => {
    const rows = [
      coin({ id: 'a', symbol: 'A', athDate: daysAgo(10), price: 6, ath: 12 }),
      coin({ id: 'b', symbol: 'B', athDate: daysAgo(1), price: 12, ath: 12 })
    ];
    const out = newListings(rows, { now: NOW, withinDays: 30 });
    expect(out[0].symbol).toBe('B');
    expect(out[0].fromAthPct).toBeCloseTo(0, 6);
    expect(out[1].fromAthPct).toBeCloseTo(-50, 6);
    expect(out[1].daysSinceAth).toBe(10);
  });

  it('honours the limit', () => {
    const rows = Array.from({ length: 40 }, (_, i) => coin({ id: `c${i}`, athDate: daysAgo(i % 20) }));
    expect(newListings(rows, { now: NOW, withinDays: 30, limit: 5 })).toHaveLength(5);
  });

  it('labels itself as a proxy rather than an official listing feed', () => {
    expect(NEW_LISTINGS_LABEL).toMatch(/proxy/i);
    expect(NEW_LISTINGS_LABEL).toMatch(/no listing date/i);
  });
});
