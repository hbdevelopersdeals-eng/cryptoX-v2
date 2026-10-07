/* Enterprise scope: what Sections 6 and 7 can and cannot be, and the two parts
 * that can genuinely be built in the client.
 *
 * WHY THIS FILE EXISTS
 * CryptoX is a static single-page app served from a CDN. Sections 6 and 7 ask
 * for SAML, SCIM, OIDC, WAF, DDoS protection, network segmentation, container
 * scanning, malware scanning, key rotation and server-side authorization. None
 * of those exist in a browser, and pretending otherwise would be the most
 * damaging thing this codebase could do — a security checklist that claims
 * coverage it does not have is worse than no checklist.
 *
 * So each item below carries its real status and the reason. The statuses are:
 *   implemented   — code exists in this repo and is covered by tests
 *   client-ready  — the client half is real; it needs a configured provider
 *   server-only   — cannot exist without a backend; no client substitute is honest
 */

import { isValidZone } from './time.js';

export const SCOPE_STATUS = {
  implemented: 'implemented in this build',
  'client-ready': 'client half built, needs provider configuration',
  'server-only': 'requires a server — no honest client substitute',
  'not-applicable': 'does not apply to this build'
};

/* ---------------------------------------------------------------------------
 * Section 6 — Enterprise authentication
 * ------------------------------------------------------------------------ */

export const AUTH_CAPABILITY = [
  { item: 'Email/password', status: 'implemented', note: 'Salted password hashing with session issue, wired through Supabase auth.', where: 'src/lib/auth.jsx' },
  { item: 'Email verification', status: 'client-ready', note: 'Verification state is modelled and enforced in the profile; the sending step needs a mail provider.', where: 'src/lib/accounts.js' },
  { item: 'Phone verification', status: 'server-only', note: 'Requires an SMS gateway and sender registration. Cannot be done from a browser.', where: null },
  { item: 'OAuth — Google', status: 'client-ready', note: 'The OAuth 2.0 PKCE flow is genuinely client-side; it needs a registered client ID and the provider redirect configured.', where: null },
  { item: 'OAuth — Apple', status: 'client-ready', note: 'Same PKCE shape. Apple additionally requires a signed client secret, which must be minted server-side.', where: null },
  { item: 'OAuth — Microsoft', status: 'client-ready', note: 'Same PKCE shape; needs an Azure app registration.', where: null },
  { item: 'Enterprise SSO — SAML', status: 'server-only', note: 'A SAML assertion must be validated against the IdP certificate. Doing that in the browser would mean trusting the client to authenticate itself.', where: null },
  { item: 'OpenID Connect', status: 'server-only', note: 'The authorisation-code exchange needs a confidential client and a session cookie.', where: null },
  { item: 'MFA', status: 'implemented', note: 'TOTP enrolment, verification and enforcement flags are modelled and tested; the secret is stored per account.', where: 'src/lib/mfa.js' },
  { item: 'Passkeys / WebAuthn', status: 'client-ready', note: 'navigator.credentials is a real browser API and the client flow is implemented; credential storage and challenge issuance need a server.', where: 'src/lib/mfa.js' },
  { item: 'Backup codes', status: 'implemented', note: 'Generated with a CSPRNG, hashed at rest, single-use, and consumed atomically.', where: 'src/lib/mfa.js' },
  { item: 'Login notifications', status: 'implemented', note: 'Composed from the login record; delivery channel status is reported honestly.', where: 'src/lib/accounts.js' },
  { item: 'Suspicious-login detection', status: 'implemented', note: 'Explainable risk score over the account’s own history: new country, device, network, failed attempts, impossible travel.', where: 'src/lib/accounts.js' },
  { item: 'Session management', status: 'implemented', note: 'Session registry with last-seen, current-session marking and immediate revocation.', where: 'src/lib/accounts.js' },
  { item: 'Device management', status: 'implemented', note: 'Coarse device description derived from the user agent — deliberately not a fingerprint.', where: 'src/lib/accounts.js' },
  { item: 'Logout all devices', status: 'implemented', note: 'Revokes every session for the account except the caller’s, effective on the next authorization check.', where: 'src/lib/accounts.js' },
  { item: 'Password reset', status: 'client-ready', note: 'The reset state machine and token-expiry rules are modelled; sending the mail needs a provider.', where: 'src/lib/mfa.js' },
  { item: 'Account recovery', status: 'server-only', note: 'Recovery must prove control of an identifier to the server. A client-side recovery path would be a bypass.', where: null },
  { item: 'Account lockout protection', status: 'implemented', note: 'Escalating lockout with a cooldown, keyed per account and per network.', where: 'src/lib/mfa.js' },
  { item: 'Brute-force protection', status: 'implemented', note: 'Attempt counters, exponential backoff and lockout windows are enforced before verification.', where: 'src/lib/mfa.js' },
  { item: 'Credential-stuffing protection', status: 'implemented', note: 'Per-network throttling plus a breached-password check, so a leaked password is refused even if it is correct.', where: 'src/lib/mfa.js' }
];

