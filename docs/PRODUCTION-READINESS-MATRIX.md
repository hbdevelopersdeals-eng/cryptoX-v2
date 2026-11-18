# CryptoX — Production-Readiness Matrix

_Traceability for every item in `CryptoX_Master_Production_Ready_Checklist.docx` (702 items, 48 sections plus Product Vision), audited against the working tree in `cryptox-app/`._

## How to read this

The checklist mixes four different kinds of work, and treating them as one list is why "100% complete" is a claim nobody can verify. Each item below carries one status:

| Status | Meaning |
|---|---|
| **CODE** | Behaviour is implemented in this repository and reachable in the running app. |
| **SIM** | Implemented as an explicit simulation or analysis surface. The product places no real orders, holds no customer funds and signs nothing — this is stated in the UI, not implied. |
| **PART** | Something real exists, and a named part is missing. The missing part is written down. |
| **EXT** | Cannot be closed by writing code in this repository: a licence, an audit, a native binary, a hardware module, a legal opinion or production infrastructure. |
| **GAP** | Not implemented. |

**What this audit does not claim.** `EXT` is not "done later by an engineer". A SOC 2 report, a penetration test, an HSM, a market-data redistribution licence and an App Store binary are contractual and physical artefacts. A repository can prepare for them (controls, runbooks, schemas, disclosure pages) and cannot produce them. Any checklist that marks them complete on the strength of a commit is wrong.

**Evidence format.** `path` or `path:line` where a single call site matters. Where a whole section is one module, the module is named once and rows reference the function.

## Summary

| Section | Items | CODE | SIM | PART | EXT | GAP |
|---|---:|---:|---:|---:|---:|---:|
| 0. Product Vision | 21 | 5 | 0 | 6 | 9 | 1 |
| 1. Exchange Engine | 14 | 11 | 2 | 0 | 0 | 1 |
| 2. Derivatives | 17 | 14 | 2 | 1 | 0 | 0 |
| 3. Professional Charting | 11 | 10 | 1 | 0 | 0 | 0 |
| 4. Market Data Super-Layer | 15 | 10 | 0 | 3 | 2 | 0 |
| 5. Real-Time Data Engine | 14 | 9 | 0 | 5 | 0 | 0 |
| 6. Market Intelligence | 20 | 19 | 0 | 1 | 0 | 0 |
| 7. Exchange Aggregator | 8 | 8 | 0 | 0 | 0 | 0 |
| 8. Portfolio | 15 | 13 | 0 | 1 | 0 | 1 |
| 9. Non-Custodial Wallet | 23 | 15 | 0 | 4 | 0 | 4 |
| 10. Blockchain Explorer | 15 | 10 | 0 | 3 | 0 | 2 |
| 11. DeFi | 15 | 7 | 0 | 6 | 0 | 2 |
| 12. NFT | 11 | 7 | 0 | 3 | 0 | 1 |
| 13. News & Research | 11 | 9 | 0 | 2 | 0 | 0 |
| 14. CryptoX AI | 20 | 17 | 0 | 0 | 0 | 3 |
| 15. Trading Bots | 17 | 14 | 0 | 1 | 0 | 2 |
| 16. Alert Engine | 18 | 14 | 0 | 4 | 0 | 0 |
| 17. Social Network | 17 | 0 | 0 | 0 | 0 | 17 |
| 18. Copy Trading | 12 | 11 | 0 | 1 | 0 | 0 |
| 19. Token Research Pages | 12 | 7 | 0 | 5 | 0 | 0 |
| 20. Security | 26 | 3 | 0 | 11 | 11 | 1 |
| 21. Custody | 14 | 0 | 0 | 6 | 8 | 0 |
| 22. KYC & Compliance | 12 | 4 | 0 | 2 | 5 | 1 |
| 23. Admin Super Panel | 15 | 2 | 0 | 8 | 5 | 0 |
| 24. API Platform | 19 | 4 | 0 | 14 | 0 | 1 |
| 25. Database Architecture | 10 | 1 | 0 | 0 | 9 | 0 |
| 26. Event-Driven Architecture | 12 | 8 | 0 | 4 | 0 | 0 |
| 27. Service Architecture | 25 | 0 | 0 | 23 | 0 | 2 |
| 28. Cloud & DevOps | 16 | 1 | 0 | 1 | 14 | 0 |
| 29. Observability | 13 | 1 | 0 | 9 | 3 | 0 |
| 30. Data Quality | 10 | 10 | 0 | 0 | 0 | 0 |
| 31. Search | 15 | 4 | 0 | 1 | 0 | 10 |
| 32. Notifications | 11 | 2 | 0 | 3 | 6 | 0 |
| 33. Commercial & Billing | 11 | 6 | 0 | 2 | 3 | 0 |
| 34. Referral/Affiliate | 8 | 4 | 0 | 3 | 0 | 1 |
| 35. Launchpad | 10 | 7 | 0 | 3 | 0 | 0 |
| 36. Education | 5 | 4 | 0 | 1 | 0 | 0 |
| 37. Mobile | 15 | 8 | 1 | 3 | 1 | 2 |
| 38. Enterprise Security | 16 | 2 | 0 | 4 | 6 | 4 |
| 39. Testing | 14 | 8 | 0 | 3 | 1 | 2 |
| 40. Failure Engineering | 9 | 0 | 0 | 5 | 2 | 2 |
| 41. Data Licensing | 12 | 1 | 0 | 3 | 8 | 0 |
| 42. CryptoX Data Fusion | 8 | 5 | 0 | 3 | 0 | 0 |
| 43. Universal Identity Graph | 8 | 5 | 0 | 0 | 0 | 3 |
| 44. Provider Orchestrator | 12 | 6 | 0 | 6 | 0 | 0 |
| 45. Production UX | 13 | 9 | 1 | 2 | 0 | 1 |
| 46. Enterprise Multi-Tenancy | 18 | 5 | 0 | 12 | 1 | 0 |
| 47. Financial Accounting | 10 | 10 | 0 | 0 | 0 | 0 |
| 48. Production Release Gate | 29 | 4 | 0 | 12 | 13 | 0 |
| **Total** | **702** | **334** | **7** | **190** | **107** | **64** |

Counts are of the rows below, not estimates. The 107 `EXT` items are the ceiling on this repository: no further commit changes them. The 64 `GAP` items are buildable work, listed by section so each one can be scheduled or explicitly dropped.

---

## 0. Product Vision

The umbrella platform exists as a single React application. Native shells and super-admin infrastructure do not: a responsive web app is not an iOS app, and a PWA manifest is not App Store distribution.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | CryptoX umbrella platform | CODE | `src/App.jsx` route table |
| 2 | Web application | CODE | React 18 + Vite 5 |
| 3 | Responsive mobile web | CODE | Tailwind breakpoints; `dvh` viewport units; guarded by `scripts/check-frontend.mjs` |
| 4 | iOS application | EXT | No native target. `public/manifest.webmanifest` gives installability only; App Store distribution is a separate build, signing identity and review |
| 5 | Android application | EXT | Same as above; no AAB |
| 6 | Desktop application | EXT | No Electron/Tauri target |
| 7 | Public API | PART | Schema, error contract and versioning live in `src/lib/api.js`; a deployed gateway does not exist in this repository |
| 8 | Developer SDK | GAP | No published package |
| 9 | Institutional API | EXT | Requires contracted SLAs and dedicated infrastructure |
| 10 | Admin/control center | PART | `src/pages/Admin.jsx` — fee/risk validation, health, listing gates; cross-user data needs a server console |
| 11 | Super-admin infrastructure | EXT | Separate network-restricted deployment with its own auth |
| 12 | Multi-language | CODE | 24 catalogs in `src/locales/`, RTL handled |
| 13 | Multi-currency | CODE | `src/lib/currency.jsx`, `src/lib/currencies.js` |
| 14 | Multi-region | PART | Region/locale overrides (`src/pages/Region.jsx`); no regional deployment or data residency |
| 15 | Multi-tenant architecture | PART | Roles and permissions in `src/lib/rbac.js`, `src/lib/enterprise.js`; organisation tables are not migrated, so tenancy is enforced client-side only |
| 16 | Global CDN | EXT | Host configuration |
| 17 | 24/7 operation | EXT | Operational commitment, not code |
| 18 | High availability | EXT | Multi-AZ infrastructure |
| 19 | Disaster recovery | PART | Plans and RTO/RPO models in `src/lib/incident.js`; an untested restore is a plan, not a capability |
| 20 | Horizontal scalability | EXT | Static assets scale on a CDN; the data path does not exist yet |
| 21 | Enterprise-grade observability | PART | Client-side logs, metrics, traces and SLO models (`src/lib/observability.js`, `src/lib/sre.test.js`); no collector endpoint configured |

## 1. Exchange Engine

