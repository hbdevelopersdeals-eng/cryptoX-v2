/* URL safety: SSRF, open redirect and header injection (Section 26).
 *
 * HONEST SCOPE. This is the CLIENT half. A browser cannot see which IP a
 * hostname resolves to, so it cannot defend against DNS rebinding — a hostname
 * that passes every check here can still resolve to 127.0.0.1 on the server.
 * The server MUST re-validate after resolution and pin the address. Shipping
 * this alone and calling the SSRF risk closed would be the dangerous mistake.
 */

/** IPv4 ranges that must never be reachable from a server-side fetch. */
const PRIVATE_V4 = [
  { cidr: '0.0.0.0/8', why: 'this-network' },
  { cidr: '10.0.0.0/8', why: 'private' },
  { cidr: '100.64.0.0/10', why: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', why: 'loopback' },
  { cidr: '169.254.0.0/16', why: 'link-local — includes cloud instance metadata' },
  { cidr: '172.16.0.0/12', why: 'private' },
  { cidr: '192.0.0.0/24', why: 'IETF protocol assignments' },
  { cidr: '192.168.0.0/16', why: 'private' },
  { cidr: '198.18.0.0/15', why: 'benchmarking' },
  { cidr: '224.0.0.0/4', why: 'multicast' },
  { cidr: '240.0.0.0/4', why: 'reserved' }
];

const ipToInt = (ip) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

export function ipv4InCidr(ip, cidr) {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

export function isPrivateIpv4(ip) {
  if (!/^\d{1,4}(\.\d{1,4}){3}$/.test(ip)) return { private: false, reason: 'not-ipv4' };
  if (ip.split('.').some((o) => Number(o) > 255)) return { private: false, reason: 'invalid-octet' };
  const hit = PRIVATE_V4.find((r) => ipv4InCidr(ip, r.cidr));
  return hit ? { private: true, reason: hit.why, cidr: hit.cidr } : { private: false };
}

/** Expand a v6 address to its eight 16-bit groups, or null if it is not one. */
function expandIpv6(h) {
  if (h.includes('::')) {
    const [left, right] = h.split('::');
    const l = left ? left.split(':') : [];
    const r = right ? right.split(':') : [];
    const fill = 8 - l.length - r.length;
    if (fill < 0) return null;
    return [...l, ...Array(fill).fill('0'), ...r].map((g) => g || '0');
  }
  const parts = h.split(':');
  return parts.length === 8 ? parts.map((g) => g || '0') : null;
}

/** The IPv4 address behind a v4-mapped v6 address, in either notation. */
function ipv4FromMapped(h) {
  const dotted = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const groups = expandIpv6(h);
  if (!groups) return null;
  const head = groups.slice(0, 6).map((g) => parseInt(g, 16));
  if (head[5] !== 0xffff || head.slice(0, 5).some((n) => n !== 0)) return null;
  const hi = parseInt(groups[6], 16);
  const lo = parseInt(groups[7], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** IPv6 loopback, unique-local, link-local, and v4-mapped forms. */
export function classifyIpv6(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return { special: false };
  if (h === '::1' || h === '::') return { special: true, reason: 'loopback' };
  if (/^f[cd]/.test(h)) return { special: true, reason: 'unique-local' };
  if (/^fe[89ab]/.test(h)) return { special: true, reason: 'link-local' };
  // v4-mapped — a v4 address wearing a v6 costume. Both notations must be
  // handled: the dotted form ::ffff:127.0.0.1 is what a human writes, but
  // `new URL()` normalises it to hex, so ::ffff:7f00:1 is what actually
  // reaches here. Recognising only the dotted form let
  // https://[::ffff:127.0.0.1]/ pass every check while pointing at loopback.
  const v4 = ipv4FromMapped(h);
  if (v4) {
    const verdict = isPrivateIpv4(v4);
    return verdict.private ? { special: true, reason: `v4-mapped ${verdict.reason}` } : { special: false };
  }
  return { special: false };
}

const BLOCKED_HOSTNAMES = [
  { pattern: /^localhost$/i, why: 'loopback by name' },
  { pattern: /\.localhost$/i, why: 'loopback by name' },
  { pattern: /^.*\.local$/i, why: 'mDNS / local network' },
  { pattern: /^.*\.internal$/i, why: 'internal network' },
  { pattern: /^metadata\./i, why: 'cloud instance metadata' },
  { pattern: /^metadata\.google\.internal$/i, why: 'cloud instance metadata' },
  { pattern: /^.*\.onion$/i, why: 'tor hidden service' }
];

/**
 * Decide whether a URL may be fetched.
 *
 * `allowedHosts` is optional but strongly recommended: an allowlist of the
 * providers this application actually talks to is a far stronger control than
 * any blocklist, because blocklists lose to a new hostname.
 */
export function assertSafeUrl(input, { allowedProtocols = ['https:'], allowedHosts = null, allowPorts = [443, 80] } = {}) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (!allowedProtocols.includes(url.protocol)) {
    return { ok: false, reason: 'blocked-protocol', protocol: url.protocol, allowed: allowedProtocols };
  }
  // Credentials in a URL end up in logs and in the Referer header.
  if (url.username || url.password) return { ok: false, reason: 'credentials-in-url' };

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (allowedHosts) {
    const permitted = allowedHosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
    if (!permitted) return { ok: false, reason: 'host-not-allowed', host, allowed: allowedHosts };
  }

  const named = BLOCKED_HOSTNAMES.find((b) => b.pattern.test(host));
  if (named) return { ok: false, reason: 'blocked-hostname', host, why: named.why };

  const v4 = isPrivateIpv4(host);
  if (v4.private) return { ok: false, reason: 'private-address', host, why: v4.reason, cidr: v4.cidr };

  const v6 = classifyIpv6(host);
  if (v6.special) return { ok: false, reason: 'private-address', host, why: v6.reason };

  // An explicit port that is not standard is how a request reaches an internal
  // service on a hostname that otherwise looks fine.
  if (url.port && !allowPorts.includes(Number(url.port))) {
    return { ok: false, reason: 'non-standard-port', port: url.port, allowed: allowPorts };
  }

  // Belt and braces. `new URL()` already turns an integer or octal host into a
  // dotted quad (https://2130706433/ arrives as 127.0.0.1) or refuses to parse
  // it, so this branch is a guard for hosts assembled some other way rather
  // than the primary defence — the dotted-quad check above is.
  if (/^\d+$/.test(host)) {
    return { ok: false, reason: 'numeric-hostname', host, note: 'A single-integer hostname is an encoded address; resolve and check it, do not trust it.' };
  }

  return {
    ok: true,
    url: url.toString(),
    host,
    // Repeated on every pass so the limitation cannot be forgotten downstream.
    caveat: 'Client checks the URL only. The server must re-validate the RESOLVED address, or a rebinding hostname defeats all of this.'
  };
}

/** Open redirect: only same-origin relative paths are safe to bounce to. */
export function safeRedirect(target, { base = null, allowedPaths = null } = {}) {
  if (target == null) return { ok: false, reason: 'missing-target' };
  const value = String(target);
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    return { ok: false, reason: 'absolute-url', note: 'An absolute or protocol-relative redirect is an open redirect.' };
  }
  if (!value.startsWith('/')) return { ok: false, reason: 'not-root-relative' };
  // Backslashes are treated as slashes by some browsers, so "/\evil.com" escapes.
  if (/[\\]/.test(value)) return { ok: false, reason: 'backslash-in-path' };
  if (value.includes('\n') || value.includes('\r')) return { ok: false, reason: 'control-character' };
  if (allowedPaths && !allowedPaths.some((p) => value === p || value.startsWith(`${p}/`))) {
    return { ok: false, reason: 'path-not-allowed', value, allowed: allowedPaths };
  }
  if (base) {
    const resolved = new URL(value, base);
    if (resolved.origin !== new URL(base).origin) return { ok: false, reason: 'origin-mismatch' };
  }
  return { ok: true, path: value };
}

/** Header injection: a value carrying CR/LF can forge a second header. */
export function assertSafeHeaderValue(value, { maxLength = 8192 } = {}) {
  const s = String(value ?? '');
  if (/[\r\n]/.test(s)) return { ok: false, reason: 'crlf-injection' };
  if (/[\u0000-\u001f\u007f]/.test(s)) return { ok: false, reason: 'control-character' };
  if (s.length > maxLength) return { ok: false, reason: 'too-long', length: s.length };
  return { ok: true, value: s };
}

export const SSRF_LIMITATIONS = [
  'A browser cannot resolve a hostname, so DNS rebinding is undetectable here.',
  'Redirects are followed by the transport, so a safe URL can redirect to an unsafe one — the server must validate each hop with redirects disabled.',
  'An allowlist of known hosts is stronger than any blocklist; new hostnames defeat blocklists by definition.'
];

export const PRIVATE_RANGE_COUNT = PRIVATE_V4.length;
