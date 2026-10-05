import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, RefreshCw, Loader2, Search, Flame, Layers, TrendingUp, TrendingDown, Coins, Info, Star
} from 'lucide-react';
import {
  topGainers, topLosers, topVolume, searchCoins, bucketCategories, valuationRow, universeStats, sortBy
} from '../lib/marketIntel.js';
import { useMarket } from '../lib/market.jsx';
import { useWatchlist } from '../lib/prefs.jsx';
import { fmtPrice, fmtCompact, fmtUsd, cls, timeAgo } from '../lib/format.js';
import { CoinImg, Card } from '../components/ui.jsx';
import { reportError } from '../lib/telemetry.js';

const TABS = [
  ['rankings', 'Rankings', Layers],
  ['movers', 'Gainers & Losers', TrendingUp],
  ['volume', 'Highest Volume', BarChart3],
  ['trending', 'Trending', Flame],
  ['sectors', 'Sectors', Coins],
  ['supply', 'Supply & ATH', Layers],
  ['performance', 'Performance', TrendingDown]
];

const REFRESH_MS = 120000;

export default function MarketIntelPage() {
  const { getKlines } = useMarket();
  const [watch, toggleWatch] = useWatchlist();
  const [coins, setCoins] = useState([]);
  const [categories, setCategories] = useState([]);
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('rankings');
  const [q, setQ] = useState('');
  const [lastRun, setLastRun] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = 'vs_currency=usd&order=market_cap_desc&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d%2C1y';
      const [p1, p2, cats, trend] = await Promise.all([
        fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}&per_page=250&page=1`).then((r) => r.json()),
        fetch(`https://api.coingecko.com/api/v3/coins/markets?${params}&per_page=250&page=2`).then((r) => r.json()),
        fetch('https://api.coingecko.com/api/v3/coins/categories').then((r) => r.json()),
        fetch('https://api.coingecko.com/api/v3/search/trending').then((r) => r.json())
      ]);
      const merged = [...(Array.isArray(p1) ? p1 : []), ...(Array.isArray(p2) ? p2 : [])];
      if (!merged.length) throw new Error('No market data returned');
      setCoins(merged);
      setCategories(Array.isArray(cats) ? cats : []);
      setTrending(Array.isArray(trend?.coins) ? trend.coins : []);
      setLastRun(Date.now());
    } catch (e) {
      reportError(e, { kind: 'marketIntel.load' });
      setErr('Could not load market intelligence data. Retrying automatically.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const iv = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(iv);
  }, [load]);

  const stats = useMemo(() => universeStats(coins), [coins]);
  const buckets = useMemo(() => bucketCategories(categories), [categories]);

  const searched = useMemo(() => searchCoins(coins, q), [coins, q]);
  const rankings = useMemo(() => sortBy(searched, 'market_cap'), [searched]);
  const supply = useMemo(() => sortBy(searched, 'fully_diluted_valuation'), [searched]);
  const performance = useMemo(
    () => sortBy(searched.filter((c) => c.price_change_percentage_30d_in_currency != null), 'price_change_percentage_30d_in_currency'),
    [searched]
  );
  const gainers = useMemo(() => topGainers(searched, 25), [searched]);
  const losers = useMemo(() => topLosers(searched, 25), [searched]);
  const volume = useMemo(() => topVolume(searched, 40), [searched]);

  const Row = ({ c, i, cols }) => {
    const id = c.id;
    const starred = watch.includes(id);
    return (
      <tr className="border-b border-border/60 last:border-0 hover:bg-accent/30">
        <td className="px-3 py-2 text-[11px] text-muted-foreground">{c.market_cap_rank ?? i + 1}</td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleWatch(id)}
              aria-label={starred ? `Remove ${c.name} from watchlist` : `Add ${c.name} to watchlist`}
              aria-pressed={starred}
              className={`shrink-0 rounded p-0.5 ${starred ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Star size={12} fill={starred ? 'currentColor' : 'none'} />
            </button>
            <CoinImg src={c.image} symbol={c.symbol} size={22} />
            <Link to={`/coin/${id}`} className="min-w-0 hover:text-primary">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="block text-[11px] uppercase text-muted-foreground">{c.symbol}</span>
            </Link>
          </div>
        </td>
        {cols.map((col) => (
          <td key={col.key} className={`num px-3 py-2 text-right ${col.tone ? col.tone(c) : ''}`}>
            {col.render(c)}
          </td>
        ))}
      </tr>
    );
  };

  const priceCol = { key: 'price', render: (c) => fmtPrice(c.current_price) };
  const pct = (key) => ({
    key,
    tone: (c) => cls(c[key]),
    render: (c) => (c[key] == null ? '—' : `${c[key] >= 0 ? '+' : ''}${Number(c[key]).toFixed(2)}%`)
  });

  const tableCols = {
    rankings: [priceCol, pct('price_change_percentage_24h_in_currency'), pct('price_change_percentage_7d_in_currency'),
      { key: 'mcap', render: (c) => fmtCompact(c.market_cap) }, { key: 'vol', render: (c) => fmtCompact(c.total_volume) }],
    volume: [priceCol, pct('price_change_percentage_24h_in_currency'),
      { key: 'vol', render: (c) => fmtUsd(c.total_volume, 0) }, { key: 'mcap', render: (c) => fmtCompact(c.market_cap) }],
    supply: [priceCol,
      { key: 'fdv', render: (c) => fmtCompact(c.fully_diluted_valuation) },
      { key: 'ratio', render: (c) => { const r = valuationRow(c).fdvRatio; return r == null ? '—' : `${r.toFixed(2)}×`; } },
      { key: 'supply', render: (c) => { const s = valuationRow(c).supplyPct; return s == null ? '—' : `${s.toFixed(1)}%`; } },
      { key: 'belowath', tone: (c) => 'text-muted-foreground', render: (c) => { const d = valuationRow(c).belowAthPct; return d == null ? '—' : `-${d.toFixed(1)}%`; } }],
    performance: [priceCol, pct('price_change_percentage_30d_in_currency'), pct('price_change_percentage_1y_in_currency'),
      pct('price_change_percentage_24h_in_currency')]
  };

  const COL_HEADS = {
    rankings: ['Price', '24h', '7d', 'Market cap', 'Volume'],
    volume: ['Price', '24h', '24h Volume', 'Market cap'],
    supply: ['Price', 'FDV', 'FDV / MCap', 'Circ. supply', 'Below ATH'],
    performance: ['Price', '30d', '1y', '24h']
  };

  const renderTable = (rows, colsKey) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Market intelligence table</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-semibold">#</th>
            <th scope="col" className="px-2 py-2 font-semibold">Coin</th>
            {COL_HEADS[colsKey].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-right font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => <Row key={c.id} c={c} i={i} cols={tableCols[colsKey]} />)}
        </tbody>
      </table>
      {!rows.length && !loading ? <p className="px-4 py-8 text-center text-xs text-muted-foreground">No coins match.</p> : null}
    </div>
  );

  const moverList = (items, tone) => (
    <div>
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-0">
          <CoinImg src={c.image} symbol={c.symbol} size={22} />
          <Link to={`/coin/${c.id}`} className="min-w-0 flex-1 hover:text-primary">
            <span className="block truncate text-sm font-medium">{c.name}</span>
            <span className="block text-[11px] uppercase text-muted-foreground">{c.symbol}</span>
          </Link>
          <span className="num text-sm">{fmtPrice(c.current_price)}</span>
          <span className={`num w-20 text-right text-sm font-semibold ${tone}`}>
            {c.price_change_percentage_24h_in_currency >= 0 ? '+' : ''}
            {Number(c.price_change_percentage_24h_in_currency).toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <BarChart3 size={22} className="text-primary" /> Market Intelligence
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {stats.coins.toLocaleString()} coins ranked by market cap, with movers, volume, sectors, supply/valuation metrics,
            ATH distance and multi-period performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search coin"
              aria-label="Search coins"
              className="input-dark !h-9 !w-44 !pl-8 text-xs"
            />
          </div>
          <button onClick={load} disabled={loading} className="btn-ghost !h-9 !px-3 !text-xs">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      {lastRun ? (
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          Updated {timeAgo(lastRun)} · auto-refresh 2 min
        </p>
      ) : null}
      {err ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">{err}</div> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Total market cap', fmtUsd(stats.totalMarketCap, 0)],
          ['24h volume', fmtUsd(stats.totalVolume, 0)],
          ['Gainers', stats.gainers],
          ['Losers', stats.losers]
        ].map(([label, value]) => (
          <Card key={label} className="!p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="num mt-1 text-xl font-bold">{value}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-input bg-background p-0.5" role="tablist" aria-label="Market intelligence views">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden !p-0">
        {tab === 'rankings' ? renderTable(rankings.slice(0, 250), 'rankings') : null}

        {tab === 'movers' ? (
          <div className="grid lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <TrendingUp size={15} className="text-up" />
                <h2 className="text-sm font-semibold">Top gainers (24h)</h2>
              </div>
              {moverList(gainers, 'text-up')}
            </div>
            <div className="border-t border-border lg:border-l lg:border-t-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <TrendingDown size={15} className="text-down" />
                <h2 className="text-sm font-semibold">Top losers (24h)</h2>
              </div>
              {moverList(losers, 'text-down')}
            </div>
          </div>
        ) : null}

        {tab === 'volume' ? renderTable(volume, 'volume') : null}

        {tab === 'trending' ? (
          <div>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Flame size={15} className="text-primary" />
              <h2 className="text-sm font-semibold">Trending right now</h2>
              <span className="ml-auto text-[11px] text-muted-foreground">Search-interest based</span>
            </div>
            {trending.map(({ item }) => (
              <div key={item.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <span className="num w-8 text-[11px] text-muted-foreground">{item.market_cap_rank ?? '—'}</span>
                <CoinImg src={item.thumb || item.small} symbol={item.symbol} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-[11px] uppercase text-muted-foreground">{item.symbol}</p>
                </div>
                <span className="num text-sm">
                  {item.data?.price != null ? fmtPrice(item.data.price) : '—'}
                </span>
                <span className={`num w-20 text-right text-sm font-semibold ${cls(item.data?.price_change_percentage_24h?.usd)}`}>
                  {item.data?.price_change_percentage_24h?.usd == null
                    ? '—'
                    : `${item.data.price_change_percentage_24h.usd >= 0 ? '+' : ''}${item.data.price_change_percentage_24h.usd.toFixed(2)}%`}
                </span>
                <Link to={`/coin/${item.id}`} className="text-xs font-medium text-primary hover:underline">Chart</Link>
              </div>
            ))}
            {!trending.length ? <p className="px-4 py-8 text-center text-xs text-muted-foreground">No trending data available.</p> : null}
          </div>
        ) : null}

        {tab === 'sectors' ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {buckets.map((b) => (
              <div key={b.id} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{b.label}</h3>
                  <span className={`num text-sm font-bold ${cls(b.change24h)}`}>
                    {b.change24h == null ? '—' : `${b.change24h >= 0 ? '+' : ''}${b.change24h.toFixed(2)}%`}
                  </span>
                </div>
                <p className="num mt-1 text-lg font-bold">{fmtCompact(b.marketCap)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.count} categories · {fmtCompact(b.volume)} volume
                </p>
                <p className="mt-2 truncate text-[11px] text-muted-foreground" title={b.members.join(', ')}>
                  {b.members.join(' · ')}
                </p>
              </div>
            ))}
            {!buckets.length ? <p className="col-span-full py-6 text-center text-xs text-muted-foreground">No sector data available.</p> : null}
          </div>
        ) : null}

        {tab === 'supply' ? renderTable(supply.slice(0, 150), 'supply') : null}
        {tab === 'performance' ? renderTable(performance.slice(0, 150), 'performance') : null}
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Source: CoinGecko public API (top {stats.coins.toLocaleString()} by market cap). FDV, supply and ATH figures are
          exchange-independent aggregates. New-listing detection needs a licensed listing feed — that sits in the enterprise
          blueprint. Data is for research only, not investment advice.
        </span>
      </div>
    </div>
  );
}
