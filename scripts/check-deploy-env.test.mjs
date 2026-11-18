import { describe, it, expect } from 'vitest';
import { parseEnv, validateDeployEnv, keyRole } from './check-deploy-env.mjs';

/* The guard exists because demo auth is a silent failure: the bundle renders,
 * checkout opens, and the purchase lands on no account. These tests pin the
 * three ways that can happen — missing URL, missing key, and a privileged key
 * pasted into a VITE_ variable.
 */

const GOOD_URL = 'https://bvyiqinyakxlefaeomoj.supabase.co';
const PUBLISHABLE = 'sb_publishable_abcdefghijklmnopqrstuvwx';

/** Build a legacy JWT-shaped key with a role claim, without any crypto. */
const jwt = (role) => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.c2lnbmF0dXJl`;
};

describe('parseEnv', () => {
  it('reads pairs, ignores comments and strips quotes', () => {
    const env = parseEnv('# comment\nVITE_SUPABASE_URL="https://x.supabase.co"\n\nA=1\nbad line\n');
    expect(env.VITE_SUPABASE_URL).toBe('https://x.supabase.co');
    expect(env.A).toBe('1');
    expect(Object.keys(env)).toHaveLength(2);
  });
});

describe('keyRole', () => {
  it('names publishable, anon and privileged keys', () => {
    expect(keyRole(PUBLISHABLE)).toBe('publishable');
    expect(keyRole(jwt('anon'))).toBe('anon');
    expect(keyRole(jwt('service_role'))).toBe('service_role'); // secret-scan:allow asserts the role is detected, holds no credential
  });

  it('returns missing/unknown instead of guessing', () => {
    expect(keyRole('')).toBe('missing');
    expect(keyRole('not-a-jwt')).toBe('unknown');
  });
});

describe('validateDeployEnv', () => {
  it('passes a configured deploy with a publishable key', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(result.ok).toBe(true);
    expect(result.authMode).toBe('supabase');
    expect(result.keyRole).toBe('publishable');
    expect(result.errors).toEqual([]);
  });

  it('accepts a legacy anon key', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: jwt('anon') });
    expect(result.ok).toBe(true);
    expect(result.keyName).toBe('VITE_SUPABASE_ANON_KEY');
  });

  it('fails closed when the URL is missing: that build ships demo auth', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(result.ok).toBe(false);
    expect(result.authMode).toBe('demo');
    expect(result.errors.join(' ')).toMatch(/demo auth/i);
  });

  it('fails closed when the key is missing', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: GOOD_URL });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/demo auth/i);
  });

  it('refuses a privileged key, because VITE_ values are public', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: jwt('service_role') }); // secret-scan:allow synthetic role claim, not a key
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SERVICE ROLE/i);
  });

  it('rejects a non-https project URL', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: 'http://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/https/);
  });

  it('warns but does not fail on an unverifiable key', () => {
    const result = validateDeployEnv({ VITE_SUPABASE_URL: GOOD_URL, VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/role could not be verified/i);
  });
});
