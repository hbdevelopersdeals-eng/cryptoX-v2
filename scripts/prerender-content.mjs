/* Static body copy for the prerendered public routes.
 *
 * WHY THIS FILE EXISTS
 * CryptoX is a client-rendered SPA. Every public URL returned the same 7 KB
 * shell, so an AI crawler (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot) —
 * none of which execute JavaScript — saw `<div id="root"></div>` and nothing
 * else. robots.txt invited those crawlers and there was nothing for them to
 * read.
 *
 * The block below is written into `#root` at build time. React's createRoot
 * replaces the container's children on mount, so a browser user never sees it
 * beyond the first paint, while a non-JS client gets real, quotable text with
 * real internal links.
 *
 * RULES
 *  - Every statement here must be true of the shipped product. No invented
 *    awards, users, licences or performance claims.
 *  - Prices mirror src/lib/plans.js. If a price changes there, change it here.
 *  - Keep links relative and pointing only at routes that exist.
 */

import { GUIDES, GUIDE_GLOSSARY } from '../src/lib/guides.js';

const link = (href, text) => `<a href="${href}">${text}</a>`;

/** Shared tail: the same three links every public page offers a crawler. */
const nav = () =>
  `<nav aria-label="CryptoX">${[
    link('/', 'Overview'),
    link('/pricing', 'Pricing'),
    link('/data-sources', 'Data sources'),
    link('/status', 'System status')
  ].join(' · ')}</nav>`;

