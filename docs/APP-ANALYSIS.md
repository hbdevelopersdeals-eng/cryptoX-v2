# CryptoX — App Analysis, Capability Map and Build Order

_Written 18 Nov 2026, 18:40 (Asia/Karachi) against the working tree in `cryptox-app/`.
Every claim below is either observed in the source tree or quoted from the repo's own
audit documents. Nothing here is estimated from the marketing copy._

> **Read this first.** At the time of writing, a second build process is actively
> editing this working tree (`src/lib/*`, `src/App.jsx`, `public/*`, tests, a new
> migration). Any line-level statement below can be stale by minutes. Section 6
> records what was verified and when.

---

## 1. What the app is

A single-page React 18 + Vite 5 + Tailwind 3 crypto market terminal, published as a
static bundle at `https://cryptox-v2.site.accio.ai`, with a Supabase project behind
it for identity and subscriptions, and Lemon Squeezy for billing.

| Dimension | Observed |
|---|---|
| Source size | 36 pages, 103 library modules under `src/lib`, 68 test files |
| Last green gate | `npm test` → **1,913/1,913 passing, 68 files** (18:29 today, before the concurrent edits) |
| Locales | 24 catalogs under `src/locales` |
| Money path | browser → `lemonsqueezy-checkout` (mints nonce) → Lemon Squeezy → `lemonsqueezy-webhook` (verifies signature, consumes nonce, writes `cx_subscriptions`) |
| Migrations | 6 applied (`0001`–`0006`), plus `0007_entitlements.sql` being written now |

## 2. What genuinely works today

These are built and backed by tests or a documented live probe:

| Area | State | Evidence |
|---|---|---|
| Market table + provenance | 250-coin CoinGecko page, Binance WebSocket ticks, `LIVE/DELAYED/SIMULATED` badges, fabricated "wobble" removed | CHANGELOG; `market.jsx`, `sources.js` |
| Candlestick charts | Canvas + `ProChart`, MA20/50, RSI-14, 5m–1d, table alternative | `CandleChart.jsx`, `ProChart.jsx` |
| Strategy presets | 12 presets (incl. Stochastic RSI, CCI Reversal) shared by engine and `signalSeries` | `strategies.js` |
| Backtester | Next-bar fills, fees, slippage, Sharpe/Sortino/max-DD, walk-forward split, buy & hold | `backtest.js` + tests |
| Paper trading | Virtual balance, equity curve, trade log, win rate | `PaperTrading.jsx` |
| Portfolio | FIFO lots, fees in basis, realized/unrealized split, tax lots, P&L calendar, CSV | `portfolio.js` + tests |
| Alerts | 9 rule types, cooldown, per-rule readouts, never fires on simulated data | `alertsEngine.js`, `alertContext.js` |
| Venue aggregator | Per-asset best buy/sell, spreads, leaderboard, honest volume exclusions | `aggregator.js` + tests |
| Wallet Lab | EIP-55 + bech32 checksums, poisoning detection, approval risk, read-only `eth_call`; **no key custody by design** | `keccak.js`, `walletSecurity.js`, `evmRead.js` |
| Explorer / DeFi / NFT / Derivatives | Chain head, pools, NFT checks, funding/OI views | pages + libs |
| Auth | Supabase session when configured, PBKDF2 demo store otherwise | `auth.jsx`, `supabase.js` |
| Billing | Server-side checkout creation, signed webhook, nonce + variant mapping | 2 edge functions, 3 test files |
| Assistant | **Deterministic intent router — no model call**, and says so | `analyst.js` |

## 3. What is real only in the UI, or not wired at all

This is the part that decides whether money can be taken, and it is stated plainly
in the repo's own files:

| Gap | What it means | Where the repo admits it |
|---|---|---|
| Entitlements are UI-only | Quotas (`alerts: 100`, `bots: 3`, `apiCallsPerMonth`) are compared in the browser. Editing `localStorage` beats every gate. | `upgrade.js` header comment; `docs/LAUNCH-READINESS.md` P0-2 |
| No AI provider | `ai.js` is an abstraction + guards (redaction, rate limit, validation) with **no provider call site** | `ai.js` header: "No provider is wired up" |
| Demo auth can still ship | If the host build lacks `VITE_SUPABASE_URL`, the bundle silently runs browser-only accounts and a purchase has nothing to attach to | `AUTH_MODE` in `auth.jsx`; P0-1 |
| Public surface was missing | `/` served the login wall to crawlers; no `sitemap.xml`; `robots.txt` unpublished (both 404 on the live host today) | verified by HEAD request; P0-3 |
| Error visibility | `VITE_ERROR_ENDPOINT` empty ⇒ ring buffer in memory only | P1-4 |
| Service worker | `VERSION = 'cx-v1'` hardcoded ⇒ a released fix can be masked by a cached shell | P1-3; `public/sw.js` |
| 71 unlabelled controls | Accessibility ratchet, not yet zero | `check:frontend` baseline |
| **i18n is mostly decorative** | 24 catalogs × 100 keys exist and pass parity, but **3 of 44 pages** call `useI18n` (61 `t()` sites in total). The interface body is English in every language. | measured 19:55, 18 Nov |

