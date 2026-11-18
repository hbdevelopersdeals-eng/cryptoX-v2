import { describe, it, expect } from 'vitest';
import {
  validateFeeConfig, validateRiskConfig, diffConfig, healthSummary, listingReadiness,
  queueSummary, confirmDestructive, FEE_BOUNDS, RISK_BOUNDS, REQUIRES_PRIVILEGED_ROLE
} from './adminConfig.js';

const fees = { makerBps: 2, takerBps: 10, withdrawalBps: 50, settlementMinutes: 30 };
const risk = { maxLeverage: 5, maxOrderNotionalUsd: 100000, maxDailyWithdrawalUsd: 50000, circuitBreakerPct: 10 };

describe('fee configuration', () => {
  it('accepts a sane configuration', () => {
    const r = validateFeeConfig(fees);
    expect(r.valid).toBe(true);
    expect(r.values.takerBps).toBe(10);
  });

  it('refuses an out-of-bounds value instead of clamping it', () => {
    const r = validateFeeConfig({ ...fees, takerBps: 10000 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/between 0 and 100/);
    expect(r.values.takerBps).toBeUndefined();
  });

  it('allows a negative maker fee as a rebate', () => {
    expect(validateFeeConfig({ ...fees, makerBps: -5 }).valid).toBe(true);
    expect(FEE_BOUNDS.makerBps.min).toBeLessThan(0);
  });

  it('refuses a taker fee below the maker fee', () => {
    const r = validateFeeConfig({ ...fees, makerBps: 20, takerBps: 5 });
    expect(r.errors.join(' ')).toMatch(/pay traders to take liquidity/);
  });

  it('requires every field', () => {
    expect(validateFeeConfig({}).errors).toHaveLength(Object.keys(FEE_BOUNDS).length);
  });

  it('rejects non-numeric input', () => {
    expect(validateFeeConfig({ ...fees, takerBps: 'ten' }).errors.join(' ')).toMatch(/must be a number/);
  });
});

describe('risk configuration', () => {
  it('accepts a sane configuration', () => {
    expect(validateRiskConfig(risk).valid).toBe(true);
  });

  it('caps leverage', () => {
    expect(validateRiskConfig({ ...risk, maxLeverage: 100 }).errors.join(' ')).toMatch(/between 1 and 20/);
    expect(Object.keys(RISK_BOUNDS)).toContain('maxLeverage');
  });

  it('refuses the high-leverage plus high-withdrawal pairing', () => {
    const r = validateRiskConfig({ ...risk, maxLeverage: 15, maxDailyWithdrawalUsd: 5000000 });
    expect(r.errors.join(' ')).toMatch(/unacceptable risk pairing/);
  });
});

describe('diffConfig', () => {
  it('reports only changed fields with direction', () => {
    const d = diffConfig(fees, { ...fees, takerBps: 12 });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: 'takerBps', before: 10, after: 12, direction: 'increase' });
  });

  it('returns an empty diff for an identical config', () => {
    expect(diffConfig(fees, { ...fees })).toEqual([]);
  });

  it('reports a newly added field', () => {
    const d = diffConfig({ a: 1 }, { a: 1, b: 2 });
    expect(d[0]).toMatchObject({ key: 'b', before: null, after: 2 });
  });
});

describe('health summary', () => {
  it('reports ok when every service is healthy', () => {
    const h = healthSummary([{ id: 'a', status: 'ok' }, { id: 'b', status: 'ok', latencyMs: 40 }]);
    expect(h.overall).toBe('ok');
    expect(h.ok).toBe(2);
  });

  it('reports down when any service is down', () => {
    const h = healthSummary([{ id: 'a', status: 'ok' }, { id: 'b', status: 'down' }]);
    expect(h.overall).toBe('down');
    expect(h.down).toBe(1);
  });

  it('treats an unknown status as degraded, never as healthy', () => {
    const h = healthSummary([{ id: 'a', status: 'weird' }]);
    expect(h.rows[0].status).toBe('degraded');
    expect(h.overall).toBe('degraded');
  });

  it('reports unknown for an empty service list', () => {
    expect(healthSummary([]).overall).toBe('unknown');
  });

  it('computes a p95 latency over the provided rows', () => {
    const h = healthSummary([
      { id: 'a', status: 'ok', latencyMs: 10 },
      { id: 'b', status: 'ok', latencyMs: 20 },
      { id: 'c', status: 'ok', latencyMs: 30 }
    ]);
    expect(h.p95LatencyMs).toBe(30);
  });
});

describe('market listing readiness', () => {
  it('blocks on a missing critical item', () => {
    const r = listingReadiness({ legal: true, audit: true, sanctions: true, oracle: false });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(' ')).toMatch(/Price source/);
  });

  it('warns but does not block on non-critical items', () => {
    const r = listingReadiness({ legal: true, audit: true, sanctions: true, oracle: true });
    expect(r.ready).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('counts completion against the checklist', () => {
    const r = listingReadiness({ legal: true, audit: true, sanctions: true, oracle: true, support: true });
    expect(r.completed).toBe(5);
    expect(r.total).toBe(7);
  });
});

describe('queue summary', () => {
  const now = Date.parse('2026-06-10T12:00:00Z');

  it('counts open items and breaches', () => {
    const q = queueSummary([
      { id: '1', openedAt: '2026-06-10T10:00:00Z' },
      { id: '2', openedAt: '2026-06-08T12:00:00Z' },
      { id: '3', status: 'closed', openedAt: '2026-06-01T12:00:00Z' }
    ], { slaHours: 24, now });
    expect(q.open).toBe(2);
    expect(q.breaches).toBe(1);
    expect(q.oldestHours).toBeCloseTo(48, 5);
  });

  it('reports an empty queue without inventing an age', () => {
    const q = queueSummary([], { now });
    expect(q.open).toBe(0);
    expect(q.oldestHours).toBeNull();
  });

  it('honours a per-queue SLA', () => {
    const items = [{ id: '1', openedAt: '2026-06-10T06:00:00Z' }];
    expect(queueSummary(items, { slaHours: 4, now }).breaches).toBe(1);
    expect(queueSummary(items, { slaHours: 12, now }).breaches).toBe(0);
  });
});

describe('destructive action confirmation', () => {
  it('requires the exact identifier', () => {
    expect(confirmDestructive({ action: 'delist', target: 'ETH-USDT', confirmText: 'eth-usdt', expected: 'ETH-USDT' }).ok).toBe(false);
    expect(confirmDestructive({ action: 'delist', target: 'ETH-USDT', confirmText: ' ETH-USDT ', expected: 'ETH-USDT' }).ok).toBe(true);
  });

  it('refuses when there is nothing to confirm against', () => {
    expect(confirmDestructive({ action: 'delist', target: 'X' }).ok).toBe(false);
  });
});

describe('privileged-role boundary', () => {
  it('documents which sections cannot be read from a browser', () => {
    const names = REQUIRES_PRIVILEGED_ROLE.map((r) => r.section);
    expect(names).toContain('Users');
    expect(names).toContain('Revenue & fees');
    expect(REQUIRES_PRIVILEGED_ROLE.every((r) => r.reason.length > 20)).toBe(true);
  });
});