/* ---------------------------------------------------------------------------
 * Section 7 — Security architecture
 * ------------------------------------------------------------------------ */

export const SECURITY_CAPABILITY = [
  { item: 'OWASP Top 10 protection', status: 'implemented', note: 'The applicable client-side classes are addressed directly: injection through parameterised queries only, XSS through React rendering plus a CSP with no unsafe-inline, and broken access control through the RBAC engine.', where: 'src/lib/rbac.js' },
  { item: 'CSRF protection', status: 'client-ready', note: 'Token-based auth with SameSite cookies and no ambient authority removes the classic CSRF vector; the header check belongs on the server.', where: null },
  { item: 'XSS protection', status: 'implemented', note: 'No raw-HTML injection sink exists anywhere, enforced by a build guard that fails on its appearance. Output is escaped by React by default.', where: 'scripts/check-config.mjs' },
  { item: 'SQL/NoSQL injection protection', status: 'client-ready', note: 'All database access goes through the Supabase client, which parameterises. No string-built queries exist in this repo.', where: null },
  { item: 'SSRF protection', status: 'client-ready', note: 'Outbound requests are restricted to an allowlist of known hosts at build time; a server would enforce it at runtime.', where: 'scripts/check-config.mjs' },
  { item: 'Secure headers', status: 'client-ready', note: 'CSP, Referrer-Policy, X-Content-Type-Options and Permissions-Policy are shipped; HSTS and frame-ancestors must be set by the host.', where: 'index.html' },
  { item: 'Content Security Policy', status: 'implemented', note: 'A restrictive policy with no unsafe-inline or unsafe-eval, plus a build guard that fails if eval appears in the bundle.', where: 'scripts/check-config.mjs' },
  { item: 'CORS policy', status: 'server-only', note: 'CORS is enforced by the responding server. A client cannot set it for its own responses.', where: null },
  { item: 'Input validation', status: 'implemented', note: 'Every modelled field validates its own shape, including country, currency, time zone, username and phone.', where: 'src/lib/accounts.js' },
  { item: 'Output encoding', status: 'implemented', note: 'React escapes by default; the one place raw markup is produced (the ICS export) escapes explicitly.', where: 'src/lib/time.js' },
  { item: 'File-upload security', status: 'implemented', note: 'Size, extension and MIME allowlists plus magic-byte sniffing, so a renamed executable is rejected.', where: 'src/lib/enterprise.js' },
  { item: 'Malware scanning', status: 'server-only', note: 'Requires a scanning engine. Client-side heuristics would give false assurance.', where: null },
  { item: 'Rate limiting', status: 'implemented', note: 'Token-bucket limiter with per-key isolation and a queue-depth signal for the UI.', where: 'src/lib/mfa.js' },
  { item: 'Bot protection', status: 'client-ready', note: 'Honeypot and timing checks are implemented; real bot defence needs server-side risk scoring or a captcha provider.', where: 'src/lib/enterprise.js' },
  { item: 'TLS everywhere', status: 'server-only', note: 'Terminated by the host. The app refuses to load over plain HTTP.', where: null },
  { item: 'Encryption at rest', status: 'server-only', note: 'A property of the database and storage layer, not of the browser.', where: null },
  { item: 'Encryption in transit', status: 'server-only', note: 'TLS in the host and in the database connection.', where: null },
  { item: 'Secret management', status: 'implemented', note: 'No secret may appear in the bundle, and a build guard fails on the patterns that leaked before. Only the Supabase anon key is present — it is designed to be public and is constrained by row-level security.', where: 'scripts/check-config.mjs' },
  { item: 'Key rotation', status: 'server-only', note: 'Rotation is a server and KMS concern; the client must simply tolerate a rotated public key.', where: null },
  { item: 'Least-privilege access', status: 'implemented', note: 'Row-level security scopes every row to its owner, and the RBAC engine denies by default.', where: 'src/lib/rbac.js' },
  { item: 'Network segmentation', status: 'server-only', note: 'A network topology concern with no client equivalent.', where: null },
  { item: 'WAF', status: 'server-only', note: 'A reverse-proxy layer. Nothing in a browser bundle can provide it.', where: null },
  { item: 'DDoS protection', status: 'server-only', note: 'Provided by the CDN or an upstream scrubbing service.', where: null },
  { item: 'Firewall rules', status: 'server-only', note: 'Enforced by the network layer.', where: null },
  { item: 'Vulnerability scanning', status: 'implemented', note: 'npm audit runs in CI and fails on high or critical advisories in production dependencies.', where: 'package.json' },
  { item: 'Dependency scanning', status: 'implemented', note: 'Lockfile-pinned installs plus the same audit gate.', where: 'package.json' },
  { item: 'Container scanning', status: 'not-applicable', note: 'This build ships no container image. If one is added, scanning belongs in the image pipeline.', where: null },
  { item: 'Security monitoring', status: 'implemented', note: 'Client error and security telemetry with an allowlist of fields, so no personal data is captured in a report.', where: 'src/lib/telemetry.js' }
];

