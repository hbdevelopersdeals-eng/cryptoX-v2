/* Multi-factor authentication, lockout and rate limiting.
 *
 * The TOTP implementation follows RFC 6238 and is verified in the test suite
 * against the RFC's own published test vectors, so "MFA is implemented" is a
 * checkable claim rather than a description.
 *
 * Everything here is pure or Web-Crypto based. What it CANNOT do, and does not
 * pretend to: store a secret server-side, issue a WebAuthn challenge, or send a
 * verification message.
 */

/* ---------------------------------------------------------------------------
 * Base32 (RFC 4648) — the encoding authenticator apps use for a shared secret
 * ------------------------------------------------------------------------ */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  if (!clean) return new Uint8Array(0);
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ---------------------------------------------------------------------------
 * HOTP / TOTP (RFC 4226 / RFC 6238)
 * ------------------------------------------------------------------------ */

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

/**
 * HMAC-based one-time password.
 * `key` is the raw shared secret as bytes — callers holding a base32 secret
 * decode it first, which keeps the RFC test vectors expressible directly.
 */
export async function hotp(key, counter, { digits = 6 } = {}) {
  const lib = subtle();
  if (!lib) throw new Error('Web Crypto is unavailable');
  const cryptoKey = await lib.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key || []),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  // The counter is a big-endian 64-bit integer.
  const message = new Uint8Array(8);
  let remaining = BigInt(Math.max(0, Math.floor(counter)));
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = Number(remaining & 0xFFn);
    remaining >>= 8n;
  }
  const mac = new Uint8Array(await lib.sign('HMAC', cryptoKey, message));
  // Dynamic truncation: the low nibble of the last byte selects the offset.
  const offset = mac[mac.length - 1] & 0x0F;
  const binary = ((mac[offset] & 0x7F) << 24) | ((mac[offset + 1] & 0xFF) << 16)
    | ((mac[offset + 2] & 0xFF) << 8) | (mac[offset + 3] & 0xFF);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Current TOTP for a secret. */
export async function totp(secret, { at = Date.now(), step = 30, digits = 6, t0 = 0 } = {}) {
  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const counter = Math.floor((at / 1000 - t0) / step);
  return hotp(key, counter, { digits });
}

/**
 * Constant-time string comparison.
 * A length-dependent early return leaks how much of a code was correct.
 */
export function timingSafeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a submitted code.
 * `window` accepts one step either side, which is the standard allowance for
 * clock drift; a larger window meaningfully weakens the second factor.
 */
