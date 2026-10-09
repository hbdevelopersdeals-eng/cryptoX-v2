import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { lsGet, lsSet, lsRemove } from './storage.js';
import { reportError } from './telemetry.js';
import { supabase, supabaseConfigured } from './supabase.js';

/* ------------------------------------------------------------------ *
 * Identity layer.
 *
 * Two modes, chosen automatically at boot:
 *
 *   'supabase'  — production mode. Accounts live in Supabase Auth; the
 *                 database enforces row-level security per user. Used
 *                 whenever VITE_SUPABASE_URL + a publishable key exist.
 *   'demo'      — fallback used when no backend is configured (local
 *                 preview, CI). Accounts are local to this browser only.
 *
 * Demo-mode hardening (still in force):
 *  - PBKDF2-SHA256, per-user random salt, 210k iterations, constant-time compare.
 *  - Brute-force lockout, absolute + idle session expiry, random hashed codes.
 * ------------------------------------------------------------------ */

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const USERS_KEY = 'cx_users_v2';
const SESSION_KEY = 'cx_session_v2';
const LEGACY_USERS_KEY = 'cx_users';
const LEGACY_SESSION_KEY = 'cx_session';

export const SESSION_HOURS = 12;
export const IDLE_MINUTES = 30;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const PBKDF2_ITERATIONS = 210000;

export const AUTH_MODE = supabaseConfigured ? 'supabase' : 'demo';

/* ---------------- crypto helpers (demo mode; exported for tests) ---------------- */

export function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable in this environment');
  const enc = new TextEncoder();
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iterations);
  return { alg: 'PBKDF2-SHA256', iter: iterations, salt: bytesToB64(salt), hash: bytesToB64(hash) };
}

export async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const salt = b64ToBytes(record.salt);
  const expected = b64ToBytes(record.hash);
  const actual = await pbkdf2(password, salt, record.iter || PBKDF2_ITERATIONS);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/* ---------------- input validation ---------------- */

export function validateEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return { ok: false, error: 'Please enter a valid email address' };
  if (e.length > 254) return { ok: false, error: 'Email address is too long' };
  return { ok: true, email: e };
}

const WEAK = new Set(['password', 'password1', '12345678', 'qwerty123', 'letmein1', 'iloveyou1', 'admin123', 'cryptox123']);

export function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  if (p.length > 128) return { ok: false, error: 'Password is too long (max 128 characters)' };
  if (!/[A-Za-z]/.test(p)) return { ok: false, error: 'Password must include at least one letter' };
  if (!/\d/.test(p)) return { ok: false, error: 'Password must include at least one number' };
  if (WEAK.has(p.toLowerCase())) return { ok: false, error: 'That password is too common — choose another' };
  return { ok: true };
}

/* ---------------- local storage helpers (demo mode) ---------------- */

function readUsers() {
  const users = lsGet(USERS_KEY, []);
  return Array.isArray(users) ? users : [];
}
function writeUsers(users) {
  lsSet(USERS_KEY, users);
}
function findUser(users, email) {
  return users.find((u) => u.email === email);
}

function sessionIsValid(s) {
  if (!s || !s.email) return false;
  const now = Date.now();
  if (!s.exp || now > s.exp) return false;
  if (!s.last || now - s.last > IDLE_MINUTES * 60 * 1000) return false;
  return true;
}

/* Supabase session -> the shape the app already expects. */
function mapSupabaseSession(s) {
  if (!s || !s.user) return null;
  return {
    id: s.user.id,
    email: s.user.email,
    provider: 'supabase',
    at: Date.now(),
    exp: s.expires_at ? s.expires_at * 1000 : null,
    last: Date.now()
  };
}

/* ---------------- provider ---------------- */

