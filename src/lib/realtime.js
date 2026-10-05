import { useEffect, useRef, useState } from 'react';
import { reportError } from './telemetry.js';
import { BackpressureQueue, throttle } from './backpressure.js';

/* Real-time data engine (browser-side).
 *
 * Covers the client-feasible parts of the real-time spec:
 *   WebSocket ingestion · automatic reconnect with exponential backoff + jitter
 *   heartbeat/ping watchdog · event sequencing · gap detection · replay buffer
 *   dead-letter queue · backpressure with a bounded queue · REST fallback and
 *   provider failover.
 *
 * Not covered here (needs server infrastructure): durable event logs,
 * exactly-once delivery, cross-region fan-out, blockchain event indexing.
 */

export const WS_HOSTS = [
  'wss://stream.binance.com:9443',
  'wss://data-stream.binance.vision'
];

export const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

export const DEFAULT_STREAMS = ['btcusdt@aggTrade', 'btcusdt@depth20@100ms', 'btcusdt@kline_1m', 'ethusdt@aggTrade'];

export const SILENCE_TIMEOUT_MS = 30000;
export const MAX_REPLAY_EVENTS = 200;
export const MAX_DLQ = 50;
export const QUEUE_CAPACITY = 1000;
export const PUBLISH_INTERVAL_MS = 250;

