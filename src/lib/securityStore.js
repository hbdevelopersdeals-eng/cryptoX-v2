/* Local persistence for the account-security surface (Sections 6, 8, 9, 10).
 *
 * This is a THIN layer. Every rule — lockout escalation, backup-code single use,
 * the last-owner check, privilege-escalation refusal, audit immutability —
 * lives in the pure modules (mfa.js, accounts.js, rbac.js) and is tested there.
 * The store only loads, mutates and saves.
 *
 * Storage is localStorage, so the honest label is "this browser". Passwords are
 * NOT held here: they stay in auth.jsx behind PBKDF2. A TOTP secret and the
 * backup-code hashes do live here, which is stated in the UI.
 */

import { lsGet, lsSet } from './storage.js';
import {
  generateSecret, provisioningUri, verifyTotp, generateBackupCodes, consumeBackupCode,
  createLockoutState, recordFailure, recordSuccess, isLocked, issueResetToken, verifyResetToken
} from './mfa.js';
import {
  createProfile, createOrganization, createWorkspace, createInvitation, acceptInvitation,
  registerSession, revokeSession, revokeAllSessions, scoreLogin, recordLogin, appendAudit,
  createDataRequest, advanceDataRequest, describeDevice, setMemberRoles, removeMember, ownersOf
} from './accounts.js';
import { assignableRoles } from './rbac.js';

export const SECURITY_KEY = 'cx_security';

export const EMPTY_SECURITY = {
  profile: null,
  mfa: { enabled: false, secret: null, backupHashes: [], enrolledAt: null, lastVerifiedAt: null },
  sessions: [],
  history: [],
  lockout: null,
  dsr: [],
  organizations: [],
  memberships: [],
  invitations: [],
  workspaces: [],
  audit: [],
  activeOrgId: null
};

export const loadSecurity = () => {
  const stored = lsGet(SECURITY_KEY, null);
  if (!stored || typeof stored !== 'object') return { ...EMPTY_SECURITY };
  // Shape-tolerant merge, so adding a field later does not break an old record.
  return { ...EMPTY_SECURITY, ...stored, mfa: { ...EMPTY_SECURITY.mfa, ...(stored.mfa || {}) } };
};

export const saveSecurity = (state) => {
  lsSet(SECURITY_KEY, state);
  return state;
};

export const resetSecurity = () => {
  lsSet(SECURITY_KEY, { ...EMPTY_SECURITY });
  return { ...EMPTY_SECURITY };
};

/* ---------------------------------------------------------------------------
 * Profile
 * ------------------------------------------------------------------------ */

export function ensureProfile(state, { userId, email, username, displayName }) {
  if (state.profile) return state;
  const { profile } = createProfile({ userId, email, username: username || (email || '').split('@')[0], displayName });
  return { ...state, profile };
}

/* ---------------------------------------------------------------------------
 * MFA — TOTP
 * ------------------------------------------------------------------------ */

/**
 * Begin TOTP enrolment.
 * Returns the base32 secret and the otpauth URI. No QR image is produced on
 * purpose: a QR is normally rendered by an image service, which would send the
 * shared secret to a third party — the one thing that must never happen.
 */
export async function beginTotpEnrolment({ account, issuer = 'CryptoX' }) {
  const secret = generateSecret(20);
  return { secret, uri: provisioningUri({ secret, account, issuer }) };
}

/**
 * Confirm enrolment with a code from the authenticator app.
 * A secret is only stored once a code derived from it has verified, so a
 * mis-scanned secret cannot lock the account out later.
 */
export async function confirmTotpEnrolment(state, { secret, code, now = Date.now() }) {
  const result = await verifyTotp(secret, code, { at: now });
  if (!result.ok) return { ok: false, reason: result.reason, state };
  const { codes, hashes } = await generateBackupCodes({ count: 10 });
  return {
    ok: true,
    codes, // shown once, never persisted
    state: {
      ...state,
      mfa: {
        enabled: true,
        secret,
        backupHashes: hashes,
        enrolledAt: new Date(now).toISOString(),
        lastVerifiedAt: new Date(now).toISOString()
      }
    }
  };
}

