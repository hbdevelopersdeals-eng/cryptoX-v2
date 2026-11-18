import { describe, it, expect } from 'vitest';
import {
  QUOTA_KEYS, checkQuota, limitFor, usageSummary, quotaWarning, periodKey,
  nextReset, fromServer, consumeQuota, readUsage, ENFORCEMENT, MIGRATION
} from './entitlements.js';

describe('limits mirror the plan catalogue', () => {
  it('reads the documented values', () => {
    expect(limitFor('free', 'alerts')).toBe(5);
    expect(limitFor('pro', 'alerts')).toBe(100);
    expect(limitFor('business', 'bots')).toBe(25);
    expect(limitFor('enterprise', 'alerts')).toBeNull();
  });

  it('returns undefined for an unknown key or plan rather than a number', () => {
    expect(limitFor('pro', 'nonsense')).toBeUndefined();
    expect(limitFor('nope', 'alerts')).toBeUndefined();
  });
});

describe('checkQuota', () => {
  it('allows usage inside the limit and reports the remaining headroom', () => {
    const r = checkQuota({ planId: 'pro', key: 'alerts', used: 98, amount: 1 });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.reason).toBe('within-quota');
  });

  it('refuses the increment that would cross the limit', () => {
    const r = checkQuota({ planId: 'pro', key: 'alerts', used: 100, amount: 1 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('quota-exceeded');
    expect(r.message).toMatch(/Resets/);
  });

  it('treats a null limit as unlimited, not as zero', () => {
    const r = checkQuota({ planId: 'enterprise', key: 'apiCallsPerMonth', used: 10_000_000 });
    expect(r.allowed).toBe(true);
    expect(r.limit).toBeNull();
  });

  it('fails closed on an unknown key', () => {
    const r = checkQuota({ planId: 'pro', key: 'unicorns' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('unknown-key');
  });

  it('treats a zero limit as a wall', () => {
    expect(checkQuota({ planId: 'free', key: 'bots', used: 0, amount: 1 }).allowed).toBe(false);
  });

  it('never lets a negative amount reduce usage past zero', () => {
    const r = checkQuota({ planId: 'free', key: 'alerts', used: 4, amount: -10 });
    expect(r.allowed).toBe(true);
    expect(r.predicted).toBe(4);
  });
});

describe('period arithmetic', () => {
  it('produces a UTC month key', () => {
    expect(periodKey(Date.parse('2026-03-15T23:59:00Z'))).toBe('2026-03');
    expect(periodKey(Date.parse('2026-12-31T23:59:00Z'))).toBe('2026-12');
  });

  it('resets at the first moment of the next UTC month', () => {
    const r = nextReset(Date.parse('2026-03-15T12:00:00Z'));
    expect(r.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('usageSummary', () => {
  it('marks every enforcement state honestly, including "migration not applied"', () => {
    const rows = usageSummary('pro', { alerts: 50 });
    expect(rows).toHaveLength(QUOTA_KEYS.length);
    expect(rows.find((r) => r.key === 'alerts').enforcement).toBe('server');
    // Portfolios and seats have a mechanism in migration 0008, but this client
    // cannot know whether it is applied — so they are neither "server" nor
    // "display-only", which is the distinction that keeps the pricing page true.
    expect(rows.find((r) => r.key === 'portfolios').enforcement).toBe('pending-migration');
    expect(rows.find((r) => r.key === 'seats').enforcement).toBe('pending-migration');
  });

  it('caps the percentage at 100 even when usage exceeds the limit', () => {
    const rows = usageSummary('free', { alerts: 50 });
    expect(rows.find((r) => r.key === 'alerts').pct).toBe(100);
  });

  it('reports unlimited rows without a percentage', () => {
    const rows = usageSummary('enterprise', { apiCallsPerMonth: 3 });
    const api = rows.find((r) => r.key === 'apiCallsPerMonth');
    expect(api.unlimited).toBe(true);
    expect(api.pct).toBeNull();
  });

  it('documents the migration that makes enforcement real', () => {
    expect(MIGRATION).toBe('0007_entitlements.sql');
    expect(ENFORCEMENT.alerts.server).toBe(true);
    expect(ENFORCEMENT.portfolios.server).toBe(false);
  });
});

describe('quotaWarning', () => {
  it('stays silent below the threshold', () => {
    expect(quotaWarning('pro', 'alerts', 10)).toBeNull();
  });

  it('warns at 80% and blocks at the limit', () => {
    expect(quotaWarning('pro', 'alerts', 85).severity).toBe('warning');
    expect(quotaWarning('pro', 'alerts', 100).severity).toBe('blocked');
  });

  it('says nothing for an unlimited plan', () => {
    expect(quotaWarning('enterprise', 'alerts', 99999)).toBeNull();
  });
});

describe('server responses', () => {
  it('normalises an allowed payload', () => {
    const r = fromServer({ allowed: true, limit: 100, used: 5, remaining: 95, period: '2026-06', reset_at: '2026-07-01T00:00:00Z' });
    expect(r.allowed).toBe(true);
    expect(r.period).toBe('2026-06');
  });

  it('normalises a refusal without inventing numbers', () => {
    const r = fromServer({ allowed: false, limit: 5, used: 5 });
    expect(r.allowed).toBe(false);
    expect(r.message).toMatch(/Limit reached/);
  });

  it('refuses the write when there is no database client', async () => {
    const r = await consumeQuota(null, 'alerts');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no-client');
  });

  it('fails closed when the RPC errors', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    const r = await consumeQuota(client, 'alerts');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('rpc-error');
  });

  it('passes the client payload through when the RPC succeeds', async () => {
    const client = { rpc: async () => ({ data: [{ allowed: true, limit: 100, used: 11 }], error: null }) };
    const r = await consumeQuota(client, 'alerts', 1);
    expect(r.allowed).toBe(true);
    expect(r.used).toBe(11);
  });

  it('reports an unreadable usage table instead of zeros', async () => {
    const client = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'no table' } }) }) }) };
    const r = await readUsage(client);
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/no table/);
  });

  it('maps counter rows into a usage object', async () => {
    const client = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ key: 'alerts', used: '7' }], error: null }) }) }) };
    const r = await readUsage(client);
    expect(r.ok).toBe(true);
    expect(r.usage.alerts).toBe(7);
  });
});
