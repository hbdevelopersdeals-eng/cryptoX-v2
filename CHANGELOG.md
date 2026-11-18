# Changelog

All notable changes to CryptoX are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased] — "Every claim checkable"

### Added
- **Server-side quota enforcement for the last two keys** (`0008_quotas_portfolios_seats.sql`): portfolios are counted from the `cx_settings.portfolios` array by a BEFORE INSERT/UPDATE trigger, and seats from a new `cx_org_members` table whose limit comes from the **organisation owner's** plan. Both fail closed on an unknown plan or key, and `cx_consume_quota()` now understands both shapes.
- **A real model behind the assistant, server-side** (`supabase/functions/ai-assistant`): provider abstraction with fallback order (Anthropic → OpenAI → Google), the system prompt held on the server, an allow-listed market context, secret and injection screening, output validation that refuses advice-shaped answers, and a 501 when no key is configured. The page now says which of the two answered — a model or the deterministic router — and why.
- **A build gate for the deploy environment** (`scripts/check-deploy-env.mjs`, wired into `npm run check`): a build with no `VITE_SUPABASE_URL` ships demo auth, where a paid purchase has no account to attach to. The gate fails that build and refuses a privileged admin key in any `VITE_` variable.
- **Service-worker versioning and registration** (`src/lib/pwa.js`, stamped build): the worker was never registered and its cache version was the literal `cx-v1`, so a shipped fix could never replace the cached shell. It now registers in production, carries the build stamp, serves documents network-first, and waits for the user before taking over.

### Changed
- **Quota state is three-valued, not two.** `enforcementState()` returns `server`, `pending-migration` or `display-only`, and the pricing table's disclosure names which keys are refused by Postgres today and which are waiting on migration 0008. Claiming "enforced" for a migration that may not be applied is the same false claim as selling a quota nobody checks.
- **Error reports are sanitised before they leave the browser**: query strings dropped, emails/keys/JWTs redacted, stacks capped, 20 reports per session with a 30-second de-duplication window, and an `http://` collector refused rather than downgraded.

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- `shouldSend()` swallowed the first sighting of an error; `activateUpdate()` reported success when no worker was waiting.
- The frontend guard counted markup mentioned inside a **comment** as real markup (a test file explaining `<select>` was reported as an unlabelled control), and the schema contract used an unbounded regex that failed on any later `for delete` policy in a different table.
- **All 71 `[control-label]` defects are fixed**; the ratchet baseline is now 0, so a new unlabelled control fails the build.

## [Unreleased] — "Two more presets, one honest feed"

### Added
- **Stochastic RSI preset** (`stoch-rsi`): %K/%D crossover gated to the oversold and overbought zones, implemented in both the strategy engine and `signalSeries`, so what an armed strategy signals and what the backtester measures are the same rule.
- **CCI Reversal preset** (`cci-reversal`): CCI crossing back through ±100, with configurable period and thresholds.
- The market table now carries CoinGecko's full 250-coin page instead of an arbitrary 150-row cut of a response already being paid for; the header states `showing N of M`.

### Changed
- **The invented price movement is gone.** A sine-wave "wobble" used to nudge every row without a live exchange pair — and the headline market cap, volume and BTC dominance — so the table looked alive. It was fabricated movement drawn exactly like a real tick. Rows without a live pair now keep the provider's last value, are marked `~` with a tooltip and a footnote, and move only when the provider refreshes them every 60 seconds.

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- `stochRsi` could emit values outside 0–100 on a flat or near-flat window; `raw`, `%K` and `%D` are now clamped.

## [Unreleased] — "Wallet Lab (read-only)"

**Scope decision.** Section 9 asked for a non-custodial wallet. This app deliberately does **not** implement key custody. Generating or storing a seed phrase / private key in a browser-only React app is a catastrophic risk: localStorage is readable by any script on the origin, there is no secure element, and an XSS bug becomes irreversible total loss. Nothing is generated, derived, stored, signed or broadcast. What was built instead is the safe, genuinely working half: everything you should check *before* you sign.

