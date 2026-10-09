import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, TrendingUp, BarChart3, Gauge, Waves, Zap, Rocket, Compass,
  X, Search, Check, Radio, Flame, Snowflake, Minus, AlertTriangle
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useArms, useSignalLog } from '../lib/prefs.jsx';
import { PRESETS, INTERVALS, intervalLabel } from '../lib/strategies.js';
import { fmtPrice, timeAgo, cls } from '../lib/format.js';
import { CoinImg, CoinLink, Card } from '../components/ui.jsx';
import BacktestPanel from '../components/BacktestPanel.jsx';

const ICONS = { Activity, TrendingUp, BarChart3, Gauge, Waves, Zap, Rocket, Compass };
const PARAM_LABELS = {
  fast: 'Fast MA period', slow: 'Slow MA period', signal: 'Signal period',
  period: 'Lookback period', mult: 'Std-dev ×', k: '%K period', d: '%D period',
  low: 'Oversold level', high: 'Overbought level', threshold: 'Trigger %',
  buyBelow: 'Buy when RSI below', sellAbove: 'Sell when RSI above'
};

function ArmModal({ preset, onClose, onArm, rows }) {
  const [coin, setCoin] = useState(null);
  const [q, setQ] = useState('');
  const [interval, setInterval] = useState('1h');
  const [params, setParams] = useState({ ...preset.defaults });
  const [openList, setOpenList] = useState(false);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = [...rows].sort((a, b) => b.mcap - a.mcap).slice(0, 120);
    return t ? base.filter((r) => r.symbol.toLowerCase().includes(t) || r.name.toLowerCase().includes(t)).slice(0, 8) : base.slice(0, 8);
  }, [rows, q]);

  const submit = () => {
    if (!coin) return;
    onArm({
      presetId: preset.id,
      name: preset.name,
      coinId: coin.id,
      symbol: coin.symbol,
      interval,
      params: Object.keys(params).length ? params : undefined
    });
    onClose();
  };

  return (
    <div aria-hidden="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: preset.color + '22', color: preset.color }}>
              {React.createElement(ICONS[preset.icon] || Activity, { size: 16 })}
            </span>
            Arm {preset.name}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X size={17} /></button>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Coin picker */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Coin</p>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={coin ? `${coin.name} (${coin.symbol})` : q}
                onChange={(e) => { setCoin(null); setQ(e.target.value); setOpenList(true); }}
                onFocus={() => setOpenList(true)}
                placeholder="Search by name or symbol…"
                className="input-dark !h-10 pl-9"
              />
              {openList && list.length ? (
                <div className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl">
                  {list.map((r) => (
                    <button key={r.id} onClick={() => { setCoin(r); setQ(''); setOpenList(false); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent">
                      <CoinImg src={r.image} symbol={r.symbol} size={20} />
                      <span className="flex-1 truncate">{r.name} <span className="text-muted-foreground">{r.symbol}</span></span>
                      <span className="num text-xs text-muted-foreground">{fmtPrice(r.price)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Interval */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeframe</p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVALS.map((it) => (
                <button key={it.key} onClick={() => setInterval(it.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${interval === it.key ? 'border-primary bg-primary/15 text-primary' : 'border-input text-muted-foreground hover:text-foreground'}`}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          {/* Params */}
          {Object.keys(preset.defaults).length ? (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Parameters</p>
              <div className="grid grid-cols-2 gap-2.5">
                {Object.entries(preset.defaults).map(([k, v]) => (
                  <label key={k} className="block">
                    <span className="mb-1 block text-[11px] text-muted-foreground">{PARAM_LABELS[k] || k}</span>
                    <input
                      type="number"
                      step="any"
                      value={params[k]}
                      onChange={(e) => setParams({ ...params, [k]: Number(e.target.value) })}
                      className="input-dark !h-9 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The engine watches live {coin ? coin.symbol : 'coin'} candles every 4 seconds and alerts you the moment the {preset.name} edge fires. Signals are educational simulations — no real orders are placed.
          </p>
        </div>

        <div className="flex gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="btn-ghost flex-1 !h-10">Cancel</button>
          <button onClick={submit} disabled={!coin} className="btn-primary flex-1 !h-10 disabled:opacity-40">
            <Check size={15} /> Arm strategy
          </button>
        </div>
      </div>
    </div>
  );
}

function StateChip({ state }) {
  if (state === 'bullish') return <span className="inline-flex items-center gap-1 rounded-full bg-up/10 px-2 py-0.5 text-[11px] font-semibold text-up"><Flame size={11} /> BULLISH</span>;
  if (state === 'bearish') return <span className="inline-flex items-center gap-1 rounded-full bg-down/10 px-2 py-0.5 text-[11px] font-semibold text-down"><Snowflake size={11} /> BEARISH</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"><Minus size={11} /> NEUTRAL</span>;
}

export default function StrategiesPage() {
  const { rows, byId } = useMarket();
  const [arms, armsApi] = useArms();
  const [log] = useSignalLog();
  const [arming, setArming] = useState(null); // preset object
  const [flash, setFlash] = useState('');

  const signals = useMemo(() => log.filter((l) => l.kind === 'signal').slice(0, 10), [log]);

  const flashMsg = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2600); };

  const arm = (cfg) => {
    armsApi.arm(cfg);
    flashMsg(`${cfg.name} armed on ${cfg.symbol} (${intervalLabel(cfg.interval)}) — engine watching…`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Strategy Engine</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ready-made trading strategies. Pick one, choose a coin — the engine computes indicators on live Binance candles every 4 seconds and signals the exact buy / sell moment.
          </p>
        </div>
        <div className="chip !py-1.5"><Radio size={13} className="text-primary" /> {arms.length} armed · live scan</div>
      </div>

      {flash ? <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary">{flash}</div> : null}

      {/* Preset gallery */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PRESETS.map((p) => (
          <div key={p.id} className="card-panel flex flex-col p-4 transition-colors hover:border-primary/40">
            <div className="mb-3 flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: p.color + '1f', color: p.color }}>
                {React.createElement(ICONS[p.icon] || Activity, { size: 19 })}
              </span>
              {p.tag ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{p.tag}</span> : null}
            </div>
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{p.desc}</p>
            <button onClick={() => setArming(p)} className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
              <Zap size={13} /> Arm on a coin
            </button>
          </div>
        ))}
      </div>

      {/* Active */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Armed strategies ({arms.length})</h2>
        {!arms.length ? (
          <Card>
            <div className="flex flex-col items-center py-8 text-center">
              <Activity size={26} className="text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No strategies armed yet</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">Pick a preset above — start with RSI Reversal, the signature rule: buy when RSI &lt; 30, sell when RSI &gt; 70.</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {arms.map((a) => {
              const row = byId[a.coinId];
              const lastSignal = log.find((l) => l.kind === 'signal' && l.armKey === a.key);
              return (
                <div key={a.key} className="card-panel p-4">
                  <div className="flex items-center gap-3">
                    {row ? <CoinImg src={row.image} symbol={row.symbol} size={34} /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                        {a.name}
                        <span className="text-xs font-normal text-muted-foreground">{row?.name} · {intervalLabel(a.interval)}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StateChip state={a.state} />
                        <span className="num text-xs text-muted-foreground">@{row ? fmtPrice(row.price) : '—'}</span>
                        {a.dataWarning === 'simulated' ? (
                          <span role="status" className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                            PAUSED · SIMULATED DATA
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button onClick={() => armsApi.disarm(a.key)} className="rounded-lg border border-input p-2 text-muted-foreground transition-colors hover:border-down/40 hover:bg-down/10 hover:text-down" title="Stop strategy">
                      <X size={14} />
                    </button>
                  </div>
                  <p className="mt-3 min-h-[16px] truncate text-xs text-muted-foreground" title={a.reason}>{a.reason || 'Evaluating…'}</p>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                    {lastSignal ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 font-bold ${lastSignal.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{lastSignal.side}</span>
                        <span className="text-muted-foreground">{fmtPrice(lastSignal.price)} · {timeAgo(lastSignal.t)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No signal yet — engine scanning…</span>
                    )}
                    <Link to={`/paper-trading?coin=${a.coinId}&preset=${a.presetId}&interval=${a.interval}`} className="font-medium text-primary hover:underline">
                      Paper-test →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Signal feed */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Live signal feed</h2>
        {!signals.length ? (
          <Card><p className="py-4 text-center text-xs text-muted-foreground">Signal history appears here the moment an armed strategy fires a buy / sell edge.</p></Card>
        ) : (
          <Card className="!p-2">
            {signals.map((s, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-0">
                <span className={`mt-0.5 flex h-6 w-16 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${s.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                  {s.side === 'BUY' ? '▲ BUY' : '▼ SELL'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed">
                    <b>{s.presetName}</b> on {s.coinName} <span className="text-muted-foreground">({s.intervalLabel}):</span>{' '}
                    <span className="text-muted-foreground">{s.reason}</span>
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {s.image ? <CoinImg src={s.image} symbol={s.symbol} size={13} /> : null}
                    <span className="num">{s.symbol} · {fmtPrice(s.price)}</span> · {timeAgo(s.t)}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Backtesting */}
      <BacktestPanel />

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-primary" />
        <p>
          All signals are computed locally from public Binance &amp; CoinGecko data for education and research. <b className="text-foreground">No real orders are placed.</b> Past performance never guarantees future results — always do your own research.
        </p>
      </div>

      {arming ? <ArmModal preset={arming} onClose={() => setArming(null)} onArm={arm} rows={rows} /> : null}
    </div>
  );
}
