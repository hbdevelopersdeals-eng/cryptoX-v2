# Launch Readiness Audit — CryptoX

_Audited 19 October 2026 against the working tree in `cryptox-app/`. Engineering evidence only; licensing, legal and trademark items are external and marked as such._

## Verdict

**The code is in good shape. The product is not launchable as a paid product yet.**

All automated gates pass (1,892 tests, build, bundle budget, secret scan, config, i18n, schema). The blockers are not defects in the source — they are **configuration, exposure and enforcement gaps** around it. Three of the five P0 items are fixable in hours; two are external contracts that cannot be coded around.

The single most important finding: **the deployed build runs in demo auth mode**, so a customer can complete a Lemon Squeezy checkout with no server-side account to attach the subscription to.

---

## 1. Gate results (run on this tree)

| Gate | Command | Result |
|---|---|---|
| Unit + component tests | `npm run test` | **PASS** — 65 files, **1,892/1,892** tests, 107s |
| Production build | `npm run build` | **PASS** — built in 12.65s, 92 lazy chunks |
| Bundle budget | `npm run check:bundle` | **PASS** — first load **178.4 KB** gzip, all chunks 499.5 KB |
| Secret scan | `npm run check:secrets` | **PASS** — 283 files, 1 publishable anon JWT, 0 privileged-role refs |
| Configuration policy | `npm run check:config` | **PASS** — 189 source files |
| Locale catalogs | `npm run check:locales` | **PASS** — 24 catalogs × 95 keys |
| i18n usage | `npm run check:i18n` | **PASS** — 52 literal `t()` keys resolve |
| Frontend policy | `npm run check:frontend` | **PASS with debt** — no new errors; **71 `[control-label]` defects ratcheted** |
| Schema guard | `npm run check:schema` | **PASS** — 5 migrations, 11 tables, 11 with RLS |

Raw logs: `audit/test.log`, `audit/build.log`.

---

## 2. P0 — launch blockers

### P0-1. Production runs in demo auth mode (no server-side accounts)

**Evidence**
- Live site `https://cryptox.site.accio.ai/` renders the login screen with the footer *"Demo build — accounts and data stay in your browser. No real trading."*
- The same screen offers *"Continue with Google (demo)"* and *"Demo shortcut — no real Google OAuth is configured."*
- `src/lib/auth.jsx:37` — `AUTH_MODE = supabaseConfigured ? 'supabase' : 'demo'`; the demo banner only renders in that branch.
- `.env.example` documents **only** `VITE_APP_VERSION`, `VITE_BUILD_STAMP`, `VITE_ERROR_ENDPOINT`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required by `src/lib/supabase.js` but are **not documented anywhere in the build config**.

**Why it blocks launch**
The entitlement chain is: browser → `lemonsqueezy-checkout` (mints nonce) → Lemon Squeezy → `lemonsqueezy-webhook` (verifies signature, consumes nonce, **writes the subscription row to Supabase**). With no Supabase account there is no row and no user to bind it to. A paying customer would complete checkout and receive nothing. It also means every "account" today is a browser-local PBKDF2 record that disappears with site data.

**Fix**
1. Add `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` to the build environment and to `.env.example` (they are public by design — publishable/anon only, never privileged-role).
2. Rebuild and confirm the demo banner and "(demo)" Google button disappear.
3. Sign up in production and confirm a row appears in `auth.users`.
4. Run one **test-mode** purchase end-to-end and confirm the webhook writes `cx_subscriptions` and the plan flips.

**Effort:** hours. **Owner:** whoever controls the Accio static host build settings.

### P0-2. Entitlements are UI-only, not access control

**Evidence** — `src/lib/upgrade.js` states it plainly: *"everything here runs in the browser, so it is a UI affordance, NOT access control. Hiding a button does not protect anything... a determined user can bypass every gate in this file."*

**Why it blocks launch**
The paid tiers sell quotas (`alerts: 100`, `bots: 3`, `apiCallsPerMonth: 250 000`) and route access (`/bots`, `/strategies`, `/derivatives`, `/exchange`). None of these are enforced where the data lives. On launch day a free user can exceed every quota by editing localStorage, which is both revenue leakage and a truthfulness problem in the pricing table.

**Fix** — enforce at the data layer: Postgres RLS + an edge function for metered counters (`apiCallsPerMonth`, `alerts`, `portfolios`, `bots`), so the limit is checked on write, not on render.

**Effort:** 2–4 days. **Owner:** engineering.

### P0-3. No public surface — the entire site is behind login

**Evidence**
- `src/App.jsx`: only `/login`, `/register`, `/forgot-password`, `/reset-password` and `/legal/:doc` are public; **every other route** sits inside `<RequireAuth>`.
- Live check: `https://cryptox.site.accio.ai/` → login form. `https://cryptox.site.accio.ai/status` → **also** login form (the status page is auth-gated).
- `public/` contains **no `robots.txt` and no `sitemap.xml`**.