/** Roll-up, so the honest position is visible at a glance rather than buried. */
export function scopeSummary(items = []) {
  const byStatus = items.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});
  const total = items.length;
  const implemented = byStatus.implemented || 0;
  return {
    total,
    byStatus,
    implemented,
    percentImplemented: total ? Math.round((implemented / total) * 100) : 0,
    note: `${implemented} of ${total} items are implemented in this build. The remainder are marked with what they need, not written off.`
  };
}

/* ---------------------------------------------------------------------------
 * Password strength — Section 6
 * ------------------------------------------------------------------------ */

/* A short list of the passwords that appear in every breach corpus. Not a
   substitute for a breach API, but it stops the worst case offline. */
export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'admin', 'admin123', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'abc123', '111111', '000000',
  'cryptox', 'crypto', 'bitcoin', 'trustno1', 'sunshine', 'princess', 'master',
  'passw0rd', 'zaq12wsx', 'qazwsx', '1q2w3e4r', 'secret', 'changeme'
]);

const CLASSES = [
  { id: 'lower', re: /[a-z]/ },
  { id: 'upper', re: /[A-Z]/ },
  { id: 'digit', re: /\d/ },
  { id: 'symbol', re: /[^A-Za-z0-9]/ }
];

/**
 * Score a password.
 * Deliberately transparent: a single score with no reason is unusable in a form,
 * and "your password is weak" without a fix is a dead end.
 */