### Added
- **Keccak-256 + EIP-55** (`src/lib/keccak.js`): the original Keccak padding Ethereum uses, verified against published vectors (`""`, `"abc"`, the `0xa9059cbb` / `0x70a08231` selectors). Unlocks real EIP-55 checksum validation, so a single mistyped character is caught before signing.
- **Address codecs** (`src/lib/addressCodec.js`): bech32 + bech32m (BIP-173/350) with real checksum verification, and base58 with documented limits.
- **Chain registry** (`src/lib/chains.js`): SLIP-44 coin types, standard derivation paths and concrete path building for EVM, Bitcoin, Solana, Tron, XRP, Sui, Aptos, TON, Cosmos, Polkadot and Cardano. Each validator reports how far it actually goes — `verified` (a real checksum was checked) vs `unverified` (format only) vs `not-applicable`. A passing format check is never presented as proof an address is spendable.
- **Wallet safety analysis** (`src/lib/walletSecurity.js`): the custody policy, an honest capability matrix, **address-poisoning (lookalike) detection** against your own address book, and **approval risk scoring** (unlimited allowances, burn-address spenders, unlabelled spenders).
- **Read-only EVM layer** (`src/lib/evmRead.js`): live EIP-1559 fee suggestion, `eth_call` dry-run simulation with decoded revert reasons, gas estimation, nonce, EOA-vs-contract probing, plus ERC-20 allowance / balanceOf / metadata reads. Endpoint fallback, and a revert is surfaced immediately while a dead endpoint falls through.
- **Wallet Lab page** with six tabs: Custody policy, Address check, Chains & paths, Gas & simulate, Approvals, Capabilities.

### Verified live
`eth_feeHistory`, `eth_call decimals()` (USDC → 6), `eth_getCode` (contract detection) and `eth_call allowance()` were each exercised against public RPC before being claimed to work.

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- Bitcoin bech32 validation fed the witness-version byte into the 5→8 bit conversion, making the padding invalid and **rejecting every valid segwit address**.
- `KNOWN_BURN` used mixed-case keys while every lookup lowercases first, so the burn-address check silently never matched.
- `rpcRequest` returned on the first JSON-RPC error instead of trying the next endpoint — a dead endpoint answering with an error envelope disabled the chain. Reverts now surface immediately; infrastructure errors fall through.
- `addressSimilarity` counted the shared `0x` prefix, handing every EVM pair two characters of free "similarity" and biasing poisoning detection.
- XRP validation asserted a version byte that could not be confirmed against a primary source; reduced to structural checks and labelled unverified.

## [Unreleased] — "Portfolio engine"

### Added
- **Portfolio engine** (`src/lib/portfolio.js`): FIFO lot matching per coin, with buy fees added to cost basis and sell fees deducted from proceeds; realized P&L per disposal; open positions with average entry, unrealized P&L, ROI and weights; portfolio totals.
- **Multiple manual portfolios**: every transaction carries a portfolio label and the page filters on it.
- **Allocation** by asset, by chain and by **custody venue**. Venue allocation works on lots, so a coin held on two exchanges is split rather than merged.
- **Tax lots and reports**: one row per disposal with proceeds, cost basis, gain, holding period and short/long term classification, plus CSV export.
- **Profit/loss calendar**: realized P&L per day in a month grid with monthly totals.
- **Performance history**: hourly equity snapshots recorded locally, rendered as an equity curve with max drawdown, current drawdown and change since the first snapshot. APR/APY are shown as a **naive holding-period annualisation**, explicitly not a money-weighted (IRR) figure.
- **Portfolio risk**: Herfindahl-Hirschman concentration index, effective number of positions, top-1/top-3 weight, and a volume-weighted average of per-coin volatility with an explicit statement that correlation is not modelled.
- **Read-only blockchain wallet tracking** (`src/lib/wallets.js`): native balances for Bitcoin (Blockstream), Ethereum, Arbitrum, OP Mainnet, BNB Chain, Polygon (public JSON-RPC) and Solana. Public addresses only — no seed phrase, private key, exchange secret, signing, or wallet-connect provider is ever requested or stored.
- **Portfolio value alerts**: `portfolio_value_above` / `portfolio_value_below` rule types, evaluated cross-aware by the existing alert engine. Manageable from both the Portfolio and Alerts pages.

