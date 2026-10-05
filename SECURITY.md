# Security Policy — CryptoX

_Last reviewed: 11 September 2026 · Applies to the `cryptox` demo build (v1.0.0)_

## Reporting a vulnerability

Report privately to **security@cryptox.example** (placeholder — replace with a monitored mailbox before launch). Include: affected version/build stamp, reproduction steps, impact, and any proof-of-concept. Please do not open public issues for security defects. Target first response: 3 business days; fix or mitigation plan: 10 business days for high severity.

## Threat model

| Asset | Where it lives | Primary threats |
|---|---|---|
| Demo credentials | Browser localStorage (PBKDF2 hash + salt) | Device compromise, offline brute force of weak passwords |
| Portfolio / watchlist / strategy config | Browser localStorage | Device compromise, tampering (not security-sensitive) |
| Market data | Public third-party APIs | Spoofing by third parties, provider outage, licence breach |
| Session | localStorage token-like object | XSS token theft (mitigated by CSP, no HTML injection sinks) |

Out of scope for this build: server-side compromise (there is no server), payment flows, and real trading execution (not implemented).

## Implemented controls

- **Credentials:** PBKDF2-SHA256, 210,000 iterations, 16-byte random per-user salt, constant-time comparison. Plaintext is never persisted; legacy plaintext accounts are transparently migrated and the old key deleted.
- **Verification codes:** cryptographically random 6-digit codes, hashed at rest, 10-minute TTL, max 5 attempts, single use. No email provider is configured, so the code is displayed in an explicitly labelled demo inbox.
- **Brute force:** account lockout for 15 minutes after 5 consecutive failures; generic "Invalid email or password" responses do not reveal account existence.
- **Sessions:** 12-hour absolute expiry plus 30-minute idle expiry, refreshed by user activity, invalidated on sign-out.
- **Transport/rendering:** Content-Security-Policy meta (see `index.html` and `public/_headers`), `referrer` policy `strict-origin-when-cross-origin`, external links carry `rel="noopener noreferrer"`, no `dangerouslySetInnerHTML` or `eval` anywhere (enforced by `scripts/check-config.mjs`).
- **Resilience:** global error boundary with diagnostics copy; local error ring buffer; feed circuit breaker with exponential backoff + jitter and a 60s slow retry; stale-feed detection (20s); socket pauses when the tab is hidden.
- **Integrity:** every dataset carries provenance; synthetic candles are labelled and can never generate signals, backtests or paper trades.
- **Supply chain:** exact dependency pinning, `npm ci` in CI, blocking gate on critical production advisories, plus config and bundle-size guards.

## Known residual risks (accepted, documented)

1. **Client-only identity.** A user with control of the device can read or modify localStorage, so identity is not trustworthy for anything of value. Production requires server-side identity (Supabase/OIDC) and httpOnly cookie sessions.
2. **Session storage in localStorage.** Mitigated by CSP and the absence of injection sinks, but a server-side session would remove the class entirely.
3. **No independent penetration test.** All findings to date come from internal testing.
4. **Dependency advisories outstanding at v1.0.0** (verified with `npm audit --omit=dev`):

   | Severity | Package | Advisory | Applicability to this app |
   |---|---|---|---|
   | High | `vite` | Path traversal in optimized-deps `.map` handling | **Dev server only** — not present in the published static build |
   | Moderate | `esbuild` | Dev server request exposure | **Dev server only** |
   | Moderate | `react-router` | Open redirect via backslash in `<Link>`/`useNavigate` | Low: no redirect target derives from untrusted input; fix requires the v7 major upgrade |

   These are tracked; the blocking CI gate is set to *critical*, with high/moderate reported on every build.
5. **Host-level headers.** `frame-ancestors`, HSTS, `Permissions-Policy` and `X-Content-Type-Options` cannot be set from a `<meta>` tag. `public/_headers` declares the intended contract; confirm with `curl -I` and treat anything missing as an open item.
6. **Third-party data exposure.** The browser contacts CoinGecko/Binance/Alternative.me directly, which see the user's IP. A server-side proxy would remove this for production.
7. **No rate limiting at the edge.** Brute-force protection is per-account and client-side only.

## Production requirements (before handling real users or money)

- Server-side identity with httpOnly sessions, MFA, and password-reset via a real email provider.
- Server-side API proxy with provider keys, caching, and signed data licences.
- Edge rate limiting + WAF, real HTTP security headers, and CDN caching.
- Third-party penetration test and remediation; dependency and container scanning in CI.
- Centralised logging/monitoring with alerting and an on-call rotation (see `docs/OPERATIONS.md`).
- Data-protection review (GDPR/CCPA), KYC/AML and licensing assessment (`docs/COMPLIANCE.md`).
