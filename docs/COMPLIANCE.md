# Compliance & Legal Gap Analysis — CryptoX

_Last updated 11 September 2026. **This is an engineering assessment, not legal advice.** Every item marked ⚖️ requires qualified counsel in the jurisdictions you operate in._

## 1. What this product actually is (and is not)

**Is:** a client-side dashboard and simulator. It displays public market data, computes textbook indicators, backtests rules against historical candles, and simulates trades with virtual money.

**Is not:** a broker, exchange, custodian, wallet, adviser, signal service, or order router. **No orders are placed, no funds are held, no assets are transferred.** This framing is the single most important regulatory fact about the build and must not change without reopening this analysis.

## 2. Data inventory and flows

| Data | Type | Storage | Leaves the device? |
|---|---|---|---|
| Email address | Personal data | localStorage | No (except no email is sent at all) |
| Password | Credential | PBKDF2 hash + salt in localStorage | No |
| Session metadata | Operational | localStorage (`cx_session_v2`) | No |
| Watchlist, portfolio, alerts, strategies, paper trades, consent choice | User content | localStorage | No |
| Requests to CoinGecko / Binance / Alternative.me | IP + headers | Not stored by the app | **Yes** — to those providers |
| Client error reports | Diagnostic | In-memory ring buffer; optional HTTPS endpoint if configured | Only if `VITE_ERROR_ENDPOINT` is set |

No cookies, no analytics SDKs, no advertising pixels, no cross-site trackers, no fingerprinting.

## 3. Privacy compliance

| Requirement | Status |
|---|---|
| Transparency about local storage & third-party requests | ✅ In-app privacy notice + consent banner + `/legal/privacy` |
| GDPR/UK-GDPR lawful basis | ✅ Consent / legitimate interest documented; withdraw via banner or clearing storage |
| Data subject rights (access, erasure, portability, objection) | ✅ Exercisable directly in the browser; documented in the notice |
| Retention limits | ✅ Sessions expire (12h/30m); local data removed on user action |
| Children's data | ✅ Not directed at children; stated in the notice |
| Data Processing Agreements with processors | ⚖️ None needed today (no server processors); required once a backend, email provider or error collector is added |
| Records of processing (Art. 30) | ⚖️ To be produced by the controller before launch |
| CCPA/CPRA | ⚖️ "Do not sell/share" posture is trivially satisfied (no sale/share), but formal notice wording needs review |
| Cookie policy | ✅ Not applicable to cookies; storage notice covers localStorage |

## 4. Market-data licensing (critical for commercial use)

| Source | Current use | Commercial requirement |
|---|---|---|
| CoinGecko API (markets, global, status) | Free public endpoints, attributed by usage | ⚖️💰 Free/demo tiers are rate-limited and not intended for commercial redistribution — a paid plan or licence is required |
| CoinGecko image CDN (coin logos) | Hotlinked as part of the data feed | ⚖️ Confirm asset usage terms for commercial deployment or self-host with permission |
| Binance WebSocket / REST (klines, tickers) | Public market data | ⚖️💰 Redistribution of exchange market data typically requires a data licence; also note regional access restrictions |
| Alternative.me Fear & Greed | Public endpoint | ⚖️ Confirm terms for commercial display |

**Action:** obtain written licences (or replace sources with licensed feeds) **before** charging money, running ads, or operating at commercial scale. Until then, the deployment must remain a demo.

## 5. Financial-services regulation

If the product later (a) places real orders, (b) provides personalised advice or recommendations, (c) manages third-party funds, or (d) operates as a signal service for a fee, then a licensing analysis is mandatory. Typical touchpoints:

- **EU/UK:** MiCA (crypto-asset services), MiFID II if advice/portfolio management, financial-promotion rules for marketing.
- **UAE:** VARA (Dubai) / ADGM.
- **US:** SEC/CFTC depending on asset and activity; state money-transmitter rules for custody/transfers.
- **Pakistan and other national regimes:** local securities/crypto rules and payment restrictions.

**KYC/AML:** not applicable while no funds move and no accounts are onboarded to a financial service. It becomes applicable the moment real money, custody, or paid personalised advice exists. A KYC provider, sanctions/PEP screening, transaction monitoring and a reporting officer would then be required.

**Current controls that support a future compliance posture:** no execution path exists at all, all performance output is labelled simulation, and synthetic data can never generate signals.

## 6. Trademark and brand ⚖️

The name "CryptoX" is short, descriptive-adjacent and widely used in crypto branding. Before commercial launch:

- [ ] Search national/EU/US trademark registers in classes **9** (software), **36** (financial services), **42** (SaaS).
- [ ] Check common-law use and app-store conflicts (App Store, Google Play).
- [ ] Assess likelihood of confusion with existing "CryptoX"-style marks; consider a distinctive alternative.
- [ ] Secure domains and social handles; `cryptox.site.accio.ai` is a hosted subdomain, not owned infrastructure.
- [ ] Clear the logo/wordmark and the yellow-on-dark brand assets.

## 7. Content, marketing and disclosures

- ✅ Risk disclosure page with crypto volatility, simulation limitations and "not regulated" statements.
- ✅ Backtest assumptions disclosed in-product (next-bar fills, fees, slippage; no funding/taxes/liquidity).
- ✅ Signals are described as mechanical textbook rules, not predictive intelligence.
- ⚖️ Any marketing claim ("accurate", "real-time", "best", performance figures) must be substantiated and reviewed; avoid implying guaranteed returns.
- ⚖️ Testimonials/social proof must not be fabricated; none are present today.

## 8. Accessibility statement (target: WCAG 2.2 AA)

Implemented: semantic landmarks, skip link, keyboard-operable chart with a data-table alternative, focus-visible styles, contrast-improved muted text, ARIA labels on icon-only controls, reduced-motion support, screen-reader-friendly table alternative.

Still open: ⚖️/🧪 independent accessibility audit including screen-reader passes (NVDA/JAWS/VoiceOver), automated axe scan in CI, and verification of focus order in complex views (bubbles, modals).

## 9. Policy document inventory

| Document | Location | Status |
|---|---|---|
| Privacy notice | `/legal/privacy`, `src/pages/Legal.jsx` | Draft complete — counsel review pending ⚖️ |
| Terms of use | `/legal/terms` | Draft complete — counsel review pending ⚖️ |
| Risk disclosure | `/legal/risk` | Draft complete — counsel review pending ⚖️ |
| Security overview | `/legal/security`, `SECURITY.md` | Complete (engineering) |
| Consent notice | `src/components/ConsentBanner.jsx` | Complete |
| Operations & readiness | `docs/OPERATIONS.md` | Complete |

## 10. Legal review checklist (hand this to counsel)

1. Review and finalise privacy notice, terms, risk disclosure and consent wording.
2. Confirm whether the current "simulator only" positioning avoids regulated activity in target markets.
3. Confirm market-data licensing requirements with CoinGecko/Binance (or approve replacement providers).
4. Trademark clearance opinion for "CryptoX" and brand assets.
5. If monetisation is planned: assess promotional rules, consumer-protection obligations, and refund policy needs.
6. If real trading is ever planned: full licensing, KYC/AML and custody analysis before any build work.
