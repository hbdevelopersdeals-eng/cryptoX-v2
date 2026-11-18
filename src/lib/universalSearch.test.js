import { describe, it, expect } from 'vitest';
import {
  SEARCH_TYPES, buildIndex, search, groupResults, highlight, coverage, suggestions,
  TYPE_BY_ID, MAX_PER_TYPE
} from './universalSearch.js';

const collections = {
  coin: [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', popularity: 1000000 },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', popularity: 400000 },
    { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', popularity: 9000 }
  ],
  exchange: [{ id: 'binance', name: 'Binance' }, { id: 'kraken', name: 'Kraken' }],
  pair: [{ id: 'BTCUSDT', symbol: 'BTC/USDT', name: 'BTC/USDT' }],
  protocol: [{ id: 'uniswap', name: 'Uniswap', keywords: ['dex', 'amm'] }],
  strategy: [{ id: 'rsi', name: 'RSI Reversal', keywords: ['oversold'] }]
};

const index = buildIndex(collections);

describe('index building', () => {
  it('counts what was indexed per type and reports empty types', () => {
    expect(index.counts.coin).toBe(3);
    expect(index.counts.exchange).toBe(2);
    expect(index.counts.nft).toBe(0);
    const cov = coverage(index);
    expect(cov).toHaveLength(SEARCH_TYPES.length);
    expect(cov.find((c) => c.id === 'nft').indexed).toBe(false);
    expect(cov.find((c) => c.id === 'coin').indexed).toBe(true);
  });

  it('falls back to the name for an id, and drops a truly empty entity', () => {
    const idx = buildIndex({ coin: [{ name: 'No id' }, { id: 'ok', name: 'Ok' }, {}] });
    expect(idx.counts.coin).toBe(2);
    expect(idx.docs.find((d) => d.label === 'No id').id).toBe('No id');
  });

  it('caps a pathological collection', () => {
    const huge = Array.from({ length: MAX_PER_TYPE + 25 }, (_, i) => ({ id: `c${i}`, name: `Coin ${i}` }));
    expect(buildIndex({ coin: huge }).counts.coin).toBe(MAX_PER_TYPE);
  });
});

describe('search ranking', () => {
  it('returns nothing for an empty query', () => {
    expect(search(index, '   ').results).toEqual([]);
  });

  it('ranks an exact symbol above a name substring', () => {
    const { results } = search(index, 'BTC');
    expect(results[0].id).toBe('bitcoin');
  });

  it('prefers the shorter name when both are prefix matches', () => {
    const { results } = search(index, 'bitcoin');
    expect(results[0].id).toBe('bitcoin');
    expect(results.map((r) => r.id)).toContain('bitcoin-cash');
  });

  it('matches aliases and keywords', () => {
    expect(search(index, 'dex').results[0].id).toBe('uniswap');
    expect(search(index, 'oversold').results[0].id).toBe('rsi');
  });

  it('applies AND semantics across tokens', () => {
    const { results } = search(index, 'bitcoin cash');
    expect(results.every((r) => /bitcoin/i.test(r.label))).toBe(true);
  });

  it('tolerates a typo via subsequence matching', () => {
    const { results } = search(index, 'bitcon');
    expect(results.some((r) => r.id === 'bitcoin')).toBe(true);
  });

  it('filters by type', () => {
    const { results } = search(index, 'b', { types: ['exchange'] });
    expect(results.every((r) => r.type === 'exchange')).toBe(true);
  });

  it('honours the limit and reports truncation', () => {
    const { results, truncated } = search(index, 'i', { limit: 1 });
    expect(results).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('is deterministic across identical calls', () => {
    const a = search(index, 'bitcoin').results.map((r) => r.id);
    const b = search(index, 'bitcoin').results.map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('labels each result with a human type', () => {
    const { results } = search(index, 'binance');
    expect(results[0].typeLabel).toBe(TYPE_BY_ID.exchange.label);
  });
});

describe('grouping and highlighting', () => {
  it('groups results by type in weight order', () => {
    const { results } = search(index, 'bitcoin');
    const groups = groupResults(results);
    expect(groups[0].type).toBe('coin');
  });

  it('highlights a whole-query hit as one segment', () => {
    const segs = highlight('Bitcoin Cash', 'bitcoin');
    expect(segs).toEqual([{ text: 'Bitcoin', match: true }, { text: ' Cash', match: false }]);
  });

  it('returns the full string unmarked when nothing matches', () => {
    expect(highlight('Bitcoin', 'zzz')).toEqual([{ text: 'Bitcoin', match: false }]);
  });

  it('never returns markup', () => {
    const segs = highlight('<script>alert(1)</script>', 'script');
    expect(segs.every((s) => typeof s.text === 'string' && !s.text.includes('<mark'))).toBe(true);
  });
});

describe('suggestions', () => {
  it('offers one row per type, most popular first', () => {
    const s = suggestions(index, 3);
    expect(s).toHaveLength(3);
    expect(new Set(s.map((x) => x.type)).size).toBe(3);
  });

  it('is empty for an empty index', () => {
    expect(suggestions(buildIndex({}))).toEqual([]);
  });
});