export async function verifyTotp(secret, code, { at = Date.now(), step = 30, digits = 6, window = 1, t0 = 0 } = {}) {
  const submitted = String(code || '').replace(/\s/g, '');
  if (!/^\d+$/.test(submitted) || submitted.length !== digits) {
    return { ok: false, reason: 'malformed' };
  }
  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const counter = Math.floor((at / 1000 - t0) / step);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await hotp(key, counter + offset, { digits });
    if (timingSafeEqual(candidate, submitted)) {
      return { ok: true, drift: offset, reason: 'valid' };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

/** A fresh 160-bit secret, as required by RFC 4226 for SHA-1. */
export function generateSecret(bytes = 20) {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else throw new Error('a CSPRNG is required to generate a secret');
  return base32Encode(buf);
}

/** The otpauth:// URI an authenticator app scans. */
export function provisioningUri({ secret, account, issuer = 'CryptoX', digits = 6, step = 30 }) {
  const label = encodeURIComponent(`${issuer}:${account || ''}`);
  const params = new URLSearchParams({ secret, issuer, digits: String(digits), period: String(step), algorithm: 'SHA1' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ---------------------------------------------------------------------------
 * Backup codes
 * ------------------------------------------------------------------------ */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — unreadable when typed

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(text) {
  const lib = subtle();
  if (!lib) throw new Error('Web Crypto is unavailable');
  return hex(await lib.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Generate backup codes.
 * Returns the plaintext codes ONCE (to show the user) and their hashes (to
 * store). The plaintext is never persisted — the same rule as a password.
 */
export async function generateBackupCodes({ count = 10, groups = 2, groupLength = 5 } = {}) {
  const lib = subtle();
  if (!lib) throw new Error('Web Crypto is unavailable');
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = new Uint8Array(groups * groupLength);
    crypto.getRandomValues(bytes);
    const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
    const code = Array.from({ length: groups }, (_, g) => chars.slice(g * groupLength, (g + 1) * groupLength).join('')).join('-');
    codes.push(code);
  }
  const hashes = await Promise.all(codes.map((c) => sha256(normaliseBackupCode(c))));
  return {
    codes,
    hashes,
    note: 'These codes are shown once. Only their hashes are stored.'
  };
}

/** Case and separator insensitive, so a typed code still matches. */
export const normaliseBackupCode = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');

/**
 * Consume a backup code. Single use: the matching hash is removed, so the same
 * code cannot be replayed.
 */
export async function consumeBackupCode(hashes = [], submitted) {
  const value = normaliseBackupCode(submitted);
  if (!value) return { ok: false, reason: 'empty', remaining: hashes };
  const target = await sha256(value);
  const index = hashes.findIndex((h) => timingSafeEqual(h, target));
  if (index === -1) return { ok: false, reason: 'no-match', remaining: hashes };
  const remaining = hashes.filter((_, i) => i !== index);
  return {
    ok: true,
    remaining,
    remainingCount: remaining.length,
    warning: remaining.length <= 2 ? 'Few backup codes left — generate a new set.' : null
  };
}

/* ---------------------------------------------------------------------------
 * Lockout and brute-force protection
 * ------------------------------------------------------------------------ */

export const LOCKOUT_POLICY = {
  // Escalating lockout: the first few mistakes are free, then the window grows.
  thresholds: [
    { attempts: 3, lockMs: 30 * 1000 },
    { attempts: 5, lockMs: 5 * 60 * 1000 },
    { attempts: 10, lockMs: 60 * 60 * 1000 },
    { attempts: 20, lockMs: 24 * 60 * 60 * 1000 }
  ]
};

export const createLockoutState = (now = Date.now()) => ({ attempts: 0, lockedUntil: 0, firstAttemptAt: now, lastAttemptAt: now });

/** How long the cooldown is after this many failures. */
export function lockDurationFor(attempts) {
  const hit = [...LOCKOUT_POLICY.thresholds].reverse().find((t) => attempts >= t.attempts);
  return hit ? hit.lockMs : 0;
}

export function isLocked(state, now = Date.now()) {
  const locked = state?.lockedUntil || 0;
  if (locked <= now) return { locked: false, retryAfterMs: 0, attempts: state?.attempts || 0 };
  return { locked: true, retryAfterMs: locked - now, attempts: state.attempts };
}

/** Record a failure and apply the escalating cooldown. */
export function recordFailure(state, now = Date.now()) {
  const base = state || createLockoutState(now);
  const attempts = base.attempts + 1;
  const lockMs = lockDurationFor(attempts);
  return {
    ...base,
    attempts,
    lastAttemptAt: now,
    lockedUntil: lockMs ? now + lockMs : 0
  };
}

/** A success clears the counter — but only once the cooldown has elapsed. */
export function recordSuccess(state, now = Date.now()) {
  const check = isLocked(state, now);
  if (check.locked) return { ...state, note: 'success ignored while locked' };
  return createLockoutState(now);
}

/* ---------------------------------------------------------------------------
 * Rate limiting (token bucket)
 * ------------------------------------------------------------------------ */

/**
 * A token bucket per key.
 * Buckets are keyed, so one noisy caller cannot exhaust capacity for everyone;
 * the classic bug is a single global counter that lets one client lock out all.
 */
export class TokenBucket {
  constructor({ capacity = 10, refillPerSecond = 1, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.buckets = new Map();
  }

  _bucket(key) {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, { tokens: this.capacity, updatedAt: this.now() });
    }
    return this.buckets.get(key);
  }

  _refill(bucket) {
    const now = this.now();
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updatedAt = now;
  }

  /** Try to take `cost` tokens. Never goes negative. */
  take(key, cost = 1) {
    const bucket = this._bucket(key);
    this._refill(bucket);
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    const deficit = cost - bucket.tokens;
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: Math.ceil((deficit / this.refillPerSecond) * 1000)
    };
  }

  reset(key) { this.buckets.delete(key); }
  size() { return this.buckets.size; }
}

/* ---------------------------------------------------------------------------
 * Password reset
 * ------------------------------------------------------------------------ */

export const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Issue a reset token. Only the hash is storable; the raw token goes in the
 * email. A single-use flag is carried so replay is detectable.
 */
export async function issueResetToken({ userId, now = Date.now(), ttlMs = RESET_TTL_MS } = {}) {
  if (!userId) return { ok: false, reason: 'no-user' };
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = hex(bytes);
  return {
    ok: true,
    token,
    record: {
      userId,
      tokenHash: await sha256(token),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      usedAt: null
    }
  };
}

export async function verifyResetToken(record, token, now = Date.now()) {
  if (!record || !token) return { ok: false, reason: 'missing' };
  if (record.usedAt) return { ok: false, reason: 'already-used' };
  if (now > new Date(record.expiresAt).getTime()) return { ok: false, reason: 'expired' };
  const hash = await sha256(token);
  return timingSafeEqual(hash, record.tokenHash) ? { ok: true, reason: 'valid' } : { ok: false, reason: 'mismatch' };
}

/* ---------------------------------------------------------------------------
 * WebAuthn / passkeys — capability only
 * ------------------------------------------------------------------------ */

/**
 * What the browser can do. Registration and assertion need a server to issue
 * and verify the challenge; without one, only the client half is honest.
 */
export async function webauthnAvailable() {
  const hasApi = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  if (!hasApi) return { available: false, reason: 'no-public-key-credential' };
  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      const platform = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return { available: true, platformAuthenticator: platform, reason: 'ok' };
    }
    return { available: true, platformAuthenticator: null, reason: 'unknown-platform-authenticator' };
  } catch {
    return { available: true, platformAuthenticator: null, reason: 'probe-failed' };
  }
}

/** The public-key options a server would sign. Built here so the shape is explicit. */
export function buildRegistrationOptions({ userId, username, displayName, challenge, rpId, rpName = 'CryptoX' } = {}) {
  if (!challenge) return { ok: false, reason: 'server-challenge-required' };
  return {
    ok: true,
    options: {
      challenge,
      rp: { id: rpId, name: rpName },
      user: { id: new TextEncoder().encode(String(userId || '')), name: username || '', displayName: displayName || username || '' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }  // RS256
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      timeout: 60000,
      attestation: 'none'
    }
  };
}

export const MFA_METHODS = [
  { id: 'totp', label: 'Authenticator app', status: 'implemented', note: 'RFC 6238, verified against the published test vectors.' },
  { id: 'backup_codes', label: 'Backup codes', status: 'implemented', note: 'Single-use, hashed at rest.' },
  { id: 'passkey', label: 'Passkey / security key', status: 'client-ready', note: 'Client flow built; needs a server to issue and verify challenges.' },
  { id: 'sms', label: 'SMS code', status: 'server-only', note: 'Requires a paid gateway; SMS is also phishable.' },
  { id: 'email_code', label: 'Email code', status: 'client-ready', note: 'Composition is built; delivery needs a mail provider.' }
];