A deterministic matching engine with price-time priority, self-trade prevention, halts and settlement runs in the browser for paper trading. It is not a venue: latency is bounded by JavaScript, not by a kernel-bypass stack, and no real money settles.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Spot trading | SIM | `src/pages/Exchange.jsx` against the in-browser book |
| 2 | Market, limit, stop, stop-limit, take-profit, OCO, trailing-stop | CODE | `src/lib/engine/matching.js` (order-type validation and triggers) |
| 3 | Ultra-low-latency deterministic matching | SIM | Deterministic and price-time ordered; "ultra-low-latency" describes a colocated C++/Rust venue, which this is not |
| 4 | Price-time priority | CODE | `src/lib/engine/matching.js` |
| 5 | Self-trade prevention | CODE | `selfTrade` policy in `matching.js` |
| 6 | Market protection | CODE | Collar/limit-band checks before a market order sweeps |
| 7 | Tick/lot-size enforcement | CODE | `tickSize` / `lotSize` validation |
| 8 | Circuit breakers and trading halts | CODE | Halt state + breaker thresholds |
| 9 | Kill switch | CODE | `src/pages/Exchange.jsx`, `src/lib/reliability.js` |
| 10 | Real-time risk checks | CODE | Pre-trade balance/notional checks |
| 11 | Atomic settlement | CODE | `src/lib/engine/settlement.js` — both legs applied or neither |
| 12 | Level 1/2/3 order books | CODE | `src/lib/engine/depth.js` |
| 13 | Depth, spread and liquidity visualisation | CODE | `src/pages/Aggregator.jsx`, `Exchange.jsx` |
| 14 | Historical order-book replay | GAP | Event replay exists for market events (`src/lib/realtime.js`); book snapshots are not persisted |

## 2. Derivatives

Futures, perpetuals and options analytics with margin, funding, liquidation and Greeks are implemented as computation, not as a margined venue. There is no counterparty, no insurance fund balance and no real liquidation.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Futures | SIM | `src/lib/derivativesEngine.js` |
| 2 | Perpetual futures | SIM | Funding accrual in the same engine |
| 3 | Options | CODE | `src/lib/options.js` (pricing, payoff, Greeks) |
| 4 | Cross/isolated margin | PART | Isolated margin is modelled; cross-margin netting across positions is not implemented |
| 5 | Leverage | CODE | Bounded by config (`RISK_BOUNDS.maxLeverage`) |
| 6 | Funding rates | CODE | `derivativesEngine.js` |
| 7 | Mark/index price | CODE | Mark from index + basis |
| 8 | Liquidation engine | CODE | Thresholds and penalty in `derivativesEngine.js` |
| 9 | ADL | CODE | Auto-deleveraging queue modelled |
| 10 | Insurance fund | CODE | Modelled balance absorbs shortfall before ADL |
| 11 | Maintenance/initial margin | CODE | Tiered maintenance margin |
| 12 | Position risk | CODE | `src/pages/Derivatives.jsx` |
| 13 | Realized/unrealized PnL | CODE | Engine + portfolio |
| 14 | Greeks | CODE | `src/lib/options.js` |
| 15 | Implied volatility | CODE | Bisection solver in `options.js` |
| 16 | Open interest | CODE | `src/lib/derivatives.js` |
| 17 | Liquidation heatmap | CODE | `src/lib/liquidationHeatmap.js` |

## 3. Professional Charting

Every chart type, scale, drawing and indicator below renders from live candles. "Indicator marketplace" means a local catalogue of presets, not a paid third-party store.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Candlestick, hollow, Heikin Ashi, line, area, baseline | CODE | `src/lib/chartTypes.js`, `src/components/ProChart.jsx` |
| 2 | Renko, Kagi, Point & Figure, range | CODE | `chartTypes.js`, `src/components/AltChart.jsx` |
| 3 | Multiple/custom timeframes | CODE | 5m–1d plus custom aggregation |
| 4 | Multi-chart layouts and synchronisation | CODE | `src/pages/Charting.jsx` pane grid + crosshair sync |
| 5 | Log/percentage/auto scales | CODE | `ProChart.jsx` |
| 6 | Volume, VWAP, volume profile, market profile | CODE | `ProChart.jsx` |
| 7 | DOM and order-book overlays | CODE | Depth overlay on the chart |
| 8 | Trend lines, rays, channels, Fibonacci, pitchfork, Elliott Wave, shapes, text, measurement | CODE | `src/lib/drawings.js` |
| 9 | RSI, MACD, EMA, SMA, WMA, Bollinger, ATR, ADX, Stochastic, OBV, Ichimoku, Supertrend, custom | CODE | `src/lib/indicators.js`, `indicators2.js` |
| 10 | Custom/user-created indicators | CODE | `src/lib/indicatorMarketplace.js` (`makeCustomIndicator`) |
| 11 | Indicator marketplace | SIM | Local preset catalogue; no purchase, no author payouts |

## 4. Market Data Super-Layer

Ingestion covers the venues whose adapters are actually implemented, plus public RPCs. It does not cover CME, Deribit or licensed institutional feeds, and the licensing position is unresolved — see `docs/COMPLIANCE.md`.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Multi-exchange ingestion | CODE | `src/lib/sources.js` adapters |
| 2 | Binance, Coinbase, Kraken, OKX, Bybit, KuCoin, Bitget, Gate, Crypto.com, Gemini, Bitfinex, HTX, MEXC, Deribit, CME where licensed | PART | Adapters exist for a subset (`SUPPORTED_VENUES`); CME/Deribit require licensed feeds and are absent |
| 3 | DEX sources | PART | Pool TVL/price from DeFi endpoints (`src/lib/defi.js`); no swap quoting |
| 4 | CoinMarketCap and CoinGecko where commercially licensed | PART | CoinGecko live; CMC not integrated; redistribution rights unresolved (`EXT`) |
| 5 | Blockchain RPCs/indexers | CODE | `src/lib/evmRead.js`, `src/lib/chainHead.js` |
| 6 | Licensed institutional feeds | EXT | Contract required |
| 7 | Proprietary CryptoX feeds | EXT | Requires a venue or aggregated order flow of our own |
| 8 | Symbol mapping | CODE | `src/lib/aggregator.js` asset/venue mapping |
| 9 | Asset IDs | CODE | `src/lib/identifiers.js` |
| 10 | Exchange IDs | CODE | `SUPPORTED_VENUES` ids |
| 11 | Chain IDs | CODE | `src/lib/chains.js` |
| 12 | Contract addresses | CODE | `chains.js` token registry |
| 13 | Quote/decimal/timestamp normalisation | CODE | `src/lib/rates.js`, `src/lib/time.js` |
| 14 | Duplicate/outlier/stale-data detection | CODE | `src/lib/dataQuality.js` |
| 15 | Source confidence scoring | CODE | `src/lib/sourceRegistry.js` |

## 5. Real-Time Data Engine

Streaming, reconnect, heartbeats, backpressure and replay exist. Gap detection and dead-letter queues exist as models inside the client, not as a broker.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | WebSocket ingestion | CODE | `src/lib/market.jsx` |
| 2 | REST fallback | CODE | CoinGecko poll when the socket is down |
| 3 | Streaming trades/tickers/order books/klines | CODE | `market.jsx` tick + kline cache |
| 4 | Streaming funding/open interest/liquidations | PART | Values are computed from candles, not streamed from a venue |
| 5 | Streaming wallet and portfolio events | CODE | `src/lib/walletEvents.js` |
| 6 | Blockchain event streaming | PART | Head polling (`chainHead.js`), not a log subscription |
| 7 | Automatic reconnect | CODE | Backoff in `market.jsx` |
| 8 | Heartbeats | CODE | Stale detection with `lastTickAt` |
| 9 | Backpressure | CODE | `src/lib/backpressure.js` |
| 10 | Replay | CODE | `src/lib/realtime.js` |
| 11 | Event sequencing | CODE | Monotonic sequence per stream |
| 12 | Gap detection | PART | Sequence gaps are flagged; they are not repaired from a second source |
| 13 | Data reconciliation | PART | `dataQuality.js` cross-source comparison; no durable reconciliation job |
| 14 | Dead-letter queues | PART | Modelled in `reliability.js`; no broker to hold them |

## 6. Market Intelligence

Rankings, supply, ATH/ATL and sector taxonomies are computed from the live list. Sector tagging is a curated mapping, not an exhaustive classification of 10,000 assets.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | All coins | PART | 250 coins per provider page limit (`CG_PER_PAGE`); not the full universe |
| 2 | New listings | CODE | Rank/age heuristics in `src/lib/marketIntel.js` |
| 3 | Trending | CODE | `src/pages/Trending.jsx` |
| 4 | Gainers/losers | CODE | Home + Market Intelligence |
| 5 | Highest volume | CODE | `marketIntel.js` |
| 6 | Market-cap rankings | CODE | Market table |
| 7 | FDV | CODE | `marketIntel.js` |
| 8 | Circulating/total/max supply | CODE | `marketIntel.js` |
| 9 | ATH/ATL | CODE | `marketIntel.js` |
| 10 | Historical performance | CODE | `src/lib/marketIntelExtra.js` |
| 11 | Categories/sectors/ecosystems | CODE | Sector taxonomy in `marketIntelExtra.js` |
| 12 | Stablecoins | CODE | `defi.js` peg health + sector filter |
| 13 | Meme coins | CODE | Sector filter |
| 14 | AI tokens | CODE | Sector filter |
| 15 | DePIN | CODE | Sector filter |
| 16 | RWA | CODE | Sector filter |
| 17 | Layer 1/Layer 2 | CODE | Sector filter |
| 18 | DeFi | CODE | Sector filter |
| 19 | Gaming | CODE | Sector filter |
| 20 | Infrastructure | CODE | Sector filter |

