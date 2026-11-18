/* Public route manifest — ONE source of truth for SEO metadata.
 *
 * Why this file exists:
 *   robots.txt, sitemap.xml, the <title>/<meta> tags and the canonical URL all
 *   have to agree. When they are written in four places they drift, and the
 *   usual result is a sitemap advertising URLs that redirect or 404. Every
 *   consumer below reads this list, and `scripts/gen-sitemap.mjs --check`
 *   fails the build if the committed sitemap is out of sync with it.
 *
 * `indexable: true` means: the route renders without a session, has real
 * content in the DOM, and returns 200 for an anonymous crawler. Anything
 * behind <RequireAuth> is deliberately absent — it must never be advertised
 * to a search engine, because a crawler that follows it only ever sees the
 * login wall (a soft 404, and a coverage error in Search Console).
 */

export const SITE_NAME = 'CryptoX';

/** Routes a signed-out visitor can load and index. */
export const PUBLIC_ROUTES = [
  {
    // The homepage is the landing page for a signed-out visitor and the market
    // dashboard for a signed-in one (see AppBoundary in App.jsx). It has to be
    // the canonical entry: before this, `/` answered every crawler with the
    // login wall, so the one URL people and models actually cite was a soft 404.
    path: '/',
    indexable: true,
    priority: 1.0,
    changefreq: 'weekly',
    title: 'CryptoX — Real-Time Crypto Market Terminal, Charts & Paper Trading',
    description:
      'Track 250+ coins with live Binance and CoinGecko data, candlestick charts with RSI and moving averages, ten strategy presets, an honest backtester and a paper-trading simulator. Free to start, no card required.'
  },
  {
    // Legacy path from the HashRouter era. It still resolves, but only as a
    // client-side redirect to `/`, so it must never appear in the sitemap.
    path: '/welcome',
    indexable: false,
    priority: 0.1,
    changefreq: 'yearly',
    title: 'CryptoX — Real-Time Crypto Market Terminal, Charts & Paper Trading',
    description:
      'Track 250+ coins with live Binance and CoinGecko data, candlestick charts with RSI and moving averages, ten strategy presets, an honest backtester and a paper-trading simulator. Free to start, no card required.'
  },
  {
    path: '/pricing',
    indexable: true,
    priority: 0.9,
    changefreq: 'monthly',
    title: 'CryptoX Pricing — Free, Pro $9.99/mo, Business $24.99/mo',
    description:
      'Compare CryptoX plans: a free tier for market tracking and paper trading, Pro for unlimited alerts, bots and derivatives analytics, and Business for teams. Billed securely through Lemon Squeezy; cancel any time.'
  },
  {
    path: '/data-sources',
    indexable: true,
    priority: 0.7,
    changefreq: 'monthly',
    title: 'CryptoX Data Sources — Every Feed, Provenance and Refresh Rate',
    description:
      'Exactly where CryptoX market data comes from: CoinGecko REST, Binance WebSocket, Fear & Greed, and the venue adapters behind the price aggregator — with refresh intervals and the LIVE, DELAYED and SIMULATED badges explained.'
  },
  {
    path: '/status',
    indexable: true,
    priority: 0.6,
    changefreq: 'daily',
    title: 'CryptoX System Status — Live Feed Health and Data Provenance',
    description:
      'Real-time health of the CryptoX market feeds: last tick, provider latency, degraded and simulated states, plus the build version currently deployed.'
  },
  {
    path: '/guides',
    indexable: true,
    priority: 0.8,
    changefreq: 'monthly',
    title: 'Crypto Research Guides — Backtesting, Paper Trading and Cost Basis',
    description:
      'Short, method-first guides: what a backtest proves versus paper trading, why a next-bar fill decides whether a result is real, and how FIFO cost basis is calculated. Plus a glossary of the terms CryptoX computes.'
  },
  {
    path: '/guides/paper-trading-vs-backtesting',
    indexable: true,
    priority: 0.7,
    changefreq: 'monthly',
    title: 'Paper Trading vs Backtesting — What Each One Actually Proves',
    description:
      'A backtest replays history; paper trading runs forward on live data. What each can and cannot tell you about a crypto strategy, and how CryptoX keeps both honest with next-bar fills and simulated-data refusal.'
  },
  {
    path: '/guides/next-bar-fill',
    indexable: true,
    priority: 0.7,
    changefreq: 'monthly',
    title: 'Why Next-Bar Fills Matter More Than Your Indicator',
    description:
      'Filling an order at the price that produced the signal is lookahead bias. How next-bar execution, trading fees and slippage change a crypto backtest result, and why buy-and-hold is the benchmark.'
  },
  {
    path: '/guides/fifo-cost-basis',
    indexable: true,
    priority: 0.7,
    changefreq: 'monthly',
    title: 'FIFO Cost Basis for a Crypto Portfolio, Without the Spreadsheet',
    description:
      'When you sell part of a position, which units you sold decides the gain. How FIFO lot matching, fees in the basis and realised versus unrealised P&L work in CryptoX, and what it does not do about taxes.'
  },
  {
    path: '/legal/privacy',
    indexable: true,
    priority: 0.3,
    changefreq: 'yearly',
    title: 'CryptoX Privacy Notice',
    description:
      'What CryptoX stores, where it is stored, which third-party endpoints see your IP, and how to delete your data. No tracking cookies, no third-party analytics.'
  },
  {
    path: '/legal/terms',
    indexable: true,
    priority: 0.3,
    changefreq: 'yearly',
    title: 'CryptoX Terms of Use',
    description:
      'The terms that govern use of the CryptoX dashboard, subscriptions billed through Lemon Squeezy, and the limits of the service.'
  },
  {
    path: '/legal/risk',
    indexable: true,
    priority: 0.3,
    changefreq: 'yearly',
    title: 'CryptoX Risk Disclosure',
    description:
      'Crypto assets are volatile. CryptoX is research and simulation software: no orders are placed, no signals are investment advice, and backtested results do not predict future returns.'
  },
  {
    path: '/legal/security',
    indexable: true,
    priority: 0.3,
    changefreq: 'yearly',
    title: 'CryptoX Security Overview',
    description:
      'How CryptoX protects accounts: PBKDF2-SHA256 password hashing, session expiry, a restrictive Content Security Policy, and a read-only wallet lab that never asks for a seed phrase.'
  },
  {
    path: '/compliance',
    indexable: true,
    priority: 0.3,
    changefreq: 'yearly',
    title: 'CryptoX Compliance and Data Licensing',
    description:
      'Market-data licensing, trademark position and the regulatory boundaries CryptoX operates within as a research and simulation product.'
  }
];