### Changed
- Portfolio storage moved from a flat holdings list to a transaction ledger; existing holdings are **migrated automatically** into buy transactions so cost basis is preserved.
- DexScreener quotes now carry real on-chain pool liquidity.

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- `buildPortfolio` exposed two different `totals` objects (lots vs positions) under the same key, so position totals were silently overwritten by realized totals.
- An oversell is reported as a warning and clamped to the units actually held, instead of generating phantom lots.
- A transfer-in with no stated cost basis is recorded at 0 and flagged, rather than being assigned an invented purchase price.

## [Unreleased] — "Exchange aggregator + alert rules engine"

### Added
- **Exchange aggregator** (`src/lib/aggregator.js` + `/aggregator` page): per asset it finds the cheapest venue to buy and the dearest to sell, reports the spread in price and percent, lists cross-venue price gaps with a gross/net split after a user-chosen round-trip fee, and builds a venue leaderboard (assets quoted, best-price wins, average spread in bps, reported 24h volume). Venue ingestion health is shown per source; an unreachable venue is excluded rather than back-filled.
- **Per-exchange price comparison grid** (`priceMatrix`): one column per venue that actually quoted the asset, plus that coin's cross-venue global average and the cheapest/dearest venue. Absent venues render as a dash — never as zero or invented data.
- **Best execution venue** (`bestExecutionVenue`): where to route a buy (cheapest venue) and a sell (dearest venue) per asset, with the price delta against the cross-venue average and a note when the winning venue does not publish comparable volume.
- **Liquidity and volume reporting** (`liquidityProfile`, `VOLUME_UNIT`): 24h volume is totalled **only** across venues whose field is genuinely quote-denominated (Binance, Kraken, Bybit, KuCoin, Bitget, Gate, MEXC). Venues publishing base-asset volume (OKX, HTX) or publishing none are named and excluded from totals instead of being blended. DEX pool liquidity (DexScreener `liquidity.usd`) is surfaced separately and never added to CEX volume. Order-book depth is reported as *not published* — these public tickers do not expose it.
- Venue leaderboard gained a **reported 24h volume** column; the DexScreener adapter now carries real on-chain pool liquidity through to the quote.
- **Alert rules engine** (`src/lib/alertsEngine.js`, `src/lib/alertContext.js`): nine rule types (price above/below, 24h change, volume spike, RSI above/below, MA cross, MACD cross, range breakout), crossover-aware evaluation, per-rule cooldown windows and validation. Context is built from live tickers plus candle history, and **volume and its baseline are always taken from the same candle source** so a 24h USD figure is never compared against a per-bar figure.
- **Alert engine UI** on `/alerts`: rule builder, per-rule pause/resume, live "what the rule sees now" readouts, cooldown controls, browser-notification opt-in, and a local trigger history with cooldown reset.
- Page-level render tests (`src/pages/pages.test.jsx`) covering both new surfaces, including empty, single-venue, legacy-alert and corrupt-storage cases.

### Changed
- Indicator-based alerts stay silent until enough candles load and **never fire on simulated data**.
- Existing `{ dir, target }` price alerts are migrated to the rule schema on read instead of being dropped (`normaliseAlert`).
- Transaction history is retained locally in the browser (last 200 firings).

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- `bestBidAsk` returned a **negative** spread because it subtracted the highest venue price from the lowest; cross-venue last trades are now modelled with unambiguous `bestBuy` / `bestSell` semantics and a non-negative spread.
- Average-price dispersion divided by the median instead of the lowest venue price.
- `aggregateVenues` dropped the asset symbol, leaving the summary without a symbol.
- Two different definitions of "spread %" coexisted (mid-based in `bestQuotes`, lowest-based in the new price matrix). Both are now mid-based; the lowest-based measure is kept only where it is labelled dispersion.
- Volume figures were double-prefixed with `$` because `fmtCompact` already returns a currency symbol.
- Cooldown logic suppressed a rule's **first** firing (comparing an epoch `now` against a `0` default) and could not express per-rule windows.

## [1.0.0] — 2026-09-11 — "Production-hardening pass"

