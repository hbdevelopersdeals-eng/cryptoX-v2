import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, RefreshCw, Loader2, Search, TrendingDown, TrendingUp, Minus, AlertTriangle, Info
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { INTERVALS } from '../lib/strategies.js';
import {
  classifyRsi, rsiFromCloses, closesWithLive, distanceToTrigger, scanStats, chunk,
  STABLE_SYMBOLS, RSI_PERIOD, OVERSOLD, OVERBOUGHT
} from '../lib/rsiScan.js';
import { fmtPrice, fmtCompact, cls, timeAgo } from '../lib/format.js';
import { CoinImg, Card } from '../components/ui.jsx';

const UNIVERSES = [30, 60, 100];
const AUTO_RESCAN_MS = 60000;
const CONCURRENCY = 5;

function toneText(tone) {
  if (tone === 'up') return 'text-up';
  if (tone === 'down') return 'text-down';
  return 'text-muted-foreground';
}

function RsiBar({ value }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = value == null ? 'bg-muted' : value < OVERSOLD ? 'bg-up' : value > OVERBOUGHT ? 'bg-down' : 'bg-primary';
  return (
    <div className="relative h-1.5 w-full min-w-[70px] overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
      <span className="absolute inset-y-0 left-[30%] w-px bg-border" />
      <span className="absolute inset-y-0 left-[70%] w-px bg-border" />
    </div>
  );
}

