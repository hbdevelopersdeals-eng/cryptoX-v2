import { describe, it, expect } from 'vitest';
import {
  bestQuotes, globalAverage, arbitrageOpportunities, venueLeaderboard, aggregateVenues, summariseAggregate,
  priceMatrix, liquidityProfile, bestExecutionVenue, globalAverageAcrossAssets, VOLUME_UNIT
} from './aggregator.js';
import {
  RULE_TYPES, describeRule, evaluateRule, evaluateAll, applyCooldown, validateRule
} from './alertsEngine.js';

const q = (venue, price) => ({ venue, price, assetId: 'bitcoin', symbol: 'BTC' });

describe('best buy/sell venues and averages', () => {
  it('finds the cheapest venue to buy and the dearest to sell', () => {
    const res = bestQuotes([q('binance', 100), q('okx', 100.4), q('kraken', 99.8)]);
    expect(res.bestSell.venue).toBe('okx'); // highest venue price
    expect(res.bestBuy.venue).toBe('kraken'); // lowest venue price
    expect(res.spread).toBeCloseTo(0.6, 6);
    expect(res.spread).toBeGreaterThan(0); // spread is never negative
    expect(res.spreadPct).toBeCloseTo(0.6, 2);
    expect(res.venues).toBe(3);
  });

  it('is empty-safe', () => {
    expect(bestQuotes([]).bestBuy).toBeNull();
    expect(bestQuotes([]).spreadPct).toBeNull();
    expect(globalAverage([]).mean).toBeNull();
  });

  it('computes mean, median and dispersion', () => {
    const avg = globalAverage([q('a', 100), q('b', 102), q('c', 104)]);
    expect(avg.mean).toBeCloseTo(102, 6);
    expect(avg.median).toBe(102);
    expect(avg.dispersionPct).toBeCloseTo(4, 2);
    expect(avg.count).toBe(3);
  });
});

describe('arbitrage', () => {
  it('ranks opportunities by net spread after fees', () => {
    const ops = arbitrageOpportunities([q('a', 100), q('b', 101), q('c', 103)], { feePct: 0.1 });
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].buyVenue).toBe('a');
    expect(ops[0].sellVenue).toBe('c');
    expect(ops[0].grossPct).toBeCloseTo(3, 6);
    expect(ops[0].netPct).toBeCloseTo(2.8, 6);
    expect(ops[1].netPct).toBeLessThanOrEqual(ops[0].netPct);
  });

  it('ignores sub-threshold and same-venue pairs', () => {
    expect(arbitrageOpportunities([q('a', 100), q('b', 100.01)], { minGrossPct: 0.5 })).toEqual([]);
    expect(arbitrageOpportunities([q('a', 100)])).toEqual([]);
  });
});

describe('per-exchange price comparison', () => {
  const mix = [
    { venue: 'binance', price: 100, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 5000000 },
    { venue: 'okx', price: 101, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 1234 },
    { venue: 'coinbase', price: 99, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: null }
  ];

  it('builds one column per venue with average and spread', () => {
    const m = priceMatrix(
      [{ assetId: 'bitcoin', symbol: 'BTC', quotes: mix }],
      { venueIds: ['binance', 'okx', 'coinbase', 'kraken'] }
    );
    expect(m.venueIds).toEqual(['binance', 'okx', 'coinbase', 'kraken']);
    const row = m.rows[0];
    expect(row.prices).toEqual({ binance: 100, okx: 101, coinbase: 99, kraken: null });
    expect(row.venueCount).toBe(3);
    expect(row.average).toBeCloseTo(100, 6);
    expect(row.lowest).toBe(99);
    expect(row.lowestVenue).toBe('coinbase');
    expect(row.highest).toBe(101);
    expect(row.highestVenue).toBe('okx');
    // Mid-based spread (99 → 101 around a mid of 100) — same convention as bestQuotes().
    expect(row.spreadPct).toBeCloseTo(2, 6);
  });

  it('uses the same spread convention as bestQuotes', () => {
    const quotes = [q('binance', 100), q('okx', 101)];
    const matrix = priceMatrix([{ assetId: 'bitcoin', symbol: 'BTC', quotes }]);
    const best = bestQuotes(quotes);
    expect(matrix.rows[0].spreadPct).toBeCloseTo(best.spreadPct, 6);
  });

  it('derives the venue list from the data when none is supplied', () => {
    const m = priceMatrix([{ assetId: 'bitcoin', symbol: 'BTC', quotes: mix }]);
    expect(m.venueIds.sort()).toEqual(['binance', 'coinbase', 'okx']);
  });
});