## 7. Exchange Aggregator

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Per-exchange price comparison | CODE | `src/lib/aggregator.js` `priceMatrix` |
| 2 | Global average | CODE | `globalAverage` |
| 3 | Best bid/ask | CODE | `bestQuotes` |
| 4 | Best execution venue | CODE | `bestExecutionVenue` |
| 5 | Spread | CODE | `liquidityProfile` |
| 6 | Liquidity | CODE | Depth-weighted score |
| 7 | Volume | CODE | Venue leaderboard |
| 8 | Arbitrage-discrepancy monitoring | CODE | `arbitrageOpportunities` — gross gaps, explicitly not net profit |

## 8. Portfolio

Cost basis, FIFO lots, realised/unrealised PnL, allocation, tax lots and a P/L calendar are implemented. Exchange API connections are not: linking a read-only venue key requires a server-side secret store.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Manual portfolios | CODE | `src/pages/Portfolio.jsx` |
| 2 | Exchange API connections | GAP | Needs a server-side key vault; a browser-held exchange key is a compromise waiting to happen |
| 3 | Wallet connections | PART | Read-only address tracking; no WalletConnect session |
| 4 | Blockchain wallet tracking | CODE | Address balances via public RPC |
| 5 | Holdings | CODE | `Portfolio.jsx` |
| 6 | Cost basis | CODE | `src/lib/portfolio.js` |
| 7 | Average entry | CODE | `portfolio.js` |
| 8 | Realized/unrealized PnL | CODE | `portfolio.js` |
| 9 | ROI/APR/APY | CODE | `portfolio.js` |
| 10 | Asset/chain/exchange allocation | CODE | `Portfolio.jsx` |
| 11 | Historical performance | CODE | Equity history from snapshots |
| 12 | Tax lots and reports | CODE | FIFO lot ledger + CSV export (`src/lib/tax.js`) |
| 13 | Profit/loss calendar | CODE | `Portfolio.jsx` |
| 14 | Portfolio risk | CODE | Concentration, volatility, drawdown |
| 15 | Alerts | CODE | Shares the alert engine |

## 9. Non-Custodial Wallet

The wallet surface is deliberately read-only. It derives and validates addresses for eleven chain families, estimates gas, simulates transactions and scores approvals — and it never holds a key, never signs, and never asks for a seed phrase. That is a product decision, not an unfinished feature: a browser wallet that custodies keys is a liability with a login form.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | HD wallet | PART | Derivation paths per chain in `src/lib/chains.js`; no key generation or encrypted vault, by design |
| 2 | Seed phrase security | PART | The product never accepts a phrase — the security property is the absence of the feature, stated in `src/pages/WalletLab.jsx` and `/legal/security` |
| 3 | Hardware wallet support | GAP | No WebHID/WebUSB transport |
| 4 | Ledger/Trezor | GAP | Same |
| 5 | WalletConnect | GAP | No session pairing, no relay client |
| 6 | EVM chains | CODE | Address validation + balance reads (`evmRead.js`) |
| 7 | Bitcoin | CODE | Base58/bech32 validation, UTXO address lookup (`explorer.js`) |
| 8 | Solana | CODE | ed25519 path + address format |
| 9 | Tron | CODE | Base58Check address handling |
| 10 | XRP | CODE | X-address/r-address validation |
| 11 | Sui | CODE | `src/lib/addressCodec.js` |
| 12 | Aptos | CODE | Same codec family |
| 13 | TON | CODE | Bounceable/non-bounceable forms |
| 14 | Cosmos | CODE | bech32 HRP per zone |
| 15 | Polkadot | CODE | ss58 encoding |
| 16 | Cardano | CODE | CIP-1852 path, bech32 |
| 17 | Send/receive/swap/bridge/stake | GAP | Read-only by design; transfers require a signer this product does not have |
| 18 | Token approvals | PART | Allowance risk scoring (`walletSecurity.js`); revoking needs a signer |
| 19 | NFTs | PART | Valuation and floor lookup; no transfer or mint |
| 20 | Gas estimation | CODE | Live `eth_gasPrice`/fee history |
| 21 | Transaction simulation | CODE | `eth_call` dry-run with revert decoding |
| 22 | Scam detection | CODE | Address poisoning + known-bad patterns (`walletSecurity.js`) |
| 23 | Token risk warnings | CODE | Approval/allowance risk grades surfaced before a dapp interaction |

## 10. Blockchain Explorer

Bitcoin and EVM read paths are real and go straight to public endpoints. Three capabilities are impossible without an indexer, and the code says so in `EXPLORER_GAPS` rather than rendering an empty table.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Blocks | CODE | `btcBlocks`, `btcBlock`; EVM block reads |
| 2 | Transactions | CODE | `btcTx` + EVM receipt |
| 3 | Addresses | CODE | Balance, nonce, tx list |
| 4 | Tokens | CODE | ERC-20 metadata + balances |
| 5 | Contracts | CODE | Bytecode presence, interface probing |
| 6 | NFTs | PART | Contract-level detection; no per-token metadata crawl |
| 7 | Transfers | CODE | Bounded log range scan |
| 8 | Gas | CODE | `btcFees`, `eth_gasPrice` |
| 9 | Validators | CODE | `explorer.js` validator views |
| 10 | Staking | PART | Read-only validator/stake data where the public API exposes it |
| 11 | Mempool | CODE | `btcMempool` |
| 12 | Smart-contract verification | GAP | Listed in `EXPLORER_GAPS.verified_source`: needs a submitted-source database |
| 13 | Contract ABI | PART | Only standard functions that answered on-chain (`EXPLORER_GAPS.full_abi`) |
| 14 | Token holders | GAP | `EXPLORER_GAPS.token_holders`: needs a Transfer-log indexer |
| 15 | Rich address labels | CODE | `src/lib/labels.js` + user labels |

## 11. DeFi

Protocol analytics, pools, TVL, yields, stablecoin peg health and a risk dashboard are computed from public DeFi endpoints. Swap routing and DEX aggregation are not implemented — a router without a signer produces quotes nobody can execute.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | DEX aggregation | GAP | No quoter integration |
| 2 | Swap routing | GAP | Same; multi-hop optimisation needs live quoters |
| 3 | Liquidity pools | CODE | `src/lib/defi.js` |
| 4 | TVL | CODE | Protocol and chain TVL |
| 5 | APR/APY | CODE | Pool yields, with the reward-inflation caveat shown |
| 6 | Lending/borrowing | PART | Market health factors and rates; no position management |
| 7 | Liquidations | PART | Modelled and displayed; not executable |
| 8 | Yield farming | CODE | Farm list with reward token and emission data |
| 9 | Staking/restaking | PART | Validator and restaking protocol data; no delegation |
| 10 | Bridges | PART | Bridge TVL/flows; no transfer |
| 11 | Vaults | PART | Vault listings; no deposit |
| 12 | Stablecoins | CODE | Peg deviation and supply |
| 13 | Protocol analytics | CODE | Fees, revenue, TVL history |
| 14 | Wallet exposure | PART | Address → protocol exposure where the protocol API allows it |
| 15 | DeFi risk dashboard | CODE | `src/pages/DeFiNft.jsx` risk panel |

## 12. NFT

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | NFT marketplace | GAP | No listings, bids or settlement |
| 2 | NFT portfolio | CODE | Floor-price valuation of held collections |
| 3 | Floor price | CODE | `src/lib/nftMarket.js` |
| 4 | Volume | CODE | 24h/7d collection volume |
| 5 | Collections | CODE | Collection search and stats |
| 6 | Rarity | CODE | Trait-frequency rarity score |
| 7 | Traits | CODE | Trait breakdown with prevalence |
| 8 | Ownership | PART | Owner-of-token lookup via RPC |
| 9 | Sales history | PART | Recent sales where the public API exposes them |
| 10 | NFT analytics | CODE | `nftMarket.js` |
| 11 | Multi-chain NFTs | PART | Chain is a filter, not every chain is indexed |

## 13. News & Research

