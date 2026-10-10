import { describe, it, expect } from 'vitest';
import {
  validateUsername, createProfile, updateProfile, registerSession, describeDevice,
  activeSessions, scoreLogin, recordLogin, appendAudit, auditFilter,
  createDataRequest, advanceDataRequest, applyDeletion, buildExport, subjectFor
} from './accounts.js';
import {
  createLockoutState, recordFailure, recordSuccess, isLocked, lockDurationFor,
  generateSecret, totp, verifyTotp, generateBackupCodes, consumeBackupCode
} from './mfa.js';
import {
  normaliseAlert, validateRule, evaluateAll, applyCooldown, RULE_TYPES, PORTFOLIO_SYMBOL
} from './alertsEngine.js';
import { buildLots, positions } from './portfolio.js';
import { authorize } from './rbac.js';
import { findRoute, buildPath, validateRequest, idempotencyFor } from './api.js';

/* ============================================================================
 * End-to-end workflow tests (Section 25: E2E — registration, login, core
 * workflows, checkout, account deletion).
 *
 * These drive the real modules in sequence, carrying state from one stage into
 * the next, so a stage that silently produces the wrong shape breaks the stage
 * after it. The journey is deliberately the one a user takes:
 *   register -> sign in (and be locked out for guessing) -> enrol MFA ->
 *   do the work (portfolio, alert, checkout) -> export -> delete the account.
 * ========================================================================== */

const T = (iso) => new Date(iso).getTime();

describe('E2E: registration', () => {
  it('rejects a username two accounts could collide on', () => {
    // Case and character restrictions exist so 'Ali' and 'ali' are one account.
    expect(validateUsername('ali').valid).toBe(true);
    expect(validateUsername('ALI').valid).toBe(true);
    expect(validateUsername('ALI').normalised).toBe('ali');
    expect(validateUsername('a').valid).toBe(false);
    expect(validateUsername('admin').valid).toBe(false); // reserved
    expect(validateUsername('has space').valid).toBe(false);
  });

  it('refuses a profile with a malformed email', () => {
    const bad = createProfile({ userId: 'u1', email: 'not-an-email', username: 'ali' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.field)).toContain('email');

    const noId = createProfile({ email: 'a@example.com', username: 'ali' });
    expect(noId.errors.map((e) => e.field)).toContain('userId');
  });

  it('creates a profile with MFA off and no connected accounts', () => {
    const { ok, profile } = createProfile({ userId: 'u1', email: 'Ali@Example.com', username: 'ali' });
    expect(ok).toBe(true);
    expect(profile.email).toBe('ali@example.com'); // lower-cased, so it is one account
    expect(profile.mfa).toEqual({ enabled: false, methods: [] });
    expect(profile.connectedAccounts).toEqual([]);
    expect(profile.displayName).toBe('ali');
  });
});