describe('liquidity and volume', () => {
  const mix = [
    { venue: 'binance', price: 100, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 5000000 },
    { venue: 'okx', price: 101, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 999999 },
    { venue: 'coinbase', price: 99, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: null }
  ];

  it('classifies volume units so incompatible figures are never totalled', () => {
    expect(VOLUME_UNIT.binance).toBe('quote');
    expect(VOLUME_UNIT.okx).toBe('base');
    expect(VOLUME_UNIT.htx).toBe('base');
    expect(VOLUME_UNIT.coinbase).toBeNull();
  });

  it('totals only comparable venues and names the rest', () => {
    const p = liquidityProfile(mix);
    expect(p.venuesQuoted).toBe(3);
    expect(p.volumeVenues).toBe(1); // only Binance reports quote-currency volume
    expect(p.totalVolumeUsd).toBe(5000000);
    expect(p.topVenue).toBe('binance');
    expect(p.topSharePct).toBe(100);
    // OKX reports base-asset volume and Coinbase reports none — both excluded by name.
    expect(p.nonComparableVenues).toEqual(['okx', 'coinbase']);
    expect(p.depthDisclosed).toBe(false);
  });

  it('never invents a volume total when nothing is comparable', () => {
    const p = liquidityProfile([{ venue: 'okx', price: 100, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 42 }]);
    expect(p.totalVolumeUsd).toBeNull();
    expect(p.volumeVenues).toBe(0);
  });

  it('sums on-chain pool liquidity separately from CEX volume', () => {
    const p = liquidityProfile([
      { venue: 'dexscreener', price: 100, assetId: 'bitcoin', symbol: 'BTC', liquidityUsd: 250000 }
    ]);
    expect(p.totalVolumeUsd).toBeNull();   // DEX volume is not comparable
    expect(p.poolLiquidityUsd).toBe(250000);
    expect(p.venues[0].liquidityUsd).toBe(250000);
  });
});

describe('best execution venue', () => {
  const mix = [
    { venue: 'binance', price: 100, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 5000000 },
    { venue: 'okx', price: 101, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: 1234 },
    { venue: 'coinbase', price: 99, assetId: 'bitcoin', symbol: 'BTC', volumeQuote: null }
  ];

  it('picks the cheapest venue to buy and the dearest to sell', () => {
    const buy = bestExecutionVenue(mix, { side: 'buy' });
    expect(buy.venue).toBe('coinbase');
    expect(buy.price).toBe(99);
    expect(buy.deltaPct).toBeCloseTo(-1, 6); // 1% better than the 100 average

    const sell = bestExecutionVenue(mix, { side: 'sell' });
    expect(sell.venue).toBe('okx');
    expect(sell.price).toBe(101);
    expect(sell.deltaPct).toBeCloseTo(1, 6);
  });

  it('flags when the winning venue does not publish comparable volume', () => {
    const buy = bestExecutionVenue(mix, { side: 'buy' });
    expect(buy.reportedVolumeUsd).toBeNull();
    expect(buy.volumeVenues).toBe(1); // only Binance is comparable
  });

  it('is empty-safe', () => {
    const r = bestExecutionVenue([], { side: 'buy' });
    expect(r.venue).toBeNull();
    expect(r.note).toBe('no quotes');
  });
});

describe('global average across all venues', () => {
  it('averages every venue price of every asset', () => {
    const g = globalAverageAcrossAssets([
      { quotes: [{ venue: 'a', price: 100 }, { venue: 'b', price: 200 }] },
      { quotes: [{ venue: 'a', price: 300 }] }
    ]);
    expect(g.count).toBe(3);
    expect(g.mean).toBeCloseTo(200, 6);
    expect(g.median).toBe(200);
    expect(g.assets).toBe(2);
    // range 200 relative to the lowest price 100 → 200%
    expect(g.dispersionPct).toBeCloseTo(200, 6);
  });

  it('is empty-safe', () => {
    expect(globalAverageAcrossAssets([]).mean).toBeNull();
  });
});

describe('aggregateVenues + leaderboard', () => {
  const rows = [
    { assetId: 'bitcoin', symbol: 'BTC', quotes: [q('binance', 100), q('okx', 100.5)] },
    { assetId: 'ethereum', symbol: 'ETH', quotes: [{ venue: 'binance', price: 10, assetId: 'ethereum', symbol: 'ETH' }] }
  ];

  it('aggregates per asset with best, average and opportunities', () => {
    const result = aggregateVenues(rows, { assetMeta: (id) => ({ symbol: id === 'bitcoin' ? 'BTC' : 'ETH' }) });
    expect(result.perAsset).toHaveLength(2);
    const btc = result.perAsset[0];
    expect(btc.best.venues).toBe(2);
    expect(btc.quotes[0].price).toBe(100.5); // sorted desc
    expect(btc.opportunities.length).toBeGreaterThan(0);
  });

  it('builds a venue leaderboard by best-price wins', () => {
    const lb = venueLeaderboard(rows);
    expect(lb.length).toBe(2);
    expect(lb.every((v) => v.assets > 0)).toBe(true);
    expect(lb[0].wins).toBeGreaterThanOrEqual(lb[lb.length - 1].wins);
  });

  it('summarises the aggregate pass', () => {
    const result = aggregateVenues(rows, { assetMeta: () => ({}) });
    const s = summariseAggregate(result);
    expect(s.assets).toBe(2);
    expect(s.multiVenueAssets).toBe(1);
    expect(s.opportunities).toBeGreaterThan(0);
    expect(s.tightestSpread.symbol).toBeTruthy();
  });

  it('is empty-safe', () => {
    const s = summariseAggregate(aggregateVenues([]));
    expect(s.assets).toBe(0);
    expect(s.bestNetPct).toBeNull();
  });
});

