import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ulid, isValidUlid, ulidTime, uuidV4, isValidUuid, ID_STRATEGY, identifierFor, _resetUlidState
} from './identifiers.js';
import {
  VITAL_THRESHOLDS, rate, describeRating, clsSessionWindow, percentile, summariseLatency,
  createVitalsCollector, createApiTracker, PERFORMANCE_BUDGETS
} from './webVitals.js';
import {
  MEASURED, PERFORMANCE, PERFORMANCE_TARGETS, ARCHITECTURE_PATH, INFRASTRUCTURE,
  infrastructureSummary, MEASURED_NOTE
} from './infrastructure.js';

afterEach(() => { vi.unstubAllGlobals(); _resetUlidState(); });

describe('ULID', () => {
  it('produces a 26-character Crockford string that validates', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isValidUlid(id)).toBe(true);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Crockford excludes I, L, O and U to avoid transcription errors.
    expect(id).not.toMatch(/[ILOU]/);
  });

  it('is strictly monotonic within the same millisecond', () => {
    _resetUlidState();
    const ids = Array.from({ length: 50 }, () => ulid({ now: 1_700_000_000_000 }));
    const sorted = [...ids].sort();
    // Two ULIDs from one millisecond must still sort in creation order, or the
    // whole reason for choosing ULID over a random id is lost.
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });

  it('sorts by creation time across milliseconds', () => {
    _resetUlidState();
    const early = ulid({ now: 1_700_000_000_000 });
    const later = ulid({ now: 1_700_000_001_000 });
    expect(early < later).toBe(true);
  });

  it('round-trips the encoded timestamp', () => {
    _resetUlidState();
    const now = 1_794_000_000_000;
    expect(ulidTime(ulid({ now })).getTime()).toBe(now);
  });

  it('rejects malformed and out-of-range values', () => {
    expect(isValidUlid('too-short')).toBe(false);
    expect(isValidUlid('I'.repeat(26))).toBe(false); // I is not in the alphabet
    expect(isValidUlid('Z'.repeat(26))).toBe(false); // first char encodes 48 bits
    expect(ulidTime('nope')).toBeNull();
  });
});

describe('UUID', () => {
  it('emits a v4 with the right version and variant bits', () => {
    const id = uuidV4();
    expect(isValidUuid(id)).toBe(true);
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('does not collide across many draws', () => {
    expect(new Set(Array.from({ length: 500 }, uuidV4)).size).toBe(500);
  });

  it('rejects a malformed uuid rather than accepting a prefix match', () => {
    expect(isValidUuid('123e4567-e89b-42d3-a456-42661417400')).toBe(false);
    // Any version 1-8 is a valid uuid; the variant bits are what must hold.
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUuid('123e4567-e89b-42d3-c456-426614174000')).toBe(false); // bad variant
  });

  it('picks the identifier type per table', () => {
    expect(ID_STRATEGY['portfolio.id']).toBe('ulid');
    expect(ID_STRATEGY['session.id']).toBe('uuid');
    expect(isValidUlid(identifierFor('portfolio.id'))).toBe(true);
    expect(isValidUuid(identifierFor('session.id'))).toBe(true);
    // Unknown keys fall back to an opaque uuid, not a timestamped one.
    expect(isValidUuid(identifierFor('unknown.key'))).toBe(true);
  });
});

describe('Core Web Vitals ratings', () => {
  it('applies the published boundaries exactly', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 2501)).toBe('needs-improvement');
    expect(rate('LCP', 4000)).toBe('needs-improvement');
    expect(rate('LCP', 4001)).toBe('poor');
    expect(rate('INP', 200)).toBe('good');
    expect(rate('CLS', 0.1)).toBe('good');
    expect(rate('CLS', 0.26)).toBe('poor');
    expect(rate('TTFB', 800)).toBe('good');
  });

  it('returns unknown for a missing or non-numeric sample', () => {
    expect(rate('LCP', null)).toBe('unknown');
    expect(rate('nope', 5)).toBeNull();
  });

  it('explains a poor rating without inventing a cause', () => {
    const d = describeRating('INP', 900);
    expect(d.rating).toBe('poor');
    expect(d.note).toMatch(/poor boundary/);
    expect(describeRating('INP', 100).note).toBeUndefined();
  });
});

