import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLES, supabaseConfigured, supabase, requireSupabase } from './supabase.js';
import { RULE_TYPES } from './alertsEngine.js';
import { EXTRA_RULE_TYPES } from './alertExtras.js';
import {
  LOCKOUT_POLICY, lockDurationFor, createLockoutState, recordFailure, isLocked,
  TokenBucket, totp, verifyTotp, generateSecret, generateBackupCodes, consumeBackupCode
} from './mfa.js';
import {
  verifyWebhookSignature, applyPaymentUpdate, PAYMENT_STATUSES,
  evaluateCoupon, usageCharge, planRefund, nextRetry, classifyDecline, DUNNING_SCHEDULE
} from './billing.js';
import {
  createProfile, registerSession, maskIp, revokeSession, describeDevice,
  activeSessions, scoreLogin, recordLogin, appendAudit, auditFilter,
  createDataRequest, advanceDataRequest, applyDeletion, buildExport,
  DSR_STATES, AUDIT_ACTIONS, subjectFor
} from './accounts.js';
import { authorize, ROLE_IDS } from './rbac.js';
import {
  ROUTES, findRoute, buildPath, buildQuery, validateRequest, parsePagination,
  errorEnvelope, versionHeaders, generateOpenApi, validateRegistry, API_VERSION
} from './api.js';

/* ============================================================================
 * Integration tests (Section 25: Database, APIs, Payments, Authentication,
 * Webhooks).
 *
 * The database half is a static contract test. It cannot execute Postgres, so
 * it parses the SQL migrations and proves they are consistent with each other
 * and with the names the client uses. The defect class it catches is real:
 * migration 0002 referenced three columns that no migration created, so it
 * aborted on its first constraint and had never applied at all.
 * ========================================================================== */

/* ------------------------------------------------------------ SQL parsing */

const SQL_DIR = 'supabase/migrations';

function migrationSources() {
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(`${SQL_DIR}/${f}`, 'utf8') }));
}

/** Strip line comments so a commented-out statement is not parsed as real. */
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, ' ');

const RESERVED = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'case', 'when',
  'then', 'else', 'end', 'true', 'false', 'check', 'constraint', 'alter', 'table',
  'add', 'if', 'exists', 'coalesce', 'char_length', 'now', 'current_user', 'auth',
  'uid', 'public', 'array', 'default', 'unique', 'index', 'create', 'on', 'using',
  'with', 'text', 'uuid', 'bigint', 'jsonb', 'numeric', 'boolean', 'timestamptz',
  'primary', 'key', 'references', 'cascade', 'delete', 'set', 'identity', 'always',
  'as', 'generated', 'by', 'partition', 'range', 'like', 'interval', 'extract',
  'epoch', 'date', 'lower', 'upper', 'length', 'substring', 'desc', 'asc'
]);

/** Bare identifiers in an expression, minus keywords, literals and numbers. */
function identifiersIn(expr) {
  const withoutStrings = expr.replace(/'[^']*'/g, ' ');
  const found = withoutStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  return [...new Set(found.filter((w) => !RESERVED.has(w.toLowerCase())))];
}

const COLUMN_TYPES = 'uuid|text|numeric|boolean|jsonb|timestamptz|bigint|integer|double precision';

/** table -> Set(columns), from `create table` plus every `alter table add column`. */
function tableColumns(sources) {
  const tables = new Map();
  const add = (t, c) => {
    if (!tables.has(t)) tables.set(t, new Set());
    if (c) tables.get(t).add(c);
  };
  for (const { sql } of sources) {
    const body = stripSqlComments(sql);
    for (const m of body.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const [, table, cols] = m;
      add(table);
      for (const line of cols.split('\n')) {
        const name = line.trim().match(new RegExp(`^([a-z_][a-z0-9_]*)\\s+(${COLUMN_TYPES})`, 'i'));
        if (name) add(table, name[1]);
      }
    }
    for (const m of body.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
      add(m[1], m[2]);
    }
  }
  return tables;
}

const SOURCES = migrationSources();
const ALL_SQL = SOURCES.map((s) => s.sql).join('\n');
const COLUMNS = tableColumns(SOURCES);
const CX_TABLES = [...COLUMNS.keys()].filter((t) => t.startsWith('cx_'));