Aggregation, dedupe, attribution and sentiment run on the client. "AI summaries" are extractive summaries of the fetched text, not a language-model rewrite, and the UI says so.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Crypto news aggregation | CODE | `src/pages/News.jsx`, `src/lib/newsOps.js` |
| 2 | Official project/exchange announcements | CODE | Announcement source class |
| 3 | Regulatory/ETF/token-unlock news | CODE | Topic classifier in `newsOps.js` |
| 4 | Hack/exploit alerts | CODE | Exploit keyword class with higher priority |
| 5 | Governance proposals | CODE | Governance source class |
| 6 | Research reports | CODE | Curated research entries |
| 7 | AI summaries | PART | Extractive summary, labelled as such; no model-generated prose |
| 8 | Source attribution | CODE | Every item keeps its publisher and link |
| 9 | Duplicate-story detection | CODE | Title/shingle similarity in `newsOps.js` |
| 10 | Content-quality/fake-news controls | PART | Source allowlist and dedupe; no fact-checking service |
| 11 | Sentiment analysis | CODE | Lexicon-based scoring, with the method disclosed |

## 14. CryptoX AI

The assistant is a deterministic analyst over live data, not a large language model. It answers questions about coins, charts, portfolios, wallets and news by computing them; three generative features are absent rather than faked.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Natural-language market search | CODE | `src/lib/ai.js` intent parser |
| 2 | Token explanations | CODE | `ai.js` token brief |
| 3 | Transaction explanations | CODE | Decodes calldata and logs |
| 4 | Portfolio analysis | CODE | Concentration, PnL, risk |
| 5 | Risk analysis | CODE | Drawdown/volatility/exposure |
| 6 | Market summaries | CODE | Breadth, movers, dominance |
| 7 | Chart analysis | CODE | Structure + indicators |
| 8 | Technical/fundamental analysis | CODE | Indicator read + supply/flow context |
| 9 | On-chain analysis | CODE | `evmRead.js` metrics |
| 10 | Whale analysis | CODE | Large-transfer scan |
| 11 | News analysis | CODE | `newsOps.js` sentiment/topics |
| 12 | Alert creation | CODE | Creates a real alert via the alert engine, with confirmation |
| 13 | Strategy builder | GAP | Presets exist; no generated strategy from prose |
| 14 | Backtesting assistant | CODE | Runs the backtester on a described preset |
| 15 | Bot generator | GAP | No code generation |
| 16 | API generator | GAP | No code generation |
| 17 | Smart-contract explanation | CODE | Interface + storage read |
| 18 | Wallet investigation | CODE | `walletSecurity.js` |
| 19 | Research reports | CODE | `src/lib/analyst.js` |
| 20 | Explicit confirmation and permission controls for actions | CODE | Action allowlist; every action needs an explicit confirm (`src/pages/Assistant.jsx`) |

## 15. Trading Bots

Ten bot types run against paper balances. Market-making and mean-reversion are absent: a market maker without inventory and latency control is a way to lose money quickly, and shipping the label without the mechanics would be worse than the gap.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | DCA | CODE | `src/lib/bots.js` |
| 2 | Grid | CODE | `bots.js` |
| 3 | TWAP | CODE | `bots.js` |
| 4 | VWAP | CODE | `bots.js` |
| 5 | Arbitrage | CODE | Cross-venue paper arbitrage |
| 6 | Rebalancing | CODE | `bots.js` |
| 7 | Market-making | GAP | Needs inventory + cancel/replace latency |
| 8 | Momentum | CODE | `bots.js` |
| 9 | Mean reversion | GAP | Not in `BOT_TYPES` |
| 10 | Breakout | CODE | Donchian-style |
| 11 | Copy strategies | CODE | Copy preset consuming a follower allocation |
| 12 | Custom strategies | CODE | Custom condition builder (`CONDITION_FIELDS`) |
| 13 | Strategy marketplace | PART | Local catalogue; no authors, payouts or install |
| 14 | Backtesting | CODE | `src/lib/backtest.js` |
| 15 | Paper trading | CODE | `src/pages/PaperTrading.jsx` |
| 16 | Walk-forward testing | CODE | Split in `BacktestPanel.jsx` |
| 17 | Risk controls | CODE | `applyRiskControls` — per-trade, daily loss, max positions |

## 16. Alert Engine

Every alert *type* is implemented and evaluated against live data. Delivery is in-app only: email, SMS, Telegram, Discord and WhatsApp need provider contracts and server-side dispatch, so the channel list is honest about what fires.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Price | CODE | `src/lib/alertsEngine.js` |
| 2 | Percentage | CODE | Same |
| 3 | Volume | CODE | Volume spike vs rolling mean |
| 4 | RSI | CODE | `src/lib/alertExtras.js` |
| 5 | MACD | CODE | `alertExtras.js` |
| 6 | Moving average | CODE | Cross above/below |
| 7 | Breakout | CODE | Range break with lookback |
| 8 | Whale | CODE | Large-transfer threshold |
| 9 | Liquidation | CODE | Liquidation-size threshold |
| 10 | Funding | CODE | Funding-rate band |
| 11 | Open interest | CODE | OI change threshold |
| 12 | Wallet | PART | Address-activity alerts for tracked addresses |
| 13 | Token transfer | PART | Transfer-direction alerts on tracked tokens |
| 14 | Smart contract | PART | Event-based alerts where the ABI is known |
| 15 | News | CODE | Topic/keyword alert on the news pipeline |
| 16 | Portfolio | CODE | Portfolio value/PnL thresholds |
| 17 | Custom formula alerts | CODE | Expression parser in `alertContext.js` |
| 18 | Push/email/SMS/Telegram/Discord/WhatsApp/webhooks | PART | In-app delivery works; outbound channels are `EXT` until a provider is contracted and a server dispatcher exists |

## 17. Social Network

Not implemented in this repository, and — after inspecting the deployed project — deliberately not re-implemented.

**Finding (18 Nov 2026).** The production database already carries a social schema that this repository does not know about: `cx_profiles`, `cx_community_posts`, `cx_community_comments`, `cx_community_reactions`, `cx_user_follows`, `cx_moderation_reports`, `cx_user_verification_status`, alongside roughly eighty `cx_*` tables in total. This repository's migrations describe only thirty.

A first attempt at a `0009_social.sql` would therefore have created a **second, parallel social model** in the same database — two profile tables, two follow tables, two post tables — with the UI bound to the newer, emptier one. That file was withdrawn rather than repaired. The client logic written for it (`src/lib/social.js`, 46 tests) is kept: it is pure, table-agnostic and reusable, and its `canViewPost` predicate is the rule any adapter must reproduce.

The correct next step is an adapter over the existing tables, not a new schema. Until that adapter exists, every item below stays a gap at the product level even where a table is present.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Profiles | GAP | — |
| 2 | Follow/followers | GAP | — |
| 3 | Posts | GAP | — |
| 4 | Comments | GAP | — |
| 5 | Likes | GAP | — |
| 6 | Reposts | GAP | — |
| 7 | Quotes | GAP | — |
| 8 | Communities | GAP | — |
| 9 | Groups | GAP | — |
| 10 | Channels | GAP | — |
| 11 | Direct messaging | GAP | — |
| 12 | Trading ideas | GAP | — |
| 13 | Chart publishing | GAP | Charts can be exported as an image; there is no feed to publish into |
| 14 | Strategy sharing | GAP | — |
| 15 | Creator profiles | GAP | — |
| 16 | Verified accounts | GAP | — |
| 17 | Reputation system | GAP | — |

## 18. Copy Trading

The decision layer is real; the execution layer is not. Sizing, verification, stop rules and fee arithmetic are implemented and tested. There is no follower order router, no custody of allocated funds and no live trader leaderboard, because a leaderboard needs reconciled venue history.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Trader profiles | PART | Profile shell exists; no onboarded traders, so the leaderboard is empty by design |
| 2 | Verified performance data | CODE | `verifyTrackRecord` — reconciliation source, length, gaps and freshness all required |
| 3 | Historical PnL | CODE | Computed from the return series, never quoted from a profile field |
| 4 | Max drawdown | CODE | Peak-to-trough, `maxDrawdown` |
| 5 | Sharpe ratio | CODE | Annualised, rf = 0, period-aware |
| 6 | Win rate | CODE | Share of positive periods, labelled as such |
| 7 | Trading frequency | CODE | Trades per period when a trade count is supplied |
| 8 | Risk profile | CODE | Thresholds in `RISK_PROFILES` |
| 9 | Copy allocation | CODE | `copyPlan` / `splitAllocation` with a concentration cap |
| 10 | Maximum-loss controls | CODE | Absolute dollar stop derived from the plan |
| 11 | Stop-copy rules | CODE | `shouldStopCopy` in severity order |
| 12 | Transparent fee model | CODE | `feeBreakdown` — profit share above a high-water mark only |

