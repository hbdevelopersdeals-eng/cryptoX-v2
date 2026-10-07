import { describe, it, expect, vi } from 'vitest';
import {
  PERMISSIONS, ROLES, ROLE_IDS, RESOURCES, ACTIONS, perm, isKnownRole, matchesPermission,
  rolePermissions, effectivePermissions, authorize, can, assignableRoles, filterAuthorized,
  explain, permissionMatrix
} from './rbac.js';
import {
  createProfile, updateProfile, validateUsername, RESERVED_USERNAMES,
  createOrganization, createWorkspace, createInvitation, acceptInvitation, revokeInvitation,
  membersOf, ownersOf, setMemberRoles, removeMember, describeDevice, registerSession,
  maskIp, activeSessions, revokeSession, revokeAllSessions, sessionIsValid, scoreLogin,
  recordLogin, appendAudit, auditFilter, AUDIT_ACTIONS, createDataRequest, advanceDataRequest,
  buildExport, applyDeletion, subjectFor, memberCan, seatUsage, DEFAULT_PRIVACY
} from './accounts.js';
import {
  base32Encode, base32Decode, hotp, totp, verifyTotp, timingSafeEqual, generateSecret,
  provisioningUri, generateBackupCodes, consumeBackupCode, normaliseBackupCode,
  LOCKOUT_POLICY, createLockoutState, lockDurationFor, isLocked, recordFailure, recordSuccess,
  TokenBucket, issueResetToken, verifyResetToken, webauthnAvailable, buildRegistrationOptions,
  MFA_METHODS, RESET_TTL_MS
} from './mfa.js';
import {
  AUTH_CAPABILITY, SECURITY_CAPABILITY, SCOPE_STATUS, scopeSummary, COMMON_PASSWORDS,
  scorePassword, isBreached, MAGIC_BYTES, sniffMime, validateUpload, UPLOAD_DEFAULTS,
  createBotChallenge, hostAllowed
} from './enterprise.js';

const DAY = 86400000;

const admin = (roles = ['organization_admin'], organizationId = 'org_a') => ({
  userId: 'u1', organizationId, roles, workspaceIds: [], grants: [], denies: []
});

describe('RBAC — roles and permissions', () => {
  it('defines the requested roles and a real permission set', () => {
    ['platform_admin', 'organization_owner', 'organization_admin', 'manager', 'finance',
      'support', 'analyst', 'editor', 'viewer', 'user'].forEach((r) => {
      expect(isKnownRole(r), r).toBe(true);
    });
    expect(PERMISSIONS.length).toBe(RESOURCES.length * ACTIONS.length);
    expect(perm('billing', 'approve')).toBe('billing:approve');
    expect(isKnownRole('superuser')).toBe(false);
  });

  it('resolves inheritance transitively and survives a cycle', () => {
    const owner = rolePermissions('organization_owner');
    expect(owner).toContain('billing:manage');       // own
    expect(owner).toContain('settings:manage');      // from organization_admin
    expect(owner).toContain('reports:create');       // from manager → analyst
    expect(owner).toContain('strategies:update');    // from manager → editor

    // A deliberately cyclic definition must terminate.
    ROLES.__cycle_a = { label: 'a', permissions: [], inherits: ['__cycle_b'] };
    ROLES.__cycle_b = { label: 'b', permissions: [], inherits: ['__cycle_a'] };
    expect(() => rolePermissions('__cycle_a')).not.toThrow();
    delete ROLES.__cycle_a;
    delete ROLES.__cycle_b;
  });

  it('understands wildcard permission patterns', () => {
    expect(matchesPermission('*', 'anything:at:all')).toBe(true);
    expect(matchesPermission('portfolio:*', 'portfolio:export')).toBe(true);
    expect(matchesPermission('portfolio:*', 'billing:read')).toBe(false);
    expect(matchesPermission('billing:read', 'billing:read')).toBe(true);
  });

  it('expands roles to concrete permissions', () => {
    const viewer = effectivePermissions(['viewer']);
    expect(viewer.permissions).toContain('portfolio:read');
    expect(viewer.permissions).not.toContain('portfolio:update');
    expect(effectivePermissions(['platform_admin']).all).toBe(true);
    expect(effectivePermissions([]).permissions).toEqual([]);
    expect(effectivePermissions(['nonsense']).permissions).toEqual([]);
  });
});

