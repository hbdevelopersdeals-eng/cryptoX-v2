import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, TrendingUp, CircleDollarSign, Smile, Star, Wallet, BellRing,
  Zap, Play, Calculator, Newspaper, Search, Menu, X, LogOut, Radio, Database,
  XCircle, Activity, BarChart3, CandlestickChart, LineChart, Layers, ShieldCheck, Boxes
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useI18n, LANGUAGES } from '../lib/i18n.jsx';
import { useCurrency, CURRENCIES } from '../lib/currency.jsx';
import { useMarket } from '../lib/market.jsx';
import { CoinImg } from './ui.jsx';
import { agoLabel } from '../lib/format.js';

const NAV = [
  {
    group: 'Markets',
    items: [
      { to: '/', label: 'Crypto Market', icon: LayoutGrid, end: true },
      { to: '/trending', label: 'Trending', icon: TrendingUp },
      { to: '/bubbles', label: 'Crypto Bubbles', icon: CircleDollarSign },
      { to: '/fear-greed', label: 'Fear & Greed', icon: Smile }
    ]
  },
  {
    group: 'Portfolio',
    items: [
      { to: '/watchlist', label: 'Watchlist', icon: Star },
      { to: '/portfolio', label: 'Portfolio', icon: Wallet },
      { to: '/alerts', label: 'Price Alerts', icon: BellRing }
    ]
  },
  {
    group: 'Trading',
    items: [
      { to: '/derivatives', label: 'Derivatives (Paper)', icon: Activity, hot: true },
      { to: '/charting', label: 'Pro Charting', icon: LineChart },
      { to: '/exchange', label: 'Exchange (Paper)', icon: CandlestickChart },
      { to: '/aggregator', label: 'Exchange Aggregator', icon: Layers },
      { to: '/wallet-lab', label: 'Wallet Lab', icon: ShieldCheck },
      { to: '/explorer', label: 'Block Explorer', icon: Boxes },
      { to: '/market-intel', label: 'Market Intelligence', icon: BarChart3 },
      { to: '/data-sources', label: 'Data Sources', icon: Database },
      { to: '/rsi-scanner', label: 'RSI Scanner', icon: Activity, hot: true },
      { to: '/strategies', label: 'Strategy Engine', icon: Zap, hot: true },
      { to: '/paper-trading', label: 'Paper Trader', icon: Play },
      { to: '/calculator', label: 'Calculator', icon: Calculator }
    ]
  },
  {
    group: 'Insights',
    items: [{ to: '/news', label: 'News', icon: Newspaper }]
  }
];

const TITLES = {
  '/': ['Crypto Market', 'Real-time cryptocurrency prices and market data'],
  '/trending': ['Trending', 'Coins moving the most right now'],
  '/bubbles': ['Crypto Bubbles', 'Visual market overview'],
  '/fear-greed': ['Fear & Greed Index', 'Market sentiment history'],
  '/watchlist': ['Watchlist', 'Your tracked coins'],
  '/portfolio': ['Portfolio', 'FIFO cost basis, realized and unrealized P&L, allocation, tax lots, P/L calendar, risk and read-only wallet tracking'],
  '/alerts': ['Price Alerts', 'Get notified when price targets hit'],
  '/charting': ['Professional Charting', 'Chart types, scales, multi-pane sync, indicators, volume profile and drawing tools'],
  '/exchange': ['Exchange Engine (paper)', 'Matching engine, order types, L1/L2/L3 books, risk checks and halts — simulated'],
  '/aggregator': ['Exchange Aggregator', 'Best buy and sell venue per asset, cross-venue price gaps and a venue leaderboard — gross figures, not tradeable profit'],
  '/wallet-lab': ['Wallet Lab', 'Read-only address verification, checksum and scam checks, derivation paths, live gas and transaction simulation — no keys, no signing'],
  '/explorer': ['Blockchain Explorer', 'Blocks, transactions, addresses, tokens, contracts, interfaces, transfers, mempool, gas and validators from public keyless endpoints'],
  '/market-intel': ['Market Intelligence', 'Rankings, movers, sectors, supply, ATH and multi-period performance'],
  '/data-sources': ['Market Data', 'Multi-venue ingestion, consensus pricing, data quality and the real-time engine'],
  '/rsi-scanner': ['RSI Scanner', 'Live oversold (<30) and overbought (>70) coins with buy/sell calls'],
  '/strategies': ['Strategy Engine', 'Ready-made trading strategies — one click'],
  '/paper-trading': ['Paper Trader', 'Test strategies with virtual money'],
  '/calculator': ['Calculator', 'Calculate P&L, fees, breakeven and liquidation price'],
  '/news': ['News & Market Pulse', 'Latest cryptocurrency news and market updates']
};