## 19. Token Research Pages

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Identity | CODE | `src/pages/CoinDetail.jsx` |
| 2 | Contract/chain | CODE | `chains.js` registry |
| 3 | Website/whitepaper/GitHub/social links | CODE | Link set with `urlSafety.js` scheme checks |
| 4 | Price/market cap/FDV/volume/supply/ATH/ATL/liquidity | CODE | `marketIntel.js` |
| 5 | Technology and consensus | PART | Curated notes for covered assets; not generated per token |
| 6 | Audits and GitHub activity | PART | Links out; no audit registry or commit feed |
| 7 | Holders | CODE | Bounded holder scan |
| 8 | Transfers | CODE | Recent transfer list |
| 9 | Whale concentration | CODE | Top-holder share with the indexer caveat |
| 10 | Active addresses | PART | Where the public API exposes it |
| 11 | Transaction count | PART | Same |
| 12 | Exchange inflows/outflows | PART | Modelled from labelled addresses, not a full exchange-wallet set |

## 20. Security

Account security is implemented to the limit of what a browser-only deployment can honestly offer: MFA, lockouts, session and device records, passkeys via WebAuthn. Anything that depends on a signer, a hardware module or a contracted test is `EXT`, because writing the word "HSM" in a repository does not create one.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Zero-trust architecture | PART | RLS plus per-request authorisation; no service mesh or mTLS between services, because there are no services yet |
| 2 | MFA | CODE | `src/lib/mfa.js` — TOTP enrolment, verification, replay guard |
| 3 | Passkeys | PART | WebAuthn credential handling in `mfa.js`; a relying party and server-side challenge store are required for production |
| 4 | Hardware security keys | PART | Work through the same WebAuthn path once an RP is configured |
| 5 | Device/session management | CODE | `src/lib/securityStore.js` — device list, revoke, session expiry |
| 6 | IP controls | PART | Login history and anomaly flags; no network allowlist enforcement |
| 7 | Withdrawal whitelist/allowlist | EXT | No custody and no withdrawal path |
| 8 | Withdrawal delays | EXT | Same |
| 9 | Transaction signing | EXT | The product holds no keys by design |
| 10 | HSM | EXT | Physical hardware and a key ceremony |
| 11 | MPC | EXT | Key shares and a signing cluster |
| 12 | Key rotation | EXT | Applies to custody keys that do not exist here; application secrets rotate per `SECURITY.md` |
| 13 | Secrets management | PART | Build-time public variables only; no secret is shipped (`scripts/check-secrets.mjs`) |
| 14 | Encryption at rest/in transit | PART | TLS terminated at the host (HSTS + CSP in `public/_headers`); at-rest encryption is the database provider's |
| 15 | DDoS/WAF/bot protection | EXT | Edge provider configuration |
| 16 | Anti-phishing | PART | Strict CSP, no third-party auth redirect, security key preference over codes |
| 17 | Anti-account-takeover | CODE | Lockout, idle expiry, MFA, session revocation |
| 18 | Fraud detection | PART | Signal scoring in `src/lib/compliance.js`; no payment fraud engine |
| 19 | AML/KYC where required | EXT | Requires a licensed provider and a compliance officer |
| 20 | Sanctions screening | EXT | Screened list vendor |
| 21 | Transaction monitoring | GAP | No transaction stream to monitor |
| 22 | Security monitoring | PART | Client telemetry ring buffer; no SIEM |
| 23 | Penetration testing | EXT | Third-party engagement |
| 24 | Bug bounty | EXT | Programme and payout infrastructure |
| 25 | Incident response | PART | Severity model and runbook in `src/lib/incident.js`, `docs/OPERATIONS.md`; untested |
| 26 | Data recovery | PART | User export and deletion implemented; provider backup/restore is `EXT` |

## 21. Custody

CryptoX does not take custody of customer assets, so most of this section is not "unfinished" — it is out of scope for the product as built. The parts that can exist without custody (policy engine, approval workflow, reconciliation) are modelled.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Hot/warm/cold wallets | EXT | Requires custody operations and a treasury function |
| 2 | MPC | EXT | — |
| 3 | Multisig | EXT | — |
| 4 | Withdrawal policy engine | PART | Limits, velocity and dual-control rules modelled in `src/lib/rbac.js`; nothing to enforce them against |
| 5 | Transaction approval workflows | PART | Maker/checker modelled in `enterprise.js` |
| 6 | Separation of duties | PART | Role matrix enforces it client-side |
| 7 | Treasury management | EXT | — |
| 8 | Reconciliation | PART | Double-entry ledger reconciles internal balances (`src/lib/ledger.js`); no on-chain reconciliation |
| 9 | Proof-of-reserves architecture | EXT | Needs signed attestations over real balances |
| 10 | Liability accounting | PART | Ledger separates asset and liability accounts |
| 11 | Customer-asset segregation | EXT | No customer assets |
| 12 | Emergency freeze | PART | Kill switch halts trading in the paper engine; no custody freeze |
| 13 | Disaster recovery | EXT | Custody DR is an operational programme |
| 14 | Specialized security and legal/regulatory review | EXT | — |

## 22. KYC & Compliance

Policy, consent, retention, data-subject requests, audit trails and geographic restrictions are implemented. Identity verification itself is a vendor contract, and the code does not pretend to verify documents.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Identity verification | EXT | Requires a KYC provider (sumsub/onfido class) |
| 2 | Document/face verification | EXT | Same |
| 3 | AML | PART | Programme model, risk factors and escalation in `compliance.js`; no transaction feed |
| 4 | KYT | EXT | Chain-analytics vendor |
| 5 | Sanctions/PEP screening | EXT | Screened-list vendor |
| 6 | Travel Rule integration where applicable | EXT | Requires a VASP counterparty network |
| 7 | Geographic restrictions | CODE | `src/lib/location.js`, `src/lib/countries.js`, restricted-region handling |
| 8 | Risk scoring | PART | Client-side score with documented factors; not a compliance decision |
| 9 | Compliance case management | GAP | No case queue |
| 10 | Audit trails | CODE | `cx_audit_log` (migration 0002) + client writer |
| 11 | Data retention | CODE | Retention policy engine in `compliance.js` |
| 12 | Privacy controls | CODE | Export/delete, consent records, `/legal/privacy` |

## 23. Admin Super Panel

The control plane validates configuration and reads live health. Cross-user figures (users, volume, revenue, treasury) require a privileged server console; the panel lists them with the reason instead of rendering plausible numbers.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Users | PART | Single-account view; multi-user listing needs a privileged read |
| 2 | Active users | EXT | Aggregation over `auth.users` requires a server job |
| 3 | Trading volume | EXT | Settlement ledger is server-side |
| 4 | Deposits/withdrawals | EXT | No custody movements exist |
| 5 | Revenue/fees | EXT | Derived from the ledger, not from a browser query |
| 6 | Assets | EXT | Treasury balances live outside this application |
| 7 | System health | CODE | `src/pages/Admin.jsx` reads the live feed state |
| 8 | API/exchange/blockchain health | PART | Exchange and provider health live; blockchain node health is a server probe |
| 9 | User/KYC/wallet/trading controls | PART | Trading controls (halt, kill switch) work on the paper engine; user/KYC controls need a privileged console |
| 10 | Asset listing | PART | Readiness gates in `adminConfig.js`; the listing action itself is server-side |
| 11 | Market management | PART | Symbol/tick/lot configuration validated locally |
| 12 | Fee/risk configuration | CODE | Bounds, diff and reason capture |
| 13 | Referral/promotions | PART | Programme model and fraud scoring (`referral.js`); campaign management is server-side |
| 14 | Support | PART | Queue SLA model; no ticketing integration |
| 15 | Compliance | PART | Policy and case models; no vendor case system |

## 24. API Platform

The contract exists — resources, error shape, pagination, idempotency, versioning and an OpenAPI document built in code. The gateway that would serve it does not.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | REST APIs | PART | `src/lib/api.js` defines the contract; no deployed server |
| 2 | Authentication | PART | Supabase JWT for app calls; API-key verification belongs to the gateway |
| 3 | Markets/assets/orders/trades/positions/wallet/portfolio | PART | Client data layer implements the read paths; writes are paper-only |
| 4 | Historical data | PART | Candle history from the provider; no archive |
| 5 | Analytics | PART | Computed client-side |
| 6 | Alerts | PART | Alert CRUD exists in the app |
| 7 | AI | PART | Deterministic analyst, callable in-app |
| 8 | Webhooks | CODE | Lemon Squeezy webhook is a deployed Edge Function with signature verification and idempotency |
| 9 | WebSockets | PART | Client consumes venue sockets; no public socket server |
| 10 | Trades/tickers/order books/candles/account/position/order/wallet streams | PART | Same |
| 11 | API keys | PART | `cx_api_keys` + hash table in migration 0007; issuance endpoint pending |
| 12 | Permissions | CODE | Scope array with a CHECK constraint; `read`/`trade`/`withdraw`/`portfolio`/`alerts` |
| 13 | IP whitelist | CODE | `inet[]` allowlist column |
| 14 | Rate limits | PART | Per-key limit column; enforcement is a gateway concern |
| 15 | Usage dashboard | PART | `cx_usage_counters` + `readUsage`; UI is the billing page |
| 16 | Documentation | PART | OpenAPI document generated from `api.js`; no published docs site |
| 17 | SDKs | GAP | No package |
| 18 | Sandbox/testnet | CODE | Paper trading is the sandbox, and it is labelled as such |
| 19 | Versioning | PART | Version header and deprecation policy defined in the contract |