/* ---------------- pure helpers (unit tested) ---------------- */

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt, { base = 500, cap = 30000, random = Math.random } = {}) {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Fixed-size ring buffer used for replay. */
export class RingBuffer {
  constructor(capacity = MAX_REPLAY_EVENTS) {
    this.capacity = capacity;
    this.items = [];
  }
  push(item) {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return item;
  }
  toArray() {
    return [...this.items];
  }
  get size() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
}

/** Bounded dead-letter queue for events a handler could not process. */
export class DeadLetterQueue {
  constructor(capacity = MAX_DLQ) {
    this.capacity = capacity;
    this.items = [];
  }
  add(entry) {
    this.items.push({ ...entry, at: Date.now() });
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return entry;
  }
  toArray() {
    return [...this.items];
  }
  get size() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
}

/** Extract the monotonic sequence number a stream exposes, if any. */
export function sequenceOf(stream, data) {
  if (!data) return null;
  if (stream.includes('aggTrade') && Number.isFinite(data.a)) return data.a;
  if (stream.includes('depth') && Number.isFinite(data.u)) return data.u;
  if (stream.includes('kline') && Number.isFinite(data.k?.t)) return data.k.t;
  if (stream === '!forceOrder@arr' && Number.isFinite(data.o?.T)) return data.o.T;
  if (Number.isFinite(data.E)) return data.E;
  return null;
}

/** Per-stream sequencing: detects gaps, duplicates and out-of-order events. */
export class SequenceTracker {
  constructor() {
    this.state = new Map();
  }
  observe(stream, sequence) {
    const prev = this.state.get(stream);
    if (sequence == null) return { status: 'unsequenced' };
    if (!prev) {
      this.state.set(stream, { last: sequence, gaps: 0, duplicates: 0, outOfOrder: 0 });
      return { status: 'start' };
    }
    if (sequence === prev.last) {
      prev.duplicates += 1;
      return { status: 'duplicate' };
    }
    if (sequence < prev.last) {
      prev.outOfOrder += 1;
      return { status: 'out_of_order' };
    }
    const expectedNext = prev.last + 1;
    const gap = sequence - expectedNext;
    prev.last = sequence;
    if (gap > 0) {
      prev.gaps += 1;
      return { status: 'gap', missed: gap };
    }
    return { status: 'ok' };
  }
  stats(stream) {
    return this.state.get(stream) || { last: null, gaps: 0, duplicates: 0, outOfOrder: 0 };
  }
  allStats() {
    return Object.fromEntries(this.state.entries());
  }
}

export function combinedStreamUrl(host, streams) {
  return `${host}/stream?streams=${streams.join('/')}`;
}

/* ---------------- engine hook ---------------- */

const initialStreamState = () => ({
  status: 'idle',
  messages: 0,
  lastAt: null,
  lastSequence: null,
  gaps: 0,
  duplicates: 0,
  outOfOrder: 0,
  reconnects: 0,
  host: null
});

/**
 * Starts the engine for the given streams and returns live status.
 * opts: { streams, enabled, onEvent }
 */
export function useRealtimeEngine({ streams = DEFAULT_STREAMS, enabled = true, onEvent } = {}) {
  const [status, setStatus] = useState(() => ({
    state: 'idle',
    host: null,
    attempt: 0,
    reconnects: 0,
    messages: 0,
    lastMessageAt: null,
    silenceMs: null,
    fallback: false,
    streams: {},
    replaySize: 0,
    dlqSize: 0,
    lastGap: null,
    queue: { depth: 0, capacity: QUEUE_CAPACITY, dropped: 0, enqueued: 0, pressure: 0, highWater: 0, policy: 'drop_oldest' }
  }));

  const socketRef = useRef(null);
  const seqRef = useRef(new SequenceTracker());
  const replayRef = useRef(new RingBuffer());
  const dlqRef = useRef(new DeadLetterQueue());
  const queueRef = useRef(new BackpressureQueue(QUEUE_CAPACITY, 'drop_oldest'));
  const handlerRef = useRef(onEvent);
  const attemptRef = useRef(0);
  const hostIdxRef = useRef(0);
  const closedByUsRef = useRef(false);
  const msgRef = useRef(0);
  const gapRef = useRef(null);
  const timerRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') {
      setStatus((s) => ({ ...s, state: enabled ? 'unsupported' : 'disabled' }));
      return undefined;
    }
    closedByUsRef.current = false;
    let alive = true;

    const publish = (patch = {}) => {
      if (!alive) return;
      setStatus((s) => {
        const nextStreams = { ...s.streams };
        (patch.streams || []).forEach((name) => {
          const stats = seqRef.current.stats(name);
          nextStreams[name] = {
            ...initialStreamState(),
            ...(nextStreams[name] || {}),
            gaps: stats.gaps,
            duplicates: stats.duplicates,
            outOfOrder: stats.outOfOrder,
            lastSequence: stats.last
          };
        });
        return {
          ...s,
          ...patch,
          streams: nextStreams,
          replaySize: replayRef.current.size,
          dlqSize: dlqRef.current.size,
          queue: queueRef.current.stats()
        };
      });
    };

    const startFallback = () => {
      if (fallbackTimerRef.current) return;
      publish({ fallback: true });
      // Provider failover: keep data flowing from REST while the socket is down.
      fallbackTimerRef.current = setInterval(async () => {
        for (const host of REST_HOSTS) {
          try {
            const res = await fetch(`${host}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT']))}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();
            rows.forEach((row) => {
              const item = { stream: `${row.symbol.toLowerCase()}@ticker`, data: row, at: Date.now() };
              replayRef.current.push({ ...item, source: 'rest-fallback' });
              try {
                handlerRef.current?.({ ...item, viaFallback: true });
              } catch (err) {
                dlqRef.current.add({ stream: row.symbol, error: String(err?.message || err) });
              }
            });
            publish({ lastMessageAt: Date.now() });
            return;
          } catch (err) {
            reportError(err, { kind: 'realtime.restFallback', host });
          }
        }
      }, 5000);
    };

    const stopFallback = () => {
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      publish({ fallback: false });
    };

    /* Process one queued event: sequencing, replay, handler + dead-lettering. */
    const processItem = (item) => {
      if (!item) return;
      const { stream = 'unknown', data } = item;
      const seq = sequenceOf(stream, data);
      const verdict = seqRef.current.observe(stream, seq);
      if (verdict.status === 'gap') gapRef.current = { stream, missed: verdict.missed, at: Date.now() };

      msgRef.current += 1;
      replayRef.current.push({ stream, data, at: item.at || Date.now() });

      try {
        handlerRef.current?.({ stream, data });
      } catch (err) {
        dlqRef.current.add({ stream, error: String(err?.message || err), payload: JSON.stringify(data).slice(0, 120) });
      }
    };

    /* Publishing to React is throttled so a burst cannot cause a render storm. */
    const flush = throttle(() => {
      queueRef.current.drain(processItem, 500);
      publish({
        lastMessageAt: Date.now(),
        messages: msgRef.current,
        streams,
        lastGap: gapRef.current
      });
    }, PUBLISH_INTERVAL_MS);

    const connect = () => {
      if (!alive) return;
      const host = WS_HOSTS[hostIdxRef.current % WS_HOSTS.length];
      publish({ state: attemptRef.current === 0 ? 'connecting' : 'reconnecting', host, attempt: attemptRef.current });
      let socket;
      try {
        socket = new WebSocket(combinedStreamUrl(host, streams));
      } catch (err) {
        reportError(err, { kind: 'realtime.construct', host });
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        stopFallback();
        publish({ state: 'live', host, attempt: 0, streams });
      };

      socket.onmessage = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch (err) {
          dlqRef.current.add({ stream: 'unknown', error: 'json parse', payload: String(event.data).slice(0, 120) });
          return;
        }
        const stream = parsed?.stream || 'unknown';
        const data = parsed?.data ?? parsed;
        // Backpressure: bounded queue with drop-oldest overflow protection.
        queueRef.current.push({ stream, data, at: Date.now() });
        flush();
      };

      socket.onerror = () => publish({ state: 'error', host });

      socket.onclose = () => {
        if (closedByUsRef.current || !alive) return;
        startFallback();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      attemptRef.current += 1;
      hostIdxRef.current += 1; // provider failover: alternate hosts
      const delay = backoffDelay(attemptRef.current);
      publish({ state: 'reconnecting', attempt: attemptRef.current, reconnects: attemptRef.current });
      timerRef.current = setTimeout(connect, delay);
    };

    // Heartbeat watchdog: force a reconnect if the socket goes silent.
    const watchdog = setInterval(() => {
      const last = statusRef.current.lastMessageAt;
      const silenceMs = last ? Date.now() - last : null;
      publish({ silenceMs });
      if (silenceMs != null && silenceMs > SILENCE_TIMEOUT_MS && socketRef.current) {
        try { socketRef.current.close(); } catch { /* noop */ }
      }
    }, 5000);

    connect();

    return () => {
      alive = false;
      closedByUsRef.current = true;
      clearInterval(watchdog);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fallbackTimerRef.current) clearInterval(fallbackTimerRef.current);
      try { socketRef.current?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streams.join('|')]);

  return {
    status,
    replay: () => replayRef.current.toArray(),
    deadLetters: () => dlqRef.current.toArray(),
    clearDeadLetters: () => dlqRef.current.clear(),
    sequences: () => seqRef.current.allStats(),
    queueStats: () => queueRef.current.stats()
  };
}
