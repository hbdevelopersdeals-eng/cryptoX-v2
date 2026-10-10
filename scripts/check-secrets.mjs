#!/usr/bin/env node
/* Secret scanning guard (Section 26).
 *
 * A committed secret is not a code defect that can be patched — it is a
 * disclosure, and the only real remedy is rotation. So the control that matters
 * is the one that stops the commit.
 *
 * Two things this checks that a prefix-only scanner misses:
 *
 *   1. A JWT is decoded and its `role` claim read. A Supabase ANON key is
 *      publishable by design and must not fail the build; a SERVICE_ROLE key is
 *      a full-database credential and must. A regex over `eyJ…` cannot tell the
 *      two apart, so it would either block every legitimate anon key or wave
 *      through the one key that matters.
 *   2. `service_role` / `SUPABASE_SERVICE_ROLE` mentioned anywhere in client
 *      code is a finding on its own, even without a literal next to it — in a
 *      static build anything shipped to the browser is readable by anyone.
 *
 * A genuine false positive is suppressed inline with `secret-scan:allow <why>`
 * on the same line, so every exemption is visible in review and carries a
 * reason. A blanket allowlist file would hide them instead.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.vite', 'temp']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'check-secrets.mjs']);
const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.txt', '.yml', '.yaml', '.html', '.css', '.sql', '.sh', '.ps1', '.env', '.example']);
const ALLOW = /secret-scan:allow/;

const errors = [];
const notes = [];
const err = (file, rule, msg) => errors.push({ file, rule, msg });

/* ------------------------------------------------------------- collect files */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (SKIP_FILES.has(entry)) continue;
    const ext = extname(entry).toLowerCase();
    // Dotfiles with no extension (e.g. a stray `.env`) are still inspected.
    if (TEXT_EXT.has(ext) || entry.startsWith('.env')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
notes.push(`scanned ${files.length} text files`);

/* ------------------------------------------------------------ the patterns */

/*
 * Each entry is the shape of a real credential, not of a variable name.
 * `test`/`fake`/`example`/`do_not_ship` suffixes are deliberately NOT
 * exempted by pattern — an exemption is granted explicitly per line instead.
 */
const PATTERNS = [
  { rule: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, msg: 'A private key in the repository. Rotate it — it is already compromised.' },
  { rule: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, msg: 'AWS access key id.' },
  { rule: 'aws-secret', re: /aws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+=]{40}['"]/i, msg: 'AWS secret access key.' },
  { rule: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, msg: 'Google API key.' },
  { rule: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, msg: 'Slack token.' },
  { rule: 'github-token', re: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/, msg: 'GitHub token.' },
  { rule: 'stripe-live-key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/, msg: 'A LIVE Stripe key. Never in source; the test key is sk_test.' },
  { rule: 'webhook-signing-secret', re: /\bwhsec_[A-Za-z0-9]{24,}\b/, msg: 'A webhook signing secret — it verifies payment events.' },
  { rule: 'pgp-block', re: /-----BEGIN PGP MESSAGE-----/, msg: 'An encrypted block committed to the repository.' },
  { rule: 'basic-auth-url', re: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]{6,}@/i, msg: 'Credentials embedded in a URL.' }
];

/* Names that must never be assigned a literal value. */
const SECRET_NAMES = /\b(?:service[_-]?role[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|api[_-]?secret|signing[_-]?secret|encryption[_-]?key|db[_-]?password|database[_-]?password)\b/i;

/** Shannon entropy in bits per character, to separate a real key from prose. */
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Decode a JWT payload without verifying it — we only want the `role` claim. */
function jwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
let jwtAnon = 0;
let jwtOther = 0;

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return; // explicitly exempted, with a reason, in review
    const at = `${rel}:${i + 1}`;

    for (const p of PATTERNS) {
      if (p.re.test(line)) err(at, p.rule, p.msg);
    }

    // A secret-named variable assigned a long, high-entropy literal.
    if (SECRET_NAMES.test(line)) {
      for (const m of line.matchAll(/['"]([A-Za-z0-9+/=_\-]{20,})['"]/g)) {
        if (entropy(m[1]) >= 3.4) {
          err(at, 'assigned-secret', `A secret-named value is assigned a ${m[1].length}-character literal (entropy ${entropy(m[1]).toFixed(1)}).`);
        }
      }
    }

    // A Supabase service-role credential in client code is fatal on sight,
    // because the build ships whatever the browser can read.
    if (/(?:supabase[_-]?)?service[_-]?role/i.test(line)) {
      err(at, 'service-role-in-client', 'A service-role credential is referenced in shipped code. Anything the browser can read is public.');
    }
  });

  for (const m of text.matchAll(JWT_RE)) {
    const payload = jwtPayload(m[0]);
    if (!payload) continue;
    const role = String(payload.role || '');
    if (role === 'service_role') {
      err(rel, 'jwt-service-role', 'A JWT with role=service_role. This is a full-database credential.');
    } else if (role === 'anon' || role === 'publishable') {
      jwtAnon += 1;
    } else {
      jwtOther += 1;
      notes.push(`${rel}: a JWT with role="${role || '(none)'}" — confirm it is meant to be public`);
    }
  }
}

notes.push(`JWTs: ${jwtAnon} publishable (role=anon), ${jwtOther} other`);

/* ------------------------------------------------- required hygiene, positively */

// The three provider-side items that make the guard meaningful. Each is checked
// as a presence, so deleting the protection fails the build rather than passing
// it silently.
const gitignore = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : '';
for (const required of ['.env', '*.env']) {
  const present = gitignore.split(/\r?\n/).map((l) => l.trim()).includes(required);
  if (!present) err('.gitignore', 'env-not-ignored', `"${required}" is not ignored, so a real environment file can be committed.`);
}

if (existsSync(join(ROOT, '.env'))) {
  err('.env', 'env-committed', 'A .env file is present in the repository root. Secrets belong in the environment, not in source.');
}

const envExample = join(ROOT, '.env.example');
if (existsSync(envExample)) {
  const example = readFileSync(envExample, 'utf8');
  // The example documents the KEYS; it must never carry a VALUE that looks real.
  for (const m of example.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/gm)) {
    const [, key, value] = m;
    if (!value || /^['"]{2}$/.test(value)) continue;
    if (/(?:KEY|SECRET|TOKEN|PASSWORD|SALT)/i.test(key) && /^[A-Za-z0-9+/=_\-]{20,}$/.test(value) && entropy(value) >= 3.4) {
      err('.env.example', 'example-holds-secret', `${key} carries what looks like a real value. Use a placeholder.`);
    }
  }
}

/* -------------------------------------------------------------------- report */

const line = '─'.repeat(64);
console.log(line);
console.log('Secret scan (Section 26)');
console.log(line);
for (const n of notes) console.log(`  · ${n}`);

if (errors.length) {
  console.log(`\n  ${errors.length} finding(s):`);
  for (const e of errors) console.log(`  ✗ [${e.rule}] ${e.file}\n      ${e.msg}`);
  console.log(`\n  A committed secret is a disclosure, not a defect: rotate it, then`);
  console.log(`  suppress a genuine false positive inline with "secret-scan:allow <why>".`);
  process.exit(1);
}

console.log('\n  ✓ no credentials, private keys or service-role references found');
