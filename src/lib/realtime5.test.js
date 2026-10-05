import { describe, it, expect, vi } from 'vitest';
import { parsePremiumIndex, parseOpenInterest, parseLiquidation } from './derivatives.js';
import { BackpressureQueue, throttle, driftBps, reconcileTopOfBook, Reconciler } from './backpressure.js';
import { parseBlockNumber } from './chainHead.js';

describe('derivatives parsers', () => {
  it('parses funding / mark price', () => {
    const out = parsePremiumIndex({ symbol: 'BTCUSDT', markPrice: '60123.45', indexPrice: '60100', lastFundingRate: '0.0001', nextFundingTime: 1700000000000 });
    expect(out.markPrice).toBeCloseTo(60123.45, 2);
    expect(out.fundingRate).toBeCloseTo(0.0001, 8);
    expect(out.symbol).toBe('BTCUSDT');
  });
  it('rejects unusable funding payloads', () => {
    expect(parsePremiumIndex(null)).toBeNull();
    expect(parsePremiumIndex({})).toBeNull();
    expect(parsePremiumIndex({ markPrice: 'abc' })).toBeNull();
  });

  it('parses open interest', () => {
    expect(parseOpenInterest({ symbol: 'ETHUSDT', openInterest: '123456.7' }).openInterest).toBeCloseTo(123456.7, 2);
    expect(parseOpenInterest({})).toBeNull();
    expect(parseOpenInterest(null)).toBeNull();
  });

  it('normalises liquidation events and their side', () => {
    const long = parseLiquidation({ o: { s: 'BTCUSDT', S: 'SELL', ap: '60000', q: '0.5', T: 1700000000000 } });
    expect(long.side).toBe('long_liquidation');
    expect(long.notional).toBeCloseTo(30000, 2);

    const short = parseLiquidation({ data: { o: { s: 'ETHUSDT', S: 'BUY', p: '3000', q: '2' } } });
    expect(short.side).toBe('short_liquidation');
    expect(short.price).toBe(3000);

    expect(parseLiquidation({})).toBeNull();
    expect(parseLiquidation({ o: { s: 'X' } })).toBeNull();
  });
});

describe('BackpressureQueue', () => {
  it('accepts up to capacity then drops the oldest by default', () => {
    const q = new BackpressureQueue(2);
    expect(q.push(1).accepted).toBe(true);
    expect(q.push(2).accepted).toBe(true);
    const res = q.push(3);
    expect(res.accepted).toBe(true);   // the new item is kept
    expect(res.evicted).toBe(true);    // the oldest one is evicted
    expect(q.stats().dropped).toBe(1);
    expect(q.stats().depth).toBe(2);
    // oldest (1) was evicted
    const seen = [];
    q.drain((x) => seen.push(x));
    expect(seen).toEqual([2, 3]);
  });

  it('supports a drop-newest policy', () => {
    const q = new BackpressureQueue(1, 'drop_newest');
    q.push('a');
    const res = q.push('b');
    expect(res.accepted).toBe(false);
    const seen = [];
    q.drain((x) => seen.push(x));
    expect(seen).toEqual(['a']);
  });

  it('drains a bounded number and reports pressure', () => {
    const q = new BackpressureQueue(10);
    for (let i = 0; i < 5; i++) q.push(i);
    const seen = [];
    expect(q.drain((x) => seen.push(x), 2)).toBe(2);
    expect(q.stats().depth).toBe(3);
    expect(q.stats().pressure).toBe(30);
    expect(q.stats().highWater).toBe(5);
    q.clear();
    expect(q.stats().depth).toBe(0);
  });
});

describe('throttle', () => {
  it('runs immediately then coalesces trailing calls', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const throttled = throttle(spy, 100);
    throttled('a');
    expect(spy).toHaveBeenCalledTimes(1);
    throttled('b');
    throttled('c');
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('c'); // last call wins
    vi.useRealTimers();
  });
});

describe('reconciliation', () => {
  it('computes drift in basis points', () => {
    expect(driftBps(100, 100)).toBe(0);
    expect(driftBps(100.05, 100)).toBeCloseTo(5, 5);
    expect(driftBps(null, 100)).toBeNull();
  });

  it('flags stream/REST mismatches beyond tolerance', () => {
    const ok = reconcileTopOfBook({ wsBid: 100, wsAsk: 100.1, restBid: 100.01, restAsk: 100.09 }, { toleranceBps: 10 });
    expect(ok.ok).toBe(true);

    const bad = reconcileTopOfBook({ wsBid: 100, wsAsk: 100.1, restBid: 101, restAsk: 101.1 }, { toleranceBps: 10 });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.field).sort()).toEqual(['ask', 'bid']);
    expect(bad.maxDriftBps).toBeGreaterThan(10);
  });

  it('summarises reconciliation over time', () => {
    const r = new Reconciler();
    r.record({ wsBid: 100, wsAsk: 100.1, restBid: 100, restAsk: 100.1 });
    r.record({ wsBid: 100, wsAsk: 100.1, restBid: 105, restAsk: 105.1 });
    const s = r.summary();
    expect(s.checks).toBe(2);
    expect(s.mismatches).toBe(1);
    expect(s.mismatchRate).toBeCloseTo(0.5, 5);
    expect(s.worstBps).toBeGreaterThan(100);
  });
});

describe('parseBlockNumber', () => {
  it('decodes hex block heights', () => {
    expect(parseBlockNumber({ result: '0x10' })).toBe(16);
    expect(parseBlockNumber({ result: '0x112a880' })).toBe(18000000);
  });
  it('rejects bad payloads', () => {
    expect(parseBlockNumber({})).toBeNull();
    expect(parseBlockNumber({ result: 123 })).toBeNull();
    expect(parseBlockNumber(null)).toBeNull();
  });
});