## 25. Database Architecture

One Postgres database with row-level security. The rest of the stack in this section is absent, and the application does not depend on it: the browser talks to Postgres and public HTTP APIs.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | PostgreSQL for transactional systems | CODE | Supabase Postgres, 7 migrations |
| 2 | Redis for cache/session | EXT | Not provisioned |
| 3 | Kafka or Redpanda for event streaming | EXT | Not provisioned |
| 4 | ClickHouse/Timescale for market analytics | EXT | Not provisioned |
| 5 | Object storage for raw/historical data | EXT | Not provisioned |
| 6 | OpenSearch/Elasticsearch for search | EXT | Search is an in-memory index (`universalSearch.js`) |
| 7 | Time-series storage | EXT | Candles are fetched on demand, not retained |
| 8 | Data warehouse | EXT | — |
| 9 | Blockchain-specific storage | EXT | — |
| 10 | Automated backups | EXT | Provider configuration; restore is untested in this repository |

## 26. Event-Driven Architecture

Typed events and an in-process bus exist so features react to each other without polling. There is no broker, so "idempotent consumer" and "replayable" are properties of the client bus, not of a distributed system.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | MarketUpdated | CODE | `src/lib/realtime.js` |
| 2 | TradeExecuted | CODE | Emitted by the matching engine |
| 3 | OrderCreated/Filled/Cancelled | CODE | Same |
| 4 | PositionUpdated | CODE | Derivatives engine |
| 5 | WalletDeposit/Withdrawal | PART | Modelled for tracked addresses; no custody events |
| 6 | BlockchainTransaction | PART | Head/log polling emits events, not a subscription |
| 7 | Liquidation | CODE | Emitted when the engine liquidates |
| 8 | AlertTriggered | CODE | Alert engine |
| 9 | NewsPublished | CODE | News pipeline |
| 10 | Event bus | PART | In-process only |
| 11 | Idempotent consumers | PART | Handlers dedupe by event id |
| 12 | Replayable events | CODE | Ring buffer with replay |

## 27. Service Architecture

This is a modular monolith. Each row below maps to a module with its own responsibilities and tests, which is the right shape for the current scale — but a module is not a deployable service with its own SLO, and calling it one would hide that.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Auth | PART | `src/lib/auth.jsx` (Supabase or local PBKDF2) |
| 2 | User | PART | `src/lib/accounts.js` |
| 3 | KYC | PART | Policy only; vendor is `EXT` |
| 4 | Market Data | PART | `src/lib/market.jsx`, `sources.js` |
| 5 | Symbol | PART | `identifiers.js`, `aggregator.js` |
| 6 | Matching Engine | PART | `src/lib/engine/matching.js` (in-browser) |
| 7 | Order | PART | Order lifecycle in the engine |
| 8 | Risk | PART | Pre-trade checks + `reliability.js` |
| 9 | Wallet | PART | Read-only `wallets.js` |
| 10 | Custody | GAP | Out of scope |
| 11 | Settlement | PART | `engine/settlement.js` (paper) |
| 12 | Portfolio | PART | `portfolio.js` |
| 13 | Derivatives | PART | `derivativesEngine.js` |
| 14 | DeFi | PART | `defi.js` |
| 15 | Blockchain Indexer | PART | `explorer.js`, `evmRead.js` (bounded queries) |
| 16 | Notification | PART | In-app only |
| 17 | Alert | PART | `alertsEngine.js` |
| 18 | AI | PART | `ai.js` (deterministic) |
| 19 | News | PART | `newsOps.js` |
| 20 | Social | GAP | Not implemented |
| 21 | Payment | PART | Edge Functions + Lemon Squeezy |
| 22 | Referral | PART | `referral.js` |
| 23 | Admin | PART | `Admin.jsx` |
| 24 | Analytics | PART | `analytics.js` (client) |
| 25 | API Gateway | PART | Contract only |

## 28. Cloud & DevOps

CI is real: every push runs the test suite and the static gates. Deployment is a static upload. There is no container, no cluster, no infrastructure-as-code and no multi-region posture.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | AWS/GCP/Azure | EXT | Hosting is a static host + managed Postgres |
| 2 | Kubernetes | EXT | — |
| 3 | Docker | EXT | No Dockerfile; nothing to containerise but static files |
| 4 | Infrastructure as Code | EXT | — |
| 5 | Terraform | EXT | — |
| 6 | CI/CD | CODE | `.github/workflows/ci.yml` — tests, static gates, build |
| 7 | Blue/green deployments | EXT | — |
| 8 | Canary deployments | EXT | — |
| 9 | Automated rollback | PART | Artifact swap documented in `docs/OPERATIONS.md`; not automated |
| 10 | Multi-region | EXT | — |
| 11 | Load balancing | EXT | — |
| 12 | CDN | EXT | Host-provided |
| 13 | Auto-scaling | EXT | — |
| 14 | Service discovery | EXT | — |
| 15 | Secrets manager | EXT | Only public build variables exist |
| 16 | Disaster recovery | EXT | Runbook exists; no tested restore |

## 29. Observability

Client observability is implemented: structured logs with correlation ids, metric models, trace spans, SLO arithmetic and error capture. Without a collector endpoint it stays in a ring buffer, which is why the row is `PART` rather than `CODE`.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Logs | PART | `src/lib/observability.js`; buffer only |
| 2 | Metrics | PART | Counters/histograms modelled |
| 3 | Traces | PART | Span model with correlation ids |
| 4 | Alerts | PART | Threshold rules; no pager |
| 5 | SLOs/SLIs | PART | Error-budget arithmetic in `sre.test.js` |
| 6 | Error tracking | PART | Boundary + buffer; `VITE_ERROR_ENDPOINT` empty by default |
| 7 | Latency monitoring | PART | Provider latency measured in-tab |
| 8 | WebSocket monitoring | PART | Reconnect/stale counters |
| 9 | Provider/API monitoring | CODE | `sourceRegistry.js` health + confidence |
| 10 | Blockchain-node monitoring | PART | Head-height lag detection |
| 11 | Database monitoring | EXT | Provider dashboards |
| 12 | Queue monitoring | EXT | No queue |
| 13 | On-call alerting | EXT | Operational commitment |

## 30. Data Quality

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Timestamp validation | CODE | `src/lib/dataQuality.js` |
| 2 | Sequence validation | CODE | Monotonic checks per stream |
| 3 | Cross-source comparison | CODE | Median deviation across venues |
| 4 | Outlier rejection | CODE | MAD-based rejection |
| 5 | Stale-feed detection | CODE | Age vs expected interval |
| 6 | Duplicate detection | CODE | Id + timestamp dedupe |
| 7 | Missing-data detection | CODE | Gap accounting |
| 8 | Provider health score | CODE | `sourceRegistry.js` |
| 9 | Automatic failover | CODE | Next healthy provider |
| 10 | Data lineage | CODE | Source tag carried to the UI badge |

## 31. Search

One index over what the app can actually see. Five categories are populated; nine need an authenticated indexer, and the page prints the zero rather than hiding the tab.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Coins | CODE | `src/pages/Search.jsx` over the live market list |
| 2 | Tokens | PART | Contract-token search not indexed |
| 3 | Exchanges | CODE | From `SUPPORTED_VENUES` |
| 4 | Trading pairs | GAP | Pairs are not a first-class index type in this build |
| 5 | Wallets | GAP | Needs an address index |
| 6 | Addresses | GAP | Same |
| 7 | Transactions | GAP | Needs a transaction index |
| 8 | Blocks | GAP | Same |
| 9 | NFTs | GAP | Needs a collection index |
| 10 | DeFi protocols | GAP | Provider list not wired into the index |
| 11 | News | GAP | News pipeline exists; not indexed for search |
| 12 | Users | GAP | Requires a privileged user index |
| 13 | Posts | GAP | No social layer |
| 14 | Strategies | CODE | Strategy presets |
| 15 | Charts | CODE | App destinations and saved views |

## 32. Notifications

In-app notifications and preferences work. Every outbound channel is a provider contract plus a server dispatcher; a browser cannot send an email or a Telegram message without one.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | In-app | CODE | `src/pages/Alerts.jsx` + notification centre |
| 2 | Push | EXT | Web Push needs a VAPID key pair and a server sender |
| 3 | Email | EXT | Transactional email provider |
| 4 | SMS | EXT | SMS aggregator |
| 5 | Telegram | EXT | Bot token + server dispatcher |
| 6 | Discord | EXT | Webhook dispatcher |
| 7 | WhatsApp | EXT | Business API account |
| 8 | Webhooks | PART | Outbound shape and signing defined; no dispatcher |
| 9 | Preferences | CODE | Per-channel, per-type preferences, honoured in-app |
| 10 | Priority levels | PART | Severity model; routing depends on delivery channels |
| 11 | Security/trading notifications | PART | Rendered in-app; external delivery is `EXT` |

