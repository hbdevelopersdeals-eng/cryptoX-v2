/* Performance measurement: Core Web Vitals, API latency and error rate.
 *
 * Thresholds are the published Core Web Vitals values, held as data so they can
 * be updated without touching logic. Percentiles default to p75 because that is
 * the figure the field assessment uses — an average hides the slow tail that
 * actually loses users.
 *
 * Nothing is sent anywhere: there is no analytics endpoint in this build, so the
 * collector exposes a snapshot and the caller decides. Claiming to "report"
 * metrics with nowhere to send them would be the usual lie here.
 */

export const VITAL_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000, unit: 'ms', label: 'Largest Contentful Paint' },
  INP: { good: 200, poor: 500, unit: 'ms', label: 'Interaction to Next Paint' },
  CLS: { good: 0.1, poor: 0.25, unit: 'score', label: 'Cumulative Layout Shift' },
  TTFB: { good: 800, poor: 1800, unit: 'ms', label: 'Time to First Byte' },
  FCP: { good: 1800, poor: 3000, unit: 'ms', label: 'First Contentful Paint' },
  API: { good: 300, poor: 1000, unit: 'ms', label: 'API latency' },
  ERROR_RATE: { good: 0.01, poor: 0.05, unit: 'ratio', label: 'Error rate' }
};

/** good / needs-improvement / poor, per the published boundaries. */
export function rate(metric, value) {
  const t = VITAL_THRESHOLDS[metric];
  if (!t) return null;
  // Number(null) is 0 and Number('') is 0, so a missing sample would rate as
  // a perfect score. Nullish and empty input is 'unknown', never 'good'.
  if (value == null || value === '') return 'unknown';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'unknown';
  if (n <= t.good) return 'good';
  if (n <= t.poor) return 'needs-improvement';
  return 'poor';
}

export const describeRating = (metric, value) => {
  const t = VITAL_THRESHOLDS[metric];
  if (!t) return null;
  const rating = rate(metric, value);
  return { metric, value, rating, threshold: t, note: rating === 'poor' ? `Exceeds the poor boundary of ${t.poor}${t.unit === 'ms' ? 'ms' : ''}.` : undefined };
};

/**
 * CLS from layout-shift entries, using the session-window algorithm.
 *
 * Summing every shift over the page's lifetime over-reports badly: a 30-second
 * session with small shifts on each interaction adds up to a "poor" score even
 * though no single window was bad. The spec groups shifts separated by less than
 * one second, caps a window at five seconds, and takes the LARGEST window — a
 * user can only be disrupted once.
 */
export function clsSessionWindow(entries = []) {
  let max = 0;
  let current = 0;
  let windowStart = 0;
  let prevStart = 0;

  for (const entry of entries) {
    // Shifts from recent input are excluded by the spec.
    if (entry.hadRecentInput) continue;
    const start = Number(entry.startTime) || 0;
    const value = Number(entry.value) || 0;

    if (current === 0) {
      current = value;
      windowStart = start;
    } else if (start - prevStart < 1000 && start - windowStart < 5000) {
      current += value;
    } else {
      max = Math.max(max, current);
      current = value;
      windowStart = start;
    }
    prevStart = start;
  }
  return Math.max(max, current);
}

/** Nearest-rank percentile with linear interpolation between ranks. */
export function percentile(values = [], p = 0.75) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const rank = p * (nums.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return nums[low];
  return nums[low] + (nums[high] - nums[low]) * (rank - low);
}

export function summariseLatency(samples = []) {
  const values = samples.map((s) => (typeof s === 'number' ? s : s?.ms)).filter(Number.isFinite);
  if (!values.length) return null;
  const total = samples.length;
  const failures = samples.filter((s) => typeof s === 'object' && s && s.ok === false).length;
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
    errorRate: total ? failures / total : 0,
    // p75 is the field metric; p95 is the one that explains user complaints.
    note: 'p75 is the field assessment figure; p95 shows the tail users complain about.'
  };
}

/**
 * Collect vitals in the browser.
 * Every observer is optional: an engine that lacks one produces no sample rather
 * than a fabricated zero, because a zero would read as a perfect score.
 */