function SignalBadge({ signal }) {
  const styles =
    signal === 'BUY'
      ? 'bg-up/15 text-up'
      : signal === 'SELL'
        ? 'bg-down/15 text-down'
        : signal === 'HOLD'
          ? 'bg-muted text-muted-foreground'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${styles}`}>
      {signal}
    </span>
  );
}

function StatCard({ label, value, tone, sub }) {
  return (
    <Card className="!p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${toneText(tone)}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function CoinCell({ item }) {
  return (
    <Link to={`/coin/${item.coinId}`} className="group flex items-center gap-2.5">
      <CoinImg src={item.image} symbol={item.symbol} size={26} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold group-hover:text-primary">{item.name}</span>
        <span className="block text-[11px] text-muted-foreground">{item.symbol}</span>
      </span>
    </Link>
  );
}

export default function RsiScannerPage() {
  const { rows, bySymbol, getKlines, feed, clock } = useMarket();
  const [interval, setIntervalKey] = useState('15m');
  const [universe, setUniverse] = useState(60);
  const [entries, setEntries] = useState({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [, setLiveTick] = useState(0);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const runIdRef = useRef(0);
  const scanRef = useRef(() => {});

  /* Live re-read: prices arrive every second, so recompute the RSI readout on
     a short cadence without re-fetching candles. */
  useEffect(() => {
    const iv = window.setInterval(() => setLiveTick((t) => t + 1), 4000);
    return () => window.clearInterval(iv);
  }, []);

  const universeRows = useMemo(
    () =>
      (rows || [])
        .filter((r) => r && r.symbol && r.price > 0 && !STABLE_SYMBOLS.has(String(r.symbol).toUpperCase()))
        .slice(0, universe),
    [rows, universe]
  );

  const runScan = useCallback(async () => {
    const myId = ++runIdRef.current;
    const list = universeRows;
    if (!list.length) return;
    setScanning(true);
    setProgress({ done: 0, total: list.length });
    const collected = {};
    for (const batch of chunk(list, CONCURRENCY)) {
      if (myId !== runIdRef.current) return;
      const batchResults = await Promise.all(
        batch.map(async (r) => {
          try {
            const res = await getKlines(r.symbol, interval, 120);
            // Integrity: never compute trading signals from synthetic candles.
            if (!res || res.source === 'simulated' || !Array.isArray(res.candles) || res.candles.length < RSI_PERIOD + 2) {
              return null;
            }
            return {
              symbol: r.symbol,
              coinId: r.id,
              name: r.name,
              image: r.image,
              closes: res.candles.map((c) => c.c),
              source: res.source
            };
          } catch {
            return null;
          }
        })
      );
      batchResults.forEach((item) => {
        if (item) collected[item.symbol] = item;
      });
      if (myId !== runIdRef.current) return;
      setEntries({ ...collected });
      setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + batch.length) }));
    }
    if (myId === runIdRef.current) {
      setScanning(false);
      setLastScan(Date.now());
    }
  }, [universeRows, interval, getKlines]);

  useEffect(() => {
    scanRef.current = runScan;
  }, [runScan]);

  // First scan + rescan whenever the timeframe or universe changes.
  useEffect(() => {
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, universe]);

  // Automatic rescan loop (stable timer, always calls the latest scan).
  useEffect(() => {
    const iv = window.setInterval(() => scanRef.current(), AUTO_RESCAN_MS);
    return () => window.clearInterval(iv);
  }, []);

  const { list, excluded } = useMemo(() => {
    const out = [];
    let skipped = 0;
    Object.values(entries).forEach((e) => {
      const row = bySymbol[e.symbol];
      const closes = closesWithLive(e.closes, row?.price);
      const value = rsiFromCloses(closes);
      if (value == null) {
        skipped += 1;
        return;
      }
      const verdict = classifyRsi(value);
      out.push({
        ...e,
        rsi: value,
        signal: verdict.signal,
        tone: verdict.tone,
        label: verdict.label,
        price: row?.price ?? null,
        pct24: row?.pct24 ?? null,
        dist: distanceToTrigger(value)
      });
    });
    return { list: out, excluded: skipped };
  }, [entries, bySymbol]);

  const stats = useMemo(() => scanStats(list), [list]);

  const oversold = useMemo(
    () => list.filter((i) => i.signal === 'BUY').sort((a, b) => a.rsi - b.rsi),
    [list]
  );
  const overbought = useMemo(
    () => list.filter((i) => i.signal === 'SELL').sort((a, b) => b.rsi - a.rsi),
    [list]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((i) => (filter === 'all' ? true : i.signal === filter))
      .filter((i) => (needle ? i.name.toLowerCase().includes(needle) || i.symbol.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.rsi - b.rsi);
  }, [list, filter, q]);

  const secondsToScan = lastScan ? Math.max(0, Math.round((lastScan + AUTO_RESCAN_MS - Date.now()) / 1000)) : null;
  void clock; // re-render clock

  const signalCard = (item, kind) => (
    <div key={item.symbol} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
      <CoinCell item={item} />
      <div className="ml-auto flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="num text-sm font-semibold">{fmtPrice(item.price)}</p>
          <p className={`num text-[11px] ${cls(item.pct24)}`}>
            {item.pct24 == null ? '—' : `${item.pct24 >= 0 ? '+' : ''}${item.pct24.toFixed(2)}%`}
          </p>
        </div>
        <div className="w-[110px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">RSI</span>
            <span className={`num text-sm font-bold ${toneText(item.tone)}`}>{item.rsi.toFixed(1)}</span>
          </div>
          <RsiBar value={item.rsi} />
        </div>
        <div className="w-[104px] text-right">
          <SignalBadge signal={item.signal} />
          {item.dist ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {item.dist.points.toFixed(1)} pts past {kind === 'buy' ? '30' : '70'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Activity size={22} className="text-primary" /> RSI Scanner
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live RSI ({RSI_PERIOD}) for every tracked coin. Below {OVERSOLD} = oversold → <b className="text-up">BUY</b> call;
            above {OVERBOUGHT} = overbought → <b className="text-down">SELL</b> call. Readouts move with live prices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-0.5" role="group" aria-label="RSI timeframe">
            {INTERVALS.map((it) => (
              <button
                key={it.key}
                onClick={() => setIntervalKey(it.key)}
                aria-pressed={interval === it.key}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  interval === it.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Number of coins to scan"
            value={universe}
            onChange={(e) => setUniverse(Number(e.target.value))}
            className="input-dark !h-9 !w-auto !py-0 text-xs"
          >
            {UNIVERSES.map((n) => (
              <option key={n} value={n}>Top {n} coins</option>
            ))}
          </select>
          <button onClick={() => runScan()} disabled={scanning} className="btn-ghost !h-9 !px-3 !text-xs">
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rescan
          </button>
        </div>
      </div>

      {/* Status line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" role="status" aria-live="polite">
        <span>
          Scanning <b className="text-foreground">{progress.done}</b>/{progress.total || universeRows.length} coins
          {scanning ? ' — in progress…' : ''}
        </span>
        {lastScan ? <span>Last full scan {timeAgo(lastScan)}{secondsToScan != null && !scanning ? ` · next in ${secondsToScan}s` : ''}</span> : null}
        <span>Updates continuously with the live price feed.</span>
      </div>

      {scanning ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
          />
        </div>
      ) : null}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Oversold · BUY" value={stats.buy} tone="up" sub={`RSI < ${OVERSOLD}`} />
        <StatCard label="Overbought · SELL" value={stats.sell} tone="down" sub={`RSI > ${OVERBOUGHT}`} />
        <StatCard label="Neutral · HOLD" value={stats.hold} sub="Between 30 and 70" />
        <StatCard label="Coins scanned" value={list.length} sub={excluded ? `${excluded} skipped (no live data)` : 'Live candles'} />
      </div>

      {feed.simulated || excluded > 0 ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {feed.simulated
              ? 'Live market data is unavailable, so RSI signals are paused. Synthetic candles are never used for trading calls.'
              : `${excluded} coin(s) skipped because live candle data was unavailable — no signals are shown for them.`}
          </span>
        </div>
      ) : null}

      {/* Signal panels */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden !p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingDown size={16} className="text-up" />
            <h2 className="text-sm font-semibold">Oversold — BUY calls</h2>
            <span className="ml-auto rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-bold text-up">{oversold.length}</span>
          </div>
          {oversold.length ? (
            oversold.slice(0, 12).map((i) => signalCard(i, 'buy'))
          ) : (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No coin is below {OVERSOLD} on the {interval} timeframe right now.
            </p>
          )}
        </Card>

        <Card className="overflow-hidden !p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingUp size={16} className="text-down" />
            <h2 className="text-sm font-semibold">Overbought — SELL calls</h2>
            <span className="ml-auto rounded-full bg-down/15 px-2 py-0.5 text-[10px] font-bold text-down">{overbought.length}</span>
          </div>
          {overbought.length ? (
            overbought.slice(0, 12).map((i) => signalCard(i, 'sell'))
          ) : (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No coin is above {OVERBOUGHT} on the {interval} timeframe right now.
            </p>
          )}
        </Card>
      </div>

      {/* Full table */}
      <Card className="overflow-hidden !p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">All scanned coins</h2>
          <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-0.5" role="group" aria-label="Filter by signal">
            {[
              ['all', 'All'],
              ['BUY', 'Buy'],
              ['SELL', 'Sell'],
              ['HOLD', 'Neutral']
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-56">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search coin"
              aria-label="Search coins"
              className="input-dark !h-9 !pl-8 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <caption className="sr-only">
              RSI scan results for the tracked coins on the {interval} timeframe, with buy and sell calls
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-semibold">Coin</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Price</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">24h</th>
                <th scope="col" className="px-3 py-2 font-semibold">RSI ({RSI_PERIOD})</th>
                <th scope="col" className="px-3 py-2 text-center font-semibold">Call</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.symbol} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2"><CoinCell item={i} /></td>
                  <td className="num px-3 py-2 text-right">{fmtPrice(i.price)}</td>
                  <td className={`num px-3 py-2 text-right ${cls(i.pct24)}`}>
                    {i.pct24 == null ? '—' : `${i.pct24 >= 0 ? '+' : ''}${i.pct24.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`num w-9 text-right text-xs font-semibold ${toneText(i.tone)}`}>{i.rsi.toFixed(1)}</span>
                      <div className="w-24"><RsiBar value={i.rsi} /></div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center"><SignalBadge signal={i.signal} /></td>
                  <td className="px-4 py-2 text-right">
                    <Link to={`/coin/${i.coinId}`} className="text-xs font-medium text-primary hover:underline">Chart</Link>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <Link to="/strategies" className="text-xs font-medium text-primary hover:underline">Arm</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {scanning ? 'Scanning coins…' : 'No coin matches this filter right now.'}
            </p>
          ) : null}
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Signals are computed locally from live candles every few seconds and are for research only — they are not financial
          advice, and no order is ever placed. {RSI_PERIOD}-period RSI on the {interval} timeframe; oversold {OVERSOLD} / overbought {OVERBOUGHT}.
        </span>
      </div>
    </div>
  );
}
