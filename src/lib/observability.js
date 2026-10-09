/* Observability (Section 23): structured logs, correlation and request IDs,
 * W3C trace context, and a metric registry.
 *
 * The three pillars, honestly:
 *   Logs    — implemented client-side, redacted, bounded, correlation-aware.
 *   Traces  — W3C Trace Context generated and propagated. Sampling is local;
 *             there is no collector, so spans are not exported anywhere.
 *   Metrics — a registry with per-metric AVAILABILITY declared. CPU and memory
 *             are not readable from a browser (performance.memory is
 *             non-standard and Chrome-only), and database metrics belong to the
 *             provider. Inventing numbers for those would be worse than an
 *             empty column.
 */

import { redactText } from './analytics.js';

/* ------------------------------------------------------------------- logging */

export const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
/** Security events are logged at their own level so they can be routed separately. */
export const LOG_KINDS = ['app', 'audit', 'security', 'access'];

/**
 * Structured logger.
 *
 * Two properties matter more than the formatting:
 *   - every field value is redacted, so a token pasted into a log message does
 *     not become a permanent record of it;
 *   - the buffer is bounded, because an unbounded in-memory log is a memory
 *     leak that only appears under the load that matters.
 */
export function createLogger({ level = 'info', limit = 500, now = () => new Date(), correlationId = null } = {}) {
  const entries = [];
  let currentCorrelationId = correlationId;

  const write = (kind, lvl, message, fields = {}) => {
    if (LOG_LEVELS[lvl] < LOG_LEVELS[level]) return null;
    const safe = {};
    for (const [k, v] of Object.entries(fields)) {
      safe[k] = typeof v === 'string' ? redactText(v).text : v;
    }
    const entry = Object.freeze({
      at: now().toISOString(),
      level: lvl,
      kind: LOG_KINDS.includes(kind) ? kind : 'app',
      message: typeof message === 'string' ? redactText(message).text : String(message),
      correlationId: currentCorrelationId,
      fields: safe
    });
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return entry;
  };

  return {
    setCorrelationId: (id) => { currentCorrelationId = id; },
    getCorrelationId: () => currentCorrelationId,
    debug: (m, f) => write('app', 'debug', m, f),
    info: (m, f) => write('app', 'info', m, f),
    warn: (m, f) => write('app', 'warn', m, f),
    error: (m, f) => write('app', 'error', m, f),
    fatal: (m, f) => write('app', 'fatal', m, f),
    audit: (m, f) => write('audit', 'info', m, f),
    security: (m, f) => write('security', 'warn', m, f),
    entries: () => [...entries],
    byKind: (kind) => entries.filter((e) => e.kind === kind),
    byLevel: (lvl) => entries.filter((e) => LOG_LEVELS[e.level] >= LOG_LEVELS[lvl]),
    byCorrelation: (id) => entries.filter((e) => e.correlationId === id),
    clear: () => { entries.length = 0; }
  };
}

/* --------------------------------------------------- correlation and tracing */

