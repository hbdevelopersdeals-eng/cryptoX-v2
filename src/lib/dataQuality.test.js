import { describe, it, expect } from 'vitest';
import {
  median, deviationPct, isStale, detectOutliers, sourceConfidence, aggregateAsset, qualitySummary
} from './dataQuality.js';
import {
  ASSETS, VENUE_IDS, assetById, assetBySymbol, venueSymbol, assetIdFromVenueSymbol, coverageMatrix, pairsForAsset
} from './assets.js';
import { krakenKeyToPair, krakenSymbolToPair } from './sources.js';

const q = (price, venue = 'binance', ts = Date.now(), assetId = 'bitcoin') => ({
  venue, assetId, symbol: 'BTC', nativeSymbol: 'BTCUSDT', price, ts, changePct: 1, volumeQuote: 1000
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('ignores non-numbers and empty input', () => {
    expect(median([1, 'x', null, 3])).toBe(2);
    expect(median([])).toBeNull();
    expect(median(null)).toBeNull();
  });
});

describe('deviationPct', () => {
  it('computes absolute percentage deviation', () => {
    expect(deviationPct(101, 100)).toBeCloseTo(1, 5);
    expect(deviationPct(99, 100)).toBeCloseTo(1, 5);
  });
  it('returns null on bad input', () => {
    expect(deviationPct(1, 0)).toBeNull();
    expect(deviationPct(null, 100)).toBeNull();
  });
});

describe('isStale', () => {
  it('flags old timestamps', () => {
    const now = Date.now();
    expect(isStale(now - 1000, now, 60000)).toBe(false);
    expect(isStale(now - 90000, now, 60000)).toBe(true);
    expect(isStale(null, now, 60000)).toBe(true);
  });
});

describe('detectOutliers', () => {
  it('keeps agreeing quotes and flags the odd one out', () => {
    const { reference, outliers, kept } = detectOutliers([q(100), q(100.2), q(140)], 0.75);
    expect(reference).toBeCloseTo(100.2, 5);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].price).toBe(140);
    expect(kept).toHaveLength(2);
  });
  it('flags nothing when all sources agree', () => {
    const { outliers } = detectOutliers([q(100), q(100.1), q(99.9)]);
    expect(outliers).toHaveLength(0);
  });
  it('is safe with no usable quotes', () => {
    expect(detectOutliers([]).reference).toBeNull();
    expect(detectOutliers([q(0)]).reference).toBeNull();
  });
});