## 4. What I can do for this app

### A. Do now, no credentials, no permission needed

1. **Finish the public surface** — session-aware `/`, one route per URL (no duplicate
   definitions), `sitemap.xml` generated from `routes.js` and enforced in the gate,
   canonical/`robots`/OG tags per route, legacy `#/` adoption.
2. **Make the checks honest** — the sitemap script exists but is not in
   `package.json`; add `seo:sitemap` + `check:sitemap` so a drift fails the build.
   *(Closed by the concurrent build at 18:40: `seo:sitemap` / `seo:check` are now
   in `package.json`, `seo:check` is in the `check` chain, and `public/sitemap.xml`
   exists.)*
3. **Tests for the untested** — `routes.js`, `seo.js`, the route tree and the
   landing page have **zero** unit tests today. Add manifest invariants (unique
   paths, title ≤ 60 chars, description ≤ 158, private/public disjoint) and an
   anonymous-vs-signed-in render test.
4. **Service-worker versioning** — inject `VITE_BUILD_STAMP` into the cache name so
   a release is actually delivered.
5. **Accessibility ratchet down** — the 71 `[control-label]` defects, one page at a
   time, lowering the baseline each time.
6. **Copy and docs** — README/OPERATIONS still point at `cryptox.site.accio.ai`
   while the published host is `cryptox-v2.site.accio.ai`; CHANGELOG discipline.
7. **Social/OG asset** — `seo.js` advertises `/og-image.png`, which does not exist
   in `public/`, so every share preview is broken today.
   *(Closed by the concurrent build at 18:36: `public/og-image.png` now exists.)*
8. **Review of the in-flight modules** — copy trading, universal search, referral,
   launchpad, academy, entitlements: read them against their own claims, run their
   tests, and report which claims are backed.

### Implemented in these passes (mine)

| # | Change | Files | Why |
|---|---|---|---|
| 1 | **All five quotas have a server mechanism** | `supabase/migrations/0008_quotas_portfolios_seats.sql` (portfolios trigger, `cx_organizations`, `cx_org_members`, seat trigger, extended `cx_consume_quota`) | Portfolios and seats had no row to count, so the plan limit could not bind. Both now fail closed. Apply 0007 then 0008, then flip the two flags. |
| 2 | **Quota state is three-valued** | `src/lib/entitlements.js` (`enforcementState()`), `src/pages/Pricing.jsx` (`PENDING_KEYS`, `pendingMigrations()`, three-sentence disclosure), `src/pages/pricing.enforcement.test.jsx` (10 tests) | Two states forced a choice between claiming a migration is live and denying a mechanism that exists. The page now says which is which, from data. |
| 3 | **Model answers, server-side** | `supabase/functions/ai-assistant/{handler.js,index.ts,handler.test.js}` (18 tests), `src/lib/assistantClient.js` + test (12 tests), `src/pages/Assistant.jsx` | `ai.js` had the abstraction and no call site. The key now lives in the function; the page labels which of the two assistants answered and why the other did not. |
| 4 | **Demo-auth builds are refused** | `scripts/check-deploy-env.mjs` + test (10 tests), `.env.example`, `package.json` (`check:deploy` in the chain) | A build without Supabase env ships browser-only accounts, so a paid purchase attaches to nobody. Also refuses a privileged admin key in a `VITE_` variable. |
| 5 | **Service worker actually works** | `public/sw.js` (stamped version, documents network-first), `src/lib/pwa.js` + test (11 tests), `vite.config.js` plugin, `src/main.jsx` | The worker was never registered and its cache name never changed — a shipped fix could be masked indefinitely. Registration is production-only and updates wait for the user. |
| 6 | **Error reports can leave the browser safely** | `src/lib/telemetry.js` + test (13 tests) | The endpoint received raw URLs (query strings can carry reset tokens) and unbounded stacks, with no cap or de-duplication. Now sanitised, capped at 20/session, and an `http://` collector is refused. |
| 7 | **Accessibility ratchet to zero** | 30+ components/pages (aria-labels wired or added), `scripts/check-frontend.mjs` (baseline 71 → 0, comments no longer counted as markup) | 71 controls announced unnamed by a screen reader. |