export function AuthProvider({ children }) {
  const mode = AUTH_MODE;
  const [session, setSession] = useState(() => {
    if (mode === 'supabase') return null; // restored asynchronously below
    const s = lsGet(SESSION_KEY, null) || lsGet(LEGACY_SESSION_KEY, null);
    return sessionIsValid(s) ? normalizeSession(s) : null;
  });
  const [inbox, setInbox] = useState(null); // demo delivery only
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(mode !== 'supabase');
  const lastTouch = useRef(0);
  const pending = useRef(new Map());

  function normalizeSession(s) {
    const now = Date.now();
    return {
      email: s.email,
      id: s.id || null,
      provider: s.provider || 'local',
      at: s.at || now,
      exp: s.exp || now + SESSION_HOURS * 3600 * 1000,
      last: now
    };
  }

  function persistSession(s) {
    setSession(s);
    if (s) lsSet(SESSION_KEY, s);
    else lsRemove(SESSION_KEY);
    lsRemove(LEGACY_SESSION_KEY);
  }

  /* ---- Supabase session restore + change subscription ---- */
  useEffect(() => {
    if (mode !== 'supabase' || !supabase) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (alive) setSession(mapSupabaseSession(data?.session));
      } catch (err) {
        reportError(err, { kind: 'auth.getSession' });
      } finally {
        if (alive) setAuthReady(true);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(mapSupabaseSession(s));
      setAuthReady(true);
    });
    return () => {
      alive = false;
      try { sub?.subscription?.unsubscribe(); } catch { /* noop */ }
    };
  }, [mode]);

  /* ---- legacy plaintext migration (demo mode only) ---- */
  useEffect(() => {
    if (mode !== 'demo') return;
    let cancelled = false;
    (async () => {
      const legacy = lsGet(LEGACY_USERS_KEY, null);
      if (!Array.isArray(legacy) || !legacy.length) {
        lsRemove(LEGACY_SESSION_KEY);
        return;
      }
      try {
        const users = readUsers();
        for (const old of legacy) {
          if (!old?.email) continue;
          const email = String(old.email).toLowerCase();
          if (findUser(users, email)) continue;
          const rec = await hashPassword(String(old.password ?? randomHex(8)));
          if (cancelled) return;
          users.push({ email, ...rec, verified: true, createdAt: Date.now(), migratedFromV1: true });
        }
        if (!cancelled) {
          writeUsers(users);
          lsRemove(LEGACY_USERS_KEY);
        }
      } catch (err) {
        reportError(err, { kind: 'auth.migration' });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ---- demo session lifetime enforcement ---- */
  useEffect(() => {
    if (mode !== 'demo') return;
    const check = () => {
      const stored = lsGet(SESSION_KEY, null);
      if (stored && !sessionIsValid(stored)) persistSession(null);
    };
    const iv = window.setInterval(check, 30000);
    const touch = () => {
      const now = Date.now();
      if (now - lastTouch.current < 60000) return;
      lastTouch.current = now;
      const stored = lsGet(SESSION_KEY, null);
      if (stored) lsSet(SESSION_KEY, { ...stored, last: now });
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ---- demo verification codes ---- */

  async function issueCode(email) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const rec = await hashPassword(code, 60000);
    pending.current.set(email, { ...rec, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
    setInbox({ email, code, expiresAt: Date.now() + 10 * 60 * 1000 });
    return code;
  }

  async function checkCode(email, code) {
    const rec = pending.current.get(email);
    if (!rec) return { ok: false, error: 'No pending verification — request a new code' };
    if (Date.now() > rec.expiresAt) {
      pending.current.delete(email);
      return { ok: false, error: 'That code expired — request a new one' };
    }
    if (rec.attempts >= 5) {
      pending.current.delete(email);
      return { ok: false, error: 'Too many attempts — request a new code' };
    }
    const ok = await verifyPassword(String(code).trim(), rec);
    if (!ok) {
      rec.attempts += 1;
      return { ok: false, error: 'Incorrect code' };
    }
    pending.current.delete(email);
    return { ok: true };
  }

  /* ---------------- public API ---------------- */

  const register = async (email, password) => {
    const v = validateEmail(email);
    if (!v.ok) return v;
    const pv = validatePassword(password);
    if (!pv.ok) return pv;

    setBusy(true);
    try {
      if (mode === 'supabase') {
        const { data, error } = await supabase.auth.signUp({
          email: v.email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/#/` }
        });
        if (error) return { ok: false, error: error.message };
        if (data?.session) return { ok: true };
        return { ok: true, needVerify: true, delivery: 'email', email: v.email };
      }

      const users = readUsers();
      if (findUser(users, v.email)) return { ok: false, error: 'An account with that email already exists' };
      const rec = await hashPassword(password);
      users.push({ email: v.email, ...rec, verified: false, createdAt: Date.now(), lastLoginAt: null, failed: 0, lockedUntil: 0 });
      writeUsers(users);
      await issueCode(v.email);
      return { ok: true, needVerify: true, delivery: 'demo-inbox', email: v.email };
    } catch (err) {
      reportError(err, { kind: 'auth.register' });
      return { ok: false, error: 'Could not create the account. Please try again.' };
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async (email, code) => {
    const v = validateEmail(email);
    if (!v.ok) return v;
    if (mode === 'supabase') {
      return { ok: false, error: 'Confirm your address using the link in the email we sent.' };
    }
    setBusy(true);
    try {
      const res = await checkCode(v.email, code);
      if (!res.ok) return res;
      const users = readUsers();
      const idx = users.findIndex((u) => u.email === v.email);
      if (idx === -1) return { ok: false, error: 'Account not found' };
      users[idx] = { ...users[idx], verified: true, verifiedAt: Date.now() };
      writeUsers(users);
      persistSession(normalizeSession({ email: v.email, at: Date.now() }));
      setInbox(null);
      return { ok: true };
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async (email) => {
    const v = validateEmail(email);
    if (!v.ok) return v;
    if (mode === 'supabase') {
      setBusy(true);
      try {
        const { error } = await supabase.auth.resend({ type: 'signup', email: v.email, options: { emailRedirectTo: `${window.location.origin}/#/` } });
        if (error) return { ok: false, error: error.message };
        return { ok: true, delivery: 'email' };
      } finally {
        setBusy(false);
      }
    }
    const code = await issueCode(v.email);
    return { ok: true, code, delivery: 'demo-inbox' };
  };

  const login = async (email, password) => {
    const v = validateEmail(email);
    if (!v.ok) return v;

    setBusy(true);
    try {
      if (mode === 'supabase') {
        const { error } = await supabase.auth.signInWithPassword({ email: v.email, password });
        if (!error) return { ok: true };
        const unconfirmed = /confirm/i.test(error.message);
        return {
          ok: false,
          needVerify: unconfirmed,
          error: unconfirmed
            ? 'This email is not confirmed yet — open the confirmation link we sent you.'
            : /invalid/i.test(error.message)
              ? 'Invalid email or password'
              : error.message
        };
      }

      const users = readUsers();
      let user = findUser(users, v.email);

      if (!user) {
        const legacy = lsGet(LEGACY_USERS_KEY, []);
        const old = Array.isArray(legacy) ? legacy.find((u) => String(u.email).toLowerCase() === v.email) : null;
        if (old && String(old.password) === String(password)) {
          const rec = await hashPassword(password);
          user = { email: v.email, ...rec, verified: true, createdAt: Date.now(), failed: 0, lockedUntil: 0, migratedFromV1: true };
          users.push(user);
          writeUsers(users);
        }
      }

      if (!user) return { ok: false, error: 'Invalid email or password' };
      if (user.lockedUntil && Date.now() < user.lockedUntil) {
        const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
        return { ok: false, error: `Too many failed attempts — try again in ${mins} minute${mins === 1 ? '' : 's'}` };
      }

      const ok = await verifyPassword(password, user);
      const idx = users.findIndex((u) => u.email === v.email);
      if (!ok) {
        if (idx !== -1) {
          const failed = (users[idx].failed || 0) + 1;
          const locked = failed >= MAX_FAILED_ATTEMPTS;
          users[idx] = {
            ...users[idx],
            failed: locked ? 0 : failed,
            lockedUntil: locked ? Date.now() + LOCK_MINUTES * 60000 : users[idx].lockedUntil || 0
          };
          writeUsers(users);
        }
        return { ok: false, error: 'Invalid email or password' };
      }

      if (idx !== -1) {
        users[idx] = { ...users[idx], failed: 0, lockedUntil: 0, lastLoginAt: Date.now() };
        writeUsers(users);
      }

      if (user.verified === false) {
        await issueCode(v.email);
        return { ok: true, needVerify: true, delivery: 'demo-inbox', email: v.email };
      }

      persistSession(normalizeSession({ email: v.email, at: Date.now() }));
      return { ok: true };
    } catch (err) {
      reportError(err, { kind: 'auth.login' });
      return { ok: false, error: 'Sign-in failed. Please try again.' };
    } finally {
      setBusy(false);
    }
  };

  /* Password recovery by email (Supabase mode). */
  const resetPassword = async (email) => {
    const v = validateEmail(email);
    if (!v.ok) return v;
    if (mode !== 'supabase') return { ok: true, demo: true };
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(v.email, {
        redirectTo: `${window.location.origin}/#/reset-password`
      });
      // Always report success: never reveal whether an address is registered.
      if (error) reportError(error, { kind: 'auth.resetPassword' });
      return { ok: true };
    } finally {
      setBusy(false);
    }
  };

  /* Set a new password for the signed-in user (Supabase mode). */
  const updatePassword = async (nextPassword) => {
    const pv = validatePassword(nextPassword);
    if (!pv.ok) return pv;
    if (mode !== 'supabase') return { ok: false, error: 'Not available in demo mode' };
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: nextPassword });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (currentPassword, nextPassword) => {
    const pv = validatePassword(nextPassword);
    if (!pv.ok) return pv;
    if (mode === 'supabase') {
      if (!session) return { ok: false, error: 'Not signed in' };
      return updatePassword(nextPassword);
    }
    if (!session?.email) return { ok: false, error: 'Not signed in' };
    const users = readUsers();
    const idx = users.findIndex((u) => u.email === session.email);
    if (idx === -1) return { ok: false, error: 'Account not found' };
    const ok = await verifyPassword(currentPassword, users[idx]);
    if (!ok) return { ok: false, error: 'Current password is incorrect' };
    const rec = await hashPassword(nextPassword);
    users[idx] = { ...users[idx], ...rec, passwordChangedAt: Date.now() };
    writeUsers(users);
    return { ok: true };
  };

  /* Demo-only shortcut; never presented as real OAuth. */
  const oauthLogin = (email = 'demo@cryptox.app') => {
    if (mode === 'supabase') return { ok: false, error: 'Google sign-in is not configured for this deployment' };
    const v = validateEmail(email);
    const addr = v.ok ? v.email : 'demo@cryptox.app';
    const users = readUsers();
    if (!findUser(users, addr)) {
      users.push({ email: addr, alg: 'none', verified: true, createdAt: Date.now(), demoOauth: true, failed: 0, lockedUntil: 0 });
      writeUsers(users);
    }
    persistSession(normalizeSession({ email: addr, at: Date.now() }));
    return { ok: true, demo: true };
  };

  const logout = async () => {
    if (mode === 'supabase' && supabase) {
      try { await supabase.auth.signOut(); } catch (err) { reportError(err, { kind: 'auth.signOut' }); }
    }
    persistSession(null);
  };

  const value = useMemo(
    () => ({
      session,
      mode,
      authReady,
      register,
      login,
      verifyEmail,
      resendCode,
      resetPassword,
      updatePassword,
      changePassword,
      oauthLogin,
      logout,
      busy,
      inbox,
      dismissInbox: () => setInbox(null)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, mode, authReady, busy, inbox]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function RequireAuth({ children }) {
  const { session, authReady } = useAuth();
  const loc = useLocation();
  if (!authReady) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Checking your session…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}

export function GuestOnly({ children }) {
  const { session, authReady } = useAuth();
  if (!authReady) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Checking your session…
      </div>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return children;
}