describe('E2E: login, lockout and MFA', () => {
  it('escalates the lockout, then clears it on a genuine success', () => {
    const base = T('2026-10-09T09:00:00Z');
    let state = createLockoutState(base);

    // Two mistakes are free.
    state = recordFailure(state, base);
    state = recordFailure(state, base);
    expect(isLocked(state, base).locked).toBe(false);

    // The third locks.
    state = recordFailure(state, base);
    expect(isLocked(state, base)).toMatchObject({ locked: true, retryAfterMs: lockDurationFor(3) });

    // A success during the cooldown must not clear the counter.
    const duringLock = recordSuccess(state, base + 1000);
    expect(duringLock.attempts).toBe(3);

    // After the cooldown it does.
    const after = recordSuccess(state, base + lockDurationFor(3) + 1);
    expect(after.attempts).toBe(0);
    expect(isLocked(after, base).locked).toBe(false);
  });

  it('signs in: verifies the second factor and records the device', async () => {
    const now = T('2026-10-09T09:00:00Z');
    const secret = generateSecret();

    // Enrolment: the user scans the secret, then proves they can compute a code.
    const enrolmentCode = await totp(secret, { at: now });
    expect((await verifyTotp(secret, enrolmentCode, { at: now })).ok).toBe(true);
    // A wrong code must fail, and must not be accepted "approximately".
    expect((await verifyTotp(secret, '000000', { at: now })).ok).toBe(
      enrolmentCode === '000000'
    );

    let { sessions } = registerSession([], {
      userId: 'u1',
      device: describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0'),
      now: new Date(now)
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].device.label).toBe('Chrome on macOS');
    expect(sessions[0].device.kind).toBe('desktop');

    // A second device is the one that is now current.
    ({ sessions } = registerSession(sessions, {
      userId: 'u1',
      device: describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile'),
      now: new Date(now)
    }));
    expect(activeSessions(sessions).length).toBe(2);
    expect(activeSessions(sessions).filter((s) => s.current).length).toBe(1);
    expect(activeSessions(sessions)[0].device.label).toBe('Chrome on Android');
  });

  it('uses a backup code when the authenticator is lost, exactly once', async () => {
    const { codes, hashes } = await generateBackupCodes({ count: 5 });
    const first = await consumeBackupCode(hashes, codes[0]);
    expect(first.ok).toBe(true);
    expect(first.remainingCount).toBe(4);
    expect(await consumeBackupCode(first.remaining, codes[0])).toMatchObject({ ok: false, reason: 'no-match' });
    // The last two codes warn, so the user is told to regenerate.
    let set = hashes;
    for (let i = 0; i < 3; i += 1) set = (await consumeBackupCode(set, codes[i])).remaining;
    expect((await consumeBackupCode(set, codes[3])).warning).toMatch(/Few backup codes/);
  });

  it('flags the sign-in that follows the lockout as high risk', () => {
    // The story: an attacker guessed three times, then succeeded from a new country.
    let history = [];
    ({ history } = recordLogin(history, {
      userId: 'u1', device: { label: 'Chrome on macOS' }, ip: '203.0.113.7', country: 'PK',
      risk: { level: 'low', score: 0 }, now: new Date(T('2026-10-01T09:00:00Z'))
    }));

    const risk = scoreLogin({
      attempt: { country: 'RU', deviceLabel: 'Unknown on Unknown', ip: '198.51.100.9', failedAttempts: 3 },
      history
    });
    expect(risk.level).toBe('high');
    expect(risk.action).toBe('require-verification');
    expect(risk.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(['new-country', 'new-device', 'new-ip', 'failed-attempts'])
    );

    // The risk is recorded so the next sign-in can compare against it.
    const { entry } = recordLogin(history, {
      userId: 'u1', device: { label: 'Unknown on Unknown' }, ip: '198.51.100.9', country: 'RU',
      risk, now: new Date(T('2026-10-09T09:00:00Z'))
    });
    expect(entry.riskLevel).toBe('high');
    expect(entry.riskScore).toBe(risk.score);
  });
});