describe('RBAC — the authorization decision', () => {
  it('denies by default', () => {
    expect(authorize(null, 'billing:read').reason).toBe('no-subject');
    expect(authorize(admin(), null).reason).toBe('no-permission');
    expect(authorize({ userId: 'u1' }, 'billing:read').reason).toBe('no-role');
    expect(authorize(admin(['viewer']), 'billing:approve').reason).toBe('not-permitted');
    expect(can(admin(['viewer']), 'billing:approve')).toBe(false);
  });

  it('grants what the role genuinely includes', () => {
    expect(can(admin(['viewer']), 'portfolio:read')).toBe(true);
    expect(can(admin(['analyst']), 'reports:create')).toBe(true);
    expect(can(admin(['finance']), 'billing:approve')).toBe(true);
    expect(authorize(admin(['finance']), 'billing:approve').reason).toBe('role-grant');
  });

  it('lets an explicit deny beat the most privileged role', () => {
    // A security rule the top role can ignore is not a rule.
    const subject = { ...admin(['platform_admin']), denies: ['billing:*'] };
    expect(can(subject, 'billing:approve')).toBe(false);
    expect(authorize(subject, 'billing:approve').reason).toBe('explicit-deny');
    expect(can(subject, 'portfolio:read')).toBe(true);
  });

  it('scopes a tenant role to its own organization', () => {
    const subject = admin(['organization_admin'], 'org_a');
    expect(can(subject, 'settings:manage', { organizationId: 'org_a' })).toBe(true);
    expect(can(subject, 'settings:manage', { organizationId: 'org_b' })).toBe(false);
    expect(authorize(subject, 'settings:manage', { organizationId: 'org_b' }).reason).toBe('cross-organization');
    // A platform role is not tenant-scoped.
    expect(can(admin(['platform_admin']), 'organization:manage', { organizationId: 'org_b' })).toBe(true);
  });

  it('requires an organization for an organization-scoped role', () => {
    const subject = { userId: 'u1', roles: ['organization_admin'], workspaceIds: [] };
    expect(authorize(subject, 'settings:manage').reason).toBe('no-organization');
  });

  it('honours workspace limits', () => {
    const subject = { ...admin(['manager']), workspaceIds: ['ws_1'] };
    expect(can(subject, 'reports:approve', { workspaceId: 'ws_1' })).toBe(true);
    expect(can(subject, 'reports:approve', { workspaceId: 'ws_2' })).toBe(false);
    expect(authorize(subject, 'reports:approve', { workspaceId: 'ws_2' }).reason).toBe('outside-workspace');
  });

  it('limits a self-scoped role to its own resources', () => {
    const subject = admin(['user'], null);
    const own = { userId: 'u1', organizationId: null, roles: ['user'], workspaceIds: [], grants: [], denies: [] };
    expect(can(own, 'settings:update', { resourceOwnerId: 'u1' })).toBe(true);
    expect(can(own, 'settings:update', { resourceOwnerId: 'u2' })).toBe(false);
    expect(authorize(own, 'settings:update', { resourceOwnerId: 'u2' }).reason).toBe('not-owner');
    expect(subject.userId).toBe('u1');
  });

  it('never lets a tenant grant platform_admin or escalate above itself', () => {
    const orgAdmin = { userId: 'u1', organizationId: 'org_a', roles: ['organization_admin'], grants: [], denies: [], workspaceIds: [] };
    const allowed = assignableRoles(orgAdmin);
    expect(allowed).not.toContain('platform_admin');
    expect(allowed).not.toContain('organization_owner'); // owner-only powers
    expect(allowed).toContain('viewer');

    const owner = { userId: 'u1', organizationId: 'org_a', roles: ['organization_owner'], grants: [], denies: [], workspaceIds: [] };
    expect(assignableRoles(owner)).toContain('organization_admin');
    expect(assignableRoles(owner)).not.toContain('platform_admin');
    expect(assignableRoles(null)).toEqual([]);
  });

  it('filters a list to what the subject may act on', () => {
    const subject = admin(['viewer']);
    const rows = [{ id: 1 }, { id: 2 }];
    expect(filterAuthorized(subject, rows, 'portfolio:read')).toHaveLength(2);
    expect(filterAuthorized(subject, rows, 'portfolio:delete')).toHaveLength(0);
  });

  it('explains a denial in plain language and documents the matrix', () => {
    expect(explain({ reason: 'cross-organization' })).toMatch(/different organisation/);
    const matrix = permissionMatrix();
    expect(matrix.length).toBe(ROLE_IDS.length);
    expect(matrix.find((m) => m.role === 'viewer').count).toBeGreaterThan(0);
    expect(matrix.find((m) => m.role === 'organization_owner').inherits).toEqual(['organization_admin']);
  });
});

describe('accounts — profile', () => {
  it('validates username, normalising case and rejecting reserved names', () => {
    expect(validateUsername('Ali_Khan').normalised).toBe('ali_khan');
    expect(validateUsername('ab').reason).toBe('too-short');
    expect(validateUsername('_leading').reason).toBe('invalid-characters');
    expect(validateUsername('has space').reason).toBe('invalid-characters');
    expect(validateUsername('admin').reason).toBe('reserved');
    expect(RESERVED_USERNAMES.has('root')).toBe(true);
    // Case-folded so that Ali and ali cannot both exist.
    expect(validateUsername('ALI').normalised).toBe(validateUsername('ali').normalised);
  });

  it('creates a profile with safe defaults and validates it', () => {
    const { ok, profile } = createProfile({ userId: 'u1', email: 'A@Example.COM', username: 'Ali', displayName: 'Ali K' });
    expect(ok).toBe(true);
    expect(profile.email).toBe('a@example.com');
    expect(profile.emailVerified).toBe(false);
    expect(profile.privacy).toEqual(DEFAULT_PRIVACY);
    expect(profile.notifications.inapp).toBe(true);
    expect(profile.mfa.enabled).toBe(false);
    expect(createProfile({ userId: 'u1', email: 'bad', username: 'x' }).ok).toBe(false);
  });

  it('validates every localized field against the real registries', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'a@b.co', username: 'ali' });
    expect(updateProfile(profile, { timezone: 'Asia/Karachi' }).ok).toBe(true);
    expect(updateProfile(profile, { timezone: 'Mars/Phobos' }).errors[0].field).toBe('timezone');
    expect(updateProfile(profile, { currency: 'ZZZ' }).errors[0].field).toBe('currency');
    expect(updateProfile(profile, { language: 'klingon' }).errors[0].field).toBe('language');
    expect(updateProfile(profile, { country: 'ZZ' }).errors[0].field).toBe('country');
    expect(updateProfile(profile, { email: 'nope' }).errors[0].field).toBe('email');
  });

  it('re-opens email verification when the address changes', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'a@b.co', username: 'ali' });
    const verified = { ...profile, emailVerified: true };
    const changed = updateProfile(verified, { email: 'new@b.co' });
    expect(changed.profile.emailVerified).toBe(false);
    expect(changed.profile.email).toBe('new@b.co');
  });
});

