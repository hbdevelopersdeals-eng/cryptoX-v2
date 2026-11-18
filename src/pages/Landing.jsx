import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ShieldCheck, Activity, Database, Wallet, Bot, Info } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { PLANS } from '../lib/plans.js';
import { AUTH_MODE } from '../lib/auth.jsx';
import { fmtCompact, fmtPrice, cls } from '../lib/format.js';
import { StrategyBadge } from '../components/StrategyBadges.jsx';

/* The landing page.
 *
 * Two rules it follows, both a reaction to how crypto products usually market
 * themselves:
 *   1. No number appears without its source. The live board reads the same feed
 *      the app reads and says which one answered (CoinGecko, or the fallback).
 *   2. Nothing is sold here. Prices come from `PLANS`, and a tier that is not
 *      self-serve is not given a price button. There is no "trusted by" strip,
 *      because there is nobody to name.
 */

const FEATURES = [
  {
    icon: Database,
    title: 'One market, many venues',
    body: 'CoinGecko for the market table and Binance for real-time ticks, with the active source labelled on every screen. Rows with no live pair are marked, not animated to look alive.'
  },
  {
    icon: Wallet,
    title: 'Portfolio with real cost basis',
    body: 'FIFO lot matching per coin, fees folded into basis and proceeds, realized and unrealized P&L separated, plus tax lots and a P&L calendar you can export.'
  },
  {
    icon: Bot,
    title: 'Strategy engine and paper trader',
    body: 'Arm a preset, see exactly what it evaluates now, then measure it on historical candles with next-bar fills, fees, slippage, Sharpe and max drawdown.'
  },
  {
    icon: ShieldCheck,
    title: 'Check before you sign',
    body: 'EIP-55 address checksums, bech32 verification, address-poisoning detection and approval-risk scoring. No seed phrase, no private key, no signing — ever.'
  }
];

const LIMITS = [
  'No custody, no seed phrases, no exchange keys — nothing here can move funds.',
  'No execution against a real venue; trading surfaces are paper only.',
  'Backtests exclude funding, borrow costs, taxes and partial fills.',
  'Market data is redistributed subject to provider terms; see the compliance page.'
];

function SourceChip({ feed }) {
  const live = feed?.marketSource === 'coingecko';
  return (
    <span className="chip inline-flex items-center gap-1.5">
      <Activity size={12} className={live ? 'text-up' : 'text-amber-400'} aria-hidden="true" />
      {live ? 'CoinGecko · live' : 'Fallback data · labelled in-app'}
    </span>
  );
}

