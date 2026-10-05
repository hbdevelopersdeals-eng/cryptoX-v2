import React, { useMemo, useState } from 'react';
import { Play, Loader2, AlertTriangle, BarChart3 } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { PRESETS, INTERVALS, intervalLabel } from '../lib/strategies.js';
import { runBacktest, DEFAULT_ASSUMPTIONS } from '../lib/backtest.js';
import { fmtUsd, cls } from '../lib/format.js';
import { Card } from './ui.jsx';

function EquityCurve({ equity }) {
  if (!equity || equity.length < 2) return null;
  const W = 640, H = 150, pad = 6;
  const min = Math.min(...equity);
  const max = Math.max(...equity);
  const range = max - min || 1;
  const pts = equity
    .map((v, i) => `${((i / (equity.length - 1)) * (W - pad * 2) + pad).toFixed(1)},${(H - pad - ((v - min) / range) * (H - pad * 2)).toFixed(1)}`)
    .join(' ');
  const up = equity[equity.length - 1] >= equity[0];
  const color = up ? '#34d399' : '#f87171';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`Equity curve, ${up ? 'ending higher' : 'ending lower'} than start`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function Metric({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-base font-bold ${tone}`}>{value}</p>
    </div>
  );
}

const pctStr = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

export default function BacktestPanel({ initialPresetId = 'rsi-reversal', initialCoinId = 'bitcoin' }) {
  const { rows, byId, getKlines } = useMarket();
  const top = useMemo(() => [...rows].sort((a, b) => b.mcap - a.mcap).slice(0, 60), [rows]);

  const [presetId, setPresetId] = useState(initialPresetId);
  const [coinId, setCoinId] = useState(initialCoinId);
  const [interval, setInterval] = useState('1h');
  const [capital, setCapital] = useState(DEFAULT_ASSUMPTIONS.initialCapital);
  const [fee, setFee] = useState(DEFAULT_ASSUMPTIONS.feePct);
  const [slippage, setSlippage] = useState(DEFAULT_ASSUMPTIONS.slippagePct);
  const [position, setPosition] = useState(DEFAULT_ASSUMPTIONS.positionPct);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState(null);

  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  const coin = byId[coinId] || top[0];

  const run = async () => {
    setError('');
    setResult(null);
    setRunning(true);
    try {
      const res = await getKlines(coin.symbol, interval, 800);
      setSource(res.source);
      if (res.source === 'simulated') {
        setError('Live candle data is unavailable right now, so a backtest would run on synthetic prices. CryptoX refuses to show performance numbers derived from fake data.');
        return;
      }
      const out = runBacktest({
        candles: res.candles,
        presetId,
        interval,
        initialCapital: Number(capital) || DEFAULT_ASSUMPTIONS.initialCapital,
        feePct: Math.min(Math.max(Number(fee) || 0, 0), 2),
        slippagePct: Math.min(Math.max(Number(slippage) || 0, 0), 2),
        positionPct: Math.min(Math.max(Number(position) || 100, 1), 100)
      });
      if (!out.ok) setError(out.error);
      else setResult(out);
    } catch (e) {
      setError('Backtest failed: ' + (e?.message || 'unknown error'));
    } finally {
      setRunning(false);
    }
  };

  const inputCls = 'input-dark !h-9 text-sm num';
  const labelCls = 'mb-1 block text-[11px] text-muted-foreground';

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 size={15} className="text-primary" /> Backtest this strategy
        </h2>
        <span className="text-[11px] text-muted-foreground">next-bar fills · fees + slippage modelled · long-only spot</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label>
          <span className={labelCls}>Strategy</span>
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className={inputCls}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>Coin</span>
          <select value={coinId} onChange={(e) => setCoinId(e.target.value)} className={inputCls}>
            {top.map((r) => <option key={r.id} value={r.id}>{r.symbol}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>Timeframe</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value)} className={inputCls}>
            {INTERVALS.map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>Capital ($)</span>
          <input type="number" min="100" value={capital} onChange={(e) => setCapital(e.target.value)} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Fee % / side</span>
          <input type="number" step="0.01" min="0" max="2" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Slippage % / side</span>
          <input type="number" step="0.01" min="0" max="2" value={slippage} onChange={(e) => setSlippage(e.target.value)} className={inputCls} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={running || !coin} className="btn-primary !h-10">
          {running ? <><Loader2 size={15} className="animate-spin" /> Running…</> : <><Play size={15} /> Run backtest</>}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {preset.name} on {coin?.symbol} · {intervalLabel(interval)} · up to 800 bars
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            <Metric label="Total return" value={pctStr(result.metrics.totalReturn)} tone={cls(result.metrics.totalReturn)} />
            <Metric label="Buy & hold" value={pctStr(result.benchmarkReturn)} tone={cls(result.benchmarkReturn)} />
            <Metric label="Alpha vs hold" value={pctStr(result.alphaVsHold)} tone={cls(result.alphaVsHold)} />
            <Metric label="Max drawdown" value={`${(result.metrics.maxDrawdown * 100).toFixed(1)}%`} tone="text-down" />
            <Metric label="Sharpe" value={result.metrics.sharpe.toFixed(2)} />
            <Metric label="Sortino" value={result.metrics.sortino.toFixed(2)} />
            <Metric label="Closed trades" value={String(result.metrics.trades)} />
            <Metric label="Win rate" value={`${(result.metrics.winRate * 100).toFixed(0)}%`} />
            <Metric label="Profit factor" value={result.metrics.profitFactor === Infinity ? '∞' : result.metrics.profitFactor.toFixed(2)} />
            <Metric label="Exposure" value={`${(result.metrics.exposure * 100).toFixed(0)}%`} />
            <Metric label="Final equity" value={fmtUsd(result.metrics.finalEquity)} />
            <Metric label="Fees paid" value={fmtUsd(result.feesPaid)} tone="text-muted-foreground" />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Equity curve</p>
            <EquityCurve equity={result.equity} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">Walk-forward consistency</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{result.walkForward.note}</p>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-1 font-semibold">Slice</th>
                    <th scope="col" className="py-1 text-right font-semibold">Return</th>
                    <th scope="col" className="py-1 text-right font-semibold">Max DD</th>
                    <th scope="col" className="py-1 text-right font-semibold">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {[['In-sample (70%)', result.walkForward.inSample], ['Out-of-sample (30%)', result.walkForward.outOfSample]].map(([label, m]) => (
                    <tr key={label} className="border-t border-border/60">
                      <td className="py-1.5">{label}</td>
                      <td className={`num py-1.5 text-right ${m ? cls(m.totalReturn) : ''}`}>{m ? pctStr(m.totalReturn) : '—'}</td>
                      <td className="num py-1.5 text-right text-down">{m ? `${(m.maxDrawdown * 100).toFixed(1)}%` : '—'}</td>
                      <td className="num py-1.5 text-right">{m ? m.trades : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">Last trades</p>
              {!result.trades.some((t) => t.pnl != null) ? (
                <p className="mt-2 text-[11px] text-muted-foreground">This parameter set produced no completed round-trips in the window.</p>
              ) : (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
                  {result.trades.filter((t) => t.pnl != null).slice(-10).reverse().map((t, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-[11px]">
                      <span className={`flex h-5 w-10 items-center justify-center rounded font-bold ${t.pnl >= 0 ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>EXIT</span>
                      <span className="num flex-1">{t.pnl >= 0 ? '+' : ''}{fmtUsd(t.pnl)}</span>
                      <span className="num text-muted-foreground">{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct?.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-primary" />
            <span>
              {result.assumptions.note} Funding/borrow costs, taxes, liquidity limits and partial fills are not modelled.
              A single-asset backtest on one historical window is not evidence of future performance. Past results never guarantee future returns.
            </span>
          </p>
          {source ? <p className="text-[10px] text-muted-foreground/80">Candle source: {source === 'binance' ? 'Binance (live market data)' : source}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