describe('database contract: migrations are internally consistent', () => {
  it('finds both migrations and every cx_ table', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(2);
    expect(CX_TABLES.length).toBeGreaterThanOrEqual(8);
  });

  it('only ever adds a constraint on columns the table actually has', () => {
    // The assertion that caught migration 0002 constraining cx_holdings.quantity
    // and .cost_basis — the table has amount and buy_price. A constraint on a
    // missing column aborts the migration, so the whole file never applied.
    const missing = [];
    for (const { file, sql } of SOURCES) {
      const body = stripSqlComments(sql);
      const re = /alter table (?:if exists )?public\.(\w+)\s+add constraint (\w+)\s+check \(([\s\S]*?)\);/gi;
      for (const m of body.matchAll(re)) {
        const [, table, constraint, expr] = m;
        const cols = COLUMNS.get(table);
        expect(cols, `${file}: ${constraint} on unknown table ${table}`).toBeTruthy();
        for (const id of identifiersIn(expr)) {
          if (!cols.has(id)) missing.push(`${file}: ${constraint} references ${table}.${id}, which does not exist`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only ever builds an index on columns the table actually has', () => {
    const missing = [];
    for (const { file, sql } of SOURCES) {
      const body = stripSqlComments(sql);
      const re = /create (?:unique )?index (?:if not exists )?(\w+)\s+on public\.(\w+)\s*\(([^)]*)\)([\s\S]*?);/gi;
      for (const m of body.matchAll(re)) {
        const [, name, table, colsRaw, tail] = m;
        const cols = COLUMNS.get(table);
        expect(cols, `${file}: index ${name} on unknown table ${table}`).toBeTruthy();
        for (const col of colsRaw.split(',').map((c) => c.trim().split(/\s+/)[0])) {
          if (col && !cols.has(col)) missing.push(`${file}: ${name} indexes ${table}.${col}, which does not exist`);
        }
        for (const id of identifiersIn(tail)) {
          if (!cols.has(id)) missing.push(`${file}: ${name} filters on ${table}.${id}, which does not exist`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only ever attaches an updated_at trigger to a table that has the column', () => {
    const offenders = [];
    for (const { file, sql } of SOURCES) {
      const body = stripSqlComments(sql);
      for (const m of body.matchAll(/create trigger \w+_touch\s+before update on public\.(\w+)/gi)) {
        if (!COLUMNS.get(m[1])?.has('updated_at')) offenders.push(`${file}: ${m[1]} has no updated_at column`);
      }
    }
    // The five tables added by 0002 must have been given the column in the same
    // migration, or the trigger fails on the customer's first edit.
    expect(offenders).toEqual([]);
    expect(ALL_SQL).toMatch(/alter table public\.cx_watchlist_items add column if not exists updated_at/);
  });

  it('enables row level security on every cx_ table', () => {
    const enabled = new Set();
    for (const { sql } of SOURCES) {
      for (const m of stripSqlComments(sql).matchAll(/alter table public\.(\w+)\s+enable row level security/gi)) {
        enabled.add(m[1]);
      }
    }
    for (const table of CX_TABLES) {
      expect(enabled.has(table), `${table} has RLS disabled`).toBe(true);
    }
  });

  it('scopes every policy to auth.uid(), never to a public predicate', () => {
    const policies = [];
    for (const { sql } of SOURCES) {
      const body = stripSqlComments(sql);
      for (const m of body.matchAll(/create policy (\w+) on public\.(\w+)\s+for (all|select|insert|update|delete)([\s\S]*?);/gi)) {
        policies.push({ name: m[1], table: m[2], body: m[4] });
      }
    }
    expect(policies.length).toBeGreaterThanOrEqual(8);
    for (const p of policies) {
      expect(p.body, `policy ${p.name}`).toMatch(/auth\.uid\(\)/);
      expect(p.body, `policy ${p.name}`).not.toMatch(/\busing\s*\(\s*true\s*\)/i);
    }
  });

  it('leaves the audit log append-only by policy and by rule', () => {
    expect(ALL_SQL).toMatch(/create policy cx_audit_select_own[\s\S]*?for select/i);
    expect(ALL_SQL).toMatch(/create policy cx_audit_insert_own[\s\S]*?for insert/i);
    expect(ALL_SQL).not.toMatch(/create policy \w+ on public\.cx_audit_log[\s\S]*?for update/i);
    expect(ALL_SQL).not.toMatch(/create policy \w+ on public\.cx_audit_log[\s\S]*?for delete/i);
    expect(ALL_SQL).toMatch(/on update to public\.cx_audit_log do instead nothing/i);
    expect(ALL_SQL).toMatch(/on delete to public\.cx_audit_log do instead nothing/i);
  });

  it('keeps the signal log append-only, because a deleted event is a contradiction', () => {
    expect(ALL_SQL).toMatch(/create policy cx_signals_select[\s\S]*?for select/i);
    expect(ALL_SQL).toMatch(/create policy cx_signals_insert[\s\S]*?for insert/i);
    expect(ALL_SQL).not.toMatch(/create policy \w+ on public\.cx_signal_events[\s\S]*?for delete/i);
    expect(COLUMNS.get('cx_signal_events').has('deleted_at')).toBe(false);
  });

  it('gives every table a creation timestamp and an owner column', () => {
    const creationCols = ['created_at', 'at', 'started_at', 'opened_at', 'submitted_at', 'received_at'];
    for (const table of CX_TABLES) {
      const cols = COLUMNS.get(table);
      expect([...cols].some((c) => creationCols.includes(c)), `${table} has no creation timestamp`).toBe(true);
      if (table === 'cx_audit_log') continue; // actor_id is nulled when a user is deleted
      expect(cols.has('user_id'), `${table} has no user_id`).toBe(true);
    }
  });

  it('indexes every user_id, or makes it the primary key', () => {
    for (const table of CX_TABLES) {
      if (!COLUMNS.get(table).has('user_id')) continue;
      const indexed = new RegExp(`on public\\.${table} \\(user_id`, 'i').test(ALL_SQL);
      const isPk = new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(\\s*user_id\\s+uuid\\s+primary key`, 'i').test(ALL_SQL);
      expect(indexed || isPk, `${table} has neither an index on user_id nor user_id as its key`).toBe(true);
    }
  });
});

describe('database contract: the schema matches what the client uses', () => {
  it('names every table the client asks for', () => {
    for (const [key, name] of Object.entries(TABLES)) {
      expect(COLUMNS.has(name), `TABLES.${key} = ${name} has no table`).toBe(true);
    }
  });

  it('agrees with the client on the sixteen alert rule types', () => {
    // Both sides enumerate the same vocabulary. If either drifts, a rule the UI
    // offers becomes unstorable or a stored rule becomes unevaluatable.
    const block = ALL_SQL.match(/cx_alerts_rule_type_known check \(rule_type in \(([\s\S]*?)\)\)/);
    expect(block, 'the rule_type constraint is missing from the schema').toBeTruthy();
    const inDb = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...RULE_TYPES].sort());
    expect(inDb.length).toBe(16);
    expect(inDb).toEqual(expect.arrayContaining(EXTRA_RULE_TYPES));
  });

  it('stores a rule type on every alert, so the constraint is enforceable', () => {
    const cols = COLUMNS.get('cx_alerts');
    expect(cols.has('rule_type')).toBe(true);
    expect(cols.has('symbol')).toBe(true);
    expect(ALL_SQL).toMatch(/alter table public\.cx_alerts alter column rule_type set not null/i);
  });

  it('soft-deletes only where a restore is plausible', () => {
    const softDeleted = [...COLUMNS.entries()].filter(([, c]) => c.has('deleted_at')).map(([t]) => t);
    expect(softDeleted).toEqual(expect.arrayContaining(['cx_watchlist_items', 'cx_holdings', 'cx_alerts', 'cx_strategy_arms']));
    expect(softDeleted).not.toContain('cx_signal_events');
    expect(softDeleted).not.toContain('cx_settings');
  });

  it('cascades a user deletion from every table that holds user rows', () => {
    const cascades = ALL_SQL.match(/references auth\.users\(id\) on delete cascade/g) || [];
    expect(cascades.length).toBeGreaterThanOrEqual(7);
    // The audit log keeps its rows but drops the identity.
    expect(ALL_SQL).toMatch(/actor_id\s+uuid references auth\.users\(id\) on delete set null/);
  });
});

/* --------------------------------------------------------- client runtime */

describe('integration: the Supabase client degrades honestly', () => {
  it('is inert under test, so no test can reach the network', () => {
    expect(supabaseConfigured).toBe(false);
    expect(supabase).toBeNull();
  });

  it('throws a named error rather than crashing with a null dereference', () => {
    expect(() => requireSupabase()).toThrow(/not configured/i);
  });
});

describe('integration: authentication', () => {
  it('issues a secret and accepts the code it produces', async () => {
    const secret = generateSecret();
    const at = 1_700_000_000_000;
    const code = await totp(secret, { at });
    expect(code).toMatch(/^\d{6}$/);
    expect((await verifyTotp(secret, code, { at })).ok).toBe(true);
    // One step either side still verifies; two steps away does not.
    expect((await verifyTotp(secret, await totp(secret, { at: at - 30_000 }), { at })).ok).toBe(true);
    expect((await verifyTotp(secret, await totp(secret, { at: at - 120_000 }), { at })).ok).toBe(false);
  });

  it('escalates the lockout window and reports the wait', () => {
    expect(LOCKOUT_POLICY.thresholds.length).toBeGreaterThanOrEqual(3);
    expect(lockDurationFor(1)).toBe(0);
    const at = 1_700_000_000_000;
    let state = createLockoutState(at);
    for (let i = 0; i < 3; i += 1) state = recordFailure(state, at);
    const locked = isLocked(state, at);
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterMs).toBe(lockDurationFor(3));
    // The window must lengthen, not shorten, as attempts accumulate.
    expect(lockDurationFor(10)).toBeGreaterThan(lockDurationFor(3));
    expect(isLocked(state, at + lockDurationFor(3) + 1).locked).toBe(false);
  });

  it('consumes a backup code exactly once', async () => {
    const { codes, hashes } = await generateBackupCodes({ count: 3 });
    expect(codes.length).toBe(3);
    expect(hashes.length).toBe(3);
    const first = await consumeBackupCode(hashes, codes[0]);
    expect(first.ok).toBe(true);
    expect(first.remainingCount).toBe(2);
    // The same code cannot be replayed against the reduced set.
    expect((await consumeBackupCode(first.remaining, codes[0])).ok).toBe(false);
    expect((await consumeBackupCode(first.remaining, codes[1])).ok).toBe(true);
    // A separator- and case-insensitive match still works.
    expect((await consumeBackupCode(hashes, codes[0].replace('-', ' ').toLowerCase())).ok).toBe(true);
  });

  it('enrols sessions and revokes only the named device', () => {
    let { sessions } = registerSession([], { userId: 'u1', device: describeDevice('Mozilla/5.0 (Macintosh) Chrome/120'), ip: '203.0.113.7' });
    ({ sessions } = registerSession(sessions, { userId: 'u1', device: describeDevice('Mozilla/5.0 (iPhone) Safari/604'), ip: '203.0.113.8' }));
    expect(activeSessions(sessions).length).toBe(2);
    // Only the newest login is "current"; the older ones become historical.
    expect(activeSessions(sessions).filter((s) => s.current).length).toBe(1);

    const kept = activeSessions(sessions).find((s) => s.device.label.includes('Safari'));
    const target = activeSessions(sessions).find((s) => s.device.label.includes('Chrome'));
    ({ sessions } = revokeSession(sessions, target.id));
    expect(activeSessions(sessions).length).toBe(1);
    expect(activeSessions(sessions)[0].id).toBe(kept.id);
  });

  it('stores a masked address, so a log leak is not a location leak', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.113.0');
    expect(maskIp('203.0.113.7')).not.toContain('203.0.113.7');
    expect(maskIp('not-an-ip')).toBeNull();
  });

  it('scores a login from a new country on a new device as high risk', () => {
    const history = [{ country: 'PK', deviceLabel: 'Chrome on macOS', ip: '203.0.113.0' }];
    const risky = scoreLogin({
      attempt: { country: 'RU', deviceLabel: 'Unknown on Unknown', ip: '198.51.100.0' },
      history
    });
    expect(risky.level).toBe('high');
    expect(risky.action).toBe('require-verification');
    expect(risky.signals.map((s) => s.id)).toEqual(expect.arrayContaining(['new-country', 'new-device', 'new-ip']));

    const normal = scoreLogin({
      attempt: { country: 'PK', deviceLabel: 'Chrome on macOS', ip: '203.0.113.0' },
      history
    });
    expect(normal.level).toBe('low');
    expect(normal.action).toBe('allow');
  });

  it('does not call a first-ever login suspicious — there is no baseline', () => {
    const first = scoreLogin({ attempt: { country: 'PK', deviceLabel: 'Chrome on macOS', ip: '203.0.113.0' }, history: [] });
    expect(first.level).toBe('low');
    expect(first.baseline).toBe(true);
    expect(first.signals.map((s) => s.id)).toContain('first-login');
  });

  it('keeps the login history bounded', () => {
    let history = [];
    for (let i = 0; i < 12; i += 1) {
      ({ history } = recordLogin(history, { userId: 'u1', device: { label: 'Chrome on macOS' }, ip: '203.0.113.7', country: 'PK' }, 10));
    }
    expect(history.length).toBe(10);
  });
});

describe('integration: rate limiting is per key, not global', () => {
  it('exhausts one caller without touching another', () => {
    // A single global counter is the classic bug: one noisy client locks out all.
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 0 });
    for (let i = 0; i < 3; i += 1) expect(bucket.take('user-a').allowed).toBe(true);
    expect(bucket.take('user-a').allowed).toBe(false);
    expect(bucket.take('user-b').allowed).toBe(true);
  });

  it('reports how long to wait instead of a bare refusal', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: () => now });
    expect(bucket.take('k').allowed).toBe(true);
    const denied = bucket.take('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    now = denied.retryAfterMs;
    expect(bucket.take('k').allowed).toBe(true);
  });

  it('never lets the balance go negative', () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 0 });
    bucket.take('k', 5);
    expect(bucket.take('k').remaining).toBeGreaterThanOrEqual(0);
  });
});

describe('integration: authorization decisions', () => {
  it('grants a personal account its own resource and denies another user’s', () => {
    const mine = subjectFor({ userId: 'u1' });
    expect(authorize({ ...mine, roles: ['user'] }, 'portfolio:read', { resourceOwnerId: 'u1' }).allowed).toBe(true);
    expect(authorize({ ...mine, roles: ['user'] }, 'portfolio:read', { resourceOwnerId: 'u2' }).allowed).toBe(false);
  });

  it('denies every role when the subject carries no role at all', () => {
    // An empty role list must fail closed, not fall through to allowed.
    const subject = subjectFor({ userId: 'u1' });
    expect(authorize(subject, 'portfolio:read', { resourceOwnerId: 'u1' })).toMatchObject({ allowed: false, reason: 'no-role' });
  });

  const membership = { userId: 'u1', organizationId: 'o1', roles: ['finance'], status: 'active' };

  it('grants a role its own permission and denies an unrelated one', () => {
    const finance = subjectFor({ userId: 'u1', memberships: [membership], organizationId: 'o1' });
    expect(finance.roles).toEqual(['finance']);
    expect(authorize(finance, 'billing:read', { organizationId: 'o1' }).allowed).toBe(true);
    expect(authorize(finance, 'billing:approve', { organizationId: 'o1' }).allowed).toBe(true);
    expect(authorize(finance, 'portfolio:delete', { organizationId: 'o1' }).allowed).toBe(false);
  });

  it('does not leak a membership into an organisation the subject is not in', () => {
    // subjectFor matches the membership by organisation; asking for o2 yields no
    // roles at all, so the subject fails closed rather than carrying o1's powers.
    const outsider = subjectFor({ userId: 'u1', memberships: [membership], organizationId: 'o2' });
    expect(outsider.roles).toEqual([]);
    expect(authorize(outsider, 'billing:read', { organizationId: 'o2' })).toMatchObject({ allowed: false, reason: 'no-role' });
  });

  it('stops a scoped role crossing into another organisation', () => {
    const finance = subjectFor({ userId: 'u1', memberships: [membership], organizationId: 'o1' });
    expect(authorize(finance, 'billing:read', { organizationId: 'o2' })).toMatchObject({ allowed: false, reason: 'cross-organization' });
  });

  it('never lets a role grant a permission outside the vocabulary', () => {
    for (const role of ROLE_IDS) {
      const subject = subjectFor({ userId: 'u1', memberships: [{ ...membership, roles: [role] }], organizationId: 'o1' });
      expect(authorize(subject, 'made:up', { organizationId: 'o1' }).allowed, role).toBe(false);
    }
  });

  it('applies an explicit deny over a role that would otherwise allow', () => {
    const subject = subjectFor({
      userId: 'u1',
      memberships: [membership],
      organizationId: 'o1',
      denies: ['billing:approve']
    });
    expect(subject.roles).toEqual(['finance']);
    expect(authorize(subject, 'billing:approve', { organizationId: 'o1' }))
      .toMatchObject({ allowed: false, reason: 'explicit-deny' });
    // The rest of the role still works.
    expect(authorize(subject, 'billing:read', { organizationId: 'o1' }).allowed).toBe(true);
  });
});

describe('integration: payments and webhooks', () => {
  const SECRET = 'whsec_test_do_not_ship';

  const sign = async (payload, secret = SECRET) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  it('accepts a correctly signed webhook and rejects a tampered one', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', amount: 4900 });
    const signature = await sign(payload);
    expect(await verifyWebhookSignature({ payload, signature, secret: SECRET })).toEqual({ ok: true, algorithm: 'SHA-256' });
    expect((await verifyWebhookSignature({ payload, signature: `sha256=${signature}`, secret: SECRET })).ok).toBe(true);
    expect((await verifyWebhookSignature({ payload: payload.replace('4900', '9'), signature, secret: SECRET })).reason).toBe('signature-mismatch');
    expect((await verifyWebhookSignature({ payload, signature, secret: 'other' })).reason).toBe('signature-mismatch');
  });

  it('reports missing input rather than a successful verification', async () => {
    expect(await verifyWebhookSignature({ payload: '{}', secret: SECRET })).toEqual({ ok: false, reason: 'missing-input' });
    expect(await verifyWebhookSignature({})).toEqual({ ok: false, reason: 'missing-input' });
  });

  it('ignores a payment status asserted by the client', () => {
    // The brief: never trust payment status supplied by the frontend.
    const res = applyPaymentUpdate({ update: { status: 'paid', source: 'client' }, currentStatus: 'requires_payment' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('untrusted-source');
    expect(res.status).toBe('requires_payment');
  });

  it('requires a timestamped signature on a webhook-sourced status', () => {
    expect(applyPaymentUpdate({ update: { status: 'paid', source: 'webhook-verified' }, currentStatus: 'requires_payment' }).reason)
      .toBe('unverified-signature');
    expect(applyPaymentUpdate({
      update: { status: 'paid', source: 'webhook-verified', signatureVerifiedAt: '2026-10-09T00:00:00Z' },
      currentStatus: 'requires_payment'
    })).toMatchObject({ ok: true, status: 'paid', previous: 'requires_payment' });
  });

  it('refuses to un-settle a refund with a stale paid event', () => {
    const res = applyPaymentUpdate({
      update: { status: 'paid', source: 'webhook-verified', signatureVerifiedAt: '2026-10-09T00:00:00Z' },
      currentStatus: 'refunded'
    });
    expect(res.reason).toBe('would-unsettle-refund');
    expect(res.status).toBe('refunded');
  });

  it('rejects an unknown status without throwing', () => {
    expect(applyPaymentUpdate({ update: { status: 'nonsense', source: 'provider-api' } }).reason).toBe('unknown-status');
    expect(applyPaymentUpdate({}).ok).toBe(false);
    for (const s of PAYMENT_STATUSES) {
      expect(applyPaymentUpdate({ update: { status: s, source: 'provider-api' } }).ok, s).toBe(true);
    }
  });

  it('retries a failed charge on a schedule, then stops', () => {
    const failedAt = new Date('2026-10-01T00:00:00Z');
    const first = nextRetry({ failedAt, attempts: 0 });
    expect(first.retry).toBe(true);
    expect(first.at - failedAt).toBe(DUNNING_SCHEDULE[0].afterHours * 3600000);

    // Each retry waits at least as long as the one before it.
    let prev = -1;
    for (let i = 0; i < DUNNING_SCHEDULE.length; i += 1) {
      const r = nextRetry({ failedAt, attempts: i });
      const hours = (r.at - failedAt) / 3600000;
      expect(hours).toBeGreaterThanOrEqual(prev);
      prev = hours;
    }
    // Once the schedule is spent it must stop, not loop forever.
    const exhausted = nextRetry({ failedAt, attempts: DUNNING_SCHEDULE.length });
    expect(exhausted.retry).toBe(false);
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.action).toBe('suspend-and-notify');
  });

  it('does not blind-retry a decline that can never succeed', () => {
    expect(classifyDecline('card_expired').retryable).toBe(false);
    expect(classifyDecline('fraud_suspected').action).toBe('hold-and-review');
    expect(classifyDecline('insufficient_funds').retryable).toBe(true);
    expect(classifyDecline('something_new').retryable).toBe(false);
  });

  it('distinguishes graduated from volume metering', () => {
    const tiers = [{ upTo: 1000, rate: 0.01 }, { upTo: Infinity, rate: 0.005 }];
    const graduated = usageCharge({ units: 2000, tiers, mode: 'graduated' });
    const volume = usageCharge({ units: 2000, tiers, mode: 'volume' });
    expect(graduated.amount).toBeCloseTo(10 + 5, 6);   // 1000@0.01 + 1000@0.005
    expect(volume.amount).toBeCloseTo(2000 * 0.005, 6); // whole total at one rate
    expect(volume.amount).toBeLessThan(graduated.amount);
    expect(graduated.mode).toBe('graduated');
  });

  it('charges nothing for zero units and rejects nonsense', () => {
    const tiers = [{ upTo: Infinity, rate: 0.01 }];
    expect(usageCharge({ units: 0, tiers }).amount).toBe(0);
    expect(usageCharge({ units: -1, tiers }).reason).toBe('invalid-units');
    expect(usageCharge({ units: 5, tiers: [] }).reason).toBe('no-tiers');
  });

  it('refuses a refund larger than was actually paid', () => {
    // Refunding past the paid amount is how money leaves twice.
    const invoice = { id: 'in_1', number: 'CX-1', total: 100, currency: 'USD', paid: 100, refunded: 0 };
    expect(planRefund({ invoice, amount: 250, reason: 'duplicate' })).toMatchObject({ ok: false, reason: 'exceeds-paid' });
    expect(planRefund({ invoice, amount: 40, reason: 'goodwill' }).refund).toMatchObject({ amount: 40, kind: 'partial' });
    expect(planRefund({ invoice, reason: 'full' }).refund.kind).toBe('full');
  });

  it('never refunds more than remains after a previous refund', () => {
    const invoice = { id: 'in_1', number: 'CX-1', total: 100, currency: 'USD', paid: 100, refunded: 80 };
    expect(planRefund({ invoice, amount: 50 }).reason).toBe('exceeds-paid');
    expect(planRefund({ invoice, amount: 20 }).ok).toBe(true);
    expect(planRefund({ invoice: { ...invoice, refunded: 100 } }).reason).toBe('nothing-refundable');
  });

  it('refuses an expired coupon and applies a live one', () => {
    const base = { code: 'SAVE10', percentOff: 10 };
    expect(evaluateCoupon({ coupon: { ...base, expiresAt: '2026-10-01T00:00:00Z' }, subtotal: 100, now: new Date('2026-11-01T00:00:00Z') }))
      .toMatchObject({ ok: false, reason: 'expired', discount: 0 });
    expect(evaluateCoupon({ coupon: base, subtotal: 100, now: new Date('2026-09-01T00:00:00Z') }))
      .toMatchObject({ ok: true, discount: 10, total: 90 });
  });

  it('never discounts below zero', () => {
    const big = { code: 'BIG', amountOff: 500 };
    expect(evaluateCoupon({ coupon: big, subtotal: 100 }).discount).toBe(100);
    expect(evaluateCoupon({ coupon: big, subtotal: 100 }).total).toBe(0);
  });
});

describe('integration: API conventions end to end', () => {
  it('resolves, validates and errors a request in one pass', () => {
    const route = findRoute('POST', '/alerts');
    expect(route).toBeTruthy();
    expect(buildPath(route).ok).toBe(true);

    const bad = validateRequest(route, { symbol: 'BTC' });
    expect(bad).toMatchObject({ ok: false, reason: 'missing-fields', missing: ['ruleType'] });
    const env = errorEnvelope({ code: 'invalid_request', details: { missing: bad.missing } });
    expect(env.status).toBe(400);
    expect(env.body.error.details.missing).toEqual(['ruleType']);

    expect(validateRequest(route, { symbol: 'BTC', ruleType: 'price_above' }).ok).toBe(true);
  });

  it('serves a paginated list with an allowlisted filter and a stable order', () => {
    const route = findRoute('GET', '/alerts');
    expect(buildQuery(route, { filters: { symbol: 'BTC' }, sort: '-createdAt' }))
      .toEqual({ ok: true, filters: { symbol: 'BTC' }, order: '-createdAt' });
    const p = parsePagination({ limit: 500 });
    expect(p.limit).toBe(100);
    expect(p.clamped).toBe(true);
  });

  it('rejects an API abuse attempt: unknown filter, unknown sort, huge limit', () => {
    const route = findRoute('GET', '/alerts');
    expect(buildQuery(route, { filters: { $where: '1=1' } }).reason).toBe('unknown-filter');
    expect(buildQuery(route, { sort: '-passwordHash' }).reason).toBe('unknown-sort');
    expect(parsePagination({ limit: Number.MAX_SAFE_INTEGER }).limit).toBe(100);
  });

  it('describes exactly the registry in the generated spec', () => {
    const doc = generateOpenApi();
    expect(validateRegistry().ok).toBe(true);
    // GET and POST share a path, so the path set is deduplicated.
    const expected = [...new Set(ROUTES.map((r) => `/api/${r.version}${r.path}`))].sort();
    expect(Object.keys(doc.paths).sort()).toEqual(expected);
    expect(doc.info.version).toBe(API_VERSION);
  });

  it('tells a client on a deprecated route how long it has', () => {
    const h = versionHeaders(findRoute('GET', '/market/ticker'), { now: new Date('2026-10-09T00:00:00Z') });
    expect(h.sunset).toBeTruthy();
    expect(h.link).toContain('successor-version');
    expect(Number(h['x-sunset-in-days'])).toBeGreaterThan(0);
  });
});

describe('integration: data-subject requests complete their lifecycle', () => {
  it('walks an export request from received to completed', () => {
    const created = createDataRequest({ userId: 'u1', type: 'export' });
    expect(created.ok).toBe(true);
    expect(created.request.state).toBe('received');

    let req = created.request;
    for (const next of ['verifying', 'processing', 'completed']) {
      expect(DSR_STATES).toContain(next);
      const step = advanceDataRequest(req, next);
      expect(step.ok).toBe(true);
      req = step.request;
    }
    expect(req.state).toBe('completed');
    expect(req.updates.map((u) => u.state)).toEqual(['received', 'verifying', 'processing', 'completed']);

    // A request cannot walk backwards.
    expect(advanceDataRequest(req, 'received').reason).toBe('cannot-go-back');
    expect(advanceDataRequest(req, 'nonsense').reason).toBe('unknown-state');
  });

  it('rejects an unknown request type', () => {
    expect(createDataRequest({ userId: 'u1', type: 'erase-everything' }).reason).toBe('unknown-type');
  });

  it('exports the subject’s own data and names what it withholds', () => {
    const created = createProfile({ userId: 'u1', email: 'a@example.com', username: 'ali' });
    expect(created.ok).toBe(true);
    const { profile } = created;
    const { session } = registerSession([], {
      userId: 'u1',
      device: describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0'),
      ip: '203.0.113.7'
    });
    const bundle = buildExport({ profile, memberships: [], sessions: [session], loginHistory: [] });
    expect(bundle.profile.email).toBe('a@example.com');
    expect(bundle.omitted.join(' ')).toMatch(/other members/i);
    expect(bundle.omitted.join(' ')).toMatch(/password hashes/i);
    // A masked address is what was stored, so that is all the export can leak.
    expect(bundle.sessions[0].device).toBe('Chrome on macOS');
  });

  it('anonymises the profile on deletion and schedules legal retention', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'a@example.com', username: 'ali' });
    const res = applyDeletion(profile, { retainForLegalDays: 30, now: new Date('2026-10-09T00:00:00Z') });
    expect(res.profile.email).toBeNull();
    expect(res.profile.username).toBeNull();
    expect(res.profile.displayName).toBe('Deleted account');
    expect(res.profile.deletion.purgeAfter).toBe('2026-11-08T00:00:00.000Z');
    expect(res.retained.length).toBeGreaterThan(0);
  });

  it('records events in the audit log and reads them back by action', () => {
    let log = [];
    ({ log } = appendAudit(log, { actorId: 'u1', action: 'export.requested' }));
    ({ log } = appendAudit(log, { actorId: 'u1', action: 'session.revoked' }));
    expect(log.length).toBe(2);
    expect(auditFilter(log, { action: 'session.revoked' }).length).toBe(1);
    expect(auditFilter(log, { actorId: 'u2' }).length).toBe(0);
    // Both actions must be in the declared vocabulary, or the write is refused.
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(['export.requested', 'session.revoked']));
    expect(appendAudit(log, { actorId: 'u1', action: 'made.up' }).ok).toBe(false);
  });

  it('freezes an audit entry so history cannot be rewritten in place', () => {
    let log = [];
    ({ log } = appendAudit(log, { actorId: 'u1', action: 'login.succeeded' }));
    expect(() => { log[0].action = 'login.failed'; }).toThrow();
    expect(log[0].action).toBe('login.succeeded');
  });
});
