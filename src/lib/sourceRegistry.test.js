import { describe, it, expect } from 'vitest';
import {
  SOURCES, SOURCE_KINDS, LICENCE, sourceById, registrySummary,
  QUOTE_CONTRACT, ID_SPACES, cxComposite, confidenceScore, confidenceBand
} from './sourceRegistry.js';

const NOW = Date.UTC(2026, 9, 5, 12);

const q = (venue, price, extra = {}) => ({ venue, assetId: 'bitcoin', symbol: 'BTC', price, ts: NOW, ...extra });

describe('source registry integrity', () => {
  it('gives every source a unique id and a valid kind, licence and status', () => {
    const ids = new Set();
    SOURCES.forEach((s) => {
      expect(ids.has(s.id), `duplicate source id ${s.id}`).toBe(false);
      ids.add(s.id);
      expect(SOURCE_KINDS[s.kind], `bad kind on ${s.id}`).toBeDefined();
      expect(LICENCE[s.licence], `bad licence on ${s.id}`).toBeDefined();
      expect(['live', 'available', 'unavailable']).toContain(s.status);
      expect(Array.isArray(s.provides) && s.provides.length, `no provides on ${s.id}`).toBeGreaterThan(0);
      expect(s.tier).toBeGreaterThanOrEqual(1);
    });
  });

  it('makes every unavailable source explain itself', () => {
    const missing = SOURCES.filter((s) => s.status === 'unavailable');
    expect(missing.length).toBeGreaterThan(0);
    missing.forEach((s) => {
      // An unexplained gap would be indistinguishable from an oversight.
      expect(s.note && s.note.length > 40, `${s.id} needs a reason`).toBe(true);
    });
  });

  it('registers every CEX the checklist names', () => {
    const ids = SOURCES.map((s) => s.id);
    ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'kucoin', 'bitget', 'gate', 'cryptocom', 'gemini', 'bitfinex', 'htx', 'mexc', 'deribit']
      .forEach((id) => expect(ids, `missing ${id}`).toContain(id));
  });

  it('lists CME as licence-gated rather than pretending to carry it', () => {
    const cme = sourceById('cme');
    expect(cme).not.toBeNull();
    expect(cme.status).toBe('unavailable');
    expect(cme.licence).toBe('commercial');
    expect(cme.note).toMatch(/licence|license/i);
  });

  it('treats CoinGecko as live and CoinMarketCap as licence-gated', () => {
    expect(sourceById('coingecko').status).toBe('live');
    const cmc = sourceById('coinmarketcap');
    expect(cmc.status).toBe('unavailable');
    expect(cmc.licence).toBe('commercial');
  });

  it('covers DEX, chain RPC and institutional categories', () => {
    const kinds = new Set(SOURCES.map((s) => s.kind));
    ['cex', 'dex', 'aggregator', 'chain', 'institutional', 'proprietary'].forEach((k) => {
      expect(kinds.has(k), `missing kind ${k}`).toBe(true);
    });
  });

  it('summarises status counts and surfaces every missing reason', () => {
    const s = registrySummary();
    expect(s.total).toBe(SOURCES.length);
    expect(s.live + s.available + s.unavailable).toBe(s.total);
    expect(s.missingReasons.length).toBe(s.unavailable);
    s.missingReasons.forEach((m) => expect(m.note.length).toBeGreaterThan(20));
  });

  it('declares the normalisation contract', () => {
    const required = QUOTE_CONTRACT.filter((f) => f.required).map((f) => f.field);
    ['venue', 'assetId', 'symbol', 'nativeSymbol', 'price', 'ts'].forEach((f) => {
      expect(required, `missing required field ${f}`).toContain(f);
    });
    QUOTE_CONTRACT.forEach((f) => expect(f.note.length).toBeGreaterThan(5));
  });

  it('declares every id space the checklist names', () => {
    const ids = ID_SPACES.map((i) => i.id);
    ['asset', 'exchange', 'chain', 'contract', 'symbol'].forEach((i) => {
      expect(ids, `missing id space ${i}`).toContain(i);
    });
  });

  it('resolves a source by id, or null', () => {
    expect(sourceById('binance').name).toBe('Binance');
    expect(sourceById('nope')).toBeNull();
  });
});