export const PRERENDER_CONTENT = {
  '/': {
    h1: 'A crypto terminal where every number shows its source.',
    body: `
      <p>CryptoX is a web-based cryptocurrency market terminal. It shows live market data for
      250+ coins, candlestick charts with RSI and moving averages, ten one-click strategy presets,
      a backtester that fills on the next bar with fees and slippage, a paper-trading simulator,
      a portfolio with FIFO cost basis, and a read-only wallet safety lab.</p>
      <p>Market data comes from CoinGecko (market table, polled about every 60 seconds) and
      Binance (WebSocket ticks, about once a second). If both live hosts fail, candles are
      generated deterministically, labelled SIMULATED in the interface, and refused by the
      strategy engine, the backtester and the paper trader — a simulated price can never drive
      a signal or a trade.</p>
      <ul>
        <li>Charts: candlestick, volume, MA20/MA50, RSI-14, 5m to 1d timeframes.</li>
        <li>Strategies: RSI Reversal, Golden Cross, MACD, Bollinger, Stochastic, Momentum,
            Donchian, VWAP, Stochastic RSI, CCI Reversal — long-only, next-bar fills.</li>
        <li>Backtests report Sharpe, Sortino, max drawdown, win rate and profit factor against
            buy-and-hold, with a walk-forward split.</li>
        <li>Portfolio uses FIFO lot matching, fees folded into basis, realised and unrealised
            P&amp;L separated, with CSV export.</li>
        <li>Wallet lab: EIP-55 checksums, bech32 verification, address-poisoning detection and
            approval-risk scoring. No seed phrase, no private key, no signing.</li>
      </ul>
      <p>CryptoX is research and simulation software. No exchange account is connected, no order
      is ever placed, and nothing in the product is investment advice.</p>`,
    extra: `<p>Start with the ${link('/pricing', 'free tier')} (no card), or read
      ${link('/data-sources', 'exactly where the data comes from')}.</p>`
  },

  '/pricing': {
    h1: 'CryptoX plans and pricing',
    body: `
      <p>Four tiers, billed monthly or annually. Prices shown here are the same figures the
      billing page and the checkout read.</p>
      <ul>
        <li><strong>Free — $0.</strong> One portfolio, 5 price alerts, 1,000 API calls a month,
            one seat, CSV export, community support. No card required.</li>
        <li><strong>Pro — $9.99/month or $99.99/year.</strong> 10 portfolios, 100 alerts,
            3 trading bots, 250,000 API calls a month, 3 seats, 90 days of audit log, CSV and
            JSON export, email support. 14-day trial.</li>
        <li><strong>Business — $24.99/month or $249.99/year.</strong> 50 portfolios, 1,000 alerts,
            25 bots, 2,000,000 API calls a month, 25 seats, 365 days of audit log, XLSX export,
            priority support. 14-day trial.</li>
        <li><strong>Enterprise — $199.99/month or $1,999.99/year.</strong> Unlimited portfolios,
            alerts, bots and seats, 2,555 days of audit log, dedicated support.</li>
      </ul>
      <p>Payments are handled by Lemon Squeezy. A plan activates when their payment webhook is
      confirmed — returning to this site after checkout is not itself proof of payment. Plan
      changes and cancellations go through the Lemon Squeezy billing portal.</p>
      <p>Annual billing is priced at roughly a 17% saving on every tier, which is arithmetic on
      the monthly price, not a promotional claim.</p>`,
    extra: `<p>Questions about limits? ${link('/data-sources', 'Data sources')} explains what
      each feed costs in requests.</p>`
  },

  '/data-sources': {
    h1: 'Where CryptoX market data comes from',
    body: `
      <p>Every figure in the product carries a provenance badge. This page lists the feeds behind
      those badges, with their refresh behaviour.</p>
      <ul>
        <li><strong>CoinGecko REST</strong> — the 250-coin market table, global market cap,
            BTC dominance, 24h volume and 7-day sparklines. Polled roughly every 60 seconds.</li>
        <li><strong>Binance WebSocket</strong> — live ticks and candles, about once a second,
            for pairs that exist on Binance.</li>
        <li><strong>Alternative.me</strong> — the Fear &amp; Greed index shown on its own page.</li>
        <li><strong>Fallback candles</strong> — generated deterministically when both live hosts
            fail. Badged SIMULATED and refused by the strategy engine, backtester and paper
            trader.</li>
      </ul>
      <h2>What the badges mean</h2>
      <ul>
        <li><strong>LIVE</strong> — the value came from the primary host in this session.</li>
        <li><strong>DELAYED</strong> — a recent cached value; the timestamp is shown.</li>
        <li><strong>SIMULATED</strong> — synthetic data. Never used for signals or trades.</li>
      </ul>
      <p>A coin with no live exchange pair in the current poll is marked with a tilde instead of
      being given a fabricated price. Market-data licensing and trademark position are covered on
      the ${link('/compliance', 'compliance page')}.</p>`
  },

  '/status': {
    h1: 'CryptoX system status',
    body: `
      <p>This page reports the health of the market feeds the dashboard depends on: last tick
      time, provider latency, whether a feed is degraded or simulated, and the build version
      currently deployed.</p>
      <p>Feed states are one of <strong>live</strong>, <strong>connecting</strong>,
      <strong>degraded</strong> or <strong>simulated</strong>. The topbar chip and this page read
      the same state, so a claim about data health can be checked against what the app is
      actually serving.</p>
      <p>If a feed degrades, affected values are badged rather than hidden, and the strategy
      engine refuses to arm on simulated candles.</p>`
  },

  '/legal/privacy': {
    h1: 'Privacy Notice',
    body: `
      <p>What CryptoX stores, where it is stored, which third-party endpoints see your IP
      address, and how to delete your data.</p>
      <p>Account email and a PBKDF2-SHA256 hash of your password are stored — never the password
      itself. Session metadata and preferences are kept with the account. The app sets no
      tracking cookies and loads no third-party analytics.</p>
      <p>To show live prices the browser contacts public endpoints operated by CoinGecko, Binance
      and Alternative.me, which means those providers see your IP address. Their handling of it
      is governed by their own policies.</p>
      <p>Material changes to this notice are surfaced in-app. The full text is on this page in
      the app; the ${link('/legal/terms', 'terms of use')} and
      ${link('/legal/risk', 'risk disclosure')} sit alongside it.</p>`
  },

  '/legal/terms': {
    h1: 'Terms of Use',
    body: `
      <p>The terms that govern use of the CryptoX dashboard, subscriptions billed through Lemon
      Squeezy, and the limits of the service.</p>
      <p>CryptoX is research and simulation software. It places no orders, connects to no
      exchange account, and provides no investment advice. Subscriptions renew until cancelled
      in the Lemon Squeezy billing portal; access follows the payment webhook rather than the
      checkout redirect.</p>
      <p>Related documents: ${link('/legal/privacy', 'privacy notice')} and
      ${link('/legal/risk', 'risk disclosure')}.</p>`
  },

  '/legal/risk': {
    h1: 'Risk Disclosure',
    body: `
      <p>Crypto assets are volatile and can lose value quickly. Nothing in CryptoX is investment
      advice, and no output of the product is a recommendation to buy or sell anything.</p>
      <p>Backtested results do not predict future returns. A backtest fills on the next bar, with
      fees and slippage applied, which makes it more honest than a bar-close fill but still an
      approximation: it cannot model order-book depth, exchange outages or your own reaction to a
      drawdown.</p>
      <p>Simulated data is labelled and never used to drive signals or trades. Paper trading uses
      a virtual balance and has no connection to real funds.</p>`
  },

  '/legal/security': {
    h1: 'Security Overview',
    body: `
      <p>How CryptoX protects accounts: PBKDF2-SHA256 password hashing at 210,000 iterations with
      a per-user salt, session expiry, account lockout, a restrictive Content Security Policy
      that limits which origins the page may contact, and an error boundary that captures render
      failures before they become a blank screen.</p>
      <p>The wallet lab is read-only by design: it verifies EIP-55 checksums, bech32 addresses,
      address-poisoning patterns and token approvals, and it never asks for a seed phrase or a
      private key, and never signs a transaction.</p>
      <p>Residual risks and the disclosure process are documented in the repository's security
      policy; the ${link('/status', 'status page')} shows what is deployed right now.</p>`
  },

  '/compliance': {
    h1: 'Compliance and data licensing',
    body: `
      <p>Market-data licensing, trademark position and the regulatory boundaries CryptoX operates
      within as a research and simulation product.</p>
      <p>CryptoX displays publicly available market data from CoinGecko and Binance under their
      respective terms of use. Commercial redistribution of that data may require a separate
      licence; that question is tracked as an open item in this repository rather than assumed
      settled.</p>
      <p>Product names and exchange names referenced in the interface belong to their owners and
      are used descriptively. CryptoX is not affiliated with, endorsed by, or sponsored by any
      exchange.</p>`
  }
};

