import { describe, it, expect } from 'vitest';
import {
  BREAKER_STATES, createCircuitBreaker, classifyFailure, withRetry, idempotencyKey,
  createIdempotencyStore, DEPENDENCIES, dependencyById, HEALTH_STATES, aggregateHealth,
  probeDependency, createJobMonitor, createFlagRegistry, maintenanceState, reliabilitySummary
} from './reliability.js';
import {
  LOG_LEVELS, LOG_KINDS, createLogger, correlationId, newTraceContext, parseTraceparent,
  continueTrace, METRIC_AVAILABILITY, createMetrics, heapUsage, observabilitySummary
} from './observability.js';
import {
  RPO_TARGET, RTO_TARGET, BACKUP_CLASSES, productionReady, targetGap, recordRestoreTest,
  drSummary, RUNBOOKS, runbookFor, SEVERITIES, severityById, INCIDENT_STATES, declareIncident,
  advanceIncident, timeToResolve, ALERT_RULES, alertRuleById, createAlertEngine, alertingSummary
} from './incident.js';

/* ============================ Section 21 — Reliability ==================== */

describe('circuit breaker', () => {
  const make = (opts = {}) => {
    let t = 1000;
    const b = createCircuitBreaker({ failureThreshold: 3, windowMs: 60000, cooldownMs: 30000, halfOpenProbes: 1, now: () => t, ...opts });
    return { b, advance: (ms) => { t += ms; } };
  };

  it('opens only after the threshold, not on the first failure', () => {
    const { b } = make();
    expect(b.status().state).toBe('closed');
    b.onFailure();
    b.onFailure();
    expect(b.status().state).toBe('closed');
    b.onFailure();
    expect(b.status().state).toBe('open');
  });

  it('refuses calls while open and reports when to try again', () => {
    const { b, advance } = make();
    for (let i = 0; i < 3; i += 1) b.onFailure();
    const denied = b.allow();
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('circuit-open');
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    advance(5000);
    expect(b.allow().retryAfterMs).toBeLessThan(30000);
  });

  it('moves to half-open after the cooldown and closes on success', () => {
    const { b, advance } = make();
    for (let i = 0; i < 3; i += 1) b.onFailure();
    advance(30001);
    expect(b.status().state).toBe('half-open');
    expect(b.allow().probe).toBe(true);
    b.onSuccess();
    expect(b.status().state).toBe('closed');
    expect(b.status().failures).toBe(0);
  });

  it('returns to open when a half-open probe fails', () => {
    const { b, advance } = make();
    for (let i = 0; i < 3; i += 1) b.onFailure();
    advance(30001);
    b.status();
    b.onFailure();
    expect(b.status().state).toBe('open');
  });

  it('forgets old failures so a stale outage does not keep it broken', () => {
    const { b, advance } = make();
    b.onFailure();
    b.onFailure();
    advance(61000); // outside the window
    b.onFailure();
    // Without windowing this would be the third failure and would open.
    expect(b.status().state).toBe('closed');
    expect(b.status().failures).toBe(1);
  });

  it('exposes its states as data', () => {
    expect(BREAKER_STATES).toEqual(['closed', 'open', 'half-open']);
  });
});

describe('failure classification decides what may be retried', () => {
  it('retries server errors and rate limits, never client errors', () => {
    expect(classifyFailure({ status: 500 }).retryable).toBe(true);
    expect(classifyFailure({ status: 503 }).retryable).toBe(true);
    expect(classifyFailure({ status: 429 }).retryable).toBe(true);
    expect(classifyFailure({ status: 429 }).useRetryAfter).toBe(true);
    expect(classifyFailure({ status: 400 }).retryable).toBe(false);
    expect(classifyFailure({ status: 401 }).retryable).toBe(false);
    expect(classifyFailure({ status: 404 }).retryable).toBe(false);
  });

  it('treats a network failure on a write differently from a read', () => {
    const err = Object.assign(new TypeError('Failed to fetch'), {});
    expect(classifyFailure({ error: err, method: 'GET' }).retryable).toBe(true);
    const write = classifyFailure({ error: err, method: 'POST' });
    // A POST may already have been applied; retrying can duplicate it.
    expect(write.retryable).toBe(false);
    expect(write.note).toMatch(/duplicate/i);
  });

  it('never retries a caller cancellation', () => {
    expect(classifyFailure({ error: Object.assign(new Error('x'), { name: 'AbortError' }) }).retryable).toBe(false);
  });
});