describe('accounts — organizations and invitations', () => {
  it('creates an organization with its owner membership', () => {
    const out = createOrganization({ name: 'Acme Ltd', ownerId: 'u1', timezone: 'Asia/Karachi', currency: 'PKR', language: 'ur' });
    expect(out.ok).toBe(true);
    expect(out.organization.slug).toBe('acme-ltd');
    expect(out.membership.roles).toEqual(['organization_owner']);
    expect(out.organization.policies.sessionMaxHours).toBe(168);

    expect(createOrganization({ name: 'x', ownerId: 'u1' }).ok).toBe(false);
    expect(createOrganization({ name: 'Acme', ownerId: 'u1', timezone: 'Bad/Zone' }).errors[0].field).toBe('timezone');
    expect(createOrganization({ name: 'Acme', ownerId: 'u1', currency: 'ZZZ' }).errors[0].field).toBe('currency');
  });

  it('creates workspaces, teams and departments from one shape', () => {
    expect(createWorkspace({ organizationId: 'org_a', name: 'Risk Desk', kind: 'team' }).kind).toBe('team');
    expect(createWorkspace({ organizationId: 'org_a', slug: 'Main Desk' }).id).toBe('ws_main-desk');
  });

  it('refuses an invitation above the inviter’s own level', () => {
    const orgAdmin = { userId: 'u1', organizationId: 'org_a', roles: ['organization_admin'], grants: [], denies: [], workspaceIds: [] };
    expect(createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'organization_owner', subject: orgAdmin }).reason)
      .toBe('role-above-inviter');
    expect(createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'platform_admin', subject: orgAdmin }).reason)
      .toBe('role-above-inviter');
    expect(createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'viewer', subject: orgAdmin }).ok).toBe(true);
    expect(createInvitation({ organizationId: 'org_a', email: 'bad', role: 'viewer', subject: orgAdmin }).reason).toBe('invalid-email');
    expect(createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'wizard', subject: orgAdmin }).reason).toBe('unknown-role');
  });

  it('expires an invitation and refuses reuse', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    const owner = { userId: 'u1', organizationId: 'org_a', roles: ['organization_owner'], grants: [], denies: [], workspaceIds: [] };
    const { invitation } = createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'viewer', subject: owner, ttlHours: 24, now });

    const first = acceptInvitation(invitation, { userId: 'u2', now: new Date(now.getTime() + 3600000) });
    expect(first.ok).toBe(true);
    // acceptInvitation is pure, so acceptance has to be threaded through its result.
    expect(acceptInvitation(first.invitation, { userId: 'u3', now }).reason).toBe('already-used');

    const expired = acceptInvitation(invitation, { userId: 'u2', now: new Date(now.getTime() + 25 * 3600000) });
    expect(expired.reason).toBe('expired');

    const { invitation: i2 } = createInvitation({ organizationId: 'org_a', email: 'x@y.co', role: 'editor', subject: owner, now });
    const accepted = acceptInvitation(i2, { userId: 'u2', now });
    expect(accepted.membership.roles).toEqual(['editor']);
    expect(accepted.membership.organizationId).toBe('org_a');
    expect(revokeInvitation(i2).status).toBe('revoked');
    expect(acceptInvitation(revokeInvitation(i2), { userId: 'u2' }).reason).toBe('already-used');
  });

  it('never leaves an organization without an owner', () => {
    const memberships = [
      { id: 'm1', organizationId: 'org_a', userId: 'u1', roles: ['organization_owner'], status: 'active' },
      { id: 'm2', organizationId: 'org_a', userId: 'u2', roles: ['viewer'], status: 'active' }
    ];
    const owner = { userId: 'u1', organizationId: 'org_a', roles: ['organization_owner'], grants: [], denies: [], workspaceIds: [] };

    expect(removeMember(memberships, { membershipId: 'm1' }).reason).toBe('last-owner');
    expect(setMemberRoles(memberships, { membershipId: 'm1', roles: ['viewer'], actor: owner }).reason).toBe('last-owner');

    // With a second owner it is allowed.
    const two = [...memberships, { id: 'm3', organizationId: 'org_a', userId: 'u3', roles: ['organization_owner'], status: 'active' }];
    expect(removeMember(two, { membershipId: 'm1' }).ok).toBe(true);
    expect(ownersOf(two, 'org_a').length).toBe(2);
    expect(membersOf(two, 'org_a').length).toBe(3);
  });

  it('refuses a role change that escalates the actor', () => {
    const memberships = [
      { id: 'm1', organizationId: 'org_a', userId: 'u1', roles: ['organization_owner'], status: 'active' },
      { id: 'm2', organizationId: 'org_a', userId: 'u2', roles: ['viewer'], status: 'active' }
    ];
    const orgAdmin = { userId: 'u1', organizationId: 'org_a', roles: ['organization_admin'], grants: [], denies: [], workspaceIds: [] };
    const out = setMemberRoles(memberships, { membershipId: 'm2', roles: ['organization_owner'], actor: orgAdmin });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('role-above-actor');
    expect(out.roles).toEqual(['organization_owner']);
  });

  it('reports seat usage against the plan', () => {
    const { organization } = createOrganization({ name: 'Acme', ownerId: 'u1' });
    const memberships = [{ id: 'm1', organizationId: organization.id, userId: 'u1', roles: ['organization_owner'], status: 'active' }];
    expect(seatUsage(organization, memberships)).toMatchObject({ active: 1, seats: 1, over: false });
    const two = [...memberships, { id: 'm2', organizationId: organization.id, userId: 'u2', roles: ['viewer'], status: 'active' }];
    expect(seatUsage(organization, two).over).toBe(true);
  });
});