describe('CX-Index composite', () => {
  it('equal-weights venues when no comparable volume is published', () => {
    const r = cxComposite([{ assetId: 'bitcoin', symbol: 'BTC', quotes: [q('a', 100), q('b', 200)] }], { now: NOW });
    expect(r.assets).toHaveLength(1);
    expect(r.assets[0].price).toBeCloseTo(150, 6);
    expect(r.assets[0].weighting).toBe('equal');
    expect(r.assets[0].venues).toBe(2);
  });

  it('volume-weights venues when volume is available', () => {
    const r = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100, { volumeQuote: 100 }), q('b', 200, { volumeQuote: 300 })]
    }], { now: NOW });
    // 100*0.25 + 200*0.75 = 175
    expect(r.assets[0].price).toBeCloseTo(175, 6);
    expect(r.assets[0].weighting).toBe('volume');
  });

  it('drops an outlier before averaging', () => {
    // 100 and 100.2 sit inside the 0.75% deviation band around the median; 1000 is far outside.
    const r = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100), q('b', 100.2), q('bad', 1000)]
    }], { now: NOW });
    expect(r.assets[0].venues).toBe(2);
    expect(r.assets[0].dropped).toBe(1);
    expect(r.assets[0].price).toBeCloseTo(100.1, 6);
  });

  it('does not run outlier detection on a two-quote sample', () => {
    // With two quotes both are equidistant from the midpoint, so flagging them
    // would discard the asset entirely. Genuine dispersion must survive.
    const r = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100), q('b', 103)]
    }], { now: NOW });
    expect(r.assets[0].venues).toBe(2);
    expect(r.assets[0].dropped).toBe(0);
    expect(r.assets[0].price).toBeCloseTo(101.5, 6);
  });

  it('drops a stale quote instead of blending it in', () => {
    const r = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100), { ...q('stale', 999), ts: NOW - 120000 }]
    }], { now: NOW, maxAgeMs: 60000 });
    expect(r.assets[0].venues).toBe(1);
    expect(r.assets[0].price).toBeCloseTo(100, 6);
  });

  it('reports dispersion and a confidence score', () => {
    const tight = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100), q('b', 100.1), q('c', 99.9), q('d', 100.05), q('e', 100.02)]
    }], { now: NOW });
    const wide = cxComposite([{
      assetId: 'bitcoin', symbol: 'BTC',
      quotes: [q('a', 100), q('b', 101.4)]
    }], { now: NOW });
    expect(tight.assets[0].confidence).toBeGreaterThan(wide.assets[0].confidence);
    expect(tight.assets[0].dispersionPct).toBeLessThan(wide.assets[0].dispersionPct);
  });

  it('weights the index level by market cap when caps are known', () => {
    const r = cxComposite([
      { assetId: 'bitcoin', symbol: 'BTC', mcap: 1e12, quotes: [q('a', 100)] },
      { assetId: 'ethereum', symbol: 'ETH', mcap: 1e11, quotes: [{ ...q('a', 10), assetId: 'ethereum', symbol: 'ETH' }] }
    ], { now: NOW });
    expect(r.weighting).toBe('market-cap');
    expect(r.assetsIncluded).toBe(2);
    expect(r.level).toBeGreaterThan(0);
  });

  it('falls back to equal weighting when no market caps are supplied', () => {
    const r = cxComposite([
      { assetId: 'bitcoin', symbol: 'BTC', quotes: [q('a', 100)] },
      { assetId: 'ethereum', symbol: 'ETH', quotes: [{ ...q('a', 10), assetId: 'ethereum', symbol: 'ETH' }] }
    ], { now: NOW });
    expect(r.weighting).toBe('equal');
  });

  it('always labels itself as derived and disclaims being a benchmark', () => {
    const r = cxComposite([{ assetId: 'bitcoin', symbol: 'BTC', quotes: [q('a', 100)] }], { now: NOW });
    expect(r.kind).toBe('derived-composite');
    expect(r.disclaimer).toMatch(/not an investable index|Not an investable index/i);
  });

  it('handles empty and unusable input without inventing a level', () => {
    const none = cxComposite([], { now: NOW });
    expect(none.assets).toEqual([]);
    expect(none.level).toBeNull();
    expect(none.confidence).toBe(0);

    const invalid = cxComposite([{ assetId: 'x', symbol: 'X', quotes: [{ venue: 'a', price: 0, ts: NOW }] }], { now: NOW });
    expect(invalid.assets).toEqual([]);
    expect(invalid.level).toBeNull();
  });
});

describe('confidence scoring', () => {
  it('rises with venue breadth', () => {
    expect(confidenceScore({ venues: 5, dispersionPct: 0.1 })).toBeGreaterThan(confidenceScore({ venues: 1, dispersionPct: 0.1 }));
  });

  it('falls as venues disagree', () => {
    expect(confidenceScore({ venues: 3, dispersionPct: 0.05 })).toBeGreaterThan(confidenceScore({ venues: 3, dispersionPct: 1.5 }));
  });

  it('penalises heavy outlier rejection', () => {
    expect(confidenceScore({ venues: 5, dispersionPct: 0.1, dropped: 0 }))
      .toBeGreaterThan(confidenceScore({ venues: 5, dispersionPct: 0.1, dropped: 3 }));
  });

  it('is zero with no venues and stays inside 0-100', () => {
    expect(confidenceScore({ venues: 0 })).toBe(0);
    const high = confidenceScore({ venues: 20, dispersionPct: 0 });
    expect(high).toBeLessThanOrEqual(100);
    expect(high).toBeGreaterThanOrEqual(0);
  });

  it('bands a score for display', () => {
    expect(confidenceBand(80)).toBe('high');
    expect(confidenceBand(50)).toBe('medium');
    expect(confidenceBand(10)).toBe('low');
    expect(confidenceBand(0)).toBe('none');
  });
});