/** A request/correlation id. Random, not sequential: a sequence leaks volume. */
export function correlationId({ bytes = 8 } = {}) {
  const out = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(out);
  else return `cid-${Date.now().toString(36)}`;
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * W3C Trace Context.
 *
 * `traceparent: 00-<32 hex trace>-<16 hex span>-<2 hex flags>`. This is the
 * standard, so a browser-originated trace can be continued by any backend
 * without a bespoke header — which is the difference between tracing that works
 * and tracing that only works inside one vendor.
 */
export function newTraceContext({ sampled = true, parentSpanId = null } = {}) {
  const traceId = correlationId({ bytes: 16 });
  const spanId = correlationId({ bytes: 8 });
  return {
    traceId,
    spanId,
    parentSpanId,
    sampled,
    traceparent: `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`
  };
}

export function parseTraceparent(value) {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(String(value || '').trim());
  if (!m) return { ok: false, reason: 'malformed' };
  const [, version, traceId, spanId, flags] = m;
  // All-zero ids are explicitly invalid in the spec.
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return { ok: false, reason: 'zero-id' };
  if (version === 'ff') return { ok: false, reason: 'forbidden-version' };
  return { ok: true, version, traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

/** Continue a trace for an outbound call, keeping the same trace id. */
export function continueTrace(parent, { sampled = null } = {}) {
  const parsed = parent?.traceparent ? parseTraceparent(parent.traceparent) : { ok: false };
  if (!parsed.ok) return newTraceContext({ sampled: sampled ?? true });
  // One span id, used in both the object and the header. Generating it twice
  // produced a header that did not match the span it claimed to describe.
  const spanId = correlationId({ bytes: 8 });
  const isSampled = sampled ?? parsed.sampled;
  return {
    traceId: parsed.traceId,
    spanId,
    parentSpanId: parsed.spanId,
    sampled: isSampled,
    traceparent: `00-${parsed.traceId}-${spanId}-${isSampled ? '01' : '00'}`
  };
}

/* ------------------------------------------------------------------- metrics */

/**
 * Metric availability, stated per metric.
 *
 * A browser cannot read CPU or memory reliably, and database metrics live with
 * the provider. Marking those `unavailable` is the honest answer; a zero would
 * read as a measurement.
 */
export const METRIC_AVAILABILITY = {
  'api.latency.p75': { source: 'client', available: true },
  'api.error_rate': { source: 'client', available: true },
  'app.error_count': { source: 'client', available: true },
  'queue.depth': { source: 'client', available: true, note: 'Depth of the in-page write queue, not a server queue.' },
  'active_users': { source: 'client', available: true, note: 'Unique actors seen in this session only.' },
  'revenue.events': { source: 'client', available: true, note: 'Revenue events observed in the client; the ledger is server-side.' },
  'js.heap_mb': { source: 'client', available: 'partial', note: 'performance.memory is non-standard and Chrome-only; a dash is the correct value elsewhere.' },
  'cpu.percent': { source: 'provider', available: false, note: 'Not readable from a browser.' },
  'memory.percent': { source: 'provider', available: false },
  'db.latency.p95': { source: 'provider', available: false },
  'db.connections': { source: 'provider', available: false },
  'queue.server_depth': { source: 'provider', available: false }
};

export function createMetrics() {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();

  return {
    inc(name, by = 1) { counters.set(name, (counters.get(name) || 0) + by); return counters.get(name); },
    gauge(name, value) { gauges.set(name, Number(value)); return Number(value); },
    observe(name, value) {
      const list = histograms.get(name) || [];
      list.push(Number(value));
      if (list.length > 1000) list.splice(0, list.length - 1000);
      histograms.set(name, list);
      return list.length;
    },
    histogram: (name) => [...(histograms.get(name) || [])],
    snapshot() {
      return {
        counters: Object.fromEntries(counters),
        gauges: Object.fromEntries(gauges),
        // Full sample sets are kept so percentiles can be recomputed; only the
        // count and sum are summarised here.
        histograms: Object.fromEntries([...histograms].map(([k, v]) => [k, { count: v.length, sum: v.reduce((a, b) => a + b, 0) }])),
        availability: METRIC_AVAILABILITY
      };
    },
    reset() { counters.clear(); gauges.clear(); histograms.clear(); }
  };
}

/** Read the one browser metric that exists, and only where it truly exists. */
export function heapUsage(target = typeof performance !== 'undefined' ? performance : null) {
  const mem = target?.memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    return { available: false, reason: 'no-non-standard-performance-memory', note: 'Not available in this engine. A number here would be fiction.' };
  }
  return {
    available: true,
    usedMb: Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10,
    totalMb: Math.round((mem.totalJSHeapSize / 1048576) * 10) / 10,
    limitMb: Math.round((mem.jsHeapSizeLimit / 1048576) * 10) / 10
  };
}

export const observabilitySummary = () => ({
  levels: Object.keys(LOG_LEVELS).length,
  kinds: LOG_KINDS.length,
  metricsAvailable: Object.values(METRIC_AVAILABILITY).filter((m) => m.available === true).length,
  metricsUnavailable: Object.values(METRIC_AVAILABILITY).filter((m) => m.available === false).length,
  traceStandard: 'W3C Trace Context'
});
