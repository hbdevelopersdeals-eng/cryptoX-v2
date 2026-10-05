import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Star, Zap, Loader2, Globe2, BarChart3, Activity } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { INTERVALS, PRESETS } from '../lib/strategies.js';
import { fmtPrice, fmtCompact, fmtUsd, cls } from '../lib/format.js';
import { CoinImg, PctBadge, Card, EmptyState, CoinLink } from '../components/ui.jsx';
import { useWatchlist } from '../lib/prefs.jsx';
import CandleChart from '../components/CandleChart.jsx';

export default function CoinDetailPage() {
  const { id } = useParams();
  const { rows, byId, bySymbol, getKlines, binanceInfo, tickers } = useMarket();
  const [watch, toggle] = useWatchlist();
  const [interval, setInterval] = useState('1h');
  const [candles, setCandles] = useState(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [klineSource, setKlineSource] = useState('binance');
  const [showTable, setShowTable] = useState(false);

  const row = byId[id];

  useEffect(() => {
    if (!row) return;
    let alive = true;
    setLoadingChart(true);
    setCandles(null);
    const load = async () => {
      try {
        const res = await getKlines(row.symbol, interval);
        if (alive) { setCandles(res.candles); setKlineSource(res.source); }
      } finally {
        if (alive) setLoadingChart(false);
      }
    };
    load();
    const iv = window.setInterval(load, 55000);
    return () => { alive = false; window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, interval]);

  const livePrice = row?.price;
  const extended = useMemo(() => {
    if (!candles?.length) return candles;
    const last = candles[candles.length - 1];
    if (livePrice && Math.abs(livePrice - last.c) > 0 && Math.abs(livePrice - last.c) / last.c < 0.05) {
      const copy = [...candles];
      copy[copy.length - 1] = { ...last, c: livePrice, h: Math.max(last.h, livePrice), l: Math.min(last.l, livePrice) };
      return copy;
    }
    return candles;
  }, [candles, livePrice]);

  const related = useMemo(() => {
    if (!row) return [];
    return rows
      .filter((r) => r.id !== row.id && r.pct24 != null)
      .sort((a, b) => b.pct24 - a.pct24)
      .slice(0, 4);
  }, [rows, row]);

  if (!rows.length) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
        <Loader2 size={24} className="mr-2 animate-spin" /> Loading coin…
      </div>
    );
  }

  if (!row) {
    return (
      <EmptyState
        icon={<Activity size={32} className="text-muted-foreground" />}
        title="Coin not found"
        sub="This coin isn't in the current market feed."
        action={<Link to="/" className="btn-ghost">Back to Markets</Link>}
      />
    );
  }

  const info = binanceInfo[row.symbol];
  const watched = watch.includes(row.id);
  const liveT = tickers[row.symbol];
  const hi24 = liveT?.hi ?? null;
  const lo24 = liveT?.lo ?? null;

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={15} /> Back to Markets
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <CoinImg src={row.image} symbol={row.symbol} size={52} />
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
              {row.name}
              <span className="text-base font-normal text-muted-foreground">{row.symbol}</span>
              {row.rank ? <span className="chip !py-0.5 text-[11px]">Rank #{row.rank}</span> : null}
            </h1>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="num text-2xl font-bold">{fmtPrice(row.price)}</span>
              <PctBadge value={row.pct24} />
              <span className="text-xs text-muted-foreground">24h</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toggle(row.id)} className={`btn-sm-dark ${watched ? '!text-primary' : ''}`}>
            <Star size={14} fill={watched ? 'currentColor' : 'none'} /> {watched ? 'Watched' : 'Watchlist'}
          </button>
          <Link to="/strategies" className="btn-sm-dark !border-primary/40 !bg-primary/10 !text-primary">
            <Zap size={14} /> 1-click strategies
          </Link>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Market Cap</p><p className="num mt-1 text-base font-semibold">{fmtCompact(row.mcap)}</p></Card>
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">24h Volume</p><p className="num mt-1 text-base font-semibold">{fmtCompact(row.vol)}</p></Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">24h Range</p>
          <p className="num mt-1 text-base font-semibold">
            {hi24 ? <span className="text-down">{fmtPrice(lo24)}</span> : '—'}
            <span className="mx-1.5 text-muted-foreground">/</span>
            {hi24 ? <span className="text-up">{fmtPrice(hi24)}</span> : '—'}
          </p>
        </Card>
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">7d Change</p><p className={`num mt-1 text-base font-semibold ${cls(row.pct7)}`}>{row.pct7 >= 0 ? '+' : ''}{row.pct7?.toFixed(2)}%</p></Card>
      </div>

      {/* Chart */}
      <Card className="overflow-hidden !p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Price Chart</h2>
            {klineSource === 'simulated' ? (
              <span role="status" className="chip !border-amber-400/30 !bg-amber-400/10 !py-0.5 text-[10px] text-amber-400">SIMULATED DATA</span>
            ) : info ? (
              <span className="text-[11px] text-muted-foreground">Binance {info.pair} · real-time</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">market feed</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="btn-sm-dark !h-7 !px-2 !text-[11px]"
            >
              {showTable ? 'Hide table' : 'Data table'}
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-0.5 text-xs">
            {INTERVALS.map((it) => (
              <button
                key={it.key}
                onClick={() => setInterval(it.key)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${interval === it.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {it.label}
              </button>
            ))}
            </div>
          </div>
        </div>
        {loadingChart && !candles ? (
          <div role="status" className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={20} className="mr-2 animate-spin" /> Building chart from {interval} candles…
          </div>
        ) : (
          <div className="px-1 py-2">
            {klineSource === 'simulated' ? (
              <div role="status" className="mx-3 mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
                Live candle data is unavailable — this chart shows synthetic candles for layout only. Do not use it for trading decisions.
              </div>
            ) : null}
            <CandleChart
              candles={extended}
              interval={interval}
              height={440}
              label={`${row.name} ${row.symbol} price chart, ${interval} candles, ${klineSource === 'simulated' ? 'synthetic' : 'live'} data`}
            />
            {showTable ? (
              <div className="mt-3 overflow-x-auto px-3 pb-3">
                <table className="w-full min-w-[520px] text-xs">
                  <caption className="sr-only">{row.name} {row.symbol} recent {interval} candles — text alternative to the chart</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-semibold">Time</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Open</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">High</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Low</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Close</th>
                      <th scope="col" className="py-2 text-right font-semibold">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(extended || []).slice(-20).reverse().map((c) => (
                      <tr key={c.t} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 pr-3 text-muted-foreground">{new Date(c.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                        <td className="num py-1.5 pr-3 text-right">{fmtPrice(c.o)}</td>
                        <td className="num py-1.5 pr-3 text-right">{fmtPrice(c.h)}</td>
                        <td className="num py-1.5 pr-3 text-right">{fmtPrice(c.l)}</td>
                        <td className="num py-1.5 pr-3 text-right">{fmtPrice(c.c)}</td>
                        <td className="num py-1.5 text-right text-muted-foreground">{c.v >= 1e6 ? (c.v / 1e6).toFixed(2) + 'M' : Math.round(c.v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Related movers */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Trending movers</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {related.map((r) => (
            <Link key={r.id} to={`/coin/${r.id}`} className="card-panel flex items-center gap-2.5 p-3 transition-colors hover:bg-accent/40">
              <CoinImg src={r.image} symbol={r.symbol} size={26} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-xs font-medium">{r.name} <span className="text-muted-foreground">{r.symbol}</span></p>
                <p className="num text-[11px] text-muted-foreground">{fmtPrice(r.price)}</p>
              </div>
              <span className={`num text-xs font-semibold ${cls(r.pct24)}`}>{r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