describe('alert rules', () => {
  it('describes every rule type', () => {
    RULE_TYPES.forEach((type) => {
      const text = describeRule({ type, symbol: 'BTC', value: 10, periods: [9, 21] });
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });
  });

  it('fires price crossovers in the right direction', () => {
    const above = { type: 'price_above', symbol: 'BTC', value: 100 };
    expect(evaluateRule(above, { price: 105, prevPrice: 99 }).triggered).toBe(true);
    expect(evaluateRule(above, { price: 105, prevPrice: 104 }).triggered).toBe(false);

    const below = { type: 'price_below', symbol: 'BTC', value: 100 };
    expect(evaluateRule(below, { price: 95, prevPrice: 101 }).triggered).toBe(true);
    expect(evaluateRule(below, { price: 99, prevPrice: 98 }).triggered).toBe(false);
  });

  it('handles pct change, volume spikes and RSI', () => {
    expect(evaluateRule({ type: 'pct_change', symbol: 'BTC', value: 5 }, { pct24: -7 }).triggered).toBe(true);
    expect(evaluateRule({ type: 'pct_change', symbol: 'BTC', value: 5 }, { pct24: 2 }).triggered).toBe(false);
    expect(evaluateRule({ type: 'volume_spike', symbol: 'BTC', value: 3 }, { volume: 400, volumeAvg: 100 }).triggered).toBe(true);
    expect(evaluateRule({ type: 'volume_spike', symbol: 'BTC', value: 3 }, { volume: 200, volumeAvg: 100 }).triggered).toBe(false);
    expect(evaluateRule({ type: 'rsi_below', symbol: 'BTC', value: 30 }, { rsi: 28, prevRsi: 32 }).triggered).toBe(true);
    expect(evaluateRule({ type: 'rsi_above', symbol: 'BTC', value: 70 }, { rsi: 75, prevRsi: 68 }).triggered).toBe(true);
  });

  it('detects MA, MACD and breakout events', () => {
    expect(evaluateRule({ type: 'ma_cross', symbol: 'BTC' }, { maFast: 11, maSlow: 10, prevMaFast: 9, prevMaSlow: 10 }).detail).toBe('golden cross');
    expect(evaluateRule({ type: 'ma_cross', symbol: 'BTC' }, { maFast: 9, maSlow: 10, prevMaFast: 11, prevMaSlow: 10 }).detail).toBe('death cross');
    expect(evaluateRule({ type: 'macd_cross', symbol: 'BTC' }, { macd: 1, macdSignal: 0.5, prevMacd: 0.4, prevMacdSignal: 0.6 }).detail).toBe('bullish cross');
    expect(evaluateRule({ type: 'breakout', symbol: 'BTC' }, { price: 120, high: 110, low: 90 }).triggered).toBe(true);
    expect(evaluateRule({ type: 'breakout', symbol: 'BTC' }, { price: 100, high: 110, low: 90 }).triggered).toBe(false);
  });

  it('returns no trigger when the context is missing', () => {
    RULE_TYPES.forEach((type) => {
      expect(evaluateRule({ type, symbol: 'BTC', value: 10 }, {}).triggered).toBe(false);
    });
    expect(evaluateRule({ type: 'nonsense' }, {}).reason).toMatch(/unknown/);
  });

  it('evaluates all enabled rules and applies a cooldown', () => {
    const rules = [
      { id: 'r1', type: 'price_above', symbol: 'BTC', value: 100, enabled: true },
      { id: 'r2', type: 'price_above', symbol: 'ETH', value: 100, enabled: false }
    ];
    const hits = evaluateAll(rules, { BTC: { price: 105, prevPrice: 90 } }, 1000);
    expect(hits).toHaveLength(1);
    expect(hits[0].ruleId).toBe('r1');

    const first = applyCooldown(hits, {}, 60000, 2000);
    expect(first.fired).toHaveLength(1);
    const second = applyCooldown(hits, first.lastFired, 60000, 3000);
    expect(second.fired).toHaveLength(0); // inside cooldown
    const third = applyCooldown(hits, first.lastFired, 60000, 200000);
    expect(third.fired).toHaveLength(1); // cooldown elapsed
  });

  it('validates rules', () => {
    expect(validateRule({ symbol: 'BTC', type: 'price_above', value: 100 }).ok).toBe(true);
    expect(validateRule({ type: 'price_above', value: 100 }).ok).toBe(false);
    expect(validateRule({ symbol: 'BTC', type: 'rsi_above', value: 150 }).ok).toBe(false);
    expect(validateRule({ symbol: 'BTC', type: 'ma_cross', periods: [50, 20] }).ok).toBe(false);
    expect(validateRule({ symbol: 'BTC', type: 'ma_cross', periods: [9, 21] }).ok).toBe(true);
  });
});
