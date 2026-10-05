import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Play, Square, RotateCcw, Wallet, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useSim, cryptoId } from '../lib/prefs.jsx';
import { PRESETS, INTERVALS, intervalLabel, evaluateStrategy } from '../lib/strategies.js';
import { fmtPrice, fmtUsd, cls } from '../lib/format.js';
import { CoinImg, Card } from '../components/ui.jsx';

const FEE = 0.001;

function EquityChart({ data }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.round(e[0]?.contentRect?.width || 600)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!data || data.length < 2) {
    return <div ref={ref} style={{ height: 170 }} className="flex items-center justify-center text-xs text-muted-foreground">Waiting for the first mark…</div>;
  }
  const vals = data.map((d) => d.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const H = 170, pad = 8;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (w - pad * 2) + pad).toFixed(1)},${(H - pad - ((v - min) / range) * (H - pad * 2)).toFixed(1)}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? '#34d399' : '#f87171';
  const id = React.useId().replace(/:/g, '');
  const last = vals[vals.length - 1];
  return (
    <div ref={ref} style={{ height: H, width: '100%' }} className="relative">
      <svg width={w} height={H} className="block">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${pts} ${w - pad},${H} ${pad},${H}`} fill={`url(#${id})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
        <line x1={pad} y1={H - pad - ((last - min) / range) * (H - pad * 2)} x2={w - pad} y2={H - pad - ((last - min) / range) * (H - pad * 2)} stroke={color} strokeWidth="0.8" strokeDasharray="4 4" opacity="0.6" />
      </svg>
      <span className="num absolute right-2 top-1 rounded bg-card/90 px-1.5 py-0.5 text-[10px] font-semibold" style={{ color }}>{fmtUsd(last)}</span>
    </div>
  );
}