describe('accounts — sessions, devices and login risk', () => {
  it('describes a device coarsely rather than fingerprinting it', () => {
    const d = describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(d).toMatchObject({ browser: 'Chrome', os: 'Windows', kind: 'desktop' });
    expect(d.label).toBe('Chrome on Windows');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605').kind).toBe('mobile');
    expect(describeDevice('').browser).toBe('Unknown browser');
  });

  it('masks an IP before storing it', () => {
    expect(maskIp('203.0.113.45')).toBe('203.0.113.0');
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::');
    expect(maskIp('nonsense')).toBeNull();
  });

  it('keeps one current session and revokes immediately', () => {
    const a = registerSession([], { userId: 'u1', device: describeDevice('Chrome Windows'), ip: '203.0.113.9' });
    const b = registerSession(a.sessions, { userId: 'u1', device: describeDevice('Firefox Linux'), ip: '198.51.100.4' });

    expect(b.sessions).toHaveLength(2);
    expect(b.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(b.sessions[0].current).toBe(true);
    expect(b.sessions[0].ip).toBe('198.51.100.0');
    expect(activeSessions(b.sessions)).toHaveLength(2);

    const revoked = revokeSession(b.sessions, b.sessions[0].id);
    expect(activeSessions(revoked.sessions)).toHaveLength(1);
    // Revocation takes effect on the very next check, not at token expiry.
    expect(sessionIsValid(revoked.sessions[0])).toBe(false);
    expect(sessionIsValid(revoked.sessions[1])).toBe(true);
  });

  it('logs out everywhere but this device', () => {
    let sessions = [];
    for (let i = 0; i < 3; i += 1) {
      sessions = registerSession(sessions, { userId: 'u1', device: describeDevice(`Chrome ${i}`) }).sessions;
    }
    const keep = sessions[0].id;
    const out = revokeAllSessions(sessions, { userId: 'u1', exceptSessionId: keep });
    expect(out.revokedCount).toBe(2);
    expect(activeSessions(out.sessions)).toHaveLength(1);
    expect(out.sessions.find((s) => s.id === keep).revokedAt).toBeNull();
    // Already-revoked sessions are not revoked a second time.
    expect(revokeAllSessions(out.sessions, { userId: 'u1', exceptSessionId: keep }).revokedCount).toBe(0);

    // Another user's sessions are never touched.
    const other = registerSession(out.sessions, { userId: 'u2' }).sessions;
    const u2Ids = other.filter((s) => s.userId === 'u2').map((s) => s.id);
    const after = revokeAllSessions(other, { userId: 'u1', exceptSessionId: keep });
    u2Ids.forEach((id) => expect(after.sessions.find((s) => s.id === id).revokedAt).toBeNull());
  });

  it('scores logins explainably, and never calls a first login suspicious', () => {
    const first = scoreLogin({ attempt: { country: 'PK', deviceLabel: 'Chrome on Windows' }, history: [] });
    expect(first.baseline).toBe(true);
    expect(first.level).toBe('low');
    expect(first.action).toBe('allow');

    const history = [
      { country: 'PK', deviceLabel: 'Chrome on Windows', ip: '203.0.113.0' },
      { country: 'PK', deviceLabel: 'Chrome on Windows', ip: '203.0.113.0' }
    ];
    const normal = scoreLogin({ attempt: { country: 'PK', deviceLabel: 'Chrome on Windows', ip: '203.0.113.0' }, history });
    expect(normal.level).toBe('low');
    expect(normal.signals).toEqual([]);

    const foreign = scoreLogin({ attempt: { country: 'RU', deviceLabel: 'Firefox on Linux', ip: '198.51.100.0' }, history });
    expect(foreign.level).toBe('high');
    expect(foreign.action).toBe('require-verification');
    expect(foreign.signals.map((s) => s.id)).toContain('new-country');
    expect(foreign.explanation).toMatch(/First sign-in from RU/);

    const travel = scoreLogin({ attempt: { country: 'PK', deviceLabel: 'Chrome on Windows', impossibleTravel: true }, history });
    expect(travel.level).toBe('high');
  });

  it('bounds the login history', () => {
    let history = [];
    for (let i = 0; i < 12; i += 1) {
      history = recordLogin(history, { userId: 'u1', country: 'PK', device: { label: 'Chrome' } }, 5).history;
    }
    expect(history).toHaveLength(5);
    expect(history[0].id).toBeTruthy();
    expect(history[0].ip).toBeNull();
  });
});

describe('accounts — audit log and privacy requests', () => {
  it('appends immutable, bounded entries and rejects unknown actions', () => {
    let log = [];
    const a = appendAudit(log, { action: 'member.invited', actorId: 'u1', organizationId: 'org_a', metadata: { role: 'viewer' } }, 3);
    expect(a.ok).toBe(true);
    log = a.log;
    expect(Object.isFrozen(a.entry)).toBe(true);
    expect(() => { a.entry.action = 'tampered'; }).toThrow();

    const bad = appendAudit(log, { action: 'not.a.real.action' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('unknown-action');

    ['org.created', 'member.joined', 'member.removed', 'login.succeeded'].forEach((action) => {
      log = appendAudit(log, { action }, 3).log;
    });
    expect(log).toHaveLength(3);
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(15);
  });

  it('filters the audit log', () => {
    const log = [
      { id: '1', organizationId: 'org_a', actorId: 'u1', action: 'login.succeeded', at: '2026-10-01T00:00:00Z' },
      { id: '2', organizationId: 'org_b', actorId: 'u2', action: 'member.removed', at: '2026-10-05T00:00:00Z' }
    ];
    expect(auditFilter(log, { organizationId: 'org_a' }).map((e) => e.id)).toEqual(['1']);
    expect(auditFilter(log, { action: 'member.removed' }).map((e) => e.id)).toEqual(['2']);
    expect(auditFilter(log, { from: '2026-10-03T00:00:00Z' }).map((e) => e.id)).toEqual(['2']);
  });

  it('moves a data request forward only', () => {
    const { request } = createDataRequest({ userId: 'u1', type: 'export' });
    expect(request.state).toBe('received');
    expect(new Date(request.dueAt).getTime()).toBeGreaterThan(new Date(request.createdAt).getTime());
    expect(advanceDataRequest(request, 'processing').ok).toBe(true);
    expect(advanceDataRequest({ ...request, state: 'processing' }, 'received').reason).toBe('cannot-go-back');
    expect(advanceDataRequest(request, 'nonsense').reason).toBe('unknown-state');
    expect(createDataRequest({ userId: 'u1', type: 'teleport' }).reason).toBe('unknown-type');
  });

  it('exports the subject’s own data and states what is withheld', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'a@b.co', username: 'ali' });
    const out = buildExport({
      profile,
      memberships: [{ organizationId: 'org_a', roles: ['viewer'], status: 'active', joinedAt: 'x' }],
      sessions: [{ id: 's1', device: { label: 'Chrome on Windows' }, createdAt: 'x', lastSeenAt: 'y', revokedAt: null, ip: '203.0.113.0' }],
      loginHistory: []
    });
    expect(out.profile.username).toBe('ali');
    expect(out.memberships[0].organizationId).toBe('org_a');
    // The IP is not carried into the export even though the session holds it.
    expect(JSON.stringify(out)).not.toContain('203.0.113');
    expect(out.omitted.join(' ')).toMatch(/password hashes/);
  });

  it('deletes personal fields and says what is retained', () => {
    const { profile } = createProfile({ userId: 'u1', email: 'a@b.co', username: 'ali' });
    const out = applyDeletion(profile);
    expect(out.profile.email).toBeNull();
    expect(out.profile.username).toBeNull();
    expect(out.profile.city).toBe('');
    expect(out.profile.displayName).toBe('Deleted account');
    expect(out.retained.join(' ')).toMatch(/billing/);
    expect(out.profile.deletion.purgeAfter).toBeTruthy();
  });

  it('builds an authorization subject from a membership', () => {
    const memberships = [{ userId: 'u1', organizationId: 'org_a', roles: ['analyst'], workspaceIds: ['ws_1'] }];
    const subject = subjectFor({ userId: 'u1', memberships, organizationId: 'org_a' });
    expect(subject.roles).toEqual(['analyst']);
    expect(memberCan(memberships[0], 'reports:create')).toBe(true);
    expect(memberCan(memberships[0], 'billing:approve')).toBe(false);
    expect(subjectFor({ userId: 'u9', memberships, organizationId: 'org_a' }).roles).toEqual([]);
  });
});

