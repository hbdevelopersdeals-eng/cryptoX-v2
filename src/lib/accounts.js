/* Account, organization and membership models (Sections 8 and 9).
 *
 * These are the shapes and the RULES, not the transport. Every mutation is a
 * pure function returning a new state plus an audit entry, so the invariants can
 * be tested without a database and the same code can run against Supabase.
 *
 * Invariants, each covered by a test:
 *  1. An invitation expires, and can be accepted once. Reuse fails.
 *  2. Nobody can invite or promote above their own level (privilege escalation).
 *  3. The last owner of an organization cannot be removed or demoted. An
 *     organization with no owner is unrecoverable.
 *  4. The audit log is append-only and bounded; entries are never edited.
 *  5. Revoking a session removes access immediately, not on next refresh.
 *  6. A data-deletion request purges the personal fields; an export includes
 *     what the person is entitled to see and nothing about other people.
 */

import { isKnownRole, assignableRoles, can, effectivePermissions } from './rbac.js';
import { isValidZone } from './time.js';
import { currencyByCode } from './currencies.js';
import { isSupported as isSupportedLanguage } from './locales.js';
import { countryByCode } from './countries.js';

/* ---------------------------------------------------------------------------
 * Profile (Section 8)
 * ------------------------------------------------------------------------ */

export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'sms', 'telegram', 'discord', 'webhook'];

export const DEFAULT_PRIVACY = {
  profileVisibility: 'members',     // public | members | private
  showLocation: false,
  showActivity: true,
  allowAnalytics: true,
  allowMarketing: false
};

export const DEFAULT_NOTIFICATIONS = {
  inapp: true, email: true, sms: false, telegram: false, discord: false, webhook: false,
  categories: { alerts: true, security: true, billing: true, product: false, digest: true }
};

export function createProfile({ userId, email, username, displayName } = {}) {
  const errors = [];
  if (!userId) errors.push({ field: 'userId', reason: 'required' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) errors.push({ field: 'email', reason: 'invalid' });
  const u = validateUsername(username);
  if (!u.valid) errors.push({ field: 'username', reason: u.reason });

  return {
    ok: errors.length === 0,
    errors,
    profile: {
      userId: userId || null,
      email: String(email || '').toLowerCase(),
      emailVerified: false,
      phone: null,
      phoneVerified: false,
      username: u.normalised,
      displayName: displayName || username || '',
      photoUrl: null,
      country: null,
      city: '',
      language: 'en',
      currency: 'USD',
      timezone: 'UTC',
      notifications: { ...DEFAULT_NOTIFICATIONS, categories: { ...DEFAULT_NOTIFICATIONS.categories } },
      privacy: { ...DEFAULT_PRIVACY },
      connectedAccounts: [],
      mfa: { enabled: false, methods: [] },
      security: { passwordChangedAt: null, lastLoginAt: null },
      createdAt: new Date().toISOString()
    }
  };
}

/** Usernames are lower-cased and restricted, so two accounts cannot collide by case. */
export function validateUsername(username) {
  const raw = String(username || '').trim().toLowerCase();
  if (raw.length < 3) return { valid: false, normalised: raw, reason: 'too-short' };
  if (raw.length > 32) return { valid: false, normalised: raw, reason: 'too-long' };
  if (!/^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/.test(raw)) {
    return { valid: false, normalised: raw, reason: 'invalid-characters' };
  }
  if (RESERVED_USERNAMES.has(raw)) return { valid: false, normalised: raw, reason: 'reserved' };
  return { valid: true, normalised: raw, reason: 'ok' };
}

export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'billing', 'security',
  'cryptox', 'system', 'api', 'www', 'mail', 'postmaster', 'abuse', 'null', 'undefined'
]);

export function updateProfile(profile, patch = {}) {
  const errors = [];
  const next = { ...profile, ...patch };

  if (patch.username !== undefined) {
    const u = validateUsername(patch.username);
    if (!u.valid) errors.push({ field: 'username', reason: u.reason });
    else next.username = u.normalised;
  }
  if (patch.language !== undefined && !isSupportedLanguage(patch.language)) {
    errors.push({ field: 'language', reason: 'unsupported' });
  }
  if (patch.currency !== undefined && !currencyByCode(patch.currency)) {
    errors.push({ field: 'currency', reason: 'unknown-currency' });
  }
  if (patch.timezone !== undefined && !isValidZone(patch.timezone)) {
    errors.push({ field: 'timezone', reason: 'invalid-iana-zone' });
  }
  if (patch.country !== undefined && patch.country && !countryByCode(patch.country)) {
    errors.push({ field: 'country', reason: 'unknown-country' });
  }
  if (patch.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(patch.email))) {
    errors.push({ field: 'email', reason: 'invalid' });
  }
  if (patch.email !== undefined) {
    // Changing the address always re-opens verification and clears the old flag.
    next.email = String(patch.email).toLowerCase();
    next.emailVerified = false;
  }

  return { ok: errors.length === 0, errors, profile: next };
}

