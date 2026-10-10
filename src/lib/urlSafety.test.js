import { describe, it, expect } from 'vitest';
import {
  ipv4InCidr, isPrivateIpv4, classifyIpv6, assertSafeUrl, safeRedirect,
  assertSafeHeaderValue, SSRF_LIMITATIONS, PRIVATE_RANGE_COUNT
} from './urlSafety.js';

/* Section 26 — SSRF, open redirect and header injection.
 *
 * These tests exercise the CLIENT half of the control. Passing them does not
 * make the SSRF risk closed: a browser cannot resolve a hostname, so a
 * rebinding hostname defeats every check here and the server must re-validate
 * the resolved address. The limitation is asserted explicitly at the bottom so
 * the gap cannot quietly disappear from the module. */

describe('ipv4InCidr', () => {
  it('matches inside and outside a range', () => {
    expect(ipv4InCidr('192.168.1.5', '192.168.0.0/16')).toBe(true);
    expect(ipv4InCidr('192.169.0.1', '192.168.0.0/16')).toBe(false);
    expect(ipv4InCidr('10.255.255.255', '10.0.0.0/8')).toBe(true);
    expect(ipv4InCidr('11.0.0.0', '10.0.0.0/8')).toBe(false);
  });

  it('respects a non-byte-aligned prefix', () => {
    // 172.16.0.0/12 covers 172.16–172.31 only.
    expect(ipv4InCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
    expect(ipv4InCidr('172.32.0.0', '172.16.0.0/12')).toBe(false);
    // 100.64.0.0/10 covers 100.64–100.127.
    expect(ipv4InCidr('100.127.255.255', '100.64.0.0/10')).toBe(true);
    expect(ipv4InCidr('100.128.0.0', '100.64.0.0/10')).toBe(false);
  });

  it('handles /0 without shifting by 32', () => {
    // (0xffffffff << 32) is a no-op in JS, so a /0 built by shifting would
    // match nothing at all.
    expect(ipv4InCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('treats the top bit correctly without signed overflow', () => {
    expect(ipv4InCidr('240.1.2.3', '240.0.0.0/4')).toBe(true);
    expect(ipv4InCidr('239.255.255.255', '240.0.0.0/4')).toBe(false);
  });
});

describe('isPrivateIpv4', () => {
  it('flags every internal range', () => {
    const cases = {
      '0.0.0.0': 'this-network',
      '10.0.0.1': 'private',
      '100.64.0.1': 'carrier-grade NAT',
      '127.0.0.1': 'loopback',
      '169.254.169.254': 'link-local — includes cloud instance metadata',
      '172.16.0.1': 'private',
      '192.0.0.1': 'IETF protocol assignments',
      '192.168.1.1': 'private',
      '198.18.0.1': 'benchmarking',
      '224.0.0.1': 'multicast',
      '240.0.0.1': 'reserved'
    };
    for (const [ip, why] of Object.entries(cases)) {
      const res = isPrivateIpv4(ip);
      expect(res.private, ip).toBe(true);
      expect(res.reason, ip).toBe(why);
    }
  });

  it('passes public addresses through', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isPrivateIpv4(ip).private, ip).toBe(false);
    }
  });

  it('rejects a non-address and an impossible octet without calling it private', () => {
    // "not private" is not the same as "safe"; these are unusable as addresses
    // and the caller is told which it is rather than being given a pass.
    expect(isPrivateIpv4('not-an-ip')).toEqual({ private: false, reason: 'not-ipv4' });
    expect(isPrivateIpv4('999.1.1.1')).toEqual({ private: false, reason: 'invalid-octet' });
    expect(isPrivateIpv4('1.2.3')).toEqual({ private: false, reason: 'not-ipv4' });
  });

  it('does not mistake an almost-matching dotted quad for a private one', () => {
    expect(isPrivateIpv4('192.168.1').private).toBe(false);
    expect(isPrivateIpv4('169.253.0.1').private).toBe(false);
  });
});

describe('classifyIpv6', () => {
  it('recognises loopback in both notations', () => {
    expect(classifyIpv6('::1')).toEqual({ special: true, reason: 'loopback' });
    expect(classifyIpv6('::')).toEqual({ special: true, reason: 'loopback' });
    expect(classifyIpv6('[::1]')).toEqual({ special: true, reason: 'loopback' });
  });

  it('recognises unique-local and link-local', () => {
    expect(classifyIpv6('fc00::1')).toEqual({ special: true, reason: 'unique-local' });
    expect(classifyIpv6('fd12:3456::1')).toEqual({ special: true, reason: 'unique-local' });
    expect(classifyIpv6('fe80::1')).toEqual({ special: true, reason: 'link-local' });
    expect(classifyIpv6('fe90::1')).toEqual({ special: true, reason: 'link-local' });
  });

  it('recognises the dotted v4-mapped form', () => {
    expect(classifyIpv6('::ffff:127.0.0.1')).toEqual({ special: true, reason: 'v4-mapped loopback' });
    expect(classifyIpv6('::ffff:192.168.1.1')).toEqual({ special: true, reason: 'v4-mapped private' });
    expect(classifyIpv6('::ffff:169.254.169.254').special).toBe(true);
  });

  it('recognises the hex v4-mapped form the URL parser actually produces', () => {
    // new URL('https://[::ffff:127.0.0.1]/').hostname is '[::ffff:7f00:1]'.
    // Handling only the dotted notation left the loopback form unchecked.
    expect(classifyIpv6('::ffff:7f00:1')).toEqual({ special: true, reason: 'v4-mapped loopback' });
    expect(classifyIpv6('::ffff:c0a8:101')).toEqual({ special: true, reason: 'v4-mapped private' });
    expect(classifyIpv6('0:0:0:0:0:ffff:7f00:1')).toEqual({ special: true, reason: 'v4-mapped loopback' });
  });

  it('does not flag a public v4-mapped address', () => {
    expect(classifyIpv6('::ffff:8.8.8.8')).toEqual({ special: false });
    expect(classifyIpv6('::ffff:808:808')).toEqual({ special: false });
  });

  it('does not flag a public v6 address, or a host that is not v6 at all', () => {
    // 'ffff' appearing mid-address is not a v4-mapped prefix.
    expect(classifyIpv6('2001:db8::ffff:1:2')).toEqual({ special: false });
    expect(classifyIpv6('example.com')).toEqual({ special: false });
  });
});

describe('assertSafeUrl', () => {
  const http = { allowedProtocols: ['https:', 'http:'] };

  it('accepts an ordinary https URL', () => {
    const res = assertSafeUrl('https://api.binance.com/api/v3/ticker');
    expect(res.ok).toBe(true);
    expect(res.host).toBe('api.binance.com');
  });

  it('refuses plain http by default', () => {
    const res = assertSafeUrl('http://example.com/');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('blocked-protocol');
  });

  it('refuses the cloud instance metadata endpoint', () => {
    // The single highest-value SSRF target: credentials for the whole instance.
    for (const target of [
      'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://metadata.azure.internal/'
    ]) {
      expect(assertSafeUrl(target).ok, target).toBe(false);
    }
  });

  it('refuses a private or loopback literal in any notation', () => {
    for (const target of [
      'https://127.0.0.1:443/',
      'https://10.0.0.5/',
      'https://192.168.0.1/',
      'https://172.16.0.1/',
      'https://[::1]/',
      'https://[fc00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:7f00:1]/'
    ]) {
      const res = assertSafeUrl(target, http);
      expect(res.ok, target).toBe(false);
      expect(res.reason, target).toBe('private-address');
    }
  });

  it('refuses a localhost name and a local suffix', () => {
    for (const target of ['https://localhost/', 'https://api.localhost/', 'https://printer.local/', 'https://db.internal/', 'https://x.onion/']) {
      expect(assertSafeUrl(target).reason, target).toBe('blocked-hostname');
    }
  });

  it('refuses credentials embedded in the URL', () => {
    // They are copied into logs and into a downstream Referer header.
    expect(assertSafeUrl('https://user:pw@example.com/').reason).toBe('credentials-in-url');
  });

  it('refuses a non-standard port', () => {
    expect(assertSafeUrl('https://example.com:8080/').reason).toBe('non-standard-port');
    expect(assertSafeUrl('https://example.com:22/').reason).toBe('non-standard-port');
    expect(assertSafeUrl('https://example.com:443/').ok).toBe(true);
  });

  it('refuses an unparseable input rather than throwing', () => {
    expect(assertSafeUrl('not a url').reason).toBe('unparseable');
    expect(assertSafeUrl('https://99999999999/').reason).toBe('unparseable');
    expect(assertSafeUrl(undefined).reason).toBe('unparseable');
  });

  it('refuses an encoded integer address', () => {
    // new URL() normalises https://2130706433/ to 127.0.0.1, which the
    // dotted-quad rule then catches — the property asserted is the refusal,
    // whichever rule does the refusing.
    const res = assertSafeUrl('https://2130706433/', http);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('private-address');
  });

  it('enforces the host allowlist when one is given', () => {
    const allowedHosts = ['binance.com'];
    expect(assertSafeUrl('https://api.binance.com/x', { allowedHosts }).ok).toBe(true);
    const res = assertSafeUrl('https://evil.com/x', { allowedHosts });
    expect(res.reason).toBe('host-not-allowed');
  });

  it('does not let an allowlist suffix be spoofed', () => {
    // 'notbinance.com'.endsWith('binance.com') is true, so the allowlist match
    // must require a dot boundary.
    expect(assertSafeUrl('https://notbinance.com/x', { allowedHosts: ['binance.com'] }).reason)
      .toBe('host-not-allowed');
  });

  it('checks the allowlist before the blocklist', () => {
    // A private host that is also off-allowlist must be reported as
    // not-allowed, so the caller never learns which private hosts exist.
    expect(assertSafeUrl('https://10.0.0.1/', { allowedHosts: ['binance.com'] }).reason).toBe('host-not-allowed');
  });

  it('repeats the resolution caveat on every success', () => {
    const res = assertSafeUrl('https://api.binance.com/');
    expect(res.caveat).toMatch(/re-validate the RESOLVED address/);
  });
});

describe('safeRedirect', () => {
  it('accepts a root-relative path', () => {
    expect(safeRedirect('/app/dashboard')).toEqual({ ok: true, path: '/app/dashboard' });
  });

  it('refuses an absolute and a protocol-relative target', () => {
    expect(safeRedirect('https://evil.com').reason).toBe('absolute-url');
    expect(safeRedirect('//evil.com').reason).toBe('absolute-url');
    expect(safeRedirect('javascript:alert(1)').reason).toBe('absolute-url');
  });

  it('refuses a backslash escape', () => {
    // Some browsers read "/\evil.com" as a protocol-relative URL, so this
    // escapes the origin even though it starts with a slash.
    expect(safeRedirect('/\\evil.com').reason).toBe('backslash-in-path');
    expect(safeRedirect('/a\\b').reason).toBe('backslash-in-path');
  });

  it('refuses a path containing CR or LF', () => {
    expect(safeRedirect('/a\nSet-Cookie: x=1').reason).toBe('control-character');
    expect(safeRedirect('/a\r\nb').reason).toBe('control-character');
  });

  it('refuses a relative path that does not start at the root', () => {
    expect(safeRedirect('dashboard').reason).toBe('not-root-relative');
    expect(safeRedirect('').reason).toBe('not-root-relative');
  });

  it('refuses a missing target', () => {
    expect(safeRedirect(null).reason).toBe('missing-target');
    expect(safeRedirect(undefined).reason).toBe('missing-target');
  });

  it('enforces the allowed path prefixes', () => {
    const opts = { allowedPaths: ['/app'] };
    expect(safeRedirect('/app/x', opts).ok).toBe(true);
    expect(safeRedirect('/app', opts).ok).toBe(true);
    expect(safeRedirect('/appx', opts).reason).toBe('path-not-allowed');
    expect(safeRedirect('/admin', opts).reason).toBe('path-not-allowed');
  });

  it('re-resolves against the base and refuses a cross-origin result', () => {
    expect(safeRedirect('/a', { base: 'https://app.example.com' }).ok).toBe(true);
    expect(safeRedirect('/a', { base: 'https://app.example.com' }).path).toBe('/a');
  });
});

describe('assertSafeHeaderValue', () => {
  it('accepts an ordinary value', () => {
    expect(assertSafeHeaderValue('application/json')).toEqual({ ok: true, value: 'application/json' });
  });

  it('refuses CR or LF, which forge a second header', () => {
    expect(assertSafeHeaderValue('a\r\nX-Admin: 1').reason).toBe('crlf-injection');
    expect(assertSafeHeaderValue('a\nb').reason).toBe('crlf-injection');
  });

  it('refuses other control characters', () => {
    expect(assertSafeHeaderValue('a\u0000b').reason).toBe('control-character');
    expect(assertSafeHeaderValue('a\u007fb').reason).toBe('control-character');
  });

  it('refuses an over-long value', () => {
    expect(assertSafeHeaderValue('a'.repeat(9000)).reason).toBe('too-long');
    expect(assertSafeHeaderValue('a'.repeat(9000)).length).toBe(9000);
    expect(assertSafeHeaderValue('a'.repeat(10), { maxLength: 5 }).reason).toBe('too-long');
  });

  it('treats a null value as empty rather than crashing', () => {
    expect(assertSafeHeaderValue(null)).toEqual({ ok: true, value: '' });
    expect(assertSafeHeaderValue(undefined)).toEqual({ ok: true, value: '' });
  });
});

describe('declared limitations', () => {
  it('names the limitation that these checks cannot close', () => {
    // If this assertion ever fails, the honest scope statement has been
    // dropped and the module is claiming a guarantee it cannot provide.
    expect(SSRF_LIMITATIONS.length).toBeGreaterThanOrEqual(3);
    expect(SSRF_LIMITATIONS.join(' ')).toMatch(/rebinding/i);
    expect(SSRF_LIMITATIONS.join(' ')).toMatch(/redirect/i);
  });

  it('counts the ranges it claims to cover', () => {
    expect(PRIVATE_RANGE_COUNT).toBeGreaterThanOrEqual(11);
  });
});
