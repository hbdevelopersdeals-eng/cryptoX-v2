/* Reliability primitives (Section 21).
 *
 * Reuses what exists: realtime.js already provides `backoffDelay` (exponential
 * with jitter) and a `DeadLetterQueue` for the market stream. This module adds
 * what was missing — circuit breaking, dependency health, idempotency, job
 * monitoring, degradation, maintenance mode and feature flags.
 *
 * HEALTH ENDPOINTS are deliberately NOT faked. /health, /ready and /live are
 * endpoints a server exposes; a static bundle cannot serve them. What is built
 * here is the MODEL those endpoints would report, so the server half has a
 * single source of truth rather than inventing its own.
 */

import { backoffDelay } from './realtime.js';

/* ------------------------------------------------------------ circuit breaker */

export const BREAKER_STATES = ['closed', 'open', 'half-open'];

/**
 * Three-state breaker.
 *
 * The failure count must be over a WINDOW, not a lifetime: counting every
 * failure since page load means a service that failed twice an hour ago stays
 * broken forever, and a breaker that never closes is an outage it caused itself.
 */
export function createCircuitBreaker({
  name = 'default', failureThreshold = 5, windowMs = 60000, cooldownMs = 30000,
  halfOpenProbes = 2, now = () => Date.now()
} = {}) {
  let failures = [];
  let state = 'closed';
  let openedAt = null;
  let probes = 0;

  const prune = (at) => { failures = failures.filter((t) => at - t < windowMs); };

  return {
    name,
    get state() { return state; },
    status() {
      const at = now();
      prune(at);
      if (state === 'open' && openedAt != null && at - openedAt >= cooldownMs) {
        state = 'half-open';
        probes = 0;
      }
      return { name, state, failures: failures.length, threshold: failureThreshold, openedAt };
    },
    /** Should the call be attempted at all? */
    allow() {
      this.status();
      if (state === 'closed') return { allowed: true };
      if (state === 'open') {
        return { allowed: false, reason: 'circuit-open', retryAfterMs: Math.max(0, cooldownMs - (now() - openedAt)) };
      }
      // Half-open: let a limited number of probes through.
      if (probes < halfOpenProbes) { probes += 1; return { allowed: true, probe: true }; }
      return { allowed: false, reason: 'half-open-probing' };
    },
    onSuccess() {
      failures = [];
      state = 'closed';
      openedAt = null;
      probes = 0;
    },
    onFailure() {
      const at = now();
      failures.push(at);
      prune(at);
      if (state === 'half-open') {
        // A failed probe returns to open rather than staying half-open.
        state = 'open'; openedAt = at; probes = 0;
      } else if (failures.length >= failureThreshold) {
        state = 'open'; openedAt = at;
      }
      return this.status();
    },
    reset() { failures = []; state = 'closed'; openedAt = null; probes = 0; }
  };
}

/* --------------------------------------------------------------- retry policy */

/*
 * Not every failure should be retried. Retrying a 400 or a 401 burns attempts
 * on a request that will fail identically, and retrying a non-idempotent write
 * can duplicate it.
 */
export function classifyFailure({ status = null, error = null, method = 'GET' } = {}) {
  const idempotent = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(String(method).toUpperCase());
  if (status === 429) return { retryable: true, reason: 'rate-limited', useRetryAfter: true };
  if (status != null && status >= 500) return { retryable: true, reason: 'server-error' };
  if (status != null && status >= 400) return { retryable: false, reason: 'client-error' };
  if (error) {
    const name = error.name || '';
    if (name === 'AbortError') return { retryable: false, reason: 'aborted-by-caller' };
    if (/TypeError|network|fetch/i.test(name + (error.message || ''))) {
      return {
        retryable: idempotent,
        reason: idempotent ? 'network' : 'network-non-idempotent',
        note: idempotent ? undefined : 'A network failure on a non-idempotent request may already have been applied; retrying can duplicate it.'
      };
    }
  }
  return { retryable: false, reason: 'unknown' };
}

/** Retry with the project's existing jittered exponential backoff. */
export async function withRetry(fn, { attempts = 3, base = 500, cap = 30000, method = 'GET', onRetry = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ok: true, value: await fn(attempt), attempts: attempt };
    } catch (error) {
      lastError = error;
      const verdict = classifyFailure({ status: error?.status, error, method });
      if (!verdict.retryable || attempt === attempts) {
        return { ok: false, error, attempts: attempt, reason: verdict.retryable ? 'attempts-exhausted' : verdict.reason, note: verdict.note };
      }
      const delay = backoffDelay(attempt, { base, cap });
      if (onRetry) onRetry({ attempt, delay, reason: verdict.reason });
      await sleep(delay);
    }
  }
  return { ok: false, error: lastError, attempts, reason: 'attempts-exhausted' };
}

/* ---------------------------------------------------------------- idempotency */

/**
 * Idempotency keys for writes.
 *
 * The key is derived from the operation AND its payload, so a double-click
 * produces one key and a genuine second request produces another. A
 * timestamp-based key would make every retry a new write — which is the bug
 * idempotency keys exist to prevent.
 */