/* ---------------------------------------------------------------------------
 * Organizations and structure (Section 9)
 * ------------------------------------------------------------------------ */

export const ORG_PLANS = ['free', 'team', 'business', 'enterprise'];

export function createOrganization({ name, slug, ownerId, timezone = 'UTC', currency = 'USD', language = 'en' } = {}) {
  const errors = [];
  const normalisedSlug = String(slug || name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (normalisedSlug.length < 3) errors.push({ field: 'slug', reason: 'too-short' });
  if (!ownerId) errors.push({ field: 'ownerId', reason: 'required' });
  if (!isValidZone(timezone)) errors.push({ field: 'timezone', reason: 'invalid-iana-zone' });
  if (!currencyByCode(currency)) errors.push({ field: 'currency', reason: 'unknown-currency' });
  if (!isSupportedLanguage(language)) errors.push({ field: 'language', reason: 'unsupported' });

  const org = {
    id: `org_${normalisedSlug}`,
    name: name || normalisedSlug,
    slug: normalisedSlug,
    plan: 'free',
    timezone,
    currency,
    language,
    branding: { logoUrl: null, accentColor: null, domain: null },
    policies: {
      requireMfa: false, ssoOnly: false, allowPublicInvites: false,
      sessionMaxHours: 168, retainAuditDays: 365, ipAllowlist: []
    },
    billing: { customerId: null, seats: 1, plan: 'free' },
    createdAt: new Date().toISOString()
  };

  const membership = {
    id: `mem_${normalisedSlug}_${ownerId}`,
    organizationId: org.id,
    userId: ownerId,
    roles: ['organization_owner'],
    status: 'active',
    workspaceIds: [],
    joinedAt: new Date().toISOString()
  };

  return { ok: errors.length === 0, errors, organization: org, membership };
}

export const createWorkspace = ({ organizationId, name, slug, kind = 'workspace' } = {}) => ({
  id: `ws_${String(slug || name || 'main').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`,
  organizationId,
  name: name || slug,
  kind, // workspace | team | department
  createdAt: new Date().toISOString()
});

/* ---------------------------------------------------------------------------
 * Invitations
 * ------------------------------------------------------------------------ */

/**
 * Invite somebody. Two security rules are enforced here, not in the UI:
 *  - the inviter may only grant a role they could hold themselves
 *  - the invitation expires, and can be accepted exactly once
 */
export function createInvitation({ organizationId, email, role, invitedBy, subject, ttlHours = 72, now = new Date() } = {}) {
  if (!isKnownRole(role)) return { ok: false, reason: 'unknown-role' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return { ok: false, reason: 'invalid-email' };

  const allowed = assignableRoles(subject);
  if (!allowed.includes(role)) return { ok: false, reason: 'role-above-inviter', allowed };

  return {
    ok: true,
    invitation: {
      id: `inv_${Math.random().toString(36).slice(2, 10)}`,
      organizationId,
      email: String(email).toLowerCase(),
      role,
      invitedBy,
      tokenHash: null, // the raw token is emailed, never stored
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlHours * 3600000).toISOString(),
      acceptedAt: null,
      acceptedBy: null
    }
  };
}

/** Accept an invitation. Expiry and single use are checked in that order. */
export function acceptInvitation(invitation, { userId, now = new Date() } = {}) {
  if (!invitation) return { ok: false, reason: 'not-found' };
  if (invitation.status !== 'pending') return { ok: false, reason: 'already-used' };
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (!userId) return { ok: false, reason: 'no-user' };

  return {
    ok: true,
    invitation: { ...invitation, status: 'accepted', acceptedAt: now.toISOString(), acceptedBy: userId },
    membership: {
      id: `mem_${invitation.organizationId}_${userId}`,
      organizationId: invitation.organizationId,
      userId,
      roles: [invitation.role],
      status: 'active',
      workspaceIds: [],
      joinedAt: now.toISOString(),
      invitedBy: invitation.invitedBy
    }
  };
}

export const revokeInvitation = (invitation, now = new Date()) =>
  ({ ...invitation, status: 'revoked', revokedAt: now.toISOString() });

/* ---------------------------------------------------------------------------
 * Membership changes and the last-owner rule
 * ------------------------------------------------------------------------ */

export function membersOf(memberships = [], organizationId) {
  return memberships.filter((m) => m.organizationId === organizationId && m.status === 'active');
}

export const ownersOf = (memberships = [], organizationId) =>
  membersOf(memberships, organizationId).filter((m) => m.roles.includes('organization_owner'));

/**
 * Change a member's roles. Refuses to leave the organization without an owner.
 */
export function setMemberRoles(memberships = [], { membershipId, roles, actor } = {}) {
  const target = memberships.find((m) => m.id === membershipId);
  if (!target) return { ok: false, reason: 'not-found' };
  if (!Array.isArray(roles) || roles.some((r) => !isKnownRole(r))) return { ok: false, reason: 'unknown-role' };

  const losingOwner = target.roles.includes('organization_owner') && !roles.includes('organization_owner');
  if (losingOwner) {
    const owners = ownersOf(memberships, target.organizationId);
    if (owners.length <= 1) return { ok: false, reason: 'last-owner' };
  }
  // The actor may only grant roles they could hold themselves.
  const allowed = assignableRoles(actor);
  const escalation = roles.filter((r) => !allowed.includes(r));
  if (escalation.length) return { ok: false, reason: 'role-above-actor', roles: escalation };

  return {
    ok: true,
    memberships: memberships.map((m) => (m.id === membershipId ? { ...m, roles: [...new Set(roles)] } : m))
  };
}

export function removeMember(memberships = [], { membershipId } = {}) {
  const target = memberships.find((m) => m.id === membershipId);
  if (!target) return { ok: false, reason: 'not-found' };
  if (target.roles.includes('organization_owner')) {
    const owners = ownersOf(memberships, target.organizationId);
    if (owners.length <= 1) return { ok: false, reason: 'last-owner' };
  }
  return { ok: true, memberships: memberships.filter((m) => m.id !== membershipId) };
}

/* ---------------------------------------------------------------------------
 * Sessions and devices (Sections 8 and 6)
 * ------------------------------------------------------------------------ */

/** A device label without a fingerprinting library: coarse and honest. */
export function describeDevice(userAgent = '', platform = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : 'Unknown browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : 'Unknown OS';
  const kind = /Mobile|Android|iPhone/.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, kind, platform: platform || os, label: `${browser} on ${os}` };
}