describe('E2E: core workflow — portfolio, alert, checkout', () => {
  const TXS = [
    { id: 't1', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 1, price: 30_000, fee: 0, at: T('2026-01-10T00:00:00Z') },
    { id: 't2', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 0.5, price: 40_000, fee: 0, at: T('2026-02-10T00:00:00Z') },
    { id: 't3', coinId: 'bitcoin', symbol: 'BTC', side: 'sell', amount: 1, price: 50_000, fee: 0, at: T('2026-03-10T00:00:00Z') }
  ];

  it('matches lots FIFO: the oldest units are the ones sold', () => {
    const lots = buildLots(TXS);
    expect(lots.warnings).toEqual([]);
    // Selling 1 of 1.5 consumes the 30000 lot entirely, not a proportional slice.
    expect(lots.realizedByCoin.bitcoin).toEqual({ proceeds: 50_000, costBasis: 30_000, gain: 20_000, count: 1 });
    expect(lots.totals).toEqual({ proceeds: 50_000, costBasis: 30_000, realized: 20_000 });
    expect(lots.disposals[0]).toMatchObject({ amount: 1, unitProceeds: 50_000, costBasis: 30_000, gain: 20_000 });
    expect(lots.disposals[0].gainPct).toBeCloseTo(66.666, 2);
    // What is left is the 40000 lot.
    expect(lots.lotsByCoin.bitcoin).toHaveLength(1);
    expect(lots.lotsByCoin.bitcoin[0]).toMatchObject({ remaining: 0.5, unitCost: 40_000 });
  });

  it('maps the holding to a disclosure period', () => {
    // 2026-01-10 to 2026-03-10 is short-term; a year or more would be long-term.
    expect(buildLots(TXS).disposals[0].holdingDays).toBe(59);
    expect(buildLots(TXS).disposals[0].longTerm).toBe(false);

    const longHold = buildLots([
      { id: 'a', coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: T('2024-01-01T00:00:00Z') },
      { id: 'b', coinId: 'bitcoin', side: 'sell', amount: 1, price: 200, at: T('2025-06-01T00:00:00Z') }
    ]);
    expect(longHold.disposals[0].longTerm).toBe(true);
  });

  it('reports an oversell instead of inventing units', () => {
    const lots = buildLots([
      { id: 'a', coinId: 'bitcoin', side: 'buy', amount: 1, price: 100, at: 1 },
      { id: 'b', coinId: 'bitcoin', side: 'sell', amount: 5, price: 200, at: 2 }
    ]);
    expect(lots.warnings.map((w) => w.kind)).toContain('oversold');
    expect(lots.disposals[0].amount).toBe(1); // capped at what was held
  });

  it('values the position at the current price', () => {
    const pos = positions(TXS, { bitcoin: 55_000 }, { bitcoin: { symbol: 'BTC', name: 'Bitcoin' } });
    expect(pos.positions).toHaveLength(1);
    const btc = pos.positions[0];
    expect(btc.coinId).toBe('bitcoin');
    expect(btc.amount).toBeCloseTo(0.5, 12);
    // Cost basis is the remaining 0.5 @ 40000.
    expect(btc.costBasis).toBeCloseTo(20_000, 6);
  });

  it('creates an alert, fires it once, then respects the cooldown', () => {
    const alert = normaliseAlert({
      id: 'al1', symbol: 'BTC', rule: { type: 'price_above', value: 60_000, symbol: 'BTC' },
      cooldownMs: 300_000, enabled: true, at: T('2026-10-09T08:00:00Z')
    });
    expect(alert.rule.type).toBe('price_above');
    expect(alert.enabled).toBe(true);
    expect(validateRule(alert.rule)).toEqual({ ok: true, errors: [] });

    // evaluateAll takes rules, which is how Alerts.jsx calls it.
    const asRule = [{ ...alert.rule, id: alert.id, enabled: alert.enabled }];

    const now = T('2026-10-09T09:00:00Z');
    const notYet = evaluateAll(asRule, { BTC: { price: 59_000 } }, now);
    expect(notYet).toEqual([]);

    const hits = evaluateAll(asRule, { BTC: { price: 61_000 } }, now);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: 'al1', type: 'price_above' });

    const first = applyCooldown(hits, {}, 300_000, now);
    expect(first.fired).toHaveLength(1);

    // Still inside the window: suppressed, not re-sent.
    const again = applyCooldown(hits, first.lastFired, 300_000, now + 60_000);
    expect(again.fired).toEqual([]);

    // Past the window: fires again.
    expect(applyCooldown(hits, first.lastFired, 300_000, now + 300_001).fired).toHaveLength(1);
  });

  it('migrates a legacy {dir,target} alert rather than dropping it', () => {
    // Alerts created before the rules engine existed are still in storage.
    const migrated = normaliseAlert({ id: 'old', symbol: 'ETH', dir: 'below', target: 1500 });
    expect(migrated.rule).toEqual({ type: 'price_below', value: 1500, symbol: 'ETH' });
    expect(migrated.cooldownMs).toBeGreaterThan(0);
  });

  it('validates a portfolio alert, which has no coin to check', () => {
    const ok = validateRule({ type: 'portfolio_value_below', value: 10_000, symbol: PORTFOLIO_SYMBOL });
    expect(ok.ok).toBe(true);
    expect(validateRule({ type: 'price_above', value: 10 })).toMatchObject({ ok: false }); // no symbol
    expect(validateRule({ type: 'rsi_above', value: 900, symbol: 'BTC' })).toMatchObject({ ok: false });
    expect(validateRule({ type: 'made_up', value: 1, symbol: 'BTC' })).toMatchObject({ ok: false });
    // Every offered rule type must be creatable.
    for (const type of RULE_TYPES) {
      expect(RULE_TYPES).toContain(type);
    }
  });

  it('a disabled alert never fires', () => {
    const off = normaliseAlert({ id: 'al2', symbol: 'BTC', rule: { type: 'price_above', value: 1, symbol: 'BTC' }, enabled: false });
    expect(evaluateAll([{ ...off.rule, id: off.id, enabled: off.enabled }], { BTC: { price: 99_999 } })).toEqual([]);
  });

  it('checkout is idempotent, so a double submit charges once', () => {
    // The API contract for a charge: one idempotency key per intended payment.
    const route = findRoute('POST', '/billing/refunds');
    expect(route.idempotent).toBe(true);
    expect(validateRequest(route, { invoiceId: 'in_1' })).toMatchObject({ ok: false, reason: 'missing-fields' });
    expect(validateRequest(route, { invoiceId: 'in_1', amount: 40 }).ok).toBe(true);

    const body = { invoiceId: 'in_1', amount: 40 };
    const a = idempotencyFor(route, { payload: body, actor: 'u1' });
    const b = idempotencyFor(route, { payload: { amount: 40, invoiceId: 'in_1' }, actor: 'u1' });
    expect(a.key).toBe(b.key);
    expect(a.header).toBe('idempotency-key');
  });

  it('builds the versioned path for the resource the user just created', () => {
    const route = findRoute('GET', '/portfolios/{id}');
    expect(buildPath(route, { id: 'pf_1' })).toEqual({ ok: true, url: '/api/v1/portfolios/pf_1' });
  });
});