describe('MFA — TOTP against the RFC 6238 vectors', () => {
  const RFC_SECRET = '12345678901234567890'; // ASCII, as published in RFC 6238 Appendix B
  const keyBytes = new TextEncoder().encode(RFC_SECRET);

  it('reproduces the published SHA-1 test vectors', async () => {
    const vectors = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130']
    ];
    for (const [seconds, expected] of vectors) {
      // eslint-disable-next-line no-await-in-loop
      const code = await hotp(keyBytes, Math.floor(seconds / 30), { digits: 8 });
      expect(code, `T=${seconds}`).toBe(expected);
    }
  });

  it('matches hotp when driven through totp', async () => {
    const code = await totp(base32Encode(keyBytes), { at: 59000, step: 30, digits: 8 });
    expect(code).toBe('94287082');
  });

  it('verifies within a drift window and rejects malformed input', async () => {
    const secret = base32Encode(keyBytes);
    const at = 1111111111 * 1000;
    const code = await totp(secret, { at, digits: 8 });
    expect((await verifyTotp(secret, code, { at, digits: 8 })).ok).toBe(true);
    // One step of drift still verifies.
    expect((await verifyTotp(secret, code, { at: at + 30000, digits: 8, window: 1 })).ok).toBe(true);
    // Two steps does not.
    expect((await verifyTotp(secret, code, { at: at + 90000, digits: 8, window: 1 })).ok).toBe(false);
    expect((await verifyTotp(secret, code, { at: at + 90000, digits: 8, window: 4 })).ok).toBe(true);

    expect((await verifyTotp(secret, '12345', { at, digits: 8 })).reason).toBe('malformed');
    expect((await verifyTotp(secret, 'abcdefgh', { at, digits: 8 })).reason).toBe('malformed');
    expect((await verifyTotp(secret, '00000000', { at, digits: 8 })).ok).toBe(false);
  });

  it('compares codes in constant time', () => {
    expect(timingSafeEqual('123456', '123456')).toBe(true);
    expect(timingSafeEqual('123456', '123457')).toBe(false);
    expect(timingSafeEqual('12345', '123456')).toBe(false);
    expect(timingSafeEqual(null, '')).toBe(true);
  });

  it('generates a base32 secret that round-trips and builds a provisioning URI', () => {
    const secret = generateSecret(20);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBe(32); // 160 bits → 32 base32 chars
    expect(base32Decode(secret)).toHaveLength(20);

    const bytes = new Uint8Array([0x66, 0x6F, 0x6F, 0x62, 0x61, 0x72]);
    expect(base32Encode(bytes)).toBe('MZXW6YTBOI');
    expect([...base32Decode('MZXW6YTBOI')]).toEqual([...bytes]);
    expect(() => base32Decode('1111')).toThrow();

    const uri = provisioningUri({ secret, account: 'ali@example.com' });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('period=30');
  });
});