export function registerSession(sessions = [], { userId, device, ip, now = new Date() } = {}) {
  const session = {
    id: `ses_${Math.random().toString(36).slice(2, 10)}`,
    userId,
    device: device || describeDevice(),
    ip: ip ? maskIp(ip) : null,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    revokedAt: null,
    current: true
  };
  // Only one session is "current"; the rest become historical on next login.
  return { session, sessions: [session, ...sessions.map((s) => ({ ...s, current: false }))] };
}

/** Store a masked address, not the full one — enough to recognise, not to locate. */
export function maskIp(ip) {
  const s = String(ip);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    const parts = s.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (s.includes(':')) return `${s.split(':').slice(0, 3).join(':')}::`;
  return null;
}

export const activeSessions = (sessions = []) => sessions.filter((s) => !s.revokedAt);

export function revokeSession(sessions = [], sessionId, now = new Date()) {
  return {
    sessions: sessions.map((s) => (s.id === sessionId ? { ...s, revokedAt: now.toISOString(), current: false } : s))
  };
}

/**
 * "Log out everywhere". Revocation is immediate: the session list is the
 * authority, so a revoked session stops authorizing on the very next check
 * rather than at token expiry.
 */
export function revokeAllSessions(sessions = [], { userId, exceptSessionId = null, now = new Date() } = {}) {
  const revoked = [];
  const next = sessions.map((s) => {
    if (s.userId !== userId || s.revokedAt || s.id === exceptSessionId) return s;
    revoked.push(s.id);
    return { ...s, revokedAt: now.toISOString(), current: false };
  });
  return { sessions: next, revokedCount: revoked.length, revokedIds: revoked };
}

/** Is this session still usable? */
export const sessionIsValid = (session, now = new Date()) =>
  !!session && !session.revokedAt && new Date(session.createdAt).getTime() <= now.getTime();

/* ---------------------------------------------------------------------------
 * Login history and suspicious-login detection
 * ------------------------------------------------------------------------ */

export const RISK_LEVELS = ['low', 'medium', 'high'];

/**
 * Score a sign-in attempt against the account's own history.
 * Deliberately explainable: each signal is named and weighted, so a user can be
 * told WHY a login looked wrong rather than being silently locked out.
 */
