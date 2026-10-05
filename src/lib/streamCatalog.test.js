import { describe, it, expect } from 'vitest';
import {
  REQUIRED_KINDS, STREAMS, streamByKind, streamById, socketStreams, unsequencedStreams,
  buildStreamSet, catalogCoverage, HEARTBEAT, FAILOVER, DELIVERY, nextHost
} from './streamCatalog.js';

describe('stream catalog', () => {
  it('covers every data type the spec requires', () => {
    const kinds = STREAMS.map((s) => s.kind);
    REQUIRED_KINDS.forEach((k) => expect(kinds, `missing ${k}`).toContain(k));
    expect(REQUIRED_KINDS).toHaveLength(7);
  });

  it('documents each stream with a payload and a note', () => {
    STREAMS.forEach((s) => {
      expect(s.payload.length).toBeGreaterThan(3);
      expect(s.note.length).toBeGreaterThan(20);
      expect(typeof s.default).toBe('boolean');
    });
  });

  it('marks open interest as REST-polled rather than pretending it streams', () => {
    const oi = streamByKind('openInterest');
    expect(oi.transport).toBe('rest');
    expect(oi.suffix).toBeNull();
    expect(oi.note).toMatch(/no public websocket/i);
    expect(socketStreams().map((s) => s.kind)).not.toContain('openInterest');
  });

  it('records the venue sequence field where one exists', () => {
    expect(streamByKind('trades').sequencedBy).toBe('a');
    expect(streamByKind('orderbook').sequencedBy).toBe('u');
    expect(streamByKind('klines').sequencedBy).toBe('k.t');
    // Tickers carry no usable sequence, and the catalog says so.
    expect(streamByKind('tickers').sequencedBy).toBeNull();
    expect(unsequencedStreams()).toContain('tickers');
  });

  it('resolves streams by kind and id', () => {
    expect(streamByKind('funding').id).toBe('markPrice');
    expect(streamById('aggTrade').kind).toBe('trades');
    expect(streamByKind('nope')).toBeNull();
  });
});

describe('stream set composition', () => {
  it('builds a multi-symbol combined stream list from the defaults', () => {
    const list = buildStreamSet({ symbols: ['btcusdt', 'ethusdt'] });
    expect(list).toContain('btcusdt@aggTrade');
    expect(list).toContain('ethusdt@ticker');
    expect(list).toContain('btcusdt@markPrice@1s');
    // Liquidations are per-symbol and opt-in.
    expect(list.some((s) => s.includes('forceOrder'))).toBe(false);
  });

  it('includes liquidations only when asked', () => {
    const list = buildStreamSet({ symbols: ['BTCUSDT'], includeLiquidations: true });
    expect(list).toContain('btcusdt@forceOrder');
  });

  it('lowercases symbols because the venue requires it', () => {
    expect(buildStreamSet({ symbols: ['BTCUSDT'], kinds: ['trades'] })).toEqual(['btcusdt@aggTrade']);
  });

  it('honours an explicit kind filter', () => {
    const list = buildStreamSet({ symbols: ['btcusdt'], kinds: ['klines'] });
    expect(list).toEqual(['btcusdt@kline_1m']);
  });

  it('never emits a REST-only stream into the socket URL', () => {
    const list = buildStreamSet({ symbols: ['btcusdt'], kinds: ['openInterest'] });
    expect(list).toEqual([]);
  });
});

describe('coverage reporting', () => {
  it('reports what the default subscriptions cover', () => {
    const c = catalogCoverage();
    expect(c.required).toBe(7);
    // Tickers and funding are now default; liquidations and OI are not.
    expect(c.coveredKinds).toContain('trades');
    expect(c.coveredKinds).toContain('tickers');
    expect(c.coveredKinds).toContain('funding');
    expect(c.missing).toContain('liquidations');
    expect(c.missing).toContain('openInterest');
    expect(c.restPolled).toContain('openInterest');
    expect(c.covered + c.missing.length).toBe(c.required);
  });

  it('reports full coverage when every kind is enabled', () => {
    const c = catalogCoverage({ enabledKinds: [...REQUIRED_KINDS] });
    expect(c.covered).toBe(7);
    expect(c.missing).toEqual([]);
  });
});

describe('heartbeat policy', () => {
  it('does not claim an application-level ping a browser cannot send', () => {
    expect(HEARTBEAT.mechanism).toBe('silence-watchdog');
    expect(HEARTBEAT).not.toHaveProperty('pingIntervalMs');
  });

  it('requires a fast stream so liveness is observable', () => {
    expect(HEARTBEAT.requiredFastStreams.length).toBeGreaterThanOrEqual(1);
    // Both named fast streams must exist in the catalog with sub-second cadence.
    HEARTBEAT.requiredFastStreams.forEach((id) => {
      const s = streamById(id);
      expect(s, id).not.toBeNull();
      expect(s.suffix).toMatch(/1s|ticker/);
    });
    expect(HEARTBEAT.silenceTimeoutMs).toBeGreaterThan(HEARTBEAT.expectedMessageIntervalMs);
  });

  it('explains why silence alone is insufficient', () => {
    expect(HEARTBEAT.note).toMatch(/idle/i);
  });
});

describe('failover policy', () => {
  it('lists an ordered primary and fallback for both transports', () => {
    expect(FAILOVER.websocket.length).toBeGreaterThanOrEqual(2);
    expect(FAILOVER.rest.length).toBeGreaterThanOrEqual(2);
    expect(FAILOVER.strategy).toBe('ordered');
    FAILOVER.websocket.forEach((h) => expect(h.url.startsWith('wss://')).toBe(true));
    FAILOVER.rest.forEach((h) => expect(h.url.startsWith('https://')).toBe(true));
  });

  it('rotates to the next host and wraps around', () => {
    const hosts = FAILOVER.websocket;
    expect(nextHost(hosts, null)).toBe(hosts[0]);
    expect(nextHost(hosts, hosts[0].url)).toBe(hosts[1]);
    expect(nextHost(hosts, hosts[hosts.length - 1].url)).toBe(hosts[0]);
    // An unknown current host falls back to the primary rather than throwing.
    expect(nextHost(hosts, 'wss://nope')).toBe(hosts[0]);
    expect(nextHost([], null)).toBeNull();
  });
});

describe('delivery guarantees', () => {
  it('states its limits rather than implying durability', () => {
    expect(DELIVERY.atMostOnce).toMatch(/at most once/i);
    expect(DELIVERY.note).toMatch(/not durable/i);
    expect(DELIVERY.replayWindow).toBeGreaterThan(0);
    expect(DELIVERY.dlqCapacity).toBeGreaterThan(0);
    expect(DELIVERY.queueCapacity).toBeGreaterThan(0);
    expect(DELIVERY.gapDetection.length).toBeGreaterThan(20);
    expect(DELIVERY.reconciliation.length).toBeGreaterThan(20);
  });
});