### Added
- **Real backtesting engine** (`src/lib/backtest.js`): next-bar fills (no look-ahead), per-side fees and slippage, position sizing, buy & hold comparison, Sharpe, Sortino, max drawdown, win rate, profit factor, expectancy, exposure, walk-forward in-sample/out-of-sample split, and last-trades view in the UI.
- **Data provenance system**: every row and candle is tagged `coingecko | binance | simulated`; a global `feed` state drives the topbar chip; charts show a `SIMULATED DATA` badge; the strategy engine, backtester and paper trader refuse synthetic data.
- **Reliability layer**: global error boundary with diagnostics copy, telemetry ring buffer (`src/lib/telemetry.js`), window/unhandledrejection capture, feed circuit breaker with exponential backoff + jitter and 60s slow retry, 20-second stale-feed detection, socket pause on tab hide, `/status` page.
- **Security hardening**: CSP and referrer meta, `public/_headers` header contract, numeric input clamping, external-link hardening, `scripts/check-config.mjs` policy guard.
- **Automated test suite**: 56 Vitest unit/component tests covering indicators, all eight strategies, the backtester, formatters, auth hashing/lockout and the error boundary; `npm run test:coverage`.
- **CI pipeline**: `.github/workflows/ci.yml` — locked install, coverage tests, production build, config guard, bundle budget, audit report, blocking critical-advisory gate.
- **Compliance pack**: in-app Privacy, Terms, Risk Disclosure and Security pages, consent banner, and `docs/COMPLIANCE.md` (data map, GDPR/CCPA, KYC/AML & licensing gap analysis, trademark checklist).
- **Ops docs**: README, SECURITY.md, `docs/OPERATIONS.md` (environments, release/rollback, monitoring map, incident runbook, external readiness checklist), `.env.example`, CHANGELOG.
- **Accessibility**: skip link, landmarks and ARIA labels, keyboard-navigable chart (arrows/Home/End/Escape) with description and a data-table alternative, visible focus rings, increased muted-text contrast, `prefers-reduced-motion` support.
- **Performance**: route-level code splitting (initial JS 246 KB raw / 79.7 KB gzip), memo-friendly structure, `content-visibility` utility for long lists, visibility-aware pausing.

### Changed
- **Authentication rewritten**: PBKDF2-SHA256 (210k iterations, per-user salt, constant-time compare) replaces plaintext localStorage passwords, with automatic migration of legacy accounts; account lockout (5 attempts / 15 minutes); sessions now expire (12h absolute, 30m idle); verification codes are random, hashed, time-limited and attempt-limited, surfaced in a clearly labelled demo inbox instead of "any 6-digit code works".
- **Donchian breakout corrected** to compare against the *prior* bar's channel (the previous implementation could never trigger). Found by the new test suite; live evaluation and backtest share the corrected logic.
- Google sign-in is explicitly labelled a demo shortcut.
- Fear & Greed endpoint now returns source provenance and is badged when the live feed is unavailable.

### Measured, not yet fixed
- **Translation coverage is 3 of 44 pages.** The 24 catalogs and the 100-key parity check are real, but only three pages call `useI18n`; the rest of the interface renders English regardless of the selected language. Recorded here so the language selector is not mistaken for a translated product. Full localisation is a multi-day track, not a release task.
### Fixed
- Coin detail page crash (`Cannot read properties of null (reading 'length')`) — guarded before chart render.
- Infinite render loop and "objects are not valid as a React child" on the coin page — caused by a state setter named `setInterval` shadowing the global timer (also fixed pre-emptively in the paper trader); `scripts/check-config.mjs` now fails the build if that pattern reappears.
- Upgraded `react-router-dom` 6.28 → 6.30.6, `vite` 5.4.11 → 5.4.21, `postcss` 8.4.49 → 8.5.28 to clear applicable advisories.

### Known limitations
- Client-only identity and storage; no server, no real order execution.
- Backtests exclude funding/borrow costs, taxes, liquidity limits and partial fills.
- Outstanding dependency advisories and other residual risks are listed in SECURITY.md.

## [0.9.0] — 2026-09-04 — Initial demo
- CryptoX dashboard: live Binance/CoinGecko feeds, market table, canvas candlestick chart, eight one-click strategy presets, paper trader, watchlist, portfolio, alerts, bubbles, fear & greed, calculator, news pulse; published to `cryptox.site.accio.ai`.