export function scoreLogin({ attempt, history = [], sessions = [] } = {}) {
  const signals = [];
  let score = 0;

  const knownCountries = new Set(history.map((h) => h.country).filter(Boolean));
  const knownDevices = new Set(history.map((h) => h.deviceLabel).filter(Boolean));
  const knownIps = new Set(history.map((h) => h.ip).filter(Boolean));

  if (attempt.country && knownCountries.size && !knownCountries.has(attempt.country)) {
    score += 40;
    signals.push({ id: 'new-country', weight: 40, detail: `First sign-in from ${attempt.country}` });
  }
  if (attempt.deviceLabel && knownDevices.size && !knownDevices.has(attempt.deviceLabel)) {
    score += 25;
    signals.push({ id: 'new-device', weight: 25, detail: `New device: ${attempt.deviceLabel}` });
  }
  if (attempt.ip && knownIps.size && !knownIps.has(attempt.ip)) {
    score += 15;
    signals.push({ id: 'new-ip', weight: 15, detail: 'Unrecognised network' });
  }
  if (attempt.failedAttempts >= 3) {
    score += 20;
    signals.push({ id: 'failed-attempts', weight: 20, detail: `${attempt.failedAttempts} failed attempts before this one` });
  }
  if (attempt.impossibleTravel) {
    // Weighted high on its own: two sign-ins further apart than travel allows is
    // close to proof of compromise or a proxy, not a hint to be averaged away.
    score += 70;
    signals.push({ id: 'impossible-travel', weight: 70, detail: 'Two sign-ins too far apart in time' });
  }
  if (attempt.newSessionCount > 5) {
    score += 20;
    signals.push({ id: 'session-fanout', weight: 20, detail: `${attempt.newSessionCount} sessions opened recently` });
  }
  if (history.length === 0) {
    signals.push({ id: 'first-login', weight: 0, detail: 'First recorded sign-in' });
  }

  const level = score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low';
  return {
    score,
    level,
    signals,
    // A first login with no history cannot be "suspicious" — there is nothing to compare against.
    baseline: history.length === 0,
    action: level === 'high' ? 'require-verification' : level === 'medium' ? 'notify' : 'allow',
    explanation: signals.length ? signals.map((s) => s.detail).join(' · ') : 'Matches your usual pattern.'
  };
}