describe('sourceConfidence', () => {
  it('scores tier 1 above tier 2 for identical conditions', () => {
    const t1 = sourceConfidence({ tier: 1, ageSeconds: 0, quotesReturned: 20 });
    const t2 = sourceConfidence({ tier: 2, ageSeconds: 0, quotesReturned: 20 });
    expect(t1).toBeGreaterThan(t2);
  });
  it('penalises staleness', () => {
    expect(sourceConfidence({ tier: 1, ageSeconds: 0, quotesReturned: 20 }))
      .toBeGreaterThan(sourceConfidence({ tier: 1, ageSeconds: 120, quotesReturned: 20 }));
  });
  it('is zero for a failed source and always within 0..100', () => {
    expect(sourceConfidence({ failed: true })).toBe(0);
    const max = sourceConfidence({ tier: 1, ageSeconds: -1000, quotesReturned: 100, agreementPct: 0 });
    expect(max).toBeLessThanOrEqual(100);
    expect(sourceConfidence({ tier: 2, ageSeconds: 99999, quotesReturned: 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe('aggregateAsset', () => {
  const now = Date.now();
  it('builds a consensus from fresh, agreeing quotes', () => {
    const row = aggregateAsset('bitcoin', [q(100, 'binance', now), q(100.4, 'okx', now), q(99.8, 'kraken', now)], { now });
    expect(row.consensus).toBeCloseTo(100, 1);
    expect(row.sources).toBe(3);
    expect(row.spreadPct).toBeGreaterThan(0);
    expect(row.confidence).toBeGreaterThan(0);
    expect(row.outliers).toHaveLength(0);
  });

  it('excludes stale quotes from the consensus', () => {
    const row = aggregateAsset('bitcoin', [q(100, 'binance', now), q(500, 'kraken', now - 300000)], { now });
    expect(row.sources).toBe(1);
    expect(row.staleCount).toBe(1);
    expect(row.consensus).toBe(100);
  });

  it('drops outliers but still reports them', () => {
    const row = aggregateAsset('bitcoin', [q(100, 'binance', now), q(100.2, 'okx', now), q(200, 'kucoin', now)], { now });
    expect(row.outliers).toHaveLength(1);
    expect(row.consensus).toBeLessThan(101);
  });

  it('is empty-safe', () => {
    const row = aggregateAsset('bitcoin', [], { now });
    expect(row.consensus).toBeNull();
    expect(row.confidence).toBe(0);
  });
});

describe('qualitySummary', () => {
  it('counts sources, outliers, stale rows and merged duplicates', () => {
    const now = Date.now();
    const rows = [
      aggregateAsset('bitcoin', [q(100, 'binance', now), q(100.1, 'okx', now), q(200, 'kucoin', now)], { now }),
      aggregateAsset('ethereum', [q(10, 'binance', now - 300000)], { now })
    ];
    const summary = qualitySummary(rows, [{ status: 'live' }, { status: 'down' }]);
    expect(summary.assets).toBe(2);
    expect(summary.sourcesLive).toBe(1);
    expect(summary.sourcesDown).toBe(1);
    expect(summary.outliersFlagged).toBe(1);
    expect(summary.staleRejected).toBe(1);
  });
});

describe('asset registry', () => {
  it('has unique ids and symbols', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
    expect(new Set(ASSETS.map((a) => a.symbol)).size).toBe(ASSETS.length);
  });

  it('maps symbols in both directions', () => {
    expect(assetById('bitcoin').symbol).toBe('BTC');
    expect(assetBySymbol('btc').id).toBe('bitcoin');
    expect(assetBySymbol('nope')).toBeNull();
  });

  it('exposes venue-native symbols', () => {
    expect(venueSymbol('bitcoin', 'kraken')).toBe('XBT/USD');
    expect(venueSymbol('bitcoin', 'coinbase')).toBe('BTC-USD');
    expect(assetIdFromVenueSymbol('okx', 'BTC-USDT')).toBe('bitcoin');
    expect(assetIdFromVenueSymbol('okx', 'NOPE-USDT')).toBeNull();
  });

  it('reports coverage for every venue', () => {
    const matrix = coverageMatrix();
    expect(matrix).toHaveLength(ASSETS.length);
    matrix.forEach((row) => {
      expect(row.venues.length).toBeGreaterThan(0);
      row.venues.forEach((v) => expect(VENUE_IDS).toContain(v));
    });
    expect(pairsForAsset('bitcoin').length).toBeGreaterThan(3);
  });
});

describe('kraken symbol mapping', () => {
  it('normalises prefixed keys', () => {
    expect(krakenKeyToPair('XXBTZUSD')).toBe('BTCUSD');
    expect(krakenKeyToPair('XETHZUSD')).toBe('ETHUSD');
    expect(krakenKeyToPair('XDOTZUSD')).toBe('DOTUSD');
  });
  it('leaves unprefixed keys alone', () => {
    expect(krakenKeyToPair('SOLUSD')).toBe('SOLUSD');
    expect(krakenKeyToPair('ARBUSD')).toBe('ARBUSD');
  });
  it('normalises stored venue symbols with the XBT alias', () => {
    expect(krakenSymbolToPair('XBT/USD')).toBe('BTCUSD');
    expect(krakenSymbolToPair('ETH/USD')).toBe('ETHUSD');
    expect(krakenSymbolToPair('')).toBeNull();
  });
  it('returns null for unknown shapes', () => {
    expect(krakenKeyToPair('!!')).toBeNull();
  });
});