/**
 * Path prefixes that must never be crawled: they are session-scoped views of
 * one user's data and return the login wall to an anonymous agent.
 */
export const PRIVATE_PATH_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/portfolio',
  '/watchlist',
  '/alerts',
  '/account',
  '/organization',
  '/billing',
  '/upgrade',
  '/strategies',
  '/paper-trading',
  '/bots',
  '/derivatives',
  '/exchange',
  '/wallet-lab',
  '/explorer',
  '/assistant',
  '/rsi-scanner',
  '/market-intel',
  '/trending',
  '/bubbles',
  '/fear-greed',
  '/charting',
  '/aggregator',
  '/defi',
  '/news',
  '/calculator',
  '/region',
  '/coin',
  '/search',
  '/copy-trading',
  '/launchpad',
  '/academy',
  '/referral',
  '/social',
  '/admin',
  '/404'
];

const normalise = (path) => {
  const clean = '/' + String(path || '/').replace(/^#/, '').replace(/^\/+/, '');
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
};

/** Metadata for a pathname, or null when the route is private/unknown. */
export function seoForPath(pathname) {
  const clean = normalise(pathname);
  const exact = PUBLIC_ROUTES.find((r) => r.path === clean.toLowerCase());
  if (exact) return exact;
  // /legal/<doc> variants resolve to their own entry; anything else unknown is
  // treated as non-indexable so a typo never inherits the home page's canonical.
  return null;
}

/** Absolute canonical URL for a pathname. Always path-based — never a hash. */
export function canonicalFor(pathname, baseUrl) {
  const clean = normalise(pathname);
  return `${String(baseUrl).replace(/\/+$/, '')}${clean === '/' ? '/' : clean}`;
}

/** URLs advertised to crawlers: indexable public routes only. */
export function sitemapEntries() {
  return PUBLIC_ROUTES.filter((r) => r.indexable);
}