export async function verifyMfaCode(state, code, now = Date.now()) {
  if (!state.mfa?.enabled) return { ok: false, reason: 'not-enabled' };
  const totp = await verifyTotp(state.mfa.secret, code, { at: now });
  if (totp.ok) {
    return { ok: true, method: 'totp', state: { ...state, mfa: { ...state.mfa, lastVerifiedAt: new Date(now).toISOString() } } };
  }
  const backup = await consumeBackupCode(state.mfa.backupHashes, code);
  if (backup.ok) {
    return {
      ok: true,
      method: 'backup_code',
      warning: backup.warning,
      state: { ...state, mfa: { ...state.mfa, backupHashes: backup.remaining, lastVerifiedAt: new Date(now).toISOString() } }
    };
  }
  return { ok: false, reason: 'mismatch', state };
}

export async function rotateBackupCodes(state) {
  if (!state.mfa?.enabled) return { ok: false, reason: 'not-enabled' };
  const { codes, hashes } = await generateBackupCodes({ count: 10 });
  return { ok: true, codes, state: { ...state, mfa: { ...state.mfa, backupHashes: hashes } } };
}

export function disableMfa(state) {
  return { ...state, mfa: { enabled: false, secret: null, backupHashes: [], enrolledAt: null, lastVerifiedAt: null } };
}

/** Backup codes are hashed, so the count is all that can be shown later. */
export const backupCodesRemaining = (state) => (state.mfa?.backupHashes || []).length;

/* ---------------------------------------------------------------------------
 * Lockout
 * ------------------------------------------------------------------------ */

export function registerFailedAttempt(state, now = Date.now()) {
  const next = recordFailure(state.lockout || createLockoutState(now), now);
  return { state: { ...state, lockout: next }, lock: isLocked(next, now) };
}

export function registerSuccessfulAttempt(state, now = Date.now()) {
  return { ...state, lockout: recordSuccess(state.lockout, now) };
}

export const lockStatus = (state, now = Date.now()) => isLocked(state.lockout, now);

/* ---------------------------------------------------------------------------
 * Sessions and login history
 * ------------------------------------------------------------------------ */

export function startSession(state, { userId, userAgent, ip, now = Date.now() }) {
  const device = describeDevice(userAgent);
  const { session, sessions } = registerSession(state.sessions, { userId, device, ip, now: new Date(now) });
  return { session, state: { ...state, sessions } };
}

export const endSession = (state, sessionId, now = Date.now()) =>
  ({ ...state, sessions: revokeSession(state.sessions, sessionId, new Date(now)).sessions });

export function endAllSessions(state, { userId, exceptSessionId = null, now = Date.now() }) {
  const out = revokeAllSessions(state.sessions, { userId, exceptSessionId, now: new Date(now) });
  return { revokedCount: out.revokedCount, state: { ...state, sessions: out.sessions } };
}

/**
 * Record a sign-in: score it against this account's own history, then append it.
 * The score is computed BEFORE the new entry is added, or every login would
 * look normal against itself.
 */
export function recordSignIn(state, { userId, userAgent, ip, country, failedAttempts = 0, now = Date.now() }) {
  const device = describeDevice(userAgent);
  const risk = scoreLogin({
    attempt: { country, deviceLabel: device.label, ip, failedAttempts },
    history: state.history
  });
  const { history } = recordLogin(state.history, { userId, device, ip, country, risk, now: new Date(now) });
  return { risk, state: { ...state, history } };
}

/* ---------------------------------------------------------------------------
 * Organizations, members, invitations
 * ------------------------------------------------------------------------ */

export function addOrganization(state, { name, ownerId, timezone, currency, language, now = Date.now() }) {
  const out = createOrganization({ name, ownerId, timezone, currency, language });
  if (!out.ok) return { ok: false, errors: out.errors, state };
  return {
    ok: true,
    state: {
      ...state,
      organizations: [...state.organizations, out.organization],
      memberships: [...state.memberships, out.membership],
      activeOrgId: out.organization.id
    }
  };
}

export const addWorkspace = (state, payload) => ({
  ...state,
  workspaces: [...state.workspaces, createWorkspace(payload)]
});

export function invite(state, { email, role, subject, organizationId, now = new Date() }) {
  const out = createInvitation({ organizationId, email, role, subject, invitedBy: subject?.userId, now });
  if (!out.ok) return { ok: false, reason: out.reason, allowed: out.allowed, state };
  const audit = appendAudit(state.audit, {
    action: 'member.invited', actorId: subject.userId, organizationId,
    targetType: 'email', targetId: out.invitation.email, metadata: { role }
  });
  return { ok: true, invitation: out.invitation, state: { ...state, invitations: [...state.invitations, out.invitation], audit: audit.log } };
}