describe('MFA — backup codes, lockout and rate limiting', () => {
  it('issues single-use backup codes and stores only hashes', async () => {
    const { codes, hashes } = await generateBackupCodes({ count: 5 });
    expect(codes).toHaveLength(5);
    expect(hashes).toHaveLength(5);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/));
    // No plaintext code appears in the stored hashes.
    codes.forEach((c) => expect(hashes.join('')).not.toContain(normaliseBackupCode(c)));

    const first = await consumeBackupCode(hashes, codes[0]);
    expect(first.ok).toBe(true);
    expect(first.remainingCount).toBe(4);

    // Replay of the same code fails.
    const replay = await consumeBackupCode(first.remaining, codes[0]);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('no-match');

    // Typed case-insensitively and without the dash.
    const messy = await consumeBackupCode(hashes, codes[1].replace('-', '').toLowerCase());
    expect(messy.ok).toBe(true);

    const warning = await consumeBackupCode(hashes.slice(0, 2), codes[0]);
    expect(warning.warning).toMatch(/Few backup codes/);
    expect((await consumeBackupCode(hashes, '')).reason).toBe('empty');
  });

  it('escalates lockout and clears it only on success', () => {
    const t0 = 1_000_000;
    expect(lockDurationFor(1)).toBe(0);
    expect(lockDurationFor(3)).toBe(30000);
    expect(lockDurationFor(5)).toBe(300000);
    expect(lockDurationFor(50)).toBe(24 * 3600000);

    let state = createLockoutState(t0);
    state = recordFailure(state, t0);
    expect(isLocked(state, t0 + 1000).locked).toBe(false); // 1 failure: no lock

    state = recordFailure(state, t0 + 2000);
    state = recordFailure(state, t0 + 3000);
    const locked = isLocked(state, t0 + 4000);
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterMs).toBeGreaterThan(0);

    // A success while locked must not clear the counter.
    const ignored = recordSuccess(state, t0 + 5000);
    expect(ignored.attempts).toBe(3);
    expect(ignored.note).toBeTruthy();

    // After the cooldown a success resets everything. The lock runs to
    // t0 + 3000 + 30000, so 31s is still inside it.
    expect(isLocked(state, t0 + 31000).locked).toBe(true);
    const cleared = recordSuccess(state, t0 + 34000);
    expect(cleared.attempts).toBe(0);
    expect(isLocked(cleared, t0 + 34000).locked).toBe(false);
    expect(LOCKOUT_POLICY.thresholds.length).toBe(4);
  });

  it('limits per key so one caller cannot lock out everyone', () => {
    let t = 0;
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: () => t });

    expect(bucket.take('a').allowed).toBe(true);
    expect(bucket.take('a').allowed).toBe(true);
    expect(bucket.take('a').allowed).toBe(true);
    const denied = bucket.take('a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    // A different key has its own budget.
    expect(bucket.take('b').allowed).toBe(true);

    t += 1000; // one token back
    expect(bucket.take('a').allowed).toBe(true);
    expect(bucket.take('a').allowed).toBe(false);

    bucket.reset('a');
    expect(bucket.take('a').allowed).toBe(true);
    expect(bucket.take('a', 99).allowed).toBe(false);
    expect(bucket.size()).toBe(2);
  });

  it('issues a reset token that expires and cannot be replayed', async () => {
    const now = Date.parse('2026-10-07T00:00:00Z');
    const { token, record } = await issueResetToken({ userId: 'u1', now });
    expect(token).toHaveLength(64);
    expect(record.tokenHash).not.toBe(token);
    expect((await verifyResetToken(record, token, now)).ok).toBe(true);
    expect((await verifyResetToken(record, 'wrong', now)).reason).toBe('mismatch');
    expect((await verifyResetToken({ ...record, usedAt: new Date().toISOString() }, token, now)).reason).toBe('already-used');
    expect((await verifyResetToken(record, token, now + RESET_TTL_MS + 1)).reason).toBe('expired');
    expect((await issueResetToken({})).reason).toBe('no-user');
  });
});