## 33. Commercial & Billing

Four tiers, monthly/annual cycles, proration, coupons, invoices, credit notes and jurisdiction tax rules are implemented. Institutional terms, dedicated infrastructure and custom data are commercial agreements.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Free tier | CODE | `src/lib/plans.js` |
| 2 | Pro tier | CODE | $9.99/mo, $99.99/yr |
| 3 | Advanced tier | CODE | Sold as Business ($24.99/mo) |
| 4 | Institutional tier | PART | Enterprise is self-serve at $199.99/mo; a contracted institutional tier with SLAs is `EXT` |
| 5 | Usage-based API plans | PART | Metering table exists (`cx_usage_counters`); no metered billing job |
| 6 | Enterprise SLA | EXT | Contract |
| 7 | Dedicated infrastructure | EXT | Contract |
| 8 | Custom data | EXT | Contract |
| 9 | Billing dashboard | CODE | `src/pages/Billing.jsx` |
| 10 | Invoices | CODE | `src/lib/billing.js` invoice + credit-note model |
| 11 | Tax handling where applicable | CODE | `src/lib/tax.js` jurisdiction rules and VAT/GST identifiers |

## 34. Referral/Affiliate

Links, tiers, commission arithmetic, payout readiness, UTM campaigns and fraud scoring are implemented. Affiliate API endpoints and a real partner portal are not.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Referral links | CODE | `referralLink`, deterministic code from the account |
| 2 | Commission tracking | PART | Commission maths implemented; accrual needs a server ledger job |
| 3 | Tiered rewards | CODE | Starter/Growth/Partner with recurring rules |
| 4 | Affiliate API | GAP | No endpoint |
| 5 | Partner portal | PART | `src/pages/Referral.jsx` is the partner view; no login-scoped partner tenancy |
| 6 | Creator program | PART | Tier model covers creators; no content programme tooling |
| 7 | Campaign tracking | CODE | UTM parsing and per-code aggregation |
| 8 | Fraud prevention | CODE | Weighted signals with block/review/approve thresholds |

## 35. Launchpad

The screening desk is real: schema validation, weighted due diligence with hard gates, tokenomics checks, exact vesting arithmetic, integer pro-rata allocation and a state machine that cannot double-distribute. Custody of participant funds and a KYC vendor are not.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Project applications | CODE | `src/pages/Launchpad.jsx` + `APPLICATION_SCHEMA` |
| 2 | Due diligence | CODE | `scoreDueDiligence` with blockers |
| 3 | Tokenomics | CODE | `validateTokenomics` |
| 4 | Vesting | CODE | `vestingSchedule`, integer-exact |
| 5 | Allocation | CODE | `allocate` with refund of dust |
| 6 | Whitelisting | CODE | `subscriptionEligibility` |
| 7 | KYC | PART | Eligibility gate implemented; verification vendor is `EXT` |
| 8 | Subscription | PART | Window, caps and allocation modelled; fund custody is out of scope |
| 9 | Distribution | PART | Schedule and state machine; on-chain distribution needs a signer |
| 10 | Listing workflow | CODE | `TRANSITIONS` with terminal states |

## 36. Education

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Crypto academy | CODE | `src/pages/Academy.jsx` |
| 2 | Beginner/trading/DeFi/blockchain/security courses | CODE | `COURSES` — five tracks, 23 lessons |
| 3 | Quizzes | CODE | Graded locally with per-question breakdown |
| 4 | Certifications | PART | Client-issued and labelled as such; not proof of identity or skill (`CERTIFICATE_NOTE`) |
| 5 | Demo trading | CODE | Every lesson links to the screen where it is practised |

## 37. Mobile

The web app is responsive and installable. There is no native binary, so biometrics and app-store KYC flows do not exist.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Dashboard | CODE | Responsive layouts |
| 2 | Markets | CODE | Same |
| 3 | Charts | CODE | Touch-friendly chart surfaces |
| 4 | Buy/sell | SIM | Paper orders |
| 5 | Portfolio | CODE | Responsive tables |
| 6 | Wallet | PART | Read-only lab |
| 7 | Alerts | CODE | — |
| 8 | News | CODE | — |
| 9 | AI | CODE | — |
| 10 | Social | GAP | No social layer |
| 11 | Security | CODE | Account & security page |
| 12 | KYC | GAP | No verification flow |
| 13 | Notifications | PART | In-app only |
| 14 | Biometrics | EXT | Requires a native shell |
| 15 | Passkeys | PART | WebAuthn works in mobile browsers; no server RP configured |

## 38. Enterprise Security

Static analysis and repository scanning are the parts a repository can own. Audits, certification and bounty programmes are engagements.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Threat modeling | GAP | No maintained model |
| 2 | Secure SDLC | PART | CI gates, review rules and disclosure policy |
| 3 | Code review | PART | Process documented; single-contributor history |
| 4 | Dependency scanning | PART | `npm audit --omit=dev` script |
| 5 | SAST | GAP | No analyser configured |
| 6 | DAST | GAP | No scanner |
| 7 | Container scanning | GAP | No containers |
| 8 | Secrets scanning | CODE | `scripts/check-secrets.mjs` in CI |
| 9 | Pen testing | EXT | Engagement |
| 10 | External audit | EXT | Engagement |
| 11 | Smart-contract audits | EXT | No contract deployed |
| 12 | Bug bounty | EXT | Programme |
| 13 | SOC 2 controls | EXT | Audit |
| 14 | ISO 27001 controls | EXT | Certification |
| 15 | Privacy controls | CODE | Consent, retention, export/delete |
| 16 | Regional regulatory controls | PART | Geo restrictions and disclaimers; per-region licensing is `EXT` |

## 39. Testing

2,110 tests across 77 files. Coverage is strongest exactly where a financial product needs it — matching, settlement, ledger, taxes, precision — and weakest where a single-tab app cannot go: load, chaos and withdrawal paths.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Unit tests | CODE | 77 files, 2,110 assertions |
| 2 | Integration/API/database tests | CODE | `integration.test.js`, `e2e.test.js`, edge-function handler tests |
| 3 | Matching-engine tests | CODE | `engine/matching.test.js` |
| 4 | Race-condition tests | PART | Concurrency modelled in the ledger; no multi-process race harness |
| 5 | Order-book tests | CODE | `engine/depth.test.js` |
| 6 | Liquidation tests | CODE | `derivativesEngine.test.js` |
| 7 | Settlement tests | CODE | `engine/settlement.test.js` |
| 8 | Precision tests | CODE | Decimal/rounding tests across ledger and tax |
| 9 | Fuzzing | GAP | No fuzz target |
| 10 | Authentication/authorization testing | CODE | `auth.test.jsx`, `security.test.jsx`, RBAC tests |
| 11 | Withdrawal testing | GAP | No withdrawal path exists |
| 12 | Load testing | EXT | Needs a deployed service to load |
| 13 | Volatility stress testing | PART | Stress scenarios in the backtester, not market-wide |
| 14 | Failure simulation | PART | Provider-failure paths exercised in tests |

## 40. Failure Engineering

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Provider outage simulation | PART | Tests drive the failover path; no chaos harness |
| 2 | Blockchain RPC outage | PART | Fallback endpoint logic |
| 3 | Database/Redis/Kafka outage | GAP | No database failure mode exercised |
| 4 | Region/CDN/DNS outage | EXT | Infrastructure |
| 5 | DDoS simulation | EXT | Infrastructure |
| 6 | Bad-feed simulation | PART | Outlier/stale fixtures in `dataQuality.test.js` |
| 7 | Network congestion | GAP | Not simulated |
| 8 | Chain reorganization | PART | Head-lag detection; no reorg handler |
| 9 | Automatic detect/isolate/failover/recover/reconcile/notify | PART | Detect + failover + notify exist; isolate/recover/reconcile are manual |

## 41. Data Licensing

This is a legal and commercial programme, not code. `docs/COMPLIANCE.md` records the position; nothing in this section can be closed by a commit.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Review API terms | EXT | Counsel |
| 2 | Confirm commercial-use rights | EXT | CoinGecko/Binance terms |
| 3 | Confirm redistribution rights | EXT | Explicitly not granted by default |
| 4 | Confirm caching rights | EXT | — |
| 5 | Historical-data rights | EXT | — |
| 6 | Attribution requirements | PART | Attribution rendered on `/data-sources` and per datum |
| 7 | Rate limits | PART | Client-side budgets; provider quotas are contractual |
| 8 | SLA | EXT | Contract |
| 9 | Enterprise agreements | EXT | Contract |
| 10 | Cost model | EXT | Commercial |
| 11 | Backup providers | PART | Fallback chain implemented; no second licensed contract |
| 12 | Do not assume public API access grants commercial redistribution rights | CODE | Stated in `docs/COMPLIANCE.md` and `/compliance` |