export { nav };

/* ---------------------------------------------------------------------------
 * Guides — derived from src/lib/guides.js, not retyped.
 *
 * A guide that exists on screen but not in this map fails the build (the
 * prerenderer refuses a missing entry), which is deliberate: a public route
 * that renders for a browser and nothing for a crawler is the defect this
 * whole step exists to remove.
 * ------------------------------------------------------------------------ */

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const guideBodyHtml = (guide) =>
  guide.sections
    .map(
      (section) => `
      <h2>${escapeHtml(section.heading)}</h2>
      ${section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n      ')}
      ${section.bullets?.length ? `<ul>${section.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ''}`
    )
    .join('\n') +
  (guide.faq?.length
    ? `
      <h2>Common questions</h2>
      <dl>${guide.faq.map(([q, a]) => `<dt><strong>${escapeHtml(q)}</strong></dt><dd>${escapeHtml(a)}</dd>`).join('')}</dl>`
    : '');

PRERENDER_CONTENT['/guides'] = {
  h1: 'The method behind the numbers',
  body: `
      <p>Short, method-first guides on the parts of crypto research that are easy to get subtly
      wrong: what a backtest actually proves, why the fill price decides whether a result is real,
      and how cost basis is calculated. No predictions and no signals.</p>
      <ul>
        ${GUIDES.map((g) => `<li><a href="/guides/${g.slug}">${escapeHtml(g.title)}</a> — ${escapeHtml(g.description)}</li>`).join('\n        ')}
      </ul>
      <h2>Glossary</h2>
      <dl>${GUIDE_GLOSSARY.map(([term, meaning]) => `<dt><strong>${escapeHtml(term)}</strong></dt><dd>${escapeHtml(meaning)}</dd>`).join('')}</dl>`,
  extra: `<p>CryptoX is research and simulation software. No orders are placed and nothing here is
      investment advice. See the <a href="/legal/risk">risk disclosure</a>.</p>`
};

for (const guide of GUIDES) {
  PRERENDER_CONTENT[`/guides/${guide.slug}`] = {
    h1: guide.title,
    body: `
      <p>${escapeHtml(guide.description)}</p>
      ${guideBodyHtml(guide)}`,
    extra: `<p><a href="/guides">All research guides</a> · <a href="/pricing">Plans and pricing</a> ·
      <a href="/legal/risk">Risk disclosure</a></p>`
  };
}