describe('MFA — WebAuthn and declared methods', () => {
  it('reports passkey capability without claiming a server exists', async () => {
    const out = await webauthnAvailable();
    expect(out.available).toBe(false); // jsdom has no PublicKeyCredential
    expect(out.reason).toBe('no-public-key-credential');
  });

  it('refuses to build registration options without a server challenge', () => {
    expect(buildRegistrationOptions({ userId: 'u1', username: 'ali' }).reason).toBe('server-challenge-required');
    const built = buildRegistrationOptions({ userId: 'u1', username: 'ali', challenge: 'abc', rpId: 'cryptox.example' });
    expect(built.ok).toBe(true);
    expect(built.options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(built.options.attestation).toBe('none');
  });

  it('labels every MFA method with its real status', () => {
    MFA_METHODS.forEach((m) => {
      expect(m.note, m.id).toBeTruthy();
      expect(['implemented', 'client-ready', 'server-only']).toContain(m.status);
    });
    expect(MFA_METHODS.find((m) => m.id === 'totp').status).toBe('implemented');
    expect(MFA_METHODS.find((m) => m.id === 'sms').status).toBe('server-only');
  });
});

describe('enterprise — honest scope', () => {
  it('accounts for every Section 6 and 7 item with a reason', () => {
    [AUTH_CAPABILITY, SECURITY_CAPABILITY].forEach((list) => {
      expect(list.length).toBeGreaterThan(20);
      list.forEach((i) => {
        expect(SCOPE_STATUS[i.status], `${i.item}: ${i.status}`).toBeTruthy();
        expect(i.note, i.item).toBeTruthy();
      });
    });
  });

  it('summarises the position instead of burying it', () => {
    const auth = scopeSummary(AUTH_CAPABILITY);
    const sec = scopeSummary(SECURITY_CAPABILITY);
    expect(auth.total).toBe(AUTH_CAPABILITY.length);
    expect(auth.percentImplemented).toBeGreaterThan(0);
    expect(auth.percentImplemented).toBeLessThan(100);
    expect(auth.note).toMatch(/implemented in this build/);
    expect(sec.byStatus['server-only']).toBeGreaterThan(3);
  });

  it('marks the items that genuinely cannot exist client-side', () => {
    const serverOnly = SECURITY_CAPABILITY.filter((i) => i.status === 'server-only').map((i) => i.item);
    expect(serverOnly).toContain('WAF');
    expect(serverOnly).toContain('DDoS protection');
    expect(serverOnly).toContain('Encryption at rest');
    expect(AUTH_CAPABILITY.find((i) => i.item.includes('SAML')).status).toBe('server-only');
  });
});

describe('enterprise — password strength', () => {
  it('rejects the obvious failures with a reason', () => {
    const common = scorePassword('password123');
    expect(common.warnings.join(' ')).toMatch(/commonly used/);
    expect(common.score).toBeLessThanOrEqual(1);
    expect(common.acceptable).toBe(false);

    expect(scorePassword('ali@example.com', { email: 'ali@example.com' }).warnings.join(' ')).toMatch(/email/);
    expect(scorePassword('ali_khan99', { username: 'ali_khan' }).warnings.join(' ')).toMatch(/username/);
    expect(scorePassword('aaaaaaaa').warnings.join(' ')).toMatch(/repeated/);
    expect(scorePassword('12345678').warnings.join(' ')).toMatch(/only digits/);
    expect(scorePassword('abcd1234').warnings.join(' ')).toMatch(/straight run/);
    expect(scorePassword('').acceptable).toBe(false);
    expect(COMMON_PASSWORDS.has('qwerty')).toBe(true);
  });

  it('scores a good passphrase as strong and explains the gaps', () => {
    const weak = scorePassword('abcdefgh');
    expect(weak.suggestions.length).toBeGreaterThan(0);

    const strong = scorePassword('correct-horse-battery-Staple-71!');
    expect(strong.score).toBeGreaterThanOrEqual(3);
    expect(strong.entropyBits).toBeGreaterThan(90);
    expect(strong.warnings).toEqual([]);
    expect(strong.acceptable).toBe(true);
    expect(['very weak', 'weak', 'fair', 'strong', 'very strong']).toContain(strong.label);
  });

  it('says "unknown" for a breach check it cannot perform', async () => {
    const none = await isBreached('hunter2', { fetchImpl: null });
    expect(none.checked).toBe(false);
    expect(none.reason).toBe('unavailable');
    expect((await isBreached('')).reason).toBe('empty');
  });

  it('checks a breached password by k-anonymity, never sending the password', async () => {
    // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const body = '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003\r\n0000000000000000000000000000000000:1';
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => body }));
    const out = await isBreached('password', { fetchImpl });
    expect(out.checked).toBe(true);
    expect(out.breached).toBe(true);
    expect(out.count).toBe(3303003);
    // k-anonymity: only the 5-character hash prefix is requested. The other 35
    // characters of SHA-1('password') never leave the browser.
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain('E4C9B93F3F0682250B6CF8331B7EE68FD8');

    const clean = await isBreached('password', { fetchImpl: vi.fn(async () => ({ ok: true, status: 200, text: async () => body })) });
    expect(clean.breached).toBe(true);
    const failed = await isBreached('password', { fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })) });
    expect(failed.checked).toBe(false);
  });
});

