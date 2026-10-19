import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SUPABASE_CSP_PLACEHOLDER,
  supabaseConnectSources,
  applySupabaseCsp
} from './csp-origin.mjs';

/* The policy must permit exactly the project the client talks to, and nothing
 * wider. These cases pin the derivation, the fail-closed behaviour, and the
 * absence of wildcards. */

describe('csp-origin: deriving the Supabase sources', () => {
  it('permits both the HTTPS origin and its websocket counterpart', () => {
    // Realtime runs over wss://; permitting only https leaves live subscriptions
    // broken while ordinary REST calls appear to work.
    expect(supabaseConnectSources('https://abcdefghijklmnop.supabase.co')).toBe(
      'https://abcdefghijklmnop.supabase.co wss://abcdefghijklmnop.supabase.co'
    );
  });

  it('ignores a trailing slash and surrounding whitespace', () => {
    expect(supabaseConnectSources('  https://abc.supabase.co/  ')).toBe(
      'https://abc.supabase.co wss://abc.supabase.co'
    );
  });

  it('drops any path, because a CSP source is an origin not a URL', () => {
    expect(supabaseConnectSources('https://abc.supabase.co/auth/v1')).toBe(
      'https://abc.supabase.co wss://abc.supabase.co'
    );
  });

  it('keeps an explicit port, as local Supabase uses one', () => {
    expect(supabaseConnectSources('http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321 ws://127.0.0.1:54321'
    );
  });

  it('derives ws:// for http rather than wss://', () => {
    // A wss:// source against an http server is a mismatch that silently fails.
    expect(supabaseConnectSources('http://localhost:54321')).toContain('ws://localhost:54321');
    expect(supabaseConnectSources('http://localhost:54321')).not.toContain('wss://');
  });

  it('returns nothing when the value is absent, so the build stays consistent', () => {
    // No URL means the client is never created; permitting nothing extra is
    // correct, and the policy must not accidentally widen.
    expect(supabaseConnectSources(undefined)).toBe('');
    expect(supabaseConnectSources(null)).toBe('');
    expect(supabaseConnectSources('')).toBe('');
    expect(supabaseConnectSources('   ')).toBe('');
  });

  it('returns nothing for a value that is not a URL', () => {
    expect(supabaseConnectSources('not a url')).toBe('');
    expect(supabaseConnectSources('abc.supabase.co')).toBe('');
  });

  it('refuses non-http schemes, whatever reaches the environment', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(supabaseConnectSources(bad)).toBe('');
    }
  });

  it('never emits a wildcard or a scheme-wide source', () => {
    const cases = [
      'https://abc.supabase.co',
      'http://localhost:54321',
      undefined,
      'nonsense'
    ];
    for (const value of cases) {
      const out = supabaseConnectSources(value);
      expect(out).not.toMatch(/\*/);
      expect(out).not.toMatch(/(^|\s)https:(\s|$)/);
      expect(out).not.toMatch(/(^|\s)wss:(\s|$)/);
    }
  });
});

describe('csp-origin: substituting into a document', () => {
  it('replaces every occurrence of the placeholder', () => {
    const doc = `a ${SUPABASE_CSP_PLACEHOLDER} b ${SUPABASE_CSP_PLACEHOLDER}`;
    const out = applySupabaseCsp(doc, 'https://abc.supabase.co');
    expect(out).not.toContain(SUPABASE_CSP_PLACEHOLDER);
    expect(out.match(/https:\/\/abc\.supabase\.co/g)).toHaveLength(2);
  });

  it('leaves no token behind even when nothing can be derived', () => {
    // A literal token in a shipped policy is an invalid source expression.
    const out = applySupabaseCsp(SUPABASE_CSP_PLACEHOLDER, undefined);
    expect(out).not.toContain(SUPABASE_CSP_PLACEHOLDER);
    expect(out).toBe('');
  });

  it('is a no-op for documents that do not contain the placeholder', () => {
    const doc = "connect-src 'self'";
    expect(applySupabaseCsp(doc, 'https://abc.supabase.co')).toBe(doc);
  });

  it('returns non-string input unchanged instead of throwing', () => {
    expect(applySupabaseCsp(undefined, 'https://abc.supabase.co')).toBeUndefined();
    expect(applySupabaseCsp(null, 'https://abc.supabase.co')).toBeNull();
  });
});

describe('csp-origin: the repository actually uses the placeholder', () => {
  /* The point of the refactor is defeated if the hardcoded host creeps back in.
   * These assertions read the real files. */

  it('index.html contains the placeholder and no hardcoded project host', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(SUPABASE_CSP_PLACEHOLDER);
    expect(html).not.toMatch(/[a-z0-9]{20}\.supabase\.co/);
  });

  it('public/_headers contains the placeholder and no hardcoded project host', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    expect(headers).toContain(SUPABASE_CSP_PLACEHOLDER);
    expect(headers).not.toMatch(/[a-z0-9]{20}\.supabase\.co/);
  });
});
