import React, { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Globe2, CircleDollarSign, ArrowRight, Loader2 } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { fmtCompact, fmtPrice, fmtNum, cls } from '../lib/format.js';
import { CoinImg, Sparkline, CoinLink, Stat } from '../components/ui.jsx';
import { useWatchlist } from '../lib/prefs.jsx';
import { PremiumBanner } from '../components/PremiumBanner.jsx';

function TickerRow({ r }) {
  return (
    <div className="flex shrink-0 items-center gap-2 pr-6">
      <CoinImg src={r.image} symbol={r.symbol} size={18} />
      <span className="text-sm font-medium">{r.symbol}</span>
      <span className="num text-sm text-muted-foreground">{fmtPrice(r.price)}</span>
      <span className={`num text-xs font-semibold ${cls(r.pct24)}`}>
        {r.pct24 >= 0 ? '▲' : '▼'} {Math.abs(r.pct24).toFixed(2)}%
      </span>
    </div>
  );
}

const Marquee = memo(function Marquee({ coins }) {
  if (!coins.length) return null;
  const list = [...coins, ...coins];
  return (
    <div className="fade-x relative overflow-hidden border-y border-border bg-card/50">
      <div className="flex w-max animate-marquee items-center py-2 hover:[animation-play-state:paused]">
        {list.map((r, i) => (
          <TickerRow key={r.id + i} r={r} />
        ))}
      </div>
    </div>
  );
});

const Row = memo(function Row({ r, idx, watched, onToggle }) {
  return (
    <Link
      to={`/coin/${r.id}`}
      className="group grid grid-cols-[44px_minmax(160px,1.6fr)_repeat(4,minmax(86px,1fr))_110px_36px] items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-0 hover:bg-accent/40 sm:px-4"
    >
      <span className="num text-xs text-muted-foreground">{idx + 1}</span>
      <CoinLink id={r.id} symbol={r.symbol} name={r.name} image={r.image} />
      <span className="num text-right text-sm">
        {fmtPrice(r.price)}
        {r.live ? null : (
          <span
            className="ml-1 align-super text-[10px] text-muted-foreground"
            title="No live exchange pair — this is the provider's last price, refreshed every 60 seconds."
          >
            ~
          </span>
        )}
      </span>
      <span className={`num text-right text-sm font-medium ${cls(r.pct24)}`}>
        {r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%
      </span>
      <span className={`num text-right text-sm font-medium ${cls(r.pct7)}`}>
        {r.pct7 >= 0 ? '+' : ''}{r.pct7?.toFixed(2)}%
      </span>
      <span className="num text-right text-sm text-muted-foreground">{fmtCompact(r.mcap)}</span>
      <div className="flex justify-end"><Sparkline data={r.spark} width={92} height={28} /></div>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(r.id); }}
        className={`justify-self-end rounded-lg p-1.5 transition-colors ${watched ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}
        title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
      >
        <Star size={15} fill={watched ? 'currentColor' : 'none'} />
      </button>
    </Link>
  );
});

function MoversCard({ title, items }) {
  return (
    <div className="card-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">last 24h</span>
      </div>
      <div>
        {items.slice(0, 5).map((r, i) => (
          <Link to={`/coin/${r.id}`} key={r.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-0 hover:bg-accent/40">
            <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
            <CoinImg src={r.image} symbol={r.symbol} size={20} />
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{r.name}</span>{' '}
              <span className="text-xs text-muted-foreground">{r.symbol}</span>
            </span>
            <span className={`num text-sm font-semibold ${cls(r.pct24)}`}>
              {r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { rows, global, bySymbol, demo } = useMarket();
  const [watch, toggle] = useWatchlist();
  const [limit, setLimit] = useState(50);

  const { gainers, losers, marquee } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.mcap - a.mcap);
    const gain = [...rows].filter((r) => r.pct24 != null).sort((a, b) => b.pct24 - a.pct24);
    const loss = [...rows].filter((r) => r.pct24 != null).sort((a, b) => a.pct24 - b.pct24);
    return { gainers: gain, losers: loss, marquee: sorted.slice(0, 30) };
  }, [rows]);

  const btc = bySymbol.BTC;
  const eth = bySymbol.ETH;

  if (!rows.length) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-sm">Connecting to live market data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Crypto Market</h1>
          <p className="mt-1 text-sm text-muted-foreground">Real-time cryptocurrency prices and market data</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {demo ? (
            <span className="chip !border-amber-400/25 !bg-amber-400/10 text-amber-400">Offline demo mode</span>
          ) : (
            <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-up" /> Live · Binance &amp; CoinGecko feeds</span>
          )}
        </div>
      </div>

      {/* Premium upgrade panel. Placed below the market header so prices stay
          prominent, and it renders as a status strip for a user who already
          holds the advertised plan. */}
      <PremiumBanner />

      {/* Global stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Market Cap" value={fmtCompact(global.mcap)} hint={btc ? `${btc.name} ${fmtPrice(btc.price)}` : ' '} icon={<Globe2 size={20} />} />
        <Stat label="BTC Dominance" value={global.btcDom ? global.btcDom.toFixed(2) + '%' : '—'} hint={eth ? `ETH ${fmtPrice(eth.price)}` : ' '} icon={<CircleDollarSign size={20} />} tone="brand" />
        <Stat label="24h Volume" value={fmtCompact(global.vol)} hint="Global exchange volume" icon={<Globe2 size={20} />} />
      </div>

      <Marquee coins={marquee} />

      {/* Movers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MoversCard title="Top Gainers" items={gainers} />
        <MoversCard title="Top Losers" items={losers} />
      </div>

      {/* Market table */}
      <div className="card-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            All Cryptocurrencies
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              showing {Math.min(limit, rows.length)} of {rows.length}
            </span>
          </h2>
          <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-0.5 text-xs">
            {[50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setLimit(n)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${limit === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[880px] grid-cols-[44px_minmax(160px,1.6fr)_repeat(4,minmax(86px,1fr))_110px_36px] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
            <span>#</span><span>Name</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h %</span>
            <span className="text-right">7d %</span>
            <span className="text-right">Mkt Cap</span>
            <span className="text-right">Last 7 Days</span>
            <span />
          </div>
          <div>
            {rows.slice(0, limit).map((r, i) => (
              <Row key={r.id} r={r} idx={i} watched={watch.includes(r.id)} onToggle={toggle} />
            ))}
          </div>
        </div>
        {rows.length > limit ? (
          <button onClick={() => setLimit(limit + 50)} className="flex w-full items-center justify-center gap-1 border-t border-border py-3 text-sm font-medium text-primary hover:bg-accent/40">
            Show more <ArrowRight size={15} />
          </button>
        ) : null}
        <p className="border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-mono">~</span> marks a coin with no live exchange pair: the price is the provider&apos;s
          last published value and refreshes every 60 seconds. Coins with a live pair update in real time. This feed
          carries the top {rows.length} by market cap.
        </p>
      </div>
    </div>
  );
}