describe('CLS uses the session-window algorithm', () => {
  it('groups shifts under one second and takes the largest window', () => {
    const entries = [
      { startTime: 0, value: 0.05 },
      { startTime: 500, value: 0.03 },   // same window → 0.08
      { startTime: 3000, value: 0.02 }   // new window
    ];
    // The naive sum would be 0.10, which over-reports.
    expect(clsSessionWindow(entries)).toBeCloseTo(0.08, 6);
  });

  it('ignores shifts that follow recent input', () => {
    const entries = [
      { startTime: 0, value: 0.05 },
      { startTime: 200, value: 0.9, hadRecentInput: true }
    ];
    expect(clsSessionWindow(entries)).toBeCloseTo(0.05, 6);
  });

  it('caps a window at five seconds rather than summing a whole session', () => {
    // 8 shifts 900ms apart: the first five seconds form one window.
    const entries = Array.from({ length: 8 }, (_, i) => ({ startTime: i * 900, value: 0.1 }));
    const result = clsSessionWindow(entries);
    expect(result).toBeLessThan(0.8); // far below the naive sum of 0.8
    expect(result).toBeGreaterThan(0.1);
  });

  it('returns 0 for no shifts', () => {
    expect(clsSessionWindow([])).toBe(0);
  });
});

describe('percentiles and latency summary', () => {
  it('interpolates rather than snapping to the nearest sample', () => {
    const values = [10, 20, 30, 40];
    expect(percentile(values, 0.5)).toBeCloseTo(25, 6);
    expect(percentile(values, 0.75)).toBeCloseTo(32.5, 6);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('reports p50, p75 and p95 and counts failures', () => {
    const s = summariseLatency([
      { ms: 100, ok: true }, { ms: 200, ok: true }, { ms: 300, ok: true },
      { ms: 400, ok: false }, { ms: 500, ok: true }
    ]);
    expect(s.count).toBe(5);
    expect(s.p50).toBeCloseTo(300, 6);
    expect(s.max).toBe(500);
    expect(s.errorRate).toBeCloseTo(1 / 5, 6);
    expect(s.note).toMatch(/p95 shows the tail/);
  });

  it('accepts bare numbers as well as samples', () => {
    expect(summariseLatency([10, 20]).p50).toBeCloseTo(15, 6);
    expect(summariseLatency([])).toBeNull();
  });
});

describe('collector and API tracker degrade honestly', () => {
  it('reports unsupported rather than fabricating samples without PerformanceObserver', () => {
    const c = createVitalsCollector({ target: {} });
    expect(c.supported).toBe(false);
    expect(c.reason).toBe('no-performance-observer');
    expect(c.snapshot().supported).toBe(false);
  });

  it('excludes aborted requests from latency and error rate', () => {
    const tracker = createApiTracker({ fetchImpl: null });
    tracker.record({ url: '/a', ms: 100, ok: true, at: 1 });
    tracker.record({ url: '/b', ms: 200, ok: false, status: 500, at: 2 });
    tracker.record({ url: '/c', ms: 5000, ok: true, aborted: true, at: 3 });
    const s = tracker.stats();
    expect(s.count).toBe(2);              // the abort is not a latency sample
    expect(s.aborted).toBe(1);
    expect(s.httpErrors).toBe(1);
    expect(s.max).toBe(200);              // the 5s abort does not inflate the tail
    expect(s.errorRate).toBeCloseTo(0.5, 6);
  });

  it('distinguishes a transport failure from an HTTP error', () => {
    const tracker = createApiTracker({ fetchImpl: null });
    tracker.record({ url: '/a', ms: 10, ok: false, error: 'boom', at: 1 });
    tracker.record({ url: '/b', ms: 10, ok: false, status: 503, at: 2 });
    const s = tracker.stats();
    expect(s.transportErrors).toBe(1);
    expect(s.httpErrors).toBe(1);
  });

  it('wraps fetch, records the outcome, and rethrows failures', async () => {
    const failing = vi.fn(() => Promise.reject(Object.assign(new Error('nope'), { name: 'TypeError' })));
    const tracker = createApiTracker({ fetchImpl: failing });
    await expect(tracker.fetch('/x')).rejects.toThrow('nope');
    const first = tracker.samples()[0];
    expect(first.ok).toBe(false);
    expect(first.error).toBe('nope');
    expect(typeof first.ms).toBe('number');
  });

  it('does not count an aborted fetch as an error', async () => {
    const aborting = vi.fn(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const tracker = createApiTracker({ fetchImpl: aborting });
    await expect(tracker.fetch('/y')).rejects.toThrow();
    expect(tracker.samples()[0].aborted).toBe(true);
    expect(tracker.stats().errorRate).toBe(0);
  });

  it('states that compression and cache headers are not this repo\u2019s to enforce', () => {
    expect(PERFORMANCE_BUDGETS.note).toMatch(/NOT under this repository/);
    expect(VITAL_THRESHOLDS.LCP.good).toBe(2500);
  });
});

describe('infrastructure posture is declared, not assumed', () => {
  it('records the measured defects with their evidence', () => {
    const f = MEASURED.findings;
    expect(f.compression.rating).toBe('defect');
    expect(f.compression.detail).toMatch(/318,455|equals the uncompressed/);
    expect(f.assetCacheHeaders.rating).toBe('defect');
    expect(f.securityHeaders.rating).toBe('defect');
    expect(f.cdnCaching.rating).toBe('verified');
    expect(f.timingAllowed.rating).toBe('verified');
  });

  it('states that compression would cut roughly two thirds', () => {
    expect(MEASURED.findings.compression.fix).toMatch(/gzip|brotli/i);
    expect(MEASURED.findings.assetCacheHeaders.fix).toMatch(/immutable/);
  });

  it('marks anything not owned by this repository as such', () => {
    PERFORMANCE.forEach((p) => {
      expect(['repo', 'cdn', 'provider', 'n/a']).toContain(p.owner);
      expect(p.status).toBeTruthy();
      expect(p.evidence).toBeTruthy();
    });
  });

  it('does not claim server-side concerns a static app cannot have', () => {
    const byItem = Object.fromEntries(PERFORMANCE.map((p) => [p.item, p]));
    expect(byItem['Background jobs / queue architecture / connection pooling'].status).toBe('n/a');
    expect(byItem['Image optimization / WebP / AVIF'].status).toBe('n/a');
    expect(byItem['Performance monitoring'].status).toBe('implemented');
  });

  it('separates verified from unavailable in the infrastructure layer', () => {
    const byItem = Object.fromEntries(INFRASTRUCTURE.map((i) => [i.item, i]));
    expect(byItem.CDN.status).toBe('verified');
    expect(byItem['Disaster recovery'].status).toBe('unavailable');
    expect(byItem['Disaster recovery'].note).toMatch(/untested restore is not a recovery plan/i);
    expect(byItem['Read replicas'].status).toBe('provider');
    // WAF is an architecture hop, not an infrastructure line item.
    expect(ARCHITECTURE_PATH.find((h) => h.hop === 'WAF').status).toBe('unavailable');
  });

  it('reports the architecture hop owners without pretending compute exists', () => {
    expect(ARCHITECTURE_PATH.map((h) => h.hop)).toContain('CDN / Edge');
    const lb = ARCHITECTURE_PATH.find((h) => h.hop === 'Load balancer');
    expect(lb.status).toBe('n/a');
  });

  it('refuses to fill in field data that cannot exist yet', () => {
    expect(MEASURED_NOTE).toMatch(/no endpoint and no users/);
    PERFORMANCE_TARGETS.forEach((t) => {
      expect(t.measured).not.toMatch(/^\d+ms$/); // no invented numbers
    });
    expect(PERFORMANCE_TARGETS.find((t) => t.metric === 'Database latency').measured).toMatch(/unavailable/);
  });

  it('summarises without rounding defects away', () => {
    const s = infrastructureSummary();
    expect(s.defects).toBeGreaterThanOrEqual(2);
    expect(s.measuredDefects).toBe(3);
    expect(s.verified).toBeGreaterThan(0);
    expect(s.providerOwned).toBeGreaterThan(0);
    expect(s.total).toBe(PERFORMANCE.length + INFRASTRUCTURE.length);
  });
});
