# Operations Guide — CryptoX

_Audience: whoever builds, releases and watches this app. Last updated 11 September 2026._

## 1. Environments

| Environment | How it is produced | URL | Data |
|---|---|---|---|
| Local dev | `npm run dev` | http://127.0.0.1:5173 | Live public APIs; localStorage |
| Local production simulation | `npm run build && npm run preview` | http://127.0.0.1:4173 | Same as production bundle |
| Production | Site-builder publish of `dist/` | https://cryptox.site.accio.ai | Live public APIs |

There is no separate staging host today. **Recommended before real traffic:** publish the same build to a staging subdomain, verify there, then promote the identical artifact.

## 2. Configuration

Non-secret, build-time only (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `VITE_APP_VERSION` | `dev` | Displayed on `/status`, attached to error reports |
| `VITE_BUILD_STAMP` | `unknown` | Set per build in CI (e.g. commit SHA + timestamp) |
| `VITE_ERROR_ENDPOINT` | empty | Optional HTTPS error collector; empty keeps telemetry local |

## 3. Release and rollback

**Release checklist**
1. `npm ci` (locked install).
2. `npm run verify` → 1,892 tests green + build succeeds.
3. `node scripts/check-config.mjs` and `node scripts/check-bundle.mjs` → both green.
4. `npm audit --omit=dev` → no critical; review high/moderate against SECURITY.md applicability table.
5. Preview the built bundle; confirm login, home, coin chart, strategy backtest, paper trader at desktop **and** 375px mobile width.
6. Publish `dist/`.
7. Post-deploy smoke: load `/`, sign in, open a coin, run one backtest, open `/status`.

**Rollback**: republish the previous `dist/` artifact (or re-run the publish step against the previous commit). Static hosting makes rollback a single re-upload; no database migrations are involved. Target: < 10 minutes.

## 4. Monitoring and alerting map

The app is client-side, so "monitoring" is the status page plus whatever the host provides.

| Control | Signal | Threshold | Where you see it | Owner |
|---|---|---|---|---|
| Realtime feed | Binance WebSocket state | `live` expected | Topbar chip, `/status` | Ops |
| Feed staleness | Seconds since last tick | > 20s ⇒ `stale` | Topbar `feed stale`, `/status` | Ops |
| Market REST | CoinGecko market/global fetch | Failure ⇒ `simulated` badge | Topbar `DEMO`, `/status` | Ops |
| Data integrity | Candle provenance | Any `simulated` active ⇒ signals paused | `/status`, chart badge | Product |
| Client errors | Ring buffer (`getErrorLog`) | > 0 new errors per session | `/status` → Recent errors | Engineering |
| Render failure | Error boundary | Any boundary catch | Fallback UI + console + boundary report | Engineering |
| Bundle drift | `check-bundle.mjs` | chunk > 120 KB gzip or total > 400 KB | CI | Engineering |
| Dependency risk | `npm audit` | critical ⇒ CI fails | CI | Engineering |
| Availability | Host uptime | 5xx / unreachable | Host dashboard, manual check | Ops |

**Gaps to close for production:** centralised error reporting (`VITE_ERROR_ENDPOINT` → Sentry/GlitchTip), uptime checks every minute with alerting, synthetic browser probes, and real-user monitoring.

## 5. Incident runbook

**A. Realtime feed down ("feed delayed"/"stale")**
1. Check `/status` for the WebSocket state and last tick age.
2. Hit **Reconnect feeds** (clears caches, reconnects).
3. If Binance is blocked in the region, expect the CoinGecko-only path: prices refresh every 60s — the chip shows `SYNC`, which is honest, not broken.
4. If both providers fail, the app enters `simulated` mode: badges everywhere, signals and paper trades paused. Communicate this rather than removing the badges.

**B. Blank screen or "Something went wrong"**
1. Error boundary presents diagnostics; ask the user to click **Copy diagnostics**.
2. Cross-check the build stamp on `/status` against the deployed build.
3. If a release introduced it, roll back (section 3) and reproduce locally with `npm run preview`.

**C. Users report "Too many failed attempts"**
1. Lockout is per-account, 15 minutes after 5 failures. Confirm it is not an attacker (check for repeated emails in support tickets).
2. For a legitimate lockout, the user can wait, or clear the account in browser storage (demo build only). Production replaces this with server-side rate limiting and a reset flow.

**D. Suspected data anomaly (prices look wrong)**
1. Compare against a second source (e.g. the provider's own site).
2. Check whether the app is in `simulated` mode — synthetic candles are visually similar by design but are always badged.
3. If a live provider is wrong, document it, and treat any downstream signal as void.

## 6. Ownership

| Area | Owner | Notes |
|---|---|---|
| Front-end code, tests, CI | Engineering | This repository |
| Hosting, domain, TLS | Platform owner | Site-builder publish |
| Data providers & licences | Commercial owner | See `docs/COMPLIANCE.md` |
| User support / reports | Product owner | Needs a monitored mailbox before launch |
| Security disclosures | Engineering | SECURITY.md process |

## 7. External readiness checklist (what code cannot fix)

These are the remaining items separating this build from "commercial / enterprise grade". Each needs a human decision, a budget or a third party:

- [ ] **Server-side identity** (Supabase/OIDC) with httpOnly sessions, MFA and real password reset.
- [ ] **API proxy + paid data licences** for CoinGecko and Binance (commercial redistribution).
- [ ] **Real HTTP security headers** verified with `curl -I` (CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`).
- [ ] **Edge rate limiting / WAF** for abuse protection.
- [ ] **Third-party penetration test** with remediation sign-off.
- [ ] **Legal review** of privacy notice, terms, risk disclosure and marketing claims.
- [ ] **Trademark clearance** for the "CryptoX" name and logo.
- [ ] **Regulatory assessment** if real trading, advice or custody is ever enabled (KYC/AML, licensing).
- [ ] **Centralised monitoring + on-call rota** with alert thresholds from section 4.
- [ ] **WCAG 2.2 AA audit** by an accessibility specialist, including screen-reader testing.
- [ ] **Staging environment** plus automated post-deploy smoke tests.
- [ ] **Support channel** (monitored mailbox, response targets) and status/incident comms page.

## 8. Cost notes

Current run cost is dominated by hosting (static, minimal) and data. Free public API tiers are rate-limited and, for commercial use, not licensed. Budget for paid data plans and an error-monitoring plan before scaling traffic.