export default function Shell() {
  const { session, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { rows, conn, feed } = useMarket();
  const { t, lang, setLang } = useI18n();
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const boxRef = useRef(null);

  const meta = TITLES[loc.pathname] || ['CryptoX', ''];

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const t = q.trim().toLowerCase();
    return rows
      .filter((r) => r.symbol.toLowerCase().includes(t) || r.name.toLowerCase().includes(t))
      .slice(0, 7);
  }, [q, rows]);

  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setFocus(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => setOpen(false), [loc.pathname]);

  const go = (path) => { nav(path); setQ(''); setFocus(false); };

  const liveState = feed.simulated
    ? 'demo'
    : conn.stale
      ? 'delay'
      : conn.ws === 'live'
        ? 'live'
        : conn.ws === 'offline'
          ? 'delay'
          : 'sync';

  const SidebarInner = (
    <div className="flex h-full flex-col" role="navigation" aria-label="Main navigation">
      <button
        onClick={() => go('/')}
        className="flex items-center gap-2.5 px-5 pb-5 pt-5 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-base font-extrabold text-primary-foreground">X</span>
        <span className="text-lg font-bold tracking-tight">CryptoX</span>
      </button>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.group}</p>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? 'bg-primary text-primary-foreground' : 'text-sidebar-fg hover:bg-sidebar-hover'
                    }`
                  }
                >
                  <it.icon size={17} />
                  <span className="flex-1">{it.label}</span>
                  {it.hot ? (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${loc.pathname === it.to ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-primary/15 text-primary'}`}>
                      NEW
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
            {(session?.email || 'u').slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium">{session?.email}</p>
            <p className="text-[11px] text-muted-foreground">Demo account</p>
          </div>
          <button
            onClick={() => { logout(); go('/login'); }}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar */}
      <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border bg-sidebar-bg lg:block">
        {SidebarInner}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-sidebar-border bg-sidebar-bg shadow-xl">
            <button aria-label="Close navigation menu" className="absolute right-3 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-hover" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
            {SidebarInner}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur sm:px-6">
          <button aria-label="Open navigation menu" aria-expanded={open} className="rounded-lg p-2 text-muted-foreground hover:bg-accent lg:hidden" onClick={() => setOpen(true)}>
            <Menu size={19} />
          </button>

          <div className="hidden min-w-0 sm:block">
            <h2 className="truncate text-[15px] font-semibold leading-tight">{meta[0]}</h2>
            {meta[1] ? <p className="hidden truncate text-[11px] text-muted-foreground md:block">{meta[1]}</p> : null}
          </div>

          {/* Coin search */}
          <div className="relative ml-auto w-full max-w-xs" ref={boxRef}>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocus(true)}
              placeholder="Search coins…"
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground outline-none transition-colors focus:ring-1 focus:ring-ring"
            />
            {focus && results.length ? (
              <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => go(`/coin/${r.id}`)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <CoinImg src={r.image} symbol={r.symbol} size={20} />
                    <span className="flex-1 truncate">
                      {r.name} <span className="text-muted-foreground">{r.symbol}</span>
                    </span>
                    <span className="num text-xs text-muted-foreground">${r.price?.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Live status */}
          <div className="flex shrink-0 items-center gap-2">
            {liveState === 'live' ? (
              <span className="chip !border-up/25 !bg-up/10 text-up">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
                </span>
                LIVE
              </span>
            ) : liveState === 'demo' ? (
              <span className="chip !border-amber-400/25 !bg-amber-400/10 text-amber-400">
                <Database size={12} /> DEMO
              </span>
            ) : (
              <span className={`chip ${liveState === 'delay' ? 'text-down' : 'text-muted-foreground'}`}>
                <Radio size={12} /> SYNC
              </span>
            )}
            <div className="hidden items-center gap-1.5 sm:flex">
              <label className="sr-only" htmlFor="lang-select">{t('common.language')}</label>
              <select
                id="lang-select"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                aria-label={t('common.language')}
                className="input-dark !h-7 !w-auto !py-0 !px-2 text-[11px]"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="cur-select">{t('common.currency')}</label>
              <select
                id="cur-select"
                value={currency.code}
                onChange={(e) => currency.setCode(e.target.value)}
                aria-label={t('common.currency')}
                className="input-dark !h-7 !w-auto !py-0 !px-2 text-[11px]"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
            </div>
            {liveState === 'demo' ? null : (
              <span
                className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex"
                role="status"
                aria-live="polite"
                title={conn.lastTickAt ? `Last tick ${agoLabel(conn.lastTickAt)} ago` : 'Connecting to Binance feed'}
              >
                {conn.ws === 'live' && !conn.stale ? <span className="text-up">Binance feed</span> : conn.ws === 'offline' || conn.stale ? (
                  <><XCircle size={12} className="text-down" /> {conn.stale ? 'feed stale' : 'feed delayed'}</>
                ) : (
                  <span className="animate-pulseSoft text-muted-foreground">connecting…</span>
                )}
              </span>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
            <Outlet />
            <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
              <span>© {new Date().getFullYear()} CryptoX — demo build, educational use only, not investment advice.</span>
              <Link to="/legal/privacy" className="hover:text-foreground hover:underline">Privacy</Link>
              <Link to="/legal/terms" className="hover:text-foreground hover:underline">Terms</Link>
              <Link to="/legal/risk" className="hover:text-foreground hover:underline">Risk disclosure</Link>
              <Link to="/legal/security" className="hover:text-foreground hover:underline">Security</Link>
              <Link to="/status" className="hover:text-foreground hover:underline">System status</Link>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