export function acceptInvite(state, { invitationId, userId, now = new Date() }) {
  const invitation = state.invitations.find((i) => i.id === invitationId);
  const out = acceptInvitation(invitation, { userId, now });
  if (!out.ok) return { ok: false, reason: out.reason, state };
  const audit = appendAudit(state.audit, {
    action: 'member.joined', actorId: userId, organizationId: invitation.organizationId,
    targetType: 'membership', targetId: out.membership.id
  });
  return {
    ok: true,
    state: {
      ...state,
      invitations: state.invitations.map((i) => (i.id === invitationId ? out.invitation : i)),
      memberships: [...state.memberships, out.membership],
      audit: audit.log
    }
  };
}

export function changeMemberRoles(state, { membershipId, roles, actor, now = new Date() }) {
  const out = setMemberRoles(state.memberships, { membershipId, roles, actor });
  if (!out.ok) return { ok: false, reason: out.reason, roles: out.roles, state };
  const target = state.memberships.find((m) => m.id === membershipId);
  const audit = appendAudit(state.audit, {
    action: 'member.roles_changed', actorId: actor?.userId, organizationId: target?.organizationId,
    targetType: 'membership', targetId: membershipId,
    metadata: { from: target?.roles, to: roles },
    at: now.toISOString()
  });
  return { ok: true, state: { ...state, memberships: out.memberships, audit: audit.log } };
}

export function dropMember(state, { membershipId, actor, now = new Date() }) {
  const target = state.memberships.find((m) => m.id === membershipId);
  const out = removeMember(state.memberships, { membershipId });
  if (!out.ok) return { ok: false, reason: out.reason, state };
  const audit = appendAudit(state.audit, {
    action: 'member.removed', actorId: actor?.userId, organizationId: target?.organizationId,
    targetType: 'membership', targetId: membershipId, at: now.toISOString()
  });
  return { ok: true, state: { ...state, memberships: out.memberships, audit: audit.log } };
}

/** The roles the signed-in subject is allowed to hand out. */
export const grantableRoles = (subject) => assignableRoles(subject);

export const organizationOwners = (state, organizationId) => ownersOf(state.memberships, organizationId);

/* ---------------------------------------------------------------------------
 * Audit and privacy requests
 * ------------------------------------------------------------------------ */

export function recordEvent(state, entry) {
  const out = appendAudit(state.audit, entry);
  if (!out.ok) return { ok: false, reason: out.reason, state };
  return { ok: true, entry: out.entry, state: { ...state, audit: out.log } };
}

export function requestData(state, { userId, type, detail, now = new Date() }) {
  const out = createDataRequest({ userId, type, detail, now });
  if (!out.ok) return { ok: false, reason: out.reason, state };
  const audit = appendAudit(state.audit, {
    action: type === 'deletion' ? 'deletion.requested' : 'export.requested',
    actorId: userId, targetType: 'dsr', targetId: out.request.id, at: now.toISOString()
  });
  return { ok: true, request: out.request, state: { ...state, dsr: [...state.dsr, out.request], audit: audit.log } };
}

export function advanceRequest(state, { requestId, nextState, now = new Date() }) {
  const current = state.dsr.find((r) => r.id === requestId);
  const out = advanceDataRequest(current, nextState, now);
  if (!out.ok) return { ok: false, reason: out.reason, state };
  return { ok: true, state: { ...state, dsr: state.dsr.map((r) => (r.id === requestId ? out.request : r)) } };
}

/* ---------------------------------------------------------------------------
 * Password reset (client half — delivery needs a mail provider)
 * ------------------------------------------------------------------------ */

export async function startPasswordReset({ userId, now = Date.now() }) {
  const out = await issueResetToken({ userId, now });
  if (!out.ok) return out;
  return {
    ok: true,
    token: out.token,
    record: out.record,
    // There is no mail provider in this build, so the token is surfaced with a
    // clear note instead of pretending an email was sent.
    delivery: 'not-configured'
  };
}

export const checkResetToken = (record, token, now = Date.now()) => verifyResetToken(record, token, now);
