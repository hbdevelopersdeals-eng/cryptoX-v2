import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Copy, Download, Fingerprint, KeyRound, Laptop, Lock, RefreshCw,
  Shield, ShieldCheck, Smartphone, Trash2, X
} from 'lucide-react';
import { Card } from '../components/ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { supabaseConfigured } from '../lib/supabase.js';
import { useCurrency } from '../lib/currency.jsx';
import {
  loadSecurity, saveSecurity, ensureProfile,
  beginTotpEnrolment, confirmTotpEnrolment, verifyMfaCode, rotateBackupCodes, disableMfa,
  backupCodesRemaining, startSession, endSession, endAllSessions, recordSignIn,
  lockStatus, registerFailedAttempt, registerSuccessfulAttempt,
  requestData, advanceRequest, recordEvent
} from '../lib/securityStore.js';
import { updateProfile, DSR_TYPES, activeSessions, describeDevice } from '../lib/accounts.js';
import { scorePassword, isBreached, validateUpload, AUTH_CAPABILITY, SECURITY_CAPABILITY, scopeSummary, SCOPE_STATUS } from '../lib/enterprise.js';
import { webauthnAvailable, MFA_METHODS } from '../lib/mfa.js';
import { LANGUAGES } from '../lib/locales.js';
import { CURRENCIES } from '../lib/currencies.js';
import { ZONE_LIST, formatRelative } from '../lib/time.js';
import { countryByCode } from '../lib/countries.js';