export function createVitalsCollector({ target = null } = {}) {
  const scope = target || (typeof window !== 'undefined' ? window : null);
  const samples = { LCP: [], INP: [], CLS: [], TTFB: [], FCP: [] };
  const observers = [];
  const unsupported = [];

  const available = typeof scope?.PerformanceObserver === 'function';
  if (!available) {
    return {
      supported: false,
      reason: 'no-performance-observer',
      snapshot: () => ({ supported: false, samples, unsupported: Object.keys(samples) })
    };
  }

  const observe = (type, handler, extra = {}) => {
    try {
      const obs = new scope.PerformanceObserver((list) => handler(list.getEntries()));
      obs.observe({ type, buffered: true, ...extra });
      observers.push(obs);
    } catch {
      // Unsupported entry types throw on observe(); record rather than swallow.
      unsupported.push(type);
    }
  };

  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1];
    if (last) samples.LCP.push({ value: last.startTime, at: Date.now() });
  });

  observe('paint', (entries) => {
    const fcp = entries.find((e) => e.name === 'first-contentful-paint');
    if (fcp) samples.FCP.push({ value: fcp.startTime, at: Date.now() });
  });

  const shifts = [];
  observe('layout-shift', (entries) => {
    shifts.push(...entries);
    // Recompute over the whole set: CLS is a max over windows, not a running sum.
    samples.CLS.push({ value: clsSessionWindow(shifts), at: Date.now() });
  });

  // INP is a p75 over interactions, so each event's duration is kept.
  observe('event', (entries) => {
    for (const e of entries) {
      if (typeof e.duration === 'number') samples.INP.push({ value: e.duration, at: Date.now() });
    }
  }, { durationThreshold: 40 });

  const nav = scope.performance?.getEntriesByType?.('navigation')?.[0];
  if (nav) samples.TTFB.push({ value: nav.responseStart, at: Date.now() });

  return {
    supported: true,
    unsupported,
    disconnect: () => observers.forEach((o) => { try { o.disconnect(); } catch { /* already gone */ } }),
    snapshot: () => {
      const pick = (list, p) => (list.length ? percentile(list.map((s) => s.value), p) : null);
      const metrics = {
        LCP: pick(samples.LCP, 0.75),
        INP: pick(samples.INP, 0.75),
        CLS: samples.CLS.length ? Math.max(...samples.CLS.map((s) => s.value)) : null,
        TTFB: pick(samples.TTFB, 0.5),
        FCP: pick(samples.FCP, 0.5)
      };
      return {
        supported: true,
        metrics,
        ratings: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v == null ? 'unknown' : rate(k, v)])),
        samples: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, v.length])),
        unsupported
      };
    }
  };
}

/* ------------------------------------------------------------------ API side */

/**
 * Wrap fetch to record latency and status for every request the app makes.
 * Streaming and aborted requests are recorded separately: counting a cancelled
 * request as an error makes the error rate meaningless.
 */
export function createApiTracker({ fetchImpl = null, limit = 500 } = {}) {
  const base = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const samples = [];

  const record = (entry) => {
    samples.push(entry);
    if (samples.length > limit) samples.splice(0, samples.length - limit);
    return entry;
  };

  const tracked = base ? async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    const started = Date.now();
    try {
      const res = await base(input, init);
      return record({ url, ms: Date.now() - started, ok: res.ok, status: res.status, at: Date.now() }), res;
    } catch (err) {
      if (err?.name === 'AbortError') {
        record({ url, ms: Date.now() - started, ok: true, aborted: true, at: Date.now() });
      } else {
        record({ url, ms: Date.now() - started, ok: false, error: err?.message, at: Date.now() });
      }
      throw err;
    }
  } : null;

  return {
    fetch: tracked,
    record,
    /* A transport failure and an HTTP error are different things; both are
     * failures for the error-rate metric, but only the second has a status. */
    stats: () => ({
      ...(summariseLatency(samples.filter((s) => !s.aborted)) || {
        count: 0, p50: null, p75: null, p95: null, max: null, errorRate: 0
      }),
      transportErrors: samples.filter((s) => !s.aborted && !s.status).length,
      httpErrors: samples.filter((s) => !s.aborted && s.status >= 400).length,
      aborted: samples.filter((s) => s.aborted).length
    }),
    samples: () => [...samples]
  };
}

export const PERFORMANCE_BUDGETS = {
  firstLoadGzipKb: 220,
  assetCompression: 'gzip or brotli required',
  hashedAssetCache: 'public, max-age=31536000, immutable',
  note: 'Enforced by scripts/check-bundle.mjs for size. Compression and cache headers are served by the CDN and are NOT under this repository\u2019s control.'
};
