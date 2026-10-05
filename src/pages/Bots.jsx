import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, Play, Pause, Trash2, Plus, X, Shield, Store, Download, Loader2, Info
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useBots } from '../lib/prefs.jsx';
import {
  BOT_TYPES, DEFAULT_RISK, MARKETPLACE, RISK_BADGE, runBotTick, trackEquity,
  CONDITION_FIELDS, CONDITION_OPS
} from '../lib/bots.js';
import { Card, EmptyState } from '../components/ui.jsx';
import { fmtPrice, fmtUsd, timeAgo } from '../lib/format.js';

const GROUPS = ['Accumulation', 'Range', 'Execution', 'Market-neutral', 'Portfolio', 'Liquidity', 'Directional', 'Social', 'Builder'];
const PAPER_EQUITY = 10000;
const TICK_MS = 5000;

const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 8 }));
const fmtWhen = (t) => new Date(t).toLocaleTimeString();

/** Param form derived from the bot definition — no bespoke UI per bot. */
function ParamFields({ type, values, onChange }) {
  const def = BOT_TYPES[type];
  if (!def) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {def.params.map((p) => (
        <div key={p.key}>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{p.label}</p>
          {p.options ? (
            <select
              value={values[p.key] ?? p.default}
              onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
              className="input-dark !h-9 !text-xs"
            >
              {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type="number"
              value={values[p.key] ?? p.default}
              min={p.min}
              step={p.step ?? 'any'}
              onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
              className="input-dark !h-9 num !text-xs"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Rule rows for the custom-strategy builder. */
function ConditionRows({ label, rows, onChange }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select
              value={r.field}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
              className="input-dark !h-9 !w-auto !text-xs"
            >
              {CONDITION_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select
              value={r.op}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}
              className="input-dark !h-9 !w-auto !text-xs"
            >
              {CONDITION_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input
              type="number"
              value={r.value}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              className="input-dark !h-9 !w-24 num !text-xs"
            />
            <button
              onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
              className="rounded-lg px-2 text-muted-foreground hover:bg-down/10 hover:text-down"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...rows, { field: 'rsi', op: 'lt', value: 30 }])}
          className="btn-ghost !h-8 !px-2.5 !text-[11px]"
        >
          <Plus size={12} /> Add condition
        </button>
      </div>
    </div>
  );
}

export default function BotsPage() {
  const { rows, byId, getKlines } = useMarket();
  const [bots, api] = useBots();

  const [type, setType] = useState('dca');
  const [symbol, setSymbol] = useState('BTC');
  const [params, setParams] = useState({});
  const [limits, setLimits] = useState(DEFAULT_RISK);
  const [entry, setEntry] = useState([{ field: 'rsi', op: 'lt', value: 30 }]);
  const [exit, setExit] = useState([{ field: 'rsi', op: 'gt', value: 70 }]);
  const [err, setErr] = useState(null);
  const [ticking, setTicking] = useState(false);

  const candleRef = useRef({});
  const klinesRef = useRef(getKlines);
  const rowsRef = useRef(rows);
  const botsRef = useRef(bots);
  useEffect(() => { klinesRef.current = getKlines; }, [getKlines]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  botsRef.current = bots;

  const top = useMemo(() => [...(rows || [])].sort((a, b) => b.mcap - a.mcap).slice(0, 120), [rows]);
  const def = BOT_TYPES[type];

  useEffect(() => { setParams({}); }, [type]);

  /* ---------- live paper tick ---------- */
  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const list = botsRef.current.filter((b) => b.running);
      if (!list.length) return;
      setTicking(true);

      for (const b of list) {
        const row = (rowsRef.current || []).find((r) => r.symbol === b.symbol);
        const price = row?.price;
        if (!price) continue;

        let candles = candleRef.current[b.symbol];
        if (!candles || Date.now() - (candles.at || 0) > 120000) {
          const res = await klinesRef.current(b.symbol, '1h', 200);
          // Integrity: never drive a bot with simulated candles.
          const usable = res?.source && res.source !== 'simulated' ? res.candles : null;
          candles = { at: Date.now(), data: usable || [] };
          candleRef.current[b.symbol] = candles;
        }

        const posQty = b.state?.positionQty || 0;
        const equity = PAPER_EQUITY + posQty * price;
        const riskState = trackEquity({ ...(b.state || {}), dayStartEquity: b.state?.dayStartEquity ?? PAPER_EQUITY }, equity);

        const out = runBotTick(
          { type: b.type, params: b.params || {}, limits: b.limits || {}, entry: b.entry, exit: b.exit, state: { ...riskState, positionQty: posQty } },
          {
            price,
            barIndex: Math.floor(Date.now() / (60 * 60 * 1000)),
            candles: candles.data,
            venues: null,
            equity,
            cash: PAPER_EQUITY,
            positionValue: posQty * price,
            positionQty: posQty
          }
        );

        if (!alive) return;

        const lines = [
          ...out.orders.map((o) => ({
            at: Date.now(), kind: 'order', side: o.side, qty: o.qty, price: o.price, reason: o.reason
          })),
          ...out.notes.filter((n) => !out.orders.length).map((n) => ({ at: Date.now(), kind: 'note', text: n }))
        ];

        api.patch(b.id, { state: out.state, lastTick: Date.now(), halted: out.halted === true });
        if (lines.length) api.appendLog(b.id, lines);
      }
      if (alive) setTicking(false);
    };

    const iv = window.setInterval(tick, TICK_MS);
    return () => { alive = false; window.clearInterval(iv); };
  }, [api]);

  const create = () => {
    setErr(null);
    if (!symbol) { setErr('Choose a coin.'); return; }
    if (type === 'custom' && !entry.length) { setErr('Add at least one entry condition.'); return; }
    const clean = {};
    (def?.params || []).forEach((p) => {
      const v = params[p.key] ?? p.default;
      clean[p.key] = p.options ? v : Number(v);
    });
    api.add({
      type, symbol, name: def?.name || type, params: clean, limits,
      entry: type === 'custom' ? entry.map((c) => ({ ...c, value: Number(c.value) })) : undefined,
      exit: type === 'custom' ? exit.map((c) => ({ ...c, value: Number(c.value) })) : undefined
    });
    setParams({});
  };

  const install = (m) => {
    const d = BOT_TYPES[m.botType];
    const merged = { ...Object.fromEntries((d?.params || []).map((p) => [p.key, p.default])), ...(m.params || {}) };
    api.add({
      type: m.botType, symbol: m.symbol || 'BTC', name: m.name, params: merged, limits: DEFAULT_RISK,
      entry: m.entry, exit: m.exit, from: m.id
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trading Bots</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {Object.keys(BOT_TYPES).length} bot engines driven by live market data — DCA, Grid, TWAP, VWAP, arbitrage,
            rebalancing, market making, momentum, mean reversion, breakout, copy and your own custom rules.
          </p>
        </div>
        {ticking ? <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /> ticking…</p> : null}
      </div>

      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
        <p className="flex items-start gap-2 text-sm">
          <Shield size={16} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <b className="text-foreground">Paper only.</b>{' '}
            <span className="text-muted-foreground">
              Bots emit simulated fills against a virtual {fmtUsd(PAPER_EQUITY, 0)} account. There is no exchange
              connection, no API key and no signing anywhere in this app, so a bot can never place a real order.
              Backtesting and walk-forward testing live on the Strategy Engine page.
            </span>
          </span>
        </p>
      </div>

      {/* ---------------- create ---------------- */}
      <Card className="!p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Plus size={15} className="text-primary" /> Create a bot</p>
        </div>
        <div className="p-4">
          <div className="space-y-3">
            {GROUPS.filter((g) => Object.values(BOT_TYPES).some((b) => b.group === g)).map((g) => (
              <div key={g}>
                <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{g}</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.values(BOT_TYPES).filter((b) => b.group === g).map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setType(b.id)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        type === b.id ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {def ? <p className="mt-3 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">{def.blurb}</p> : null}

          {type === 'custom' ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <ConditionRows label="Entry (all must be true)" rows={entry} onChange={setEntry} />
              <ConditionRows label="Exit (all must be true)" rows={exit} onChange={setExit} />
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Coin</p>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input-dark !h-9 !text-xs">
                  {top.map((r) => <option key={r.id} value={r.symbol}>{r.symbol} — {r.name}</option>)}
                </select>
              </div>
              {def && def.params.length ? <ParamFields type={type} values={params} onChange={setParams} /> : null}
            </div>

            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Risk controls (applied to every order)</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['maxPositionPct', 'Max position %'],
                  ['maxOrderQuote', 'Max order (quote)'],
                  ['maxDrawdownPct', 'Halt at drawdown %'],
                  ['dailyLossPct', 'Halt at daily loss %'],
                  ['maxTradesPerDay', 'Max trades / day']
                ].map(([k, label]) => (
                  <div key={k}>
                    <p className="mb-0.5 text-[10px] text-muted-foreground">{label}</p>
                    <input
                      type="number"
                      value={limits[k]}
                      onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) })}
                      className="input-dark !h-8 num !text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {err ? <p className="mt-3 text-[11px] text-down">{err}</p> : null}

          <button onClick={create} className="btn-primary mt-4 !h-9 px-4 !text-xs">
            <Bot size={13} /> Add bot
          </button>
        </div>
      </Card>

      {/* ---------------- running ---------------- */}
      <Card className="!p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Your bots <span className="text-xs font-normal text-muted-foreground">({bots.length})</span></p>
          {bots.length ? <button onClick={api.clearAll} className="btn-ghost !h-8 !px-2.5 !text-[11px]"><Trash2 size={12} /> Clear all</button> : null}
        </div>

        {!bots.length ? (
          <div className="px-4 py-8">
            <EmptyState
              icon={<Bot size={28} className="text-muted-foreground" />}
              title="No bots yet"
              sub="Create one above, or install a preset from the marketplace below."
            />
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {bots.map((b) => {
              const row = byId?.[b.symbol] || (rows || []).find((r) => r.symbol === b.symbol);
              const price = row?.price;
              const posQty = b.state?.positionQty || 0;
              const equity = price ? PAPER_EQUITY + posQty * price : PAPER_EQUITY;
              const pnl = equity - PAPER_EQUITY;

              return (
                <div key={b.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.running ? 'bg-up/15 text-up' : 'bg-muted text-muted-foreground'}`}>
                        {b.running ? 'RUNNING' : 'PAUSED'}
                      </span>
                      <span className="text-sm font-semibold">{b.name}</span>
                      <span className="text-[11px] text-muted-foreground">on {b.symbol}</span>
                      {b.halted ? <span className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-semibold text-down">HALTED</span> : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => api.patch(b.id, { running: !b.running })}
                        className={`btn-ghost !h-8 !px-2.5 !text-[11px] ${b.running ? '' : '!text-up'}`}
                      >
                        {b.running ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Start</>}
                      </button>
                      {b.log?.length ? (
                        <button onClick={() => api.clearLog(b.id)} className="btn-ghost !h-8 !px-2.5 !text-[11px]">Clear log</button>
                      ) : null}
                      <button onClick={() => api.remove(b.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-down/10 hover:text-down"><Trash2 size={13} /></button>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                    <div><span className="text-muted-foreground">Paper equity </span><span className="num font-semibold">{fmtUsd(equity, 2)}</span></div>
                    <div><span className="text-muted-foreground">P&L </span><span className={`num font-semibold ${pnl >= 0 ? 'text-up' : 'text-down'}`}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl, 2)}</span></div>
                    <div><span className="text-muted-foreground">Position </span><span className="num font-semibold">{fmtQty(posQty)}</span></div>
                    <div><span className="text-muted-foreground">Last tick </span><span className="num">{b.lastTick ? timeAgo(b.lastTick) : '—'}</span></div>
                  </div>

                  {b.log?.length ? (
                    <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-lg border border-border bg-muted/20 p-2">
                      {b.log.slice(0, 25).map((l, i) => (
                        <p key={i} className="flex items-start gap-2 text-[10px]">
                          <span className="num shrink-0 text-muted-foreground">{fmtWhen(l.at)}</span>
                          {l.kind === 'order' ? (
                            <span className={l.side === 'buy' ? 'text-up' : 'text-down'}>
                              {l.side.toUpperCase()} {fmtQty(l.qty)} @ {fmtPrice(l.price)} — {l.reason}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{l.text}</span>
                          )}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {b.running ? 'Waiting for the first signal…' : 'Paused — start it to begin paper trading.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ---------------- marketplace ---------------- */}
      <Card className="!p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Store size={15} className="text-primary" /> Strategy marketplace</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            One-click presets. Subscriber counts are illustrative and are <b>not</b> a performance claim — run your own
            backtest before trusting any of them.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {MARKETPLACE.map((m) => (
            <div key={m.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.author} · {m.timeframe}</p>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${RISK_BADGE[m.risk]}`}>{m.risk}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{m.blurb}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">{m.subscribers.toLocaleString()} installs</span>
                <button onClick={() => install(m)} className="btn-ghost !h-7 !px-2 !text-[10px]">
                  <Download size={11} /> Install
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="!p-4">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0 text-primary" />
          <span>
            Bots tick every {TICK_MS / 1000}s against the live feed and refuse to run on simulated candles. For historical
            validation — Sharpe, Sortino, max drawdown and walk-forward windows — use the{' '}
            <Link to="/strategies" className="text-primary hover:underline">Strategy Engine</Link>, and for a manual
            execution sandbox use <Link to="/paper-trading" className="text-primary hover:underline">Paper Trader</Link>.
          </span>
        </p>
      </Card>
    </div>
  );
}