describe('withRetry', () => {
  const instant = () => Promise.resolve();

  it('succeeds after transient failures', async () => {
    let calls = 0;
    const res = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('boom'), { status: 503 });
      return 'ok';
    }, { attempts: 5, sleep: instant });
    expect(res.ok).toBe(true);
    expect(res.value).toBe('ok');
    expect(res.attempts).toBe(3);
  });

  it('gives up after the attempt limit', async () => {
    const res = await withRetry(async () => { throw Object.assign(new Error('x'), { status: 500 }); }, { attempts: 2, sleep: instant });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('attempts-exhausted');
    expect(res.attempts).toBe(2);
  });

  it('does not waste attempts on a 4xx', async () => {
    let calls = 0;
    const res = await withRetry(async () => { calls += 1; throw Object.assign(new Error('bad'), { status: 400 }); }, { attempts: 3, sleep: instant });
    expect(calls).toBe(1);
    expect(res.reason).toBe('client-error');
  });

  it('reports each retry', async () => {
    const seen = [];
    await withRetry(async () => { throw Object.assign(new Error('x'), { status: 500 }); }, { attempts: 2, sleep: instant, onRetry: (r) => seen.push(r) });
    expect(seen).toHaveLength(1);
    expect(seen[0].attempt).toBe(1);
    expect(seen[0].delay).toBeGreaterThan(0);
  });
});

describe('idempotency', () => {
  it('derives the key from the operation and payload', () => {
    const a = idempotencyKey({ operation: 'create.alert', payload: { symbol: 'BTC', above: 100 } });
    const b = idempotencyKey({ operation: 'create.alert', payload: { above: 100, symbol: 'BTC' } });
    const c = idempotencyKey({ operation: 'create.alert', payload: { symbol: 'BTC', above: 200 } });
    expect(a.key).toBe(b.key); // key order must not change the key
    expect(a.key).not.toBe(c.key);
    expect(idempotencyKey({ payload: {} }).reason).toBe('operation-required');
  });

  it('recognises a duplicate and refuses to run it twice', () => {
    let t = 0;
    const store = createIdempotencyStore({ now: () => t });
    const key = idempotencyKey({ operation: 'x', payload: { a: 1 } }).key;
    expect(store.begin(key).duplicate).toBe(false);
    expect(store.begin(key).duplicate).toBe(true);
    store.complete(key, { result: 'done' });
    expect(store.begin(key).completed).toBe(true);
  });

  it('expires keys so the store does not grow forever', () => {
    let t = 0;
    const store = createIdempotencyStore({ ttlMs: 1000, now: () => t });
    const key = idempotencyKey({ operation: 'x', payload: {} }).key;
    store.begin(key);
    t = 2000;
    expect(store.begin(key).duplicate).toBe(false);
  });
});