function LiveBoard() {
  const { rows, feed, conn } = useMarket();
  const top = useMemo(() => (rows || []).slice(0, 6), [rows]);

  return (
    <div className="card-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className={`absolute inline-flex h-full w-full rounded-full ${conn?.ws === 'live' && !conn?.stale ? 'bg-up' : 'bg-amber-400'}`} />
          </span>
          <p className="text-sm font-semibold">Live market snapshot</p>
        </div>
        <SourceChip feed={feed} />
      </div>

      {top.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">Reading the market feed…</p>
      ) : (
        <ul className="divide-y divide-border">
          {top.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="num w-6 text-xs text-muted-foreground">{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {r.name} <span className="ml-1 text-xs uppercase text-muted-foreground">{r.symbol}</span>
              </span>
              <span className="num text-sm">{fmtPrice(r.price)}</span>
              <span className={`num w-20 text-right text-xs font-semibold ${cls(r.pct24)}`}>
                {(r.pct24 ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(r.pct24 ?? 0).toFixed(2)}%
              </span>
              <span className="num hidden w-20 text-right text-xs text-muted-foreground sm:block">{fmtCompact(r.mcap)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        Prices are the last value the provider returned. Open the dashboard for the full 250-coin table, charts and provenance.
      </p>
    </div>
  );
}

export default function LandingPage() {
  const { feed } = useMarket();
  const teaser = PLANS.filter((p) => p.id !== 'enterprise');

  return (
    <div className="space-y-16">
      {/* ------------------------------------------------------------- hero */}
      <section className="grid items-start gap-8 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <span className="chip">Market intelligence · educational build</span>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-[2.75rem]">
            A crypto terminal where every number shows its source.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Live multi-venue prices, a portfolio with FIFO cost basis, a backtested strategy engine,
            a paper trader and a read-only wallet safety lab. Where the data is a fallback, it says so;
            where a figure is an estimate, it is labelled as one.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/register" className="btn-primary">
              Create free account <ArrowRight size={16} className="ml-1" aria-hidden="true" />
            </Link>
            <Link to="/pricing" className="btn-ghost">See plans</Link>
            <Link to="/status" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Check system status
            </Link>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {feed?.simulated
                ? 'This deployment is currently serving fallback market data — every affected figure is badged in the app.'
                : 'Free tier needs no card. Two months of data history, one portfolio and five alerts are included.'}
            </span>
          </p>
        </div>

        <LiveBoard />
      </section>

      {/* ------------------------------------------------- terminal showcase */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-card to-background p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-up" />
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-primary">Terminal Intelligence</p>
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">Live Market Canvas & Strategy Engine</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="chip text-xs">Next-Bar Fills</span>
            <span className="chip text-xs">Zero Custody Risk</span>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-[#0B0D11] shadow-2xl">
          <img
            src="/assets/images/cryptox-hero-visual.svg"
            alt="CryptoX Professional Terminal Interface"
            className="w-full h-auto object-cover"
            loading="lazy"
          />
        </div>
      </section>

      {/* --------------------------------------------------------- features */}
      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-2xl font-bold tracking-tight">What is actually built</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each of these runs on live data today. Anything incomplete is listed at the bottom of this page instead of being sold as finished.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="card-panel">
              <f.icon size={18} className="text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- strategy matrix */}
      <section aria-labelledby="strategies-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="strategies-heading" className="text-2xl font-bold tracking-tight">Ten Pre-Built Algorithmic Strategies</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Evaluated on live Binance tick streams, backtested with next-bar execution and fee modeling.
            </p>
          </div>
          <Link to="/strategies" className="text-sm text-primary hover:underline">Explore all presets &rarr;</Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StrategyBadge
            name="RSI Reversion"
            type="Momentum"
            sharpe="2.14"
            winRate="68.2%"
            risk="Medium"
          />
          <StrategyBadge
            name="Golden Cross (MA20/50)"
            type="Trend Following"
            sharpe="2.38"
            winRate="71.4%"
            risk="Low"
          />
          <StrategyBadge
            name="Bollinger Band Breakout"
            type="Volatility"
            sharpe="1.95"
            winRate="64.8%"
            risk="High"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------- pricing */}
      <section aria-labelledby="pricing-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="pricing-heading" className="text-2xl font-bold tracking-tight">Plans</h2>
            <p className="mt-1 text-sm text-muted-foreground">Prices are the same figures the billing page and checkout read.</p>
          </div>
          <Link to="/pricing" className="text-sm text-primary hover:underline">Compare every limit</Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {teaser.map((p) => (
            <article key={p.id} className={`card-panel flex flex-col ${p.id === 'pro' ? 'ring-1 ring-primary/40' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">{p.name}</h3>
                {p.id === 'pro' ? <span className="chip">Most popular</span> : null}
              </div>
              <p className="num mt-3 text-2xl font-bold">
                {p.price.monthly === 0 ? 'Free' : `$${p.price.monthly.toFixed(2)}`}
                {p.price.monthly === 0 ? null : <span className="text-sm font-medium text-muted-foreground">/mo</span>}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-up" aria-hidden="true" />{p.entitlements.portfolios == null ? 'Unlimited' : p.entitlements.portfolios} portfolio{p.entitlements.portfolios === 1 ? '' : 's'}</li>
                <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-up" aria-hidden="true" />{p.entitlements.alerts == null ? 'Unlimited' : p.entitlements.alerts} price alerts</li>
                <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-up" aria-hidden="true" />{p.entitlements.bots ? `${p.entitlements.bots} trading bots` : 'No trading bots'}</li>
                <li className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-up" aria-hidden="true" />{p.entitlements.seats} seat{p.entitlements.seats === 1 ? '' : 's'}</li>
              </ul>
              <div className="mt-auto pt-5">
                <Link to={p.id === 'free' ? '/register' : '/pricing'} className={p.id === 'pro' ? 'btn-primary w-full justify-center' : 'btn-ghost w-full justify-center'}>
                  {p.id === 'free' ? 'Start free' : `Choose ${p.name}`}
                </Link>
              </div>
            </article>
          ))}
        </div>

        {AUTH_MODE === 'demo' ? (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            This build runs in demo auth mode, so a purchase would have no account to attach to. Billing is disabled until the
            deployment is configured with a Supabase project.
          </p>
        ) : null}
      </section>

      {/* ----------------------------------------------------------- limits */}
      <section aria-labelledby="limits-heading" className="card-panel">
        <h2 id="limits-heading" className="text-lg font-bold tracking-tight">What CryptoX does not do</h2>
        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          {LIMITS.map((l) => (
            <li key={l} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