const StatusPill = ({ tone = 'muted', children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-400',
    warn: 'bg-amber-400/15 text-amber-300',
    bad: 'bg-down/15 text-down',
    muted: 'bg-muted text-muted-foreground'
  };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${tones[tone]}`}>{children}</span>;
};

const STRENGTH_TONE = ['bad', 'bad', 'warn', 'good', 'good'];

export default function Account() {
  const { t, lang, region, timeZone } = useI18n();
  const auth = useAuth() || {};
  const currency = useCurrency();
  const accountKey = auth.user?.email || auth.user?.username || auth.user?.id || 'local';

  const [state, setState] = useState(() => loadSecurity());
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Enrolment and password forms */
  const [enrol, setEnrol] = useState(null);       // { secret, uri }
  const [enrolCode, setEnrolCode] = useState('');
  const [freshCodes, setFreshCodes] = useState(null);
  const [testCode, setTestCode] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [passkey, setPasskey] = useState(null);

  const persist = (next) => { setState(next); saveSecurity(next); return next; };

  /* Create the profile once, and register this browser as a session on first view. */
  useEffect(() => {
    let next = ensureProfile(state, {
      userId: accountKey,
      email: auth.user?.email || `${accountKey}@local`,
      username: auth.user?.username || String(accountKey).split('@')[0]
    });
    if (!next.sessions.length) {
      const started = startSession(next, { userId: accountKey, userAgent: navigator.userAgent, ip: null });
      next = started.state;
    }
    if (next !== state) persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { webauthnAvailable().then(setPasskey).catch(() => setPasskey({ available: false, reason: 'probe-failed' })); }, []);

  const profile = state.profile;
  const mfaEnabled = !!state.mfa?.enabled;
  const lock = lockStatus(state);
  const sessions = activeSessions(state.sessions);
  const strength = useMemo(() => scorePassword(nextPw, { email: profile?.email, username: profile?.username }), [nextPw, profile]);

  const flash = (kind, text) => setNote({ kind, text });

  /* ---------------------------------------------------------------- profile */

  const patchProfile = (patch) => {
    const out = updateProfile(profile, patch);
    if (!out.ok) { flash('bad', out.errors.map((e) => `${e.field}: ${e.reason}`).join(' · ')); return; }
    persist({ ...state, profile: out.profile });
    flash('good', t('common.saved'));
  };

  /* ------------------------------------------------------------------- MFA */

  const enrolStart = async () => {
    const out = await beginTotpEnrolment({ account: profile?.email || accountKey });
    setEnrol(out);
    setEnrolCode('');
    flash(null, null);
  };

  const enrolConfirm = async () => {
    setBusy(true);
    const out = await confirmTotpEnrolment(state, { secret: enrol.secret, code: enrolCode });
    setBusy(false);
    if (!out.ok) { flash('bad', `That code did not match (${out.reason}). Check the app's clock.`); return; }
    persist(out.state);
    setFreshCodes(out.codes);
    setEnrol(null);
    setEnrolCode('');
    flash('good', 'Two-factor authentication is on. Save the backup codes now — they are shown once.');
  };

  const verifyCode = async () => {
    const out = await verifyMfaCode(state, testCode);
    if (!out.ok) { flash('bad', 'Code rejected.'); registerFailedAttempt(state); return; }
    persist(out.state);
    setTestCode('');
    flash('good', `Verified as a ${out.method === 'totp' ? 'TOTP code' : 'backup code'}. ${out.warning || ''}`);
  };

  const rotate = async () => {
    const out = await rotateBackupCodes(state);
    if (!out.ok) { flash('bad', out.reason); return; }
    persist(out.state);
    setFreshCodes(out.codes);
    flash('good', 'New backup codes issued. The previous set no longer works.');
  };

  const turnOff = () => {
    persist(disableMfa(state));
    setFreshCodes(null);
    flash('warn', 'Two-factor authentication is off. This account is protected by its password alone.');
  };

  /* -------------------------------------------------------------- password */

  const breachCheck = async () => {
    setBusy(true);
    const out = await isBreached(nextPw);
    setBusy(false);
    flash(out.checked
      ? (out.breached ? 'bad' : 'good')
      : 'warn',
    out.checked
      ? (out.breached ? `Found in ${out.count.toLocaleString('en-US')} breaches — choose another.` : 'Not found in the breach corpus checked.')
      : `Breach check unavailable (${out.reason}). Treat the result as unknown, not safe.`);
  };

  const submitPassword = async () => {
    if (!auth.changePassword) { flash('warn', 'Password changes are handled by the sign-in service in this build.'); return; }
    if (!strength.acceptable) { flash('bad', 'Pick a stronger password first.'); return; }
    setBusy(true);
    try {
      await auth.changePassword(currentPw, nextPw);
      const logged = recordEvent(state, { action: 'password.changed', actorId: accountKey });
      persist(logged.state);
      setCurrentPw(''); setNextPw('');
      flash('good', 'Password changed. Other sessions keep running until you sign them out.');
    } catch (err) {
      flash('bad', err?.message || 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- sessions */

  const revokeOne = (id) => {
    persist(endSession(state, id));
    flash('good', 'Session revoked.');
  };

  const revokeAll = () => {
    const current = state.sessions.find((s) => s.current);
    const out = endAllSessions(state, { userId: accountKey, exceptSessionId: current?.id });
    const logged = recordEvent(out.state, { action: 'sessions.revoked_all', actorId: accountKey, metadata: { count: out.revokedCount } });
    persist(logged.state);
    flash('good', `${out.revokedCount} other session(s) signed out. This device stays signed in.`);
  };

  /* ------------------------------------------------------------------ DSR */

  const ask = (type) => {
    const out = requestData(state, { userId: accountKey, type });
    if (!out.ok) { flash('bad', String(out.reason)); return; }
    persist(out.state);
    flash('good', `${type} request recorded.`);
  };

  const advance = (requestId, next) => {
    const out = advanceRequest(state, { requestId, nextState: next });
    if (out.ok) persist(out.state);
  };

  /* ------------------------------------------------------------------ view */

  const scopes = [
    { key: 'auth', label: 'Authentication', items: AUTH_CAPABILITY },
    { key: 'security', label: 'Security', items: SECURITY_CAPABILITY }
  ].map((g) => ({ ...g, summary: scopeSummary(g.items) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck size={18} className="text-primary" /> Account &amp; Security
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Signed in as <span className="font-mono">{accountKey}</span> · {supabaseConfigured ? 'account stored on our servers' : 'account stored in this browser'}
          </p>
        </div>
        {lock.locked ? (
          <p className="text-[11px] text-down">
            Sign-in locked for {Math.ceil(lock.retryAfterMs / 1000)}s after {lock.attempts} failed attempts.
          </p>
        ) : null}
      </div>

      {note ? (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-[11px] ${
          note.kind === 'bad' ? 'border-down/40 bg-down/10 text-down'
            : note.kind === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'}`}
        >
          <span className="flex-1">{note.text}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Fingerprint size={15} className="text-primary" /> Profile</h2>
          {profile ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Display name</span>
                  <input
                    defaultValue={profile.displayName}
                    onBlur={(e) => patchProfile({ displayName: e.target.value })}
                    className="input-dark !h-10 w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Username</span>
                  <input
                    defaultValue={profile.username}
                    onBlur={(e) => patchProfile({ username: e.target.value })}
                    className="input-dark !h-10 w-full"
                  />
                </label>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
                <p className="flex items-center gap-2">
                  Email <span className="font-mono">{profile.email}</span>
                  <StatusPill tone={profile.emailVerified ? 'good' : 'warn'}>
                    {profile.emailVerified ? 'verified' : 'unverified'}
                  </StatusPill>
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  Verification email is composed locally; sending needs a mail provider.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Language</span>
                  <select value={profile.language} onChange={(e) => patchProfile({ language: e.target.value })} className="input-dark !h-10 w-full">
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Currency</span>
                  <select value={profile.currency} onChange={(e) => patchProfile({ currency: e.target.value })} className="input-dark !h-10 w-full">
                    {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Country</span>
                  <input
                    defaultValue={profile.country || region}
                    onBlur={(e) => patchProfile({ country: e.target.value.toUpperCase() })}
                    maxLength={2}
                    className="input-dark !h-10 w-full font-mono uppercase"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Time zone</span>
                  <select value={profile.timezone} onChange={(e) => patchProfile({ timezone: e.target.value })} className="input-dark !h-10 w-full">
                    {[...new Set([profile.timezone, timeZone, ...ZONE_LIST].filter(Boolean))].map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Every field above is validated against the real registries — an unknown country, currency, language or IANA zone is refused.
              </p>
            </>
          ) : <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
        </Card>

        {/* Password */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Lock size={15} className="text-primary" /> Password</h2>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Current password</span>
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} className="input-dark !h-10 w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">New password</span>
            <input type="password" value={nextPw} onChange={(e) => setNextPw(e.target.value)} className="input-dark !h-10 w-full" />
          </label>

          {nextPw ? (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone={STRENGTH_TONE[strength.score]}>{strength.label}</StatusPill>
                <span className="text-[10px] text-muted-foreground">{strength.entropyBits} bits · score {strength.score}/4</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                <div className={`h-full rounded-full ${strength.score >= 3 ? 'bg-emerald-500' : strength.score >= 2 ? 'bg-amber-400' : 'bg-down'}`} style={{ width: `${(strength.score / 4) * 100}%` }} />
              </div>
              {strength.warnings.map((w) => <p key={w} className="mt-1.5 text-[11px] text-down">{w}</p>)}
              {strength.suggestions.map((s) => <p key={s} className="mt-1 text-[11px] text-muted-foreground">{s}</p>)}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !nextPw} onClick={breachCheck} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">
              Check breaches
            </button>
            <button type="button" disabled={busy || !currentPw || !nextPw} onClick={submitPassword} className="btn-primary !h-8 !px-3 !text-[11px] disabled:opacity-40">
              Change password
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            The breach check sends only the first five characters of the password&apos;s SHA-1 hash — the password itself never leaves this browser.
          </p>
        </Card>

        {/* MFA */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={15} className="text-primary" /> Two-factor authentication
            <StatusPill tone={mfaEnabled ? 'good' : 'warn'}>{mfaEnabled ? 'on' : 'off'}</StatusPill>
          </h2>

          {!mfaEnabled && !enrol ? (
            <>
              <p className="text-[11px] text-muted-foreground">
                Adds a code from an authenticator app on top of your password. Implemented to RFC 6238.
              </p>
              <button type="button" onClick={enrolStart} className="btn-primary !h-8 !px-3 !text-[11px]">Set up authenticator app</button>
            </>
          ) : null}

          {enrol ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium">1. Add this secret to your app</p>
              <p className="break-all rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[11px]">{enrol.secret}</p>
              <p className="break-all text-[10px] text-muted-foreground">{enrol.uri}</p>
              <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                No QR image is shown on purpose: QR codes are normally rendered by an image service, which would hand your shared secret to a third party. Type or paste the secret instead.
              </p>
              <p className="text-[11px] font-medium">2. Enter the 6-digit code it shows</p>
              <div className="flex gap-2">
                <input
                  value={enrolCode}
                  onChange={(e) => setEnrolCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="Authenticator code"
                  className="input-dark !h-10 w-40 font-mono tracking-widest"
                />
                <button type="button" disabled={busy || enrolCode.length < 6} onClick={enrolConfirm} className="btn-primary !h-10 !px-3 !text-[11px] disabled:opacity-40">Confirm</button>
                <button type="button" onClick={() => setEnrol(null)} className="btn-ghost !h-10 !px-3 !text-[11px]">Cancel</button>
              </div>
            </div>
          ) : null}

          {mfaEnabled ? (
            <>
              <div className="rounded-lg border border-border p-3 text-[11px]">
                <p>Backup codes remaining: <span className="font-mono">{backupCodesRemaining(state)}</span></p>
                <p className="mt-1 text-muted-foreground">Enrolled {state.mfa.enrolledAt?.slice(0, 10)} · last verified {state.mfa.lastVerifiedAt ? formatRelative(state.mfa.lastVerifiedAt, { lang }) : '—'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value)}
                  placeholder="Test a code"
                  aria-label="Test a code"
                  className="input-dark !h-8 !w-36 font-mono tracking-widest"
                />
                <button type="button" disabled={!testCode} onClick={verifyCode} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">Verify</button>
                <button type="button" onClick={rotate} className="btn-ghost !h-8 !px-3 !text-[11px]"><RefreshCw size={12} className="mr-1.5" />New backup codes</button>
                <button type="button" onClick={turnOff} className="btn-ghost !h-8 !px-3 !text-[11px] text-down">Turn off</button>
              </div>
            </>
          ) : null}

          {freshCodes ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-[11px] font-medium text-emerald-400">Save these now — they are shown once and stored only as hashes.</p>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px]">
                {freshCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <button
                type="button"
                onClick={() => { navigator.clipboard?.writeText(freshCodes.join('\n')); flash('good', 'Copied.'); }}
                className="btn-ghost mt-2 !h-7 !px-2.5 !text-[10px]"
              >
                <Copy size={11} className="mr-1" /> Copy
              </button>
            </div>
          ) : null}

          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {MFA_METHODS.map((m) => (
              <div key={m.id} className="flex items-start gap-2 p-2.5">
                <StatusPill tone={m.status === 'implemented' ? 'good' : m.status === 'client-ready' ? 'warn' : 'muted'}>{m.status}</StatusPill>
                <div>
                  <p className="text-[11px] font-medium">{m.label}</p>
                  <p className="text-[10px] text-muted-foreground">{m.note}</p>
                </div>
              </div>
            ))}
          </div>

          {passkey ? (
            <p className="text-[10px] text-muted-foreground">
              Passkey support in this browser: <span className="font-mono">{passkey.available ? (passkey.platformAuthenticator ? 'available' : 'unknown') : passkey.reason}</span>
              {passkey.available ? ' — registration still needs a server-issued challenge.' : ''}
            </p>
          ) : null}
        </Card>

        {/* Sessions */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Laptop size={15} className="text-primary" /> Sessions &amp; devices
            <span className="text-xs font-normal text-muted-foreground">{sessions.length} active</span>
          </h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 p-2.5">
                <Smartphone size={13} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">
                    {s.device?.label || describeDevice().label}
                    {s.current ? <span className="ml-1.5 text-[9px] text-emerald-400">this device</span> : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    started {formatRelative(s.createdAt, { lang })} · {s.ip || 'address not recorded'}
                  </p>
                </div>
                {!s.current ? (
                  <button type="button" onClick={() => revokeOne(s.id)} className="btn-ghost !h-7 !px-2.5 !text-[10px]">Revoke</button>
                ) : null}
              </div>
            ))}
            {!sessions.length ? <p className="p-3 text-[11px] text-muted-foreground">No active sessions.</p> : null}
          </div>
          <button type="button" onClick={revokeAll} className="btn-ghost !h-8 !px-3 !text-[11px]">
            <Lock size={12} className="mr-1.5" /> Sign out all other devices
          </button>
          <p className="text-[10px] text-muted-foreground">
            Revocation is immediate — a revoked session stops authorising on the next check, not at token expiry.
          </p>
        </Card>
      </div>

      {/* Login history */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Login history</h2>
        {state.history.length ? (
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {state.history.slice(0, 8).map((h) => (
              <div key={h.id} className="flex items-center gap-2 px-3 py-2">
                <StatusPill tone={h.riskLevel === 'high' ? 'bad' : h.riskLevel === 'medium' ? 'warn' : 'good'}>{h.riskLevel}</StatusPill>
                <span className="flex-1 text-[11px]">{h.deviceLabel} · {h.country || 'unknown country'}</span>
                <span className="text-[10px] text-muted-foreground">{formatRelative(h.at, { lang })}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No sign-ins recorded yet. The first one is recorded as a baseline and is never flagged as suspicious.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            const out = recordSignIn(state, { userId: accountKey, userAgent: navigator.userAgent, ip: null, country: profile?.country || region });
            persist(out.state);
            flash(out.risk.level === 'high' ? 'warn' : 'good', `${out.risk.level} risk — ${out.risk.explanation}`);
          }}
          className="btn-ghost !h-8 !px-3 !text-[11px]"
        >
          <Shield size={12} className="mr-1.5" /> Record a sign-in now
        </button>
      </Card>

      {/* Providers (honest) */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Sign-in providers</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUTH_CAPABILITY.filter((i) => /OAuth|SAML|OpenID|Phone|verification|recovery/i.test(i.item)).map((i) => (
            <div key={i.item} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
              <StatusPill tone={i.status === 'implemented' ? 'good' : i.status === 'client-ready' ? 'warn' : 'muted'}>{i.status}</StatusPill>
              <div>
                <p className="text-[11px] font-medium">{i.item}</p>
                <p className="text-[10px] text-muted-foreground">{i.note}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Privacy requests */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Your data</h2>
        <div className="flex flex-wrap gap-2">
          {DSR_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => ask(type)} className="btn-ghost !h-8 !px-3 !text-[11px]">
              {type === 'export' ? <Download size={12} className="mr-1.5" /> : type === 'deletion' ? <Trash2 size={12} className="mr-1.5" /> : null}
              Request {type}
            </button>
          ))}
        </div>
        {state.dsr.length ? (
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {state.dsr.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                <span className="font-medium capitalize">{r.type}</span>
                <StatusPill tone={r.state === 'completed' ? 'good' : 'warn'}>{r.state}</StatusPill>
                <span className="ml-auto text-[10px] text-muted-foreground">due {r.dueAt.slice(0, 10)}</span>
                {r.state !== 'completed' && r.state !== 'rejected' ? (
                  <button type="button" onClick={() => advance(r.id, r.state === 'received' ? 'processing' : 'completed')} className="btn-ghost !h-6 !px-2 !text-[10px]">Advance</button>
                ) : null}
              </div>
            ))}
          </div>
        ) : <p className="text-[11px] text-muted-foreground">No requests yet. Exports include your own data only — never other members&apos;.</p>}
      </Card>

      {/* Section 7 posture */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Shield size={15} className="text-primary" /> Platform security posture
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {scopes.map((g) => (
            <div key={g.key} className="rounded-lg border border-border p-3">
              <p className="text-[11px] font-medium">{g.label} — {g.summary.implemented} of {g.summary.total} implemented</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-primary" style={{ width: `${g.summary.percentImplemented}%` }} />
              </div>
              <div className="mt-2 space-y-0.5">
                {Object.entries(g.summary.byStatus).map(([status, count]) => (
                  <p key={status} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">{SCOPE_STATUS[status]}</span>
                    <span className="font-mono">{count}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Items marked &ldquo;requires a server&rdquo; cannot exist in a static browser app. They are listed with what they need rather than quietly counted as done.
        </p>
      </Card>
    </div>
  );
}
