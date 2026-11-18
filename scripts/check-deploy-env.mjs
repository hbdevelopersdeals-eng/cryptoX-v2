/* Deploy-environment guard.
 *
 * THE FAILURE THIS PREVENTS. `src/lib/auth.jsx` picks its identity mode from
 * `supabaseConfigured`: if `VITE_SUPABASE_URL` is absent the build silently
 * drops into the demo auth store, where accounts live in localStorage. The
 * bundle still renders, checkout still opens, and a paying customer completes a
 * purchase with no server-side account for the webhook to attach a subscription
 * to. Nothing looks broken — the money just arrives attached to nobody.
 *
 * That is not a runtime bug that can be caught by a test, because the code is
 * "working". It is a BUILD CONFIGURATION bug, so the guard belongs in the gate:
 *
 *   node scripts/check-deploy-env.mjs            report, never fail
 *   node scripts/check-deploy-env.mjs --strict   fail when a deploy is unsafe
 *
 * `npm run check` runs it in strict mode, so a production bundle cannot be
 * produced from a checkout that would ship demo auth. Local development without
 * Supabase vars still works: `npm run dev` does not run `check`.
 *
 * It also refuses a SERVICE ROLE key. That key bypasses every RLS policy, and
 * Vite inlines every `VITE_` value into the public bundle — putting it in
 * `VITE_SUPABASE_*` would publish the database. A key whose JWT payload says
 * `service_role` (secret-scan:allow: prose describing the detector) is treated as a hard error, not a warning.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_NAMES = ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY'];
const STRICT = process.argv.includes('--strict');

/** Minimal .env parser: KEY=value, optional surrounding quotes, # comments. */
export function parseEnv(text = '') {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Layered like Vite: .env < .env.local < .env.production < .env.production.local. */
export function readDeployEnv(root = ROOT, files = ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const merged = {};
  const found = [];
  for (const name of files) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    found.push(name);
    Object.assign(merged, parseEnv(readFileSync(path, 'utf8')));
  }
  return { env: merged, found };
}

/**
 * Decode a Supabase key far enough to name its role.
 *
 * Publishable keys (`sb_publishable_…`) are not JWTs and carry no role, which is
 * fine — they are the new public format. A legacy anon/service key is a JWT, so
 * the payload's `role` claim decides. An unreadable key is `unknown`, never
 * silently trusted.
 */
export function keyRole(key = '') {
  const value = String(key || '').trim();
  if (!value) return 'missing';
  if (/^sb_publishable_/i.test(value)) return 'publishable';
  const parts = value.split('.');
  if (parts.length !== 3) return 'unknown';
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload?.role || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Validate a resolved environment. Pure: takes an env object, returns findings,
 * so the rules can be unit-tested without touching the filesystem.
 */
export function validateDeployEnv(env = {}) {
  const errors = [];
  const warnings = [];

  const url = String(env.VITE_SUPABASE_URL || '').trim();
  const keyName = KEY_NAMES.find((name) => String(env[name] || '').trim());
  const key = keyName ? String(env[keyName]).trim() : '';

  if (!url) {
    errors.push('VITE_SUPABASE_URL is not set: the build would ship demo auth, and a paid subscription would have no account to attach to.');
  } else {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      errors.push(`VITE_SUPABASE_URL is not a URL: ${url}`);
    }
    if (parsed) {
      if (parsed.protocol !== 'https:') {
        errors.push('VITE_SUPABASE_URL must use https; an http project URL puts credentials on the wire.');
      }
      if (!/\.supabase\.(co|in)$/.test(parsed.hostname)) {
        warnings.push(`VITE_SUPABASE_URL host is ${parsed.hostname}, which is not a supabase.co project domain.`);
      }
    }
  }

  if (!key) {
    errors.push(`None of ${KEY_NAMES.join(' / ')} is set: the Supabase client would fall back to demo auth.`);
  } else {
    const role = keyRole(key);
    if (role === 'service_role') { // secret-scan:allow detects the credential; contains no key
      errors.push(
        `${keyName} is a SERVICE ROLE key. Vite inlines every VITE_ value into the public bundle, so this publishes full database access. Use the publishable/anon key.`
      );
    } else if (role === 'unknown') {
      warnings.push(`${keyName} is neither a publishable key nor a decodable JWT; its role could not be verified.`);
    } else if (role !== 'anon' && role !== 'publishable') {
      warnings.push(`${keyName} carries JWT role "${role}", expected "anon" or a publishable key.`);
    }
    if (key.length < 24) {
      warnings.push(`${keyName} is only ${key.length} characters, which is shorter than any real Supabase key.`);
    }
  }

  const authMode = url && key ? 'supabase' : 'demo';

  return {
    ok: errors.length === 0,
    authMode,
    url: url || null,
    keyName: keyName || null,
    keyRole: key ? keyRole(key) : null,
    errors,
    warnings
  };
}

/* ------------------------------------------------------------------ CLI ---- */

// Only run when executed directly. Imported by the unit test, which passes a
// vitest binary as argv[1] and must not trip the gate.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/check-deploy-env.mjs')) {
  const { env, found } = readDeployEnv(ROOT);
  const merged = { ...env, ...pickProcessEnv() };
  const result = validateDeployEnv(merged);

  console.log(`Deploy environment: sources = ${found.length ? found.join(', ') : '(none)'}; auth mode = ${result.authMode}`);
  for (const warning of result.warnings) console.log(`  warn  ${warning}`);

  if (result.ok) {
    console.log(`  ok    Supabase URL and ${result.keyName} present (role: ${result.keyRole}).`);
    process.exit(0);
  }

  for (const error of result.errors) console.error(`  ${STRICT ? 'FAIL' : 'note'}  ${error}`);

  if (STRICT) {
    console.error(
      '\nRefusing to continue: this build would run in demo auth mode. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY\n' +
        'in the build environment (site-builder settings or .env.production), then re-run. See docs/LAUNCH-READINESS.md P0-1.'
    );
    process.exit(1);
  }

  console.log('Not strict: reporting only. `npm run check` runs this with --strict.');
  process.exit(0);
}

function pickProcessEnv() {
  const out = {};
  for (const name of ['VITE_SUPABASE_URL', ...KEY_NAMES]) {
    if (process.env[name]) out[name] = process.env[name];
  }
  return out;
}