## 42. CryptoX Data Fusion

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | External data ingestion | CODE | `sources.js`, `market.jsx` |
| 2 | Normalization | CODE | `rates.js`, `time.js` |
| 3 | Identity graph | PART | Asset ids mapped; no full graph store |
| 4 | Validation | CODE | `dataQuality.js` |
| 5 | Aggregation | CODE | `aggregator.js` |
| 6 | Proprietary analytics | PART | Derived metrics are ours; the underlying data is not |
| 7 | CryptoX APIs | PART | Contract only |
| 8 | Provider independence | CODE | Multi-provider with failover |

## 43. Universal Identity Graph

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | CryptoX Asset ID | CODE | `src/lib/identifiers.js` |
| 2 | CMC ID | GAP | CMC not integrated |
| 3 | CoinGecko ID | CODE | Primary key for the market list |
| 4 | Exchange product/symbol IDs | CODE | `aggregator.js` venue symbol maps |
| 5 | Contract address | CODE | `chains.js` token registry |
| 6 | Chain ID | CODE | `chains.js` |
| 7 | DEX pair IDs | GAP | No DEX pool registry |
| 8 | Historical aliases | GAP | Ticker renames are not tracked |

## 44. Provider Orchestrator

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Quotas | PART | Budget fields per provider |
| 2 | Request scheduler | PART | Priority queue in the client |
| 3 | Token buckets | PART | Modelled per provider |
| 4 | Adaptive throttling | PART | Backoff on 429 |
| 5 | Batching | CODE | Batched quote requests |
| 6 | Cache | CODE | TTL cache with per-endpoint policy |
| 7 | Retry/backoff | CODE | Jittered exponential |
| 8 | Circuit breaker | CODE | `reliability.js` |
| 9 | Provider priority | CODE | `sourceRegistry.js` ranking |
| 10 | Failover | CODE | Next healthy provider |
| 11 | Cost optimization | PART | Weights modelled; no invoice feedback |
| 12 | Usage dashboard | PART | Per-provider counters in the data-sources page |

## 45. Production UX

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Global market overview | CODE | `/` dashboard |
| 2 | Personalized dashboard | CODE | Watchlist, portfolio, alerts |
| 3 | Markets | CODE | `/`, `/market-intel`, `/trending` |
| 4 | Trade terminal | SIM | `/exchange` (paper) |
| 5 | Discover | PART | Trending and market intelligence cover discovery; there is no dedicated discover feed |
| 6 | Wallet | PART | Read-only `/wallet-lab` |
| 7 | Portfolio | CODE | `/portfolio` |
| 8 | AI | CODE | `/assistant` |
| 9 | Research | CODE | `/news`, coin pages |
| 10 | News | CODE | `/news` |
| 11 | Alerts | CODE | `/alerts` |
| 12 | Social | GAP | No social layer |
| 13 | Security center | CODE | `/account` |

## 46. Enterprise Multi-Tenancy

Individual accounts, organisations, roles, permissions and audit logs exist. SSO/SCIM are modelled but not connected to an identity provider, and billing per tenant is not metered server-side.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Individual users | CODE | `accounts.js` |
| 2 | Traders | CODE | Same model |
| 3 | Funds | PART | Org type exists; fund-specific controls are not |
| 4 | Market makers | PART | Fee-tier model only |
| 5 | Brokers | PART | No sub-account or rebate engine |
| 6 | Fintechs | PART | API contract only |
| 7 | Developers | PART | API keys schema |
| 8 | Research institutions | PART | Export and reports |
| 9 | Organizations | PART | Client-side model; org tables not migrated |
| 10 | Teams | PART | Seats are advisory (see `ENFORCEMENT.seats`) |
| 11 | Roles | CODE | `rbac.js` |
| 12 | Permissions | CODE | Permission matrix + deny rules |
| 13 | API keys | PART | Schema in migration 0007; issuance pending |
| 14 | Billing | PART | Per-seat pricing displayed; no tenant invoicing job |
| 15 | Audit logs | CODE | `cx_audit_log` + append-only writer |
| 16 | SSO | PART | Policy model; no IdP integration |
| 17 | SCIM | PART | Model only |
| 18 | Enterprise support | EXT | Contracted service |

## 47. Financial Accounting

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Double-entry ledger | CODE | `src/lib/ledger.js` |
| 2 | Immutable journal entries | CODE | Append-only, hash-chained |
| 3 | Debit/credit | CODE | Balanced postings enforced |
| 4 | Account balances | CODE | Derived, never edited |
| 5 | Asset/liability accounting | CODE | Separate account classes |
| 6 | Reconciliation | CODE | Trial balance + drift detection |
| 7 | Audit trail | CODE | Entry provenance |
| 8 | Idempotency | CODE | Idempotency keys per posting |
| 9 | Transaction IDs | CODE | Deterministic ids |
| 10 | Ledger snapshots | CODE | Point-in-time snapshots |

## 48. Production Release Gate

Twenty-three gates. Three are code, six are documents and models, fourteen are external engagements or infrastructure tests that have not happened. This table is the honest answer to "can we ship": the repository is ready, the institution is not.

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | Security audit complete | EXT | Not commissioned |
| 2 | Penetration testing complete | EXT | Not commissioned |
| 3 | Load testing complete | EXT | No deployed service to load |
| 4 | Disaster recovery tested | EXT | Plan only |
| 5 | Backup restoration tested | EXT | Provider restore never exercised |
| 6 | Data reconciliation tested | PART | Ledger reconciliation tested in unit tests; no production reconciliation |
| 7 | Provider failover tested | PART | Exercised in tests, not against live outages |
| 8 | Blockchain failover tested | PART | Fallback endpoint logic tested |
| 9 | Matching engine audited | EXT | No independent audit |
| 10 | Ledger audited | EXT | No independent audit |
| 11 | Wallet architecture audited | EXT | No custody to audit |
| 12 | Compliance reviewed | EXT | Counsel |
| 13 | Licensing reviewed | EXT | Counsel |
| 14 | Privacy reviewed | PART | Notice and controls implemented; legal review outstanding |
| 15 | Monitoring operational | PART | Client telemetry; no collector |
| 16 | Incident-response plan tested | EXT | Untested |
| 17 | Runbooks complete | PART | `docs/OPERATIONS.md` covers release, rollback and incidents |
| 18 | Documentation complete | CODE | README, SECURITY, COMPLIANCE, OPERATIONS, this matrix |
| 19 | API documentation complete | PART | OpenAPI generated from `api.js`; not published |
| 20 | Mobile apps tested | EXT | No native apps |
| 21 | Accessibility tested | PART | Static rules + keyboard paths; no axe run or screen-reader pass |
| 22 | Browser compatibility tested | PART | Chromium verified; Safari/Firefox not exercised |
| 23 | Production rollback tested | EXT | Documented, never rehearsed |

## Core Production Principles

| # | Item | Status | Evidence / limitation |
|---:|---|---|---|
| 1 | CryptoX must not depend on a single data provider | CODE | Multi-provider chain with failover (`sourceRegistry.js`) |
| 2 | Use licensed APIs, official WebSockets, blockchain RPCs/indexers and proprietary infrastructure rather than unauthorised scraping or redistribution | PART | Official endpoints only; the commercial redistribution right is unresolved (`EXT`) |
| 3 | Treat market data, exchange execution, custody, accounting and compliance as separate high-risk systems | PART | Accounting and market data are separate modules; execution and custody are simulated/absent |
| 4 | Use immutable/double-entry accounting for financial balances | CODE | `ledger.js` |
| 5 | Design for provider failures, data corruption, network outages and regional failures | PART | Provider and corruption handled; regional failure is infrastructure |
| 6 | 24/7/365 means fault-tolerant continuous operation with redundancy, failover, monitoring, backups and disaster recovery — not an absolute guarantee of zero downtime | CODE | Stated verbatim in `docs/OPERATIONS.md` |

---

## What is left, in dependency order

1. **Deploy the entitlement migration** (`0007_entitlements.sql`) and point the app at it. Until then `alerts`, `bots` and API calls are enforced in the database but portfolios and seats are display-only, and the UI says so.
2. **Stand up the API gateway** so `api.js`, the key schema and the rate-limit columns become a product rather than a contract.
3. **Contract the data licences** (item 4/41). Charging money for redistributed market data without them is the exposure that ends the company.
4. **Pick the scope of Section 17 (social) and Section 21 (custody).** Both are products, not features. The current build is honest about not having them; that honesty is only a strategy if the answer is "we are not building them".
5. **Commission the audits and the penetration test**, then fix what they find. Nothing in this repository substitutes for that.