Verified: `npx vitest run` on the touched files → 148, 34, 18, 12, 11, 13 and 60 tests green; `node scripts/check-schema.mjs` → PASSED (8 migrations, 17 tables, all with RLS); `node scripts/check-frontend.mjs` → PASSED with `[control-label]` at 0.

### B. Do once you give me access or a decision

| Item | What I need |
|---|---|
| P0-1 demo-auth fix | Confirm the host build injects `VITE_SUPABASE_URL` + publishable key, then I verify signup writes `auth.users` |
| P0-2 server-side quotas | Approval to add RLS + a metering edge function (migration `0007` is already in flight) |
| Real assistant | A model key held server-side; I add one edge function and keep the client-side guards |
| Publish / rollback | Your go-ahead to publish `dist/` — I will not push to production unasked |
| Lemon Squeezy test purchase | Test-mode store confirmation (the last attempt hit a **live** checkout and was correctly aborted) |

### C. Outside my reach — needs a human, a budget or a third party

Market-data licensing (CoinGecko paid plan, Binance display position), legal review of
terms/privacy/risk, "CryptoX" trademark clearance in classes 9/36/42, penetration test,
WCAG 2.2 AA specialist audit, and a monitored support mailbox.

## 5. What is coming

### Already in flight in this tree (uncommitted)

Public surface (`PublicLayout`, `PublicFrame`, `SeoManager`, `BrandLogo`, hero visual,
robots, sitemap generator, `hashCompat`), plus new product modules written against a
numbered brief: **copy trading (§18), universal search (§31), referral (§34),
launchpad (§35), academy (§36), server-authoritative entitlements + `0007` migration**,
and tightened Lemon Squeezy test/live key separation.

### Recommended order after that

| Phase | Work | Why it is next | Effort |
|---|---|---|---|
| 1 | Public surface finished + tested + sitemap enforced | Acquisition is impossible until a crawler sees a page | 1 day |
| 2 | OG image, structured data, `README`/host URL drift | Shares and docs currently mislead | hours |
| 3 | Server-side quotas (RLS + metering) | The pricing table is a false claim until then | 2–4 days |
| 4 | SW versioning, error collector, scripted anonymous smoke | A shipped fix that never reaches users is worse than a bug | 1 day |
| 5 | Accessibility to zero + i18n coverage audit | 24 catalogs, 52 verified keys — the other ~40 pages are unverified | 2–3 days |
| 6 | Real assistant behind an edge function | The abstraction already exists; only the key and the route are missing | 3–5 days |
| 7 | Licensed data + legal sign-off | Business, not code | external |

## 6. Verification log

| When | What | Result |
|---|---|---|
| 18:29 | `npm test` (pre-edit tree) | 68 files, 1,913/1,913 pass, 213s |
| 18:33 | Live host `https://cryptox-v2.site.accio.ai/sitemap.xml` | **404** |
| 18:33 | Live host `https://cryptox-v2.site.accio.ai/robots.txt` | **404** |
| 18:40 | Working tree | **Being written by a concurrent process** — see §5 |
| 18:37 | `vitest run` on the 6 new modules (copy trading, universal search, referral, launchpad, academy, entitlements) | **148/148 pass** in 6 files |
| 18:45 | `vitest run src/pages/pricing.enforcement.test.jsx` (my change) | 7/7 pass |
| 18:47 | `node scripts/check-frontend.mjs` | PASSED, no new a11y/responsive errors; `[control-label]` still 71 |
| 18:48 | Working tree | Still being written (new `check-bundle.mjs`, `production.test.jsx`) — full gate not yet meaningful |
| 19:20 | `integration.test.js` schema contract (60 tests) | PASS after fixing a real false positive: an unbounded regex failed on any later `for delete` policy in another table |
| 19:20 | `node scripts/check-schema.mjs` | PASSED — 8 migrations, 17 tables, 17 with RLS |
| 19:22 | `node scripts/check-frontend.mjs` | PASSED — `[control-label]` 0 (baseline 0) |
| 19:24 | `npm test` (full suite, after all edits) | Run in background — result recorded in the conversation, not here |