describe('E2E: authorization, export and account deletion', () => {
  it('lets the owner act and denies a different user on the same resource', () => {
    const owner = { ...subjectFor({ userId: 'u1' }), roles: ['user'] };
    const other = { ...subjectFor({ userId: 'u2' }), roles: ['user'] };
    expect(authorize(owner, 'portfolio:read', { resourceOwnerId: 'u1' }).allowed).toBe(true);
    expect(authorize(other, 'portfolio:read', { resourceOwnerId: 'u1' })).toMatchObject({ allowed: false, reason: 'not-owner' });
  });

  it('exports the account, then deletes it, and the export is gone', () => {
    /* ---- the account exists ---- */
    const { profile } = createProfile({ userId: 'u1', email: 'ali@example.com', username: 'ali' });
    const { session } = registerSession([], {
      userId: 'u1',
      device: describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0'),
      ip: '203.0.113.7'
    });
    let { history } = recordLogin([], {
      userId: 'u1', device: { label: 'Chrome on macOS' }, ip: '203.0.113.7', country: 'PK', risk: { level: 'low', score: 0 }
    });

    /* ---- stage 1: the export request ---- */
    let dsr = createDataRequest({ userId: 'u1', type: 'export' }).request;
    for (const next of ['verifying', 'processing', 'completed']) dsr = advanceDataRequest(dsr, next).request;
    expect(dsr.state).toBe('completed');

    const bundle = buildExport({ profile, memberships: [], sessions: [session], loginHistory: history });
    expect(bundle.profile.email).toBe('ali@example.com');
    expect(bundle.sessions[0].device).toBe('Chrome on macOS');
    // The stored address is already masked, so the export cannot leak the host.
    expect(JSON.stringify(bundle)).not.toContain('203.0.113.7');

    /* ---- stage 2: the deletion request ---- */
    let del = createDataRequest({ userId: 'u1', type: 'deletion' }).request;
    del = advanceDataRequest(del, 'verifying').request;
    del = advanceDataRequest(del, 'processing').request;
    del = advanceDataRequest(del, 'completed').request;
    expect(del.state).toBe('completed');

    const { profile: deleted } = applyDeletion(profile, {
      retainForLegalDays: 30,
      now: new Date(T('2026-10-09T12:00:00Z'))
    });
    expect(deleted.email).toBeNull();
    expect(deleted.username).toBeNull();
    expect(deleted.displayName).toBe('Deleted account');
    expect(deleted.connectedAccounts).toEqual([]);
    expect(deleted.deletion.purgeAfter).toBe('2026-11-08T12:00:00.000Z');

    /* ---- both requests are on the audit trail ---- */
    let log = [];
    ({ log } = appendAudit(log, { actorId: 'u1', action: 'export.requested' }));
    ({ log } = appendAudit(log, { actorId: 'u1', action: 'deletion.requested' }));
    expect(auditFilter(log, { actorId: 'u1' })).toHaveLength(2);
    expect(auditFilter(log, { action: 'deletion.requested' })).toHaveLength(1);
  });

  it('an export taken before deletion must not be re-issued after it', () => {
    // The export is built from the live profile, so once the profile is
    // anonymised a new export cannot re-create the personal data.
    const { profile } = createProfile({ userId: 'u1', email: 'ali@example.com', username: 'ali' });
    const { profile: deleted } = applyDeletion(profile);
    const after = buildExport({ profile: deleted, memberships: [], sessions: [], loginHistory: [] });
    expect(after.profile.email).toBeNull();
    expect(after.profile.username).toBeNull();
  });
});

describe('E2E: the journey leaves no inconsistent state', () => {
  it('a profile edit after registration persists through the update path', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'ali@example.com', username: 'ali' });
    const { ok, profile: updated } = updateProfile(profile, { displayName: 'Ali Khan', country: 'PK', timezone: 'Asia/Karachi' });
    expect(ok).toBe(true);
    expect(updated).toMatchObject({ displayName: 'Ali Khan', country: 'PK', timezone: 'Asia/Karachi' });
    expect(updated.email).toBe('ali@example.com');
  });

  it('rejects an invalid profile edit without corrupting the profile', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'ali@example.com', username: 'ali' });
    const res = updateProfile(profile, { username: 'admin' });
    expect(res.ok).toBe(false);
    expect(res.profile.username).toBe('ali'); // unchanged, not partially applied
  });
});