export function idempotencyKey({ operation, payload, actor = null }) {
  if (!operation) return { ok: false, reason: 'operation-required' };
  const canonical = JSON.stringify(payload ?? null, Object.keys(payload || {}).sort());
  let h = 2166136261;
  const s = `${operation}|${actor || ''}|${canonical}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { ok: true, key: `${operation}:${(h >>> 0).toString(36)}` };
}

export function createIdempotencyStore({ ttlMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();
  const prune = () => { const at = now(); for (const [k, v] of seen) if (at - v.at > ttlMs) seen.delete(k); };
  return {
    /** Begins an operation. `duplicate: true` means the result must be reused. */
    begin(key) {
      prune();
      const existing = seen.get(key);
      if (existing) {
        return { ok: true, duplicate: true, key, startedAt: existing.at, completed: existing.completed === true };
      }
      seen.set(key, { at: now() });
      return { ok: true, duplicate: false, key };
    },
    complete(key, { result = null } = {}) {
      const entry = seen.get(key);
      if (!entry) return { ok: false, reason: 'unknown-key' };
      seen.set(key, { ...entry, completed: true, result });
      return { ok: true, key, result };
    },
    size: () => seen.size
  };
}

/* ---------------------------------------------------------- dependency health */

/*
 * What this app actually depends on, and what happens without it. The
 * `degradation` field is the important one: knowing Binance is down is useless
 * unless something changes as a result.
 */
/*
 * `probeUrl` is required: a probe without a target silently fetched a
 * placeholder host, which tests nothing while reporting healthy.
 */
export const DEPENDENCIES = [
  { id: 'binance-rest', label: 'Binance REST', critical: false, timeoutMs: 8000, probeUrl: 'https://api.binance.com/api/v3/ping', degradation: 'Prices fall back to CoinGecko, refreshed every 60s instead of live.' },
  { id: 'binance-ws', label: 'Binance WebSocket', critical: false, timeoutMs: 1000, probeUrl: 'https://fapi.binance.com/fapi/v1/ping', degradation: 'Live stream stops; the UI shows a stale badge and switches to REST polling.' },
  { id: 'coingecko', label: 'CoinGecko', critical: false, timeoutMs: 12000, probeUrl: 'https://api.coingecko.com/api/v3/ping', degradation: 'Market metadata (market cap, supply, logos) is hidden rather than shown stale.' },
  { id: 'supabase', label: 'Supabase', critical: true, timeoutMs: 8000, probeUrl: 'https://bvyiqinyakxlefaeomoj.supabase.co/auth/v1/health', degradation: 'Nothing. Sign-in and persistence stop; the app cannot be used as an account holder.' },
  { id: 'frankfurter', label: 'Frankfurter (ECB rates)', critical: false, timeoutMs: 10000, probeUrl: 'https://api.frankfurter.app/latest?from=USD&to=EUR', degradation: 'Currency conversion falls back to the static table and is labelled as such.' },
  { id: 'erapi', label: 'open.er-api.com', critical: false, timeoutMs: 10000, probeUrl: 'https://open.er-api.com/v6/latest/USD', degradation: 'Same as above.' }
];

export const dependencyById = (id) => DEPENDENCIES.find((d) => d.id === id) || null;

export const HEALTH_STATES = ['healthy', 'degraded', 'unhealthy', 'unknown'];

/** Roll individual checks into one state. A critical failure dominates. */
export function aggregateHealth(checks = []) {
  const results = checks.map((c) => {
    const dep = dependencyById(c.id);
    return {
      id: c.id,
      label: dep?.label || c.id,
      critical: dep?.critical === true,
      state: c.state || 'unknown',
      latencyMs: c.latencyMs ?? null,
      error: c.error || null,
      degradation: dep?.degradation || null
    };
  });
  const unhealthyCritical = results.filter((r) => r.critical && r.state === 'unhealthy');
  const anyUnhealthy = results.filter((r) => r.state === 'unhealthy');
  const anyDegraded = results.filter((r) => r.state === 'degraded' || r.state === 'unknown');

  const state = unhealthyCritical.length ? 'unhealthy'
    : anyUnhealthy.length ? 'degraded'
      : anyDegraded.length ? 'degraded'
        : 'healthy';

  return {
    state,
    // A readiness answer is not the same as a liveness answer: dependencies
    // being down means "not ready to serve", not "the process is dead".
    ready: unhealthyCritical.length === 0,
    live: true,
    checks: results,
    failing: anyUnhealthy.length,
    notes: results.filter((r) => r.state !== 'healthy' && r.degradation).map((r) => `${r.label}: ${r.degradation}`)
  };
}

/** Probe one dependency with a timeout, classifying the outcome. */
export async function probeDependency(id, { fetchImpl = null, now = () => Date.now() } = {}) {
  const dep = dependencyById(id);
  if (!dep) return { id, state: 'unknown', error: 'unknown-dependency' };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof doFetch !== 'function') return { id, state: 'unknown', error: 'no-fetch-available' };

  const started = now();
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), dep.timeoutMs) : null;
    const res = await doFetch(dep.probeUrl || 'https://example.invalid', { signal: controller?.signal, method: 'HEAD' });
    if (timer) clearTimeout(timer);
    const latencyMs = now() - started;
    if (!res?.ok) return { id, state: 'unhealthy', latencyMs, error: `HTTP ${res?.status}` };
    // Slow but working is degraded, not healthy — it predicts the outage.
    return { id, state: latencyMs > dep.timeoutMs * 0.75 ? 'degraded' : 'healthy', latencyMs };
  } catch (err) {
    return { id, state: 'unhealthy', latencyMs: now() - started, error: err?.name === 'AbortError' ? 'timeout' : err?.message };
  }
}

/* -------------------------------------------------- jobs, degradation, flags */

/** Background job monitoring. A job that has never run is not "healthy". */
export function createJobMonitor({ now = () => Date.now() } = {}) {
  const jobs = new Map();
  return {
    register(id, { expectedEveryMs, description = null }) {
      jobs.set(id, { id, expectedEveryMs, description, lastRunAt: null, lastSuccessAt: null, lastError: null, runs: 0, failures: 0 });
      return jobs.get(id);
    },
    recordRun(id) {
      const j = jobs.get(id);
      if (!j) return { ok: false, reason: 'unknown-job' };
      j.runs += 1; j.lastRunAt = now();
      return { ok: true, job: j };
    },
    recordSuccess(id) {
      const j = jobs.get(id);
      if (!j) return { ok: false, reason: 'unknown-job' };
      j.lastSuccessAt = now(); j.lastError = null;
      return { ok: true, job: j };
    },
    recordFailure(id, error) {
      const j = jobs.get(id);
      if (!j) return { ok: false, reason: 'unknown-job' };
      j.failures += 1; j.lastError = String(error || 'unknown');
      return { ok: true, job: j };
    },
    status() {
      const at = now();
      return [...jobs.values()].map((j) => {
        const overdue = j.lastRunAt == null || (j.expectedEveryMs && at - j.lastRunAt > j.expectedEveryMs * 2);
        return {
          ...j,
          overdue,
          // Never having run is stale, not healthy. Reporting "healthy" for a job
          // that has not started is how a broken scheduler looks fine.
          stale: j.lastSuccessAt == null,
          state: j.lastError ? 'failing' : overdue || j.lastSuccessAt == null ? 'stale' : 'healthy'
        };
      });
    }
  };
}

/** Feature flags with deterministic bucketing and a kill switch. */
export function createFlagRegistry({ definitions = [], now = () => Date.now() } = {}) {
  const flags = new Map(definitions.map((d) => [d.key, { rolloutPercentage: 0, enabled: false, killSwitch: false, ...d }]));
  return {
    set(key, patch) {
      const f = flags.get(key);
      if (!f) return { ok: false, reason: 'unknown-flag' };
      flags.set(key, { ...f, ...patch, updatedAt: new Date(now()).toISOString() });
      return { ok: true, flag: flags.get(key) };
    },
    list: () => [...flags.values()],
    /** Evaluation order: kill switch, then enabled, then deterministic rollout. */
    evaluate(key, { actor = null } = {}) {
      const f = flags.get(key);
      if (!f) return { key, value: false, reason: 'unknown-flag' };
      if (f.killSwitch) return { key, value: false, reason: 'kill-switch' };
      if (!f.enabled) return { key, value: false, reason: 'disabled' };
      if (f.rolloutPercentage >= 100) return { key, value: true, reason: 'full-rollout' };
      if (f.rolloutPercentage <= 0) return { key, value: false, reason: 'zero-rollout' };
      if (!actor) return { key, value: false, reason: 'no-actor-for-partial-rollout' };
      // Stable bucketing: the same actor always gets the same answer, and a
      // user does not flip on every page load.
      let h = 0;
      const s = `${key}|${actor}`;
      for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
      const bucket = h % 100;
      return { key, value: bucket < f.rolloutPercentage, reason: 'rollout', bucket };
    }
  };
}

/** Maintenance mode: the client half. Enforcement is server-side. */
export function maintenanceState({ config = null, at = new Date() } = {}) {
  if (!config?.enabled) return { active: false, writable: true };
  const startsAt = config.startsAt ? new Date(config.startsAt) : null;
  const endsAt = config.endsAt ? new Date(config.endsAt) : null;
  const within = (!startsAt || at >= startsAt) && (!endsAt || at <= endsAt);
  return {
    active: within,
    writable: config.readOnly === true,
    message: config.message || 'Scheduled maintenance in progress.',
    endsAt: endsAt ? endsAt.toISOString() : null,
    note: 'The client honours this flag; the server must also refuse writes, because a client flag is advisory.'
  };
}

export const reliabilitySummary = () => ({
  dependencies: DEPENDENCIES.length,
  critical: DEPENDENCIES.filter((d) => d.critical).length,
  breakerStates: BREAKER_STATES.length,
  healthStates: HEALTH_STATES.length
});