describe('dependency health rolls up honestly', () => {
  it('a critical failure means unhealthy and not ready', () => {
    const h = aggregateHealth([
      { id: 'supabase', state: 'unhealthy' },
      { id: 'binance-rest', state: 'healthy' }
    ]);
    expect(h.state).toBe('unhealthy');
    expect(h.ready).toBe(false);
    expect(h.live).toBe(true); // the process is alive even when a dependency is not
  });

  it('a non-critical failure degrades but stays ready, and states the fallback', () => {
    const h = aggregateHealth([{ id: 'binance-rest', state: 'unhealthy' }, { id: 'supabase', state: 'healthy' }]);
    expect(h.state).toBe('degraded');
    expect(h.ready).toBe(true);
    expect(h.notes.join(' ')).toMatch(/CoinGecko/);
  });

  it('is healthy only when everything is', () => {
    expect(aggregateHealth([{ id: 'supabase', state: 'healthy' }, { id: 'coingecko', state: 'healthy' }]).state).toBe('healthy');
    expect(HEALTH_STATES).toContain('degraded');
  });

  it('every dependency declares a probe target and a consequence', () => {
    DEPENDENCIES.forEach((d) => {
      expect(d.probeUrl).toMatch(/^https:\/\//);
      expect(d.degradation).toBeTruthy();
    });
    expect(dependencyById('nope')).toBeNull();
    expect(reliabilitySummary().critical).toBe(1);
  });

  it('probeDependency reports timeout and unknown rather than guessing', async () => {
    const aborting = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const slow = await probeDependency('binance-rest', { fetchImpl: aborting });
    expect(slow.state).toBe('unhealthy');
    expect(slow.error).toBe('timeout');
    expect((await probeDependency('nope', { fetchImpl: aborting })).error).toBe('unknown-dependency');
    // A null fetchImpl falls back to the global fetch, so the no-transport path
    // is only reachable when there is genuinely no fetch. Stub it out rather
    // than assume — otherwise this asserts against a live network call.
    vi.stubGlobal('fetch', undefined);
    expect((await probeDependency('coingecko', { fetchImpl: null })).error).toBe('no-fetch-available');
    vi.unstubAllGlobals();
  });
});

describe('background job monitoring', () => {
  it('calls a job that has never run stale, not healthy', () => {
    let t = 0;
    const m = createJobMonitor({ now: () => t });
    m.register('price-poll', { expectedEveryMs: 60000 });
    expect(m.status()[0].state).toBe('stale');
    expect(m.status()[0].stale).toBe(true);
  });

  it('detects an overdue job and a failing one', () => {
    let t = 0;
    const m = createJobMonitor({ now: () => t });
    m.register('price-poll', { expectedEveryMs: 1000 });
    m.recordRun('price-poll');
    m.recordSuccess('price-poll');
    expect(m.status()[0].state).toBe('healthy');
    t = 5000;
    expect(m.status()[0].overdue).toBe(true);
    m.recordFailure('price-poll', 'socket closed');
    expect(m.status()[0].state).toBe('failing');
    expect(m.recordRun('nope').ok).toBe(false);
  });
});

describe('feature flags', () => {
  const reg = (over = {}) => createFlagRegistry({ definitions: [{ key: 'new-chart', enabled: true, rolloutPercentage: 100, ...over }] });

  it('lets the kill switch beat everything', () => {
    const r = reg({ killSwitch: true });
    expect(r.evaluate('new-chart', { actor: 'u1' }).value).toBe(false);
    expect(r.evaluate('new-chart', { actor: 'u1' }).reason).toBe('kill-switch');
  });

  it('is off when disabled and on at full rollout', () => {
    expect(reg({ enabled: false }).evaluate('new-chart', { actor: 'u1' }).reason).toBe('disabled');
    expect(reg().evaluate('new-chart', { actor: 'u1' }).reason).toBe('full-rollout');
  });

  it('buckets partial rollouts stably, so a user does not flip per load', () => {
    const r = reg({ rolloutPercentage: 50 });
    const first = r.evaluate('new-chart', { actor: 'user-42' }).value;
    for (let i = 0; i < 5; i += 1) expect(r.evaluate('new-chart', { actor: 'user-42' }).value).toBe(first);
    // And it actually splits the population rather than always saying yes.
    const values = new Set(Array.from({ length: 200 }, (_, i) => r.evaluate('new-chart', { actor: `u${i}` }).value));
    expect(values.size).toBe(2);
  });

  it('refuses a partial rollout with no actor rather than guessing', () => {
    expect(reg({ rolloutPercentage: 50 }).evaluate('new-chart', {}).reason).toBe('no-actor-for-partial-rollout');
    expect(reg().evaluate('unknown-flag').reason).toBe('unknown-flag');
  });
});

describe('maintenance mode', () => {
  it('is inactive without configuration', () => {
    expect(maintenanceState({}).active).toBe(false);
    expect(maintenanceState({}).writable).toBe(true);
  });

  it('activates inside the window and can force read-only', () => {
    const s = maintenanceState({
      config: { enabled: true, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-01T06:00:00Z', readOnly: true },
      at: new Date('2026-01-01T03:00:00Z')
    });
    expect(s.active).toBe(true);
    expect(s.writable).toBe(true);
    expect(s.note).toMatch(/server must also refuse/);
    const outside = maintenanceState({ config: { enabled: true, endsAt: '2026-01-01T06:00:00Z' }, at: new Date('2026-01-02T00:00:00Z') });
    expect(outside.active).toBe(false);
  });
});

/* =========================== Section 23 — Observability =================== */

describe('structured logging', () => {
  it('filters by level and keeps the levels as data', () => {
    const log = createLogger({ level: 'warn' });
    expect(log.debug('x')).toBeNull();
    expect(log.info('x')).toBeNull();
    expect(log.warn('x')).toBeTruthy();
    expect(log.error('x')).toBeTruthy();
    expect(LOG_LEVELS.fatal).toBeGreaterThan(LOG_LEVELS.error);
  });

  it('redacts secrets in the message and in field values', () => {
    const log = createLogger();
    const entry = log.info('contact ali@example.com about 4111 1111 1111 1111', { note: 'key is 0x1234567890abcdef1234567890abcdef12345678' });
    expect(entry.message).not.toContain('ali@example.com');
    expect(entry.fields.note).not.toContain('0x1234567890abcdef');
    expect(entry.message).toContain('[redacted:email]');
  });

  it('separates audit and security kinds, and freezes entries', () => {
    const log = createLogger();
    log.audit('member.invited');
    log.security('repeated auth failures');
    expect(log.byKind('audit')).toHaveLength(1);
    expect(log.byKind('security')).toHaveLength(1);
    expect(Object.isFrozen(log.entries()[0])).toBe(true);
    expect(LOG_KINDS).toContain('security');
  });

  it('is bounded so it cannot become a memory leak', () => {
    const log = createLogger({ limit: 3 });
    for (let i = 0; i < 10; i += 1) log.info(`m${i}`);
    expect(log.entries()).toHaveLength(3);
    expect(log.entries()[2].message).toBe('m9');
  });

  it('correlates entries across a request', () => {
    const log = createLogger();
    log.setCorrelationId('abc123');
    log.info('start');
    log.warn('slow');
    expect(log.byCorrelation('abc123')).toHaveLength(2);
    expect(log.getCorrelationId()).toBe('abc123');
  });
});

describe('W3C trace context', () => {
  it('generates a spec-shaped traceparent', () => {
    const t = newTraceContext();
    expect(t.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(t.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(t.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(parseTraceparent(t.traceparent).ok).toBe(true);
  });

  it('rejects malformed, zero and forbidden-version values', () => {
    expect(parseTraceparent('nope').reason).toBe('malformed');
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'a'.repeat(16)}-01`).reason).toBe('zero-id');
    expect(parseTraceparent(`ff-${'a'.repeat(32)}-${'b'.repeat(16)}-01`).reason).toBe('forbidden-version');
    expect(parseTraceparent(null).ok).toBe(false);
  });

  it('continues a trace with the SAME trace id and a NEW span id', () => {
    const parent = newTraceContext();
    const child = continueTrace(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
    // The header must describe the span the object names, not a second one.
    expect(child.traceparent).toContain(child.spanId);
    expect(parseTraceparent(child.traceparent).spanId).toBe(child.spanId);
  });

  it('starts a fresh trace when the parent is unusable', () => {
    const t = continueTrace({ traceparent: 'garbage' });
    expect(t.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('generates random correlation ids, not sequential ones', () => {
    const ids = new Set(Array.from({ length: 200 }, () => correlationId()));
    expect(ids.size).toBe(200);
    expect(correlationId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('metrics declare what is and is not measurable', () => {
  it('marks browser-unavailable metrics as unavailable rather than zero', () => {
    expect(METRIC_AVAILABILITY['cpu.percent'].available).toBe(false);
    expect(METRIC_AVAILABILITY['db.latency.p95'].available).toBe(false);
    expect(METRIC_AVAILABILITY['js.heap_mb'].available).toBe('partial');
    expect(METRIC_AVAILABILITY['api.latency.p75'].available).toBe(true);
  });

  it('collects counters, gauges and histograms', () => {
    const m = createMetrics();
    m.inc('api.calls');
    m.inc('api.calls', 3);
    m.gauge('queue.depth', 7);
    m.observe('api.latency.p75', 120);
    m.observe('api.latency.p75', 200);
    const s = m.snapshot();
    expect(s.counters['api.calls']).toBe(4);
    expect(s.gauges['queue.depth']).toBe(7);
    expect(s.histograms['api.latency.p75']).toEqual({ count: 2, sum: 320 });
    expect(s.availability).toBe(METRIC_AVAILABILITY);
  });

  it('reports the non-standard heap metric as unavailable rather than inventing it', () => {
    expect(heapUsage({}).available).toBe(false);
    expect(heapUsage({}).note).toMatch(/fiction/);
    const withMem = heapUsage({ memory: { usedJSHeapSize: 104857600, totalJSHeapSize: 209715200, jsHeapSizeLimit: 419430400 } });
    expect(withMem.usedMb).toBe(100);
  });

  it('summarises availability without overstating', () => {
    const s = observabilitySummary();
    expect(s.metricsUnavailable).toBeGreaterThan(0);
    expect(s.traceStandard).toBe('W3C Trace Context');
  });
});

/* ================= Sections 22 + 24 — DR, incident, alerting ============== */

describe('backups are not ready until restored', () => {
  it('REFUSES to call an untested backup production-ready', () => {
    const r = productionReady(BACKUP_CLASSES.find((c) => c.id === 'database'));
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/never restore-tested/);
    expect(r.note).toMatch(/assumption, not a recovery capability/);
  });

  it('requires encryption and off-site as well', () => {
    expect(productionReady({ encrypted: false, offSite: true, restoreTestedAt: '2026-01-01' }).reason).toMatch(/not encrypted/);
    expect(productionReady({ encrypted: true, offSite: false, restoreTestedAt: '2026-01-01' }).reason).toMatch(/off-site/);
    expect(productionReady(null).reason).toBe('unknown-backup-class');
  });

  it('becomes ready only once a restore has actually succeeded', () => {
    const tested = { ...BACKUP_CLASSES[0], restoreTestedAt: '2026-01-01T00:00:00Z' };
    const r = productionReady(tested);
    expect(r.ready).toBe(true);
    expect(r.reason).toMatch(/restore-tested/);
  });

  it('does NOT count a failed rehearsal as verification', () => {
    const t = recordRestoreTest({ backupClassId: 'database', succeeded: false, notes: 'restore errored' });
    expect(t.ok).toBe(true);
    expect(t.test.countsAsVerification).toBe(false);
    expect(recordRestoreTest({ backupClassId: 'database', succeeded: true }).test.countsAsVerification).toBe(true);
    expect(recordRestoreTest({}).reason).toBe('backup-class-required');
  });

  it('compares the schedule against the declared RPO', () => {
    expect(targetGap({ backupClass: { rpoHours: 2 } }).withinTarget).toBe(true);
    const gap = targetGap({ backupClass: { rpoHours: 24 } });
    expect(gap.withinTarget).toBe(false);
    expect(gap.gapHours).toBe(20);
    expect(gap.note).toMatch(/cannot meet the declared RPO/);
    expect(targetGap({ backupClass: { rpoHours: null } }).note).toMatch(/version control/);
  });

  it('states the targets as data and counts what is untested', () => {
    const s = drSummary();
    expect(s.rpoTargetHours).toBe(RPO_TARGET.hours);
    expect(s.rtoTargetHours).toBe(RTO_TARGET.hours);
    expect(s.untested).toBe(BACKUP_CLASSES.length);
    expect(s.ready).toBe(0);
    expect(RTO_TARGET.note).toBeTruthy();
  });
});

describe('runbooks and incident response', () => {
  it('every runbook is actionable and answers an unknown id honestly', () => {
    RUNBOOKS.forEach((rb) => {
      expect(rb.severity).toMatch(/^P[0-3]$/);
      expect(rb.detect).toBeTruthy();
      expect(rb.steps.length).toBeGreaterThan(2);
    });
    expect(runbookFor('bad-deploy').runbook.title).toBe('Bad deployment');
    expect(runbookFor('nope').reason).toBe('unknown-runbook');
  });

  it('orders severity levels and derives the response deadline', () => {
    expect(severityById('P0').responseMinutes).toBe(5);
    expect(severityById('nope')).toBeNull();
    const { incident } = declareIncident({ title: 'db down', severity: 'P0', at: new Date('2026-01-01T00:00:00Z'), runbookId: 'db-unavailable' });
    expect(incident.respondBy).toBe('2026-01-01T00:05:00.000Z');
    expect(incident.notify).toContain('on-call');
    expect(declareIncident({ title: 'x', severity: 'PX' }).reason).toBe('unknown-severity');
    expect(declareIncident({ severity: 'P1' }).reason).toBe('title-required');
  });

  it('will not let an incident skip straight to post-mortem', () => {
    const { incident } = declareIncident({ title: 'x', severity: 'P2' });
    expect(advanceIncident({ incident, nextState: 'post-mortem' }).reason).toBe('must-resolve-first');
    expect(advanceIncident({ incident, nextState: 'nonsense' }).reason).toBe('unknown-state');
    const acked = advanceIncident({ incident, nextState: 'acknowledged' });
    const done = advanceIncident({ incident: acked.incident, nextState: 'resolved' });
    expect(done.incident.resolvedAt).toBeTruthy();
    expect(advanceIncident({ incident: done.incident, nextState: 'post-mortem' }).ok).toBe(true);
    expect(INCIDENT_STATES).toContain('monitoring');
  });

  it('computes time to resolve', () => {
    const { incident } = declareIncident({ title: 'x', severity: 'P2', at: new Date('2026-01-01T00:00:00Z') });
    const acked = advanceIncident({ incident, nextState: 'acknowledged', at: new Date('2026-01-01T00:10:00Z') });
    const done = advanceIncident({ incident: acked.incident, nextState: 'resolved', at: new Date('2026-01-01T02:00:00Z') });
    expect(timeToResolve(done.incident).minutes).toBe(120);
    expect(timeToResolve(incident)).toBeNull();
  });
});

describe('alerting avoids fatigue', () => {
  const signal = (over = {}) => [{ signal: 'api.error_rate', value: 0.9, ...over }];

  it('fires once and stays open rather than alerting on every sample', () => {
    const engine = createAlertEngine();
    const first = engine.evaluate(signal());
    expect(first.fired).toHaveLength(1);
    const second = engine.evaluate(signal());
    // The condition still holds, but the alert is already open.
    expect(second.fired).toHaveLength(0);
    expect(second.open).toHaveLength(1);
  });

  it('auto-resolves when the condition clears', () => {
    const engine = createAlertEngine();
    engine.evaluate(signal());
    const cleared = engine.evaluate([{ signal: 'api.error_rate', value: 0.01 }]);
    expect(cleared.resolved).toHaveLength(1);
    expect(engine.open()).toHaveLength(0);
  });

  it('suppresses a re-fire during the cooldown, then allows it', () => {
    let t = 1000;
    const engine = createAlertEngine({ cooldownMs: 60000, now: () => t });
    engine.evaluate(signal());
    engine.evaluate([{ signal: 'api.error_rate', value: 0.01 }]); // resolves
    expect(engine.evaluate(signal()).fired).toHaveLength(0); // inside cooldown
    t += 60001;
    expect(engine.evaluate(signal()).fired).toHaveLength(1);
  });

  it('works the queue in severity order', () => {
    const engine = createAlertEngine({ rules: ALERT_RULES });
    engine.evaluate([
      { signal: 'api.latency.p75', value: 5000 },       // P2
      { signal: 'api.error_rate', value: 0.9 },          // P0
      { signal: 'payment.failed', rate: 0.5 }            // P1
    ]);
    expect(engine.queue().map((a) => a.severity)).toEqual(['P0', 'P1', 'P2']);
  });

  it('covers every category the brief names', () => {
    const categories = new Set(ALERT_RULES.map((r) => r.category));
    ['availability', 'security', 'performance', 'revenue', 'reliability', 'capacity', 'infrastructure']
      .forEach((c) => expect(categories).toContain(c));
    expect(alertRuleById('auth-anomaly').severity).toBe('P0');
    expect(SEVERITIES.map((s) => s.id)).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('summarises rules per severity', () => {
    const s = alertingSummary();
    expect(s.rules).toBe(ALERT_RULES.length);
    expect(s.bySeverity.reduce((a, b) => a + b.rules, 0)).toBe(ALERT_RULES.length);
    expect(s.runbooks).toBe(RUNBOOKS.length);
  });
});