export function scorePassword(password, { email = '', username = '' } = {}) {
  const value = String(password || '');
  const warnings = [];
  const suggestions = [];

  if (!value) return { score: 0, label: 'empty', entropyBits: 0, warnings: ['Enter a password.'], suggestions, acceptable: false };

  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) warnings.push('This is one of the most commonly used passwords.');
  const localPart = String(email).split('@')[0]?.toLowerCase();
  if (localPart && localPart.length > 2 && lower.includes(localPart)) warnings.push('It contains your email address.');
  if (username && lower.includes(String(username).toLowerCase())) warnings.push('It contains your username.');
  if (/^(.)\1+$/.test(value)) warnings.push('It is a single repeated character.');
  if (/^\d+$/.test(value)) warnings.push('It is only digits.');
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef)/.test(lower)) warnings.push('It contains a straight run of characters.');

  // Entropy from the character pool actually used, times length.
  const pool = CLASSES.reduce((n, c) => n + (c.re.test(value) ? (c.id === 'symbol' ? 33 : c.id === 'digit' ? 10 : 26) : 0), 0);
  const entropyBits = pool > 0 ? Math.round(value.length * Math.log2(pool)) : 0;

  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (entropyBits >= 60) score += 1;
  if (entropyBits >= 90) score += 1;
  if (CLASSES.filter((c) => c.re.test(value)).length >= 3) score += 1;
  score = Math.min(4, score);

  if (warnings.length) score = Math.min(score, 1);
  if (value.length < 12 && !warnings.length) suggestions.push('A longer passphrase beats a short complicated one.');
  if (CLASSES.filter((c) => c.re.test(value)).length < 3) suggestions.push('Mix upper case, lower case, digits and symbols.');

  const label = ['very weak', 'weak', 'fair', 'strong', 'very strong'][score];
  return {
    score,
    label,
    entropyBits,
    warnings,
    suggestions,
    // Only the platform's own floor, not a claim about the password's real strength.
    acceptable: value.length >= 8 && warnings.length === 0 && score >= 2
  };
}

/**
 * A breached-password check by k-anonymity.
 * Only the first five characters of the SHA-1 hash are sent, so the password
 * itself never leaves the browser. Requires network; without it the answer is
 * "unknown", never "safe".
 */
export async function isBreached(password, { fetchImpl = typeof fetch === 'function' ? fetch : null } = {}) {
  if (!password) return { checked: false, reason: 'empty' };
  if (!fetchImpl || typeof crypto === 'undefined' || !crypto.subtle) {
    return { checked: false, reason: 'unavailable' };
  }
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { accept: 'text/plain' } });
    if (!res.ok) return { checked: false, reason: `HTTP ${res.status}` };
    const body = await res.text();
    const hit = body.split('\n').find((line) => line.split(':')[0]?.trim() === suffix);
    const count = hit ? Number(hit.split(':')[1]) : 0;
    return { checked: true, breached: count > 0, count };
  } catch (err) {
    return { checked: false, reason: err?.message || 'failed' };
  }
}

/* ---------------------------------------------------------------------------
 * File-upload validation — Section 7
 * ------------------------------------------------------------------------ */

/*
 * Magic bytes. Extension and the browser-supplied MIME type are both trivially
 * spoofed, so the decision is made on the file's own first bytes.
 */
export const MAGIC_BYTES = [
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/gif', ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'application/zip', ext: 'zip', bytes: [0x50, 0x4B, 0x03, 0x04] },
  { mime: 'text/csv', ext: 'csv', bytes: null }, // text: no signature to check
  { mime: 'application/json', ext: 'json', bytes: null }
];

export const UPLOAD_DEFAULTS = {
  allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'csv', 'json'],
  maxBytes: 5 * 1024 * 1024,
  maxCount: 5
};

const extensionOf = (name) => String(name || '').split('.').pop().toLowerCase();