**Why it blocks launch**
There is nothing to rank, nothing to advertise to, and nothing a prospect can evaluate before creating an account. It also breaks the app's own release runbook: `docs/OPERATIONS.md` §3 step 7 says to verify `/status` after deploy, which an anonymous visitor cannot load.

**Fix**
1. Public landing page (value prop, live-data proof, pricing teaser) at `/`, with the app moved to `/app/*` or gated by CTA.
2. Make `/pricing`, `/status` and `/legal/*` public.
3. Add `robots.txt`, `sitemap.xml`, canonical + OG/Twitter meta per public route (a `seo.js` module already exists to build on).

**Effort:** 2–3 days. **Owner:** engineering + copy.

### P0-4. Market-data licensing not in place (external)

**Evidence** — `docs/COMPLIANCE.md` §4: CoinGecko free/demo tiers are *"not intended for commercial redistribution — a paid plan or licence is required"*; Binance market data redistribution *"typically requires a data licence"*; Fear & Greed terms unconfirmed.

**Why it blocks launch** — charging money or running ads on unlicensed redistributed market data is the exposure that ends the product, not a warning letter about code quality.

**Fix** — paid CoinGecko plan (or licensed replacement) and a written position on Binance display; if neither is affordable, keep the deployment non-commercial and label it a demo (which is what it is today).

**Owner:** business, not code.

### P0-5. Legal and trademark review pending (external)

**Evidence** — `docs/COMPLIANCE.md` §6 and §10: terms, privacy notice and risk disclosure are drafts pending counsel; "CryptoX" trademark clearance in classes 9/36/42 not done; no refund/cancellation policy documented despite subscriptions with 14-day trials sold through Lemon Squeezy.

**Why it blocks launch** — consumer subscription sales create cancellation, refund and promotional-claim obligations that a draft notice does not satisfy.

**Owner:** counsel + business. **Code dependency:** add a refund/cancellation section to `/legal/terms` and link it from Billing once counsel signs off.

---

## 3. P1 — fix before paid traffic

| # | Issue | Evidence | Fix |
|---|---|---|---|
| P1-1 | **CSP allows inline scripts** | `index.html` meta: `script-src 'self' 'unsafe-inline'`; `public/_headers` is strict (`script-src 'self'`) but the host may not apply it | Confirm real headers with `curl -I`; if absent, move CSP to the host and remove the meta fallback |
| P1-2 | **71 unlabelled form controls** | `check:frontend` baseline: `[control-label] 71 occurrence(s)` | Associate `<label for>` / `aria-label`; ratchet the baseline down to 0 |
| P1-3 | **Service worker can serve a stale build** | `public/sw.js`: `VERSION = 'cx-v1'` is hardcoded, `./index.html` is precached, `skipWaiting()` is unconditional. The SW file never changes between releases, so browsers never install a new worker and keep the old shell | Generate the cache version from `VITE_BUILD_STAMP`, or make navigation requests network-first |
| P1-4 | **No production error visibility** | `.env.example` ships `VITE_ERROR_ENDPOINT=""`; telemetry is an in-memory ring buffer | Point it at an HTTPS collector (Sentry-style) before traffic |
| P1-5 | **No staging, no post-deploy smoke** | `docs/OPERATIONS.md` §7 lists both as external items; `/status` is auth-gated so the smoke step cannot run | Add a staging target and a scripted anonymous smoke check |
| P1-6 | **Enterprise tier is self-serve at \$199.99/mo** | `plans.js` sells seats/audit log/dedicated support through the same checkout; `/organization` exists but seat and SSO enforcement are not verified | Either verify seat enforcement server-side or move Enterprise to "contact sales" |

---

## 4. P2 — polish

- **Accessibility automation**: no axe scan in CI; the 71 defects above were found by a static rule only. Add `jest-axe` on the page tests.
- **Localization depth**: 24 catalogs × 95 keys, but `check:i18n` only validates 52 literal `t()` keys. Non-English coverage of the ~40 pages is therefore unverified — likely partial. Audit before advertising language support.
- **Bundle**: 178.4 KB first load is healthy; no action.

---

## 5. Sequence I recommend

| Window | Work | Unblocks |
|---|---|---|
| Day 1 | P0-1: env vars, rebuild, verify signup + one test-mode purchase | Taking money at all |
| Day 2–5 | P0-2: server-side quota enforcement for alerts, portfolios, bots, API calls | Pricing table becoming true |
| Day 6–8 | P0-3: public landing, pricing, status, robots/sitemap, OG meta | Any acquisition |
| Day 9–10 | P1-1, P1-3, P1-4: headers verification, SW versioning, error collector | Safe operation |
| In parallel | P0-4, P0-5 with counsel and data providers | Legal right to charge |

Until Day 1 is done, the site should keep saying "demo" — because that is what it currently is.