export default function PaperTradingPage() {
  const { rows, byId, getKlines } = useMarket();
  const [params, setParams] = useSearchParams();
  const [sim, setSim] = useSim();

  const preselectCoin = params.get('coin');
  const preselectPreset = params.get('preset');
  const preselectInterval = params.get('interval');

  const top = useMemo(() => [...rows].sort((a, b) => b.mcap - a.mcap).slice(0, 120), [rows]);
  const [coinId, setCoinId] = useState(preselectCoin || 'bitcoin');
  const [presetId, setPresetId] = useState(preselectPreset || 'rsi-reversal');
  const [interval, setInterval] = useState(preselectInterval || '1h');
  const [cashInput, setCashInput] = useState(10000);
  const [dataWarning, setDataWarning] = useState(null);

  const simRef = useRef(sim);
  simRef.current = sim;
  const getKlinesRef = useRef(getKlines);
  getKlinesRef.current = getKlines;
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const setSimRef = useRef(setSim);
  setSimRef.current = setSim;
  const prevSigRef = useRef({});

  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  const coin = byId[coinId] || top[0];

  const start = () => {
    if (!coin) return;
    const running = {
      at: Date.now(),
      coinId: coin.id,
      symbol: coin.symbol,
      presetId: preset.id,
      name: preset.name,
      interval
    };
    prevSigRef.current[running.at] = null;
    setSim({
      startedAt: running.at,
      startedCash: Number(cashInput) || 10000,
      cash: Number(cashInput) || 10000,
      holdings: [],
      trades: [],
      equity: [{ t: running.at, v: Number(cashInput) || 10000 }],
      running
    });
  };

  const stop = () => {
    if (!sim.running) return;
    setSim({ ...simRef.current, running: null });
  };

  const reset = () => {
    setSim({ startedAt: Date.now(), startedCash: 10000, cash: 10000, holdings: [], trades: [], equity: [{ t: Date.now(), v: 10000 }], running: null });
  };

  /* Simulator loop */
  useEffect(() => {
    if (!simRef.current?.running) return;
    const key = simRef.current.running.at;
    let alive = true;

    const tick = async () => {
      const S = simRef.current;
      if (!S?.running || S.running.at !== key) return;
      const row = byIdRef.current[S.running.coinId];
      if (!row) return;
      const klRes = await getKlinesRef.current(row.symbol, S.running.interval, 220);
      const kl = klRes?.candles;
      if (!kl || kl.length < 30) return;

      // Integrity guard: the paper bot never trades on synthetic candles.
      if (alive) setDataWarning(klRes.source === 'simulated' ? 'simulated' : null);
      if (klRes.source === 'simulated') return;

      const price = row.price;
      const k = { open: kl.map((x) => x.o), high: kl.map((x) => x.h), low: kl.map((x) => x.l), close: kl.map((x) => x.c), volume: kl.map((x) => x.v) };
      if (price && Math.abs(price - k.close[k.close.length - 1]) / k.close[k.close.length - 1] < 0.05) {
        k.close = [...k.close]; k.close[k.close.length - 1] = price;
      }
      const res = evaluateStrategy(S.running.presetId, k, undefined, { price });
      const prev = prevSigRef.current[key];

      if (res.signal && res.signal !== prev) {
        prevSigRef.current[key] = res.signal;
        let next = { ...S };
        const now = Date.now();

        if (res.signal === 'BUY' && !S.holdings.length) {
          const cash = S.cash;
          const feeAmt = cash * FEE;
          const invest = cash - feeAmt;
          const qty = invest / price;
          next.cash = 0;
          next.holdings = [{ id: cryptoId(), coinId: row.id, symbol: row.symbol, qty, entryPrice: price, entryCost: cash, at: now }];
          next.trades = [...S.trades, { t: now, side: 'BUY', coinId: row.id, symbol: row.symbol, qty, price, usd: cash, pnl: null }];
        } else if (res.signal === 'SELL' && S.holdings.length) {
          const h = S.holdings[0];
          const gross = h.qty * price;
          const feeAmt = gross * FEE;
          const proceeds = gross - feeAmt;
          const pnl = proceeds - h.entryCost;
          next.holdings = [];
          next.cash = S.cash + proceeds;
          next.trades = [...S.trades, { t: now, side: 'SELL', coinId: row.id, symbol: row.symbol, qty: h.qty, price, usd: proceeds, pnl, pnlPct: (pnl / h.entryCost) * 100 }];
        }

        const equityVal = next.cash + (next.holdings[0] ? next.holdings[0].qty * price : 0);
        next.equity = [...S.equity, { t: now, v: equityVal }].slice(-600);
        if (alive) setSimRef.current(next);
      } else {
        // mark-to-market each poll
        const equityVal = S.cash + (S.holdings[0] ? S.holdings[0].qty * price : 0);
        const lastP = S.equity[S.equity.length - 1];
        if (!lastP || Math.abs(lastP.v - equityVal) / Math.max(equityVal, 1) > 0.0004) {
          const next = { ...S, equity: [...S.equity, { t: Date.now(), v: equityVal }].slice(-600) };
          if (alive) setSimRef.current(next);
        }
      }
    };

    const iv = window.setInterval(tick, 5000);
    const t0 = window.setTimeout(tick, 500);
    return () => { alive = false; window.clearInterval(iv); window.clearTimeout(t0); };
  }, [sim.running]);

  const mark = sim.cash + (sim.holdings[0] ? sim.holdings[0].qty * (coin?.price ?? 0) : 0);
  const pnl = mark - sim.startedCash;
  const wins = sim.trades.filter((t) => t.pnl != null && t.pnl > 0).length;
  const closed = sim.trades.filter((t) => t.pnl != null);
  const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(0) : '—';
  const runLabel = sim.running ? `${sim.running.name} · ${intervalLabel(sim.running.interval)}` : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paper Trader</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Test any strategy with virtual money on live prices. The bot buys and sells automatically when the strategy fires — zero risk, full learning.
          </p>
        </div>
        <span className="chip !py-1.5"><Wallet size={13} className="text-primary" /> Virtual account</span>
      </div>

      {!sim.running ? (
        /* ---------- Setup ---------- */
        <Card className="max-w-2xl">
          <h2 className="mb-4 text-sm font-semibold">New simulation</h2>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Strategy</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.id} onClick={() => setPresetId(p.id)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${presetId === p.id ? 'border-primary bg-primary/15 text-primary' : 'border-input text-muted-foreground hover:text-foreground'}`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Coin</p>
                <select value={coinId} onChange={(e) => setCoinId(e.target.value)} className="input-dark !h-10">
                  {top.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.symbol})</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeframe</p>
                <select value={interval} onChange={(e) => setInterval(e.target.value)} className="input-dark !h-10">
                  {INTERVALS.map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Starting balance (USD)</p>
                <input type="number" min="100" step="500" value={cashInput} onChange={(e) => setCashInput(e.target.value)} className="input-dark !h-10 num" />
              </div>
            </div>
            {sim.trades.length ? (
              <p className="text-xs text-muted-foreground">Starting a new run keeps results below until you clear them.</p>
            ) : null}
            <button onClick={start} className="btn-primary w-full sm:w-auto" disabled={!coin}>
              <Play size={15} /> Start {preset.name} on {coin?.symbol || '…'}
            </button>
          </div>
        </Card>
      ) : (
        /* ---------- Running dashboard ---------- */
        <div className="flex flex-wrap items-center gap-3">
          {dataWarning === 'simulated' ? (
            <div role="status" className="w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-300">
              Live market data is unavailable, so the bot is paused. Synthetic candles are never traded — this protects you from acting on fake price history.
            </div>
          ) : null}
          <div className="chip !border-up/30 !bg-up/10 !py-1.5 text-up"><span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-up opacity-60" /><span className="relative h-2 w-2 rounded-full bg-up" /></span> RUNNING · {runLabel}</div>
          <button onClick={stop} className="btn-sm-dark"><Square size={13} /> Stop & keep results</button>
          <button onClick={reset} className="btn-sm-dark !text-muted-foreground"><RotateCcw size={13} /> Clear all</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Account Value</p>
          <p className="num mt-1 text-lg font-bold">{fmtUsd(mark)}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total P&L</p>
          <p className={`num mt-1 text-lg font-bold ${cls(pnl)}`}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)} <span className="text-sm">({pnl >= 0 ? '+' : ''}{((pnl / sim.startedCash) * 100).toFixed(2)}%)</span></p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Trades</p>
          <p className="num mt-1 text-lg font-bold">{sim.trades.length} <span className="text-sm font-normal text-muted-foreground">· win rate {winRate}%</span></p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Open position</p>
          {sim.holdings[0] ? (
            <div className="mt-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                {sim.holdings[0].symbol} · {sim.holdings[0].qty.toPrecision(4)}
              </p>
              <p className={`num text-[11px] ${cls((coin?.price ?? 0) - sim.holdings[0].entryPrice)}`}>
                entry {fmtPrice(sim.holdings[0].entryPrice)} · {fmtPrice(coin?.price ?? 0)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">In cash</p>
          )}
        </Card>
      </div>

      {/* Equity curve + trades */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Equity curve</h2>
          <EquityChart data={sim.equity} />
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Trade log</h2>
          {!sim.trades.length ? (
            <p className="py-8 text-center text-xs text-muted-foreground">The bot will log trades here when the strategy fires.</p>
          ) : (
            <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
              {[...sim.trades].reverse().slice(0, 40).map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-xs">
                  <span className={`flex h-6 w-12 items-center justify-center rounded font-bold ${t.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{t.side}</span>
                  <span className="flex-1 truncate">{t.symbol}</span>
                  {t.pnl != null ? (
                    <span className={`num font-semibold ${cls(t.pnl)}`}>{t.pnl >= 0 ? '+' : ''}{fmtUsd(t.pnl)}</span>
                  ) : null}
                  <span className="num text-[10px] text-muted-foreground">{fmtPrice(t.price)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {sim.running ? (
            <><Activity size={14} className="text-primary" /> Bot is re-evaluating {sim.running.name} every ~5s on live {sim.running.symbol} prices. Fills assume full balance at the signal price minus 0.1% fee.</>
          ) : (
            <><Activity size={14} /> No bot running — pick a strategy and start a paper run above.</>
          )}
        </p>
        <Link to="/strategies" className="shrink-0 text-xs font-medium text-primary hover:underline">← Back to Strategy Engine</Link>
      </div>

      {sim.trades.length && !sim.running ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3 text-xs">
          <span className="flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1 text-up"><TrendingUp size={13} /> {wins} wins</span>
            <span className="flex items-center gap-1 text-down"><TrendingDown size={13} /> {closed.length - wins} losses</span>
          </span>
          <button onClick={reset} className="font-medium text-primary hover:underline">Clear results & start fresh</button>
        </div>
      ) : null}
    </div>
  );
}