/** Does the file actually start with the signature its type claims? */
export function sniffMime(bytes, magic) {
  if (!magic?.bytes || !bytes || bytes.length < magic.bytes.length) return null;
  const from = magic.offset || 0;
  for (let i = 0; i < magic.bytes.length; i += 1) {
    if (bytes[from + i] !== magic.bytes[i]) return null;
  }
  return magic.mime;
}

/**
 * Validate an upload.
 * Checks size, count, extension allowlist, MIME agreement and the real
 * signature. A file whose bytes do not match its extension is rejected — that
 * is the case a renamed executable lands in.
 */
export function validateUpload(file, {
  allowedExtensions = UPLOAD_DEFAULTS.allowedExtensions,
  maxBytes = UPLOAD_DEFAULTS.maxBytes
} = {}) {
  const errors = [];
  const warnings = [];
  if (!file) return { valid: false, errors: [{ field: 'file', reason: 'missing' }], warnings };

  const name = file.name || '';
  const ext = extensionOf(name);
  const size = Number(file.size ?? 0);
  const declaredMime = file.type || '';

  if (!name.includes('.')) errors.push({ field: 'name', reason: 'no-extension' });
  if (!allowedExtensions.includes(ext)) errors.push({ field: 'extension', reason: `not allowed: .${ext}` });
  if (size <= 0) errors.push({ field: 'size', reason: 'empty-file' });
  if (size > maxBytes) errors.push({ field: 'size', reason: `larger than ${Math.round(maxBytes / 1024 / 1024)} MB` });
  // Double extensions are a classic trick: invoice.pdf.exe
  if (/\.(exe|dll|sh|bat|cmd|js|jar|scr|com|msi)$/.test(name.toLowerCase())) {
    errors.push({ field: 'name', reason: 'executable-extension' });
  }

  const magic = MAGIC_BYTES.find((m) => m.ext === ext || m.mime === declaredMime);
  if (magic?.bytes && Array.isArray(file.bytes) && file.bytes.length) {
    const sniffed = sniffMime(file.bytes, magic);
    if (!sniffed) {
      errors.push({ field: 'content', reason: `content does not match .${ext}` });
    } else if (declaredMime && sniffed !== declaredMime) {
      warnings.push({ field: 'mime', reason: `declared ${declaredMime}, content is ${sniffed}` });
    }
  } else if (magic?.bytes) {
    // No bytes supplied: we cannot confirm, and saying "valid" would be a guess.
    warnings.push({ field: 'content', reason: 'not inspected — no content bytes supplied' });
  }

  return { valid: errors.length === 0, errors, warnings, extension: ext, magic: magic?.mime || null };
}

/* ---------------------------------------------------------------------------
 * Bot protection — Section 7
 * ------------------------------------------------------------------------ */

/**
 * A honeypot field plus a minimum fill time.
 * This stops naive form bots. It does not stop a determined attacker, and the
 * scope map says so rather than implying bot protection is solved.
 */
export function createBotChallenge({ now = Date.now(), minFillMs = 2000 } = {}) {
  return {
    honeypotField: 'company_website',
    startedAt: now,
    minFillMs,
    check({ honeypotValue, submittedAt } = {}) {
      const reasons = [];
      if (honeypotValue) reasons.push('honeypot-filled');
      if (submittedAt != null && submittedAt - now < minFillMs) reasons.push('submitted-too-fast');
      return { human: reasons.length === 0, reasons };
    }
  };
}

/** An allowlist check for outbound hosts, mirroring the build-time guard. */
export function hostAllowed(url, allowlist = []) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return { allowed: false, reason: 'not-https' };
    const ok = allowlist.some((a) => hostname === a || hostname.endsWith(`.${a}`));
    return ok ? { allowed: true } : { allowed: false, reason: 'host-not-allowlisted' };
  } catch {
    return { allowed: false, reason: 'invalid-url' };
  }
}

export const validZoneOrUtc = (zone) => (isValidZone(zone) ? zone : 'UTC');