export function recordLogin(history = [], { userId, device, ip, country, risk, now = new Date() } = {}, limit = 100) {
  const entry = {
    id: `log_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
    userId,
    deviceLabel: device?.label || null,
    ip: ip ? maskIp(ip) : null,
    country: country || null,
    riskLevel: risk?.level || 'low',
    riskScore: risk?.score ?? 0,
    at: now.toISOString()
  };
  const next = [entry, ...history];
  return { entry, history: next.slice(0, limit) };
}

/* ---------------------------------------------------------------------------
 * Audit log (Section 9)
 * ------------------------------------------------------------------------ */

export const AUDIT_ACTIONS = [
  'member.invited', 'member.joined', 'member.roles_changed', 'member.removed',
  'org.created', 'org.updated', 'org.deleted', 'workspace.created',
  'session.revoked', 'sessions.revoked_all', 'login.succeeded', 'login.failed',
  'mfa.enabled', 'mfa.disabled', 'password.changed', 'api_key.created', 'api_key.revoked',
  'export.requested', 'deletion.requested', 'profile.updated', 'billing.updated'
];

/**
 * Append to the audit log. Entries are never edited or removed individually —
 * only the oldest are dropped once the cap is reached, and the drop is recorded.
 */
export function appendAudit(log = [], entry = {}, limit = 1000) {
  if (!entry.action || !AUDIT_ACTIONS.includes(entry.action)) {
    return { ok: false, reason: 'unknown-action', log };
  }
  const record = Object.freeze({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at || new Date().toISOString(),
    actorId: entry.actorId || null,
    organizationId: entry.organizationId || null,
    action: entry.action,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    // Never store secrets, tokens or full IPs here.
    metadata: entry.metadata ? { ...entry.metadata } : {},
    immutable: true
  });
  const next = [...log, record];
  const trimmed = next.length > limit ? next.slice(next.length - limit) : next;
  return { ok: true, entry: record, log: trimmed, trimmed: next.length - trimmed.length };
}

export function auditFilter(log = [], { organizationId, actorId, action, from, to } = {}) {
  return log.filter((e) => {
    if (organizationId && e.organizationId !== organizationId) return false;
    if (actorId && e.actorId !== actorId) return false;
    if (action && e.action !== action) return false;
    if (from && new Date(e.at) < new Date(from)) return false;
    if (to && new Date(e.at) > new Date(to)) return false;
    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Privacy requests (Section 8)
 * ------------------------------------------------------------------------ */

export const DSR_TYPES = ['export', 'deletion', 'correction'];
export const DSR_STATES = ['received', 'verifying', 'processing', 'completed', 'rejected'];

export function createDataRequest({ userId, type, detail = '', now = new Date() } = {}) {
  if (!DSR_TYPES.includes(type)) return { ok: false, reason: 'unknown-type' };
  return {
    ok: true,
    request: {
      id: `dsr_${now.getTime()}`,
      userId, type, detail,
      state: 'received',
      createdAt: now.toISOString(),
      dueAt: new Date(now.getTime() + 30 * 86400000).toISOString(), // 30-day window
      updates: [{ state: 'received', at: now.toISOString() }]
    }
  };
}

export function advanceDataRequest(request, state, now = new Date()) {
  const idx = DSR_STATES.indexOf(state);
  const current = DSR_STATES.indexOf(request.state);
  if (idx === -1) return { ok: false, reason: 'unknown-state' };
  if (idx < current) return { ok: false, reason: 'cannot-go-back' };
  return {
    ok: true,
    request: { ...request, state, updates: [...request.updates, { state, at: now.toISOString() }] }
  };
}

/**
 * What an export contains. Personal fields only — never other members' data,
 * never audit entries the subject has no right to, never secrets.
 */
export function buildExport({ profile, memberships = [], sessions = [], loginHistory = [], now = new Date() } = {}) {
  return {
    exportedAt: now.toISOString(),
    format: 'json',
    profile: {
      userId: profile?.userId, email: profile?.email, username: profile?.username,
      displayName: profile?.displayName, country: profile?.country, city: profile?.city,
      language: profile?.language, currency: profile?.currency, timezone: profile?.timezone,
      notifications: profile?.notifications, privacy: profile?.privacy,
      connectedAccounts: profile?.connectedAccounts
    },
    memberships: memberships.map((m) => ({
      organizationId: m.organizationId, roles: m.roles, status: m.status, joinedAt: m.joinedAt
    })),
    sessions: sessions.map((s) => ({
      id: s.id, device: s.device?.label, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, revokedAt: s.revokedAt
    })),
    loginHistory,
    omitted: [
      'other members’ personal data',
      'organization audit entries the subject did not create',
      'password hashes, session tokens and API keys'
    ]
  };
}

/** A deletion request removes personal fields and keeps only what must survive. */
export function applyDeletion(profile, { retainForLegalDays = 30, now = new Date() } = {}) {
  return {
    profile: {
      ...profile,
      email: null,
      phone: null,
      username: null,
      displayName: 'Deleted account',
      photoUrl: null,
      city: '',
      country: null,
      connectedAccounts: [],
      notifications: null,
      privacy: null,
      deletion: {
        requestedAt: now.toISOString(),
        // Billing records usually must be retained for a statutory period; the
        // account itself is gone either way.
        purgeAfter: new Date(now.getTime() + retainForLegalDays * 86400000).toISOString()
      }
    },
    retained: ['billing records (statutory retention)', 'audit entries naming this account as actor'],
    note: 'The account is deactivated immediately. Retention applies only to records the law requires.'
  };
}

/* ---------------------------------------------------------------------------
 * Authorization helpers that read a membership
 * ------------------------------------------------------------------------ */

/** Build the authorization subject for a user acting inside one organization. */
export function subjectFor({ userId, memberships = [], organizationId, workspaceIds, denies = [], grants = [] } = {}) {
  const membership = memberships.find((m) => m.userId === userId && m.organizationId === organizationId);
  return {
    userId,
    organizationId: membership?.organizationId || organizationId || null,
    roles: membership?.roles || [],
    workspaceIds: workspaceIds || membership?.workspaceIds || [],
    grants,
    denies
  };
}

export const memberCan = (membership, permission, context = {}) =>
  can({
    userId: membership?.userId,
    organizationId: membership?.organizationId,
    roles: membership?.roles || [],
    workspaceIds: membership?.workspaceIds || [],
    denies: [],
    grants: []
  }, permission, context);

/** Seat usage against the plan, so billing can warn before an overage. */
export function seatUsage(organization, memberships = []) {
  const active = membersOf(memberships, organization.id).length;
  const seats = organization.billing?.seats ?? active;
  return { active, seats, over: active > seats, remaining: Math.max(0, seats - active) };
}

export const permissionSummary = (roles = []) => effectivePermissions(roles);