describe('enterprise — upload validation', () => {
  const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
  const JPEG = [0xFF, 0xD8, 0xFF, 0xE0];
  const MZ = [0x4D, 0x5A, 0x90, 0x00]; // a Windows executable

  const file = (name, bytes, size) => ({ name, size: size ?? bytes.length, type: '', bytes });

  it('sniffs the real signature', () => {
    expect(sniffMime(PNG, MAGIC_BYTES.find((m) => m.ext === 'png'))).toBe('image/png');
    expect(sniffMime(JPEG, MAGIC_BYTES.find((m) => m.ext === 'jpg'))).toBe('image/jpeg');
    expect(sniffMime(MZ, MAGIC_BYTES.find((m) => m.ext === 'png'))).toBeNull();
    expect(sniffMime([], MAGIC_BYTES.find((m) => m.ext === 'png'))).toBeNull();
  });

  it('accepts a genuine image', () => {
    const out = validateUpload(file('photo.png', PNG));
    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.magic).toBe('image/png');
  });

  it('rejects a renamed executable — the extension and the bytes disagree', () => {
    const out = validateUpload(file('invoice.pdf', MZ));
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.reason.includes('content does not match'))).toBe(true);
  });

  it('rejects bad extensions, sizes and empty files', () => {
    expect(validateUpload(file('payload.exe', MZ)).errors.some((e) => e.reason === 'executable-extension')).toBe(true);
    expect(validateUpload(file('a.pdf.exe', MZ)).errors.length).toBeGreaterThan(0);
    expect(validateUpload(file('noextension', PNG, 100)).errors.some((e) => e.reason === 'no-extension')).toBe(true);
    expect(validateUpload(file('photo.png', PNG, 0)).errors.some((e) => e.reason === 'empty-file')).toBe(true);
    expect(validateUpload(file('photo.png', PNG, UPLOAD_DEFAULTS.maxBytes + 1)).errors.some((e) => e.reason.includes('larger than'))).toBe(true);
    expect(validateUpload(null).errors[0].reason).toBe('missing');
  });

  it('warns rather than pretending when content cannot be inspected', () => {
    const out = validateUpload({ name: 'photo.png', size: 1000, type: 'image/png' });
    expect(out.valid).toBe(true);
    expect(out.warnings.some((w) => w.reason.includes('not inspected'))).toBe(true);
  });

  it('flags a declared MIME that disagrees with the content', () => {
    const out = validateUpload({ name: 'photo.jpg', size: 100, type: 'image/jpeg', bytes: PNG });
    expect(out.valid).toBe(false);
  });
});

describe('enterprise — bot and host checks', () => {
  it('catches a filled honeypot and an instant submit, and nothing else', () => {
    const challenge = createBotChallenge({ now: 1000, minFillMs: 2000 });
    expect(challenge.check({ submittedAt: 5000 }).human).toBe(true);
    expect(challenge.check({ honeypotValue: 'spam', submittedAt: 5000 }).reasons).toContain('honeypot-filled');
    expect(challenge.check({ submittedAt: 1500 }).reasons).toContain('submitted-too-fast');
    expect(challenge.check({ honeypotValue: '', submittedAt: 9000 }).human).toBe(true);
    // This is a speed bump, not bot protection — the scope map says so.
    expect(challenge.honeypotField).toBeTruthy();
  });

  it('allows only https hosts on the allowlist', () => {
    const list = ['api.coingecko.com', 'supabase.co'];
    expect(hostAllowed('https://api.coingecko.com/api/v3/ping', list).allowed).toBe(true);
    expect(hostAllowed('https://x.supabase.co/rest/v1', list).allowed).toBe(true);
    expect(hostAllowed('http://api.coingecko.com/x', list).reason).toBe('not-https');
    expect(hostAllowed('https://evil.example/x', list).reason).toBe('host-not-allowlisted');
    expect(hostAllowed('https://notapi.coingecko.com.evil.example/x', list).allowed).toBe(false);
    expect(hostAllowed('nonsense', list).reason).toBe('invalid-url');
  });
});
