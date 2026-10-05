# CryptoX

A real-time cryptocurrency dashboard: live market data, candlestick charts with indicators, eight one-click trading strategies, an honest backtester, and a paper-trading simulator.

**Live demo:** https://cryptox.site.accio.ai

> **Status: hardened demo / pre-production.** All client-side engineering controls are in place; external dependencies for commercial operation (paid market-data licences, server-side identity, legal review, penetration test) are still open and listed in [docs/OPERATIONS.md](docs/OPERATIONS.md#external-readiness-checklist). Nothing here is investment advice, and no real orders are ever placed.

---

## Features

| Area | What it does |
|---|---|
| Market | Market cap / BTC dominance / 24h volume, scrolling ticker, gainers & losers, searchable 100+ coin table with 7-day sparklines |
| Charts | Canvas candlestick chart: volume, MA20/MA50, RSI-14 panel, 5m–1d timeframes, keyboard-navigable, with a table alternative |
| Strategies | Eight presets — RSI Reversal (buy < 30 / sell > 70), Golden Cross, MACD, Bollinger, Stochastic, Momentum, Donchian, VWAP |
| Backtesting | Next-bar fills, fees, slippage, long-only; Sharpe/Sortino/max-drawdown/win-rate/profit-factor, buy & hold comparison, walk-forward split |
| Paper trading | Auto-trading bot on a virtual balance with equity curve, trade log and win rate |
| Portfolio tools | Watchlist, portfolio with CSV export, price alerts, bubbles, fear & greed, P&L/liquidation calculator |
| Trust | Data provenance badges (`LIVE` / `DELAYED` / `SIMULATED`), synthetic data never drives signals or trades, system status page |

## Architecture

Single-page React 18 + Vite 5 + Tailwind 3 application. No backend, no server-side secrets.

```
src/
  lib/          market.jsx (feeds + provenance)  auth.jsx (PBKDF2 identity)
                strategies.js  backtest.js  indicators.js  telemetry.js  prefs.jsx
  components/   Shell, CandleChart, BacktestPanel, ErrorBoundary, ConsentBanner, ui
  pages/        Home, CoinDetail, Strategies, PaperTrading, Portfolio, Status, Legal, Auth…
```

**Data provenance.** CoinGecko REST (60s) + Binance WebSocket (~1s) for live data. If both live hosts fail, deterministic synthetic candles are generated, tagged `source: 'simulated'`, badged in the UI, and **refused** by the strategy engine, backtester and paper trader. Feed state is summarised in one `feed` object (`live | connecting | degraded | simulated`) used by the topbar chip and the status page.

## Getting started

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # 56 unit + component tests
npm run test:coverage
npm run build      # production bundle in dist/
npm run verify     # tests + build (use before publishing)
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run test` / `test:watch` / `test:coverage` | Vitest suite (indicators, strategies, backtester, formatters, auth, error boundary) |
| `npm run build` | Production build with route-level code splitting |
| `npm run audit` | Production dependency audit |
| `npm run verify` | `test && build` — the gate used before any release |
| `node scripts/check-config.mjs` | Static policy guard (banned hosts, HTML sinks, insecure endpoints, CSP, timer shadowing) |
| `node scripts/check-bundle.mjs` | Enforces the gzip bundle budget |

## Configuration

See [.env.example](.env.example). All variables are build-time and non-secret:

| Variable | Meaning |
|---|---|
| `VITE_APP_VERSION` | Version shown on the status page and in error reports |
| `VITE_BUILD_STAMP` | Build identifier (CI sets this per build) |
| `VITE_ERROR_ENDPOINT` | Optional HTTPS collector for client error reports; empty = local-only telemetry |

## Deployment

1. `npm run verify` — must be green (56 tests + build).
2. `node scripts/check-config.mjs && node scripts/check-bundle.mjs`.
3. Publish `dist/` (or use the site-builder publish flow). The site is static; no runtime env needed.
4. Post-deploy: confirm the login screen renders, the topbar shows `LIVE` (or `SYNC` while connecting), and `/status` reports healthy feeds.
5. Rollback: republish the previous build artifact — see [docs/OPERATIONS.md](docs/OPERATIONS.md#release-and-rollback).

## Security & privacy

Passwords are hashed with PBKDF2-SHA256 (210k iterations, per-user salt); accounts are lockable; sessions expire; a CSP restricts network origins; errors are captured by a boundary and a local telemetry buffer. Details, residual risks and the disclosure process: [SECURITY.md](SECURITY.md). Privacy notice, terms and risk disclosure are rendered in-app under `/legal/*`.

## License

Proprietary demo — see [docs/COMPLIANCE.md](docs/COMPLIANCE.md) for licensing and trademark items that must be resolved before commercial use.
