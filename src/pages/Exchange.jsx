import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickChart, ShieldAlert, Power, X, Info, ArrowUp, ArrowDown, Layers, Play, Pause
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useRealtimeEngine } from '../lib/realtime.js';
import { OrderBook, checkRisk, DEFAULT_RULES, ORDER_TYPES } from '../lib/engine/matching.js';
import { aggregateDepth, cumulative, bookMetrics, liquidityScore, replayWindow } from '../lib/engine/depth.js';
import { fmtPrice, fmtCompact, cls, timeAgo } from '../lib/format.js';
import { Card } from '../components/ui.jsx';

const TRADABLE = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC'];
const RULES = { ...DEFAULT_RULES, tickSize: 0.01, stepSize: 0.0001, minQty: 0.0001, minNotional: 5 };
const START_BALANCE = { base: 1, quote: 25000 };
const SNAPSHOT_EVERY_MS = 15000;

function Balance({ label, value, unit }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="num text-sm font-semibold">{value} <span className="text-[10px] text-muted-foreground">{unit}</span></p>
    </div>
  );
}

export default function ExchangePage() {
  const { rows } = useMarket();
  const [symbol, setSymbol] = useState('BTC');
  const pair = `${symbol}USDT`;

  const [balance, setBalance] = useState(START_BALANCE);
  const [side, setSide] = useState('buy');
  const [type, setType] = useState('limit');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingPct, setTrailingPct] = useState('2');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [formMsg, setFormMsg] = useState(null);
  const [bookView, setBookView] = useState('l2');
  const [liveL2, setLiveL2] = useState({ bids: [], asks: [] });
  const [tick, setTick] = useState(0);
  const [halt, setHalt] = useState(null);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [lastFill, setLastFill] = useState(null);

  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new OrderBook({ rules: RULES, ownerId: 'me' });
  const snapshotsRef = useRef([]);
  const lastSnapshotRef = useRef(0);

  const streams = useMemo(() => [`${pair.toLowerCase()}@depth20@100ms`, `${pair.toLowerCase()}@aggTrade`], [pair]);

  const onEvent = useCallback(({ stream, data }) => {
    if (stream.includes('depth') && Array.isArray(data?.bids)) {
      setLiveL2({
        bids: data.bids.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })).filter((l) => l.qty > 0),
        asks: data.asks.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })).filter((l) => l.qty > 0)
      });
    }
    if (stream.includes('aggTrade') && data?.p) {
      setTick((t) => t + 1);
    }
  }, []);

  const engine = useRealtimeEngine({ streams, enabled: true, onEvent });

  const row = useMemo(() => rows.find((r) => r.symbol === symbol), [rows, symbol]);
  const markPrice = row?.price ?? null;

  /* Feed the mark price into the matching engine so conditionals and the
     circuit breaker react to live prices. */
  useEffect(() => {
    if (!markPrice) return;
    const book = engineRef.current;
    const { activated, breaker } = book.markPrice(markPrice);
    if (breaker?.halted) setHalt(book.halted);
    if (activated?.length) {
      const fills = activated.flatMap((a) => a.res?.fills || []);
      if (fills.length) {
        setLastFill(fills[fills.length - 1]);
        applyFills(fills);
      }
      setTick((t) => t + 1);
    }
    const now = Date.now();
    if (now - lastSnapshotRef.current > SNAPSHOT_EVERY_MS) {
      lastSnapshotRef.current = now;
      const snaps = snapshotsRef.current;
      snaps.push(book.recordSnapshot());
      if (snaps.length > 200) snaps.splice(0, snaps.length - 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markPrice]);

  const applyFills = useCallback((fills) => {
    setBalance((b) => {
      let { base, quote } = b;
      fills.forEach((f) => {
        if (f.side === 'buy') {
          base += f.qty;
          quote -= f.qty * f.price;
        } else {
          base -= f.qty;
          quote += f.qty * f.price;
        }
      });
      return { base: Number(base.toFixed(8)), quote: Number(quote.toFixed(2)) };
    });
  }, []);

  const metrics = useMemo(() => bookMetrics(liveL2), [liveL2]);
  const liq = useMemo(() => liquidityScore(metrics), [metrics]);
  const depthChart = useMemo(() => ({
    bids: cumulative(aggregateDepth(liveL2.bids, 0.02)).slice(-20),
    asks: cumulative(aggregateDepth(liveL2.asks, 0.02)).slice(0, 20)
  }), [liveL2]);

  const risk = useMemo(() => {
    if (!qty || !Number(qty)) return null;
    const px = type === 'market' ? markPrice : Number(price) || markPrice;
    return checkRisk({
      order: { side, type, qty: Number(qty), price: px },
      balances: { base: balance.base, quote: balance.quote },
      limits: { ...RULES, maxOrderNotional: 25000 },
      referencePrice: markPrice,
      spreadPct: metrics.spreadPct || 0
    });
  }, [qty, price, side, type, markPrice, balance, metrics.spreadPct]);

  const submit = () => {
    setFormMsg(null);
    const book = engineRef.current;
    const order = {
      side,
      type,
      qty: Number(qty),
      price: type === 'market' ? null : Number(price),
      stopPrice: ['stop', 'stop-limit', 'take-profit'].includes(type) ? Number(stopPrice) : undefined,
      trailingPct: type === 'trailing-stop' ? Number(trailingPct) : undefined,
      takeProfit: type === 'oco' ? Number(tp) : undefined,
      stopLoss: type === 'oco' ? Number(sl) : undefined
    };
    const res = book.submit(order, markPrice);
    if (res.rejected) {
      setFormMsg({ tone: 'error', text: res.rejected });
    } else if (res.conditional) {
      setFormMsg({ tone: 'info', text: `${type} order armed — it triggers when your condition is met.` });
    } else {
      if (res.fills?.length) {
        applyFills(res.fills);
        setLastFill(res.fills[res.fills.length - 1]);
      }
      setFormMsg({
        tone: 'ok',
        text: res.fills?.length
          ? `Filled ${res.order.filled} ${symbol} across ${res.fills.length} fill(s)`
          : 'Limit order resting in the book'
      });
    }
    setTick((t) => t + 1);
  };

  const cancel = (id) => {
    engineRef.current.cancel(id);
    setTick((t) => t + 1);
  };

  const killSwitch = () => {
    const res = engineRef.current.killSwitch();
    setHalt(res.halted);
    setTick((t) => t + 1);
    setFormMsg({ tone: 'error', text: `Kill switch: ${res.cancelled.length} order(s) cancelled and trading halted.` });
  };

  const resume = () => {
    engineRef.current.resume();
    setHalt(null);
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!replaying) return undefined;
    const iv = window.setInterval(() => {
      setReplayIdx((i) => {
        const total = snapshotsRef.current.length;
        if (i + 1 >= total) return total - 1;
        return i + 1;
      });
    }, 700);
    return () => window.clearInterval(iv);
  }, [replaying]);

  const allOrders = engineRef.current.openOrders();
  const fills = engineRef.current.fills.slice(-12).reverse();
  const rejections = engineRef.current.rejections.slice(-3).reverse();
  const l2 = engineRef.current.getL2(8);
  const l3 = engineRef.current.getL3();
  const snapshotTotal = snapshotsRef.current.length;
  const replay = replayWindow(snapshotsRef.current, replayIdx || Math.max(0, snapshotTotal - 1), 24);
  void tick;

  const maxAskQty = Math.max(1e-9, ...liveL2.asks.map((a) => a.qty));
  const maxBidQty = Math.max(1e-9, ...liveL2.bids.map((b) => b.qty));
  const myL3Bids = l3.bids.filter((o) => o.ownerId === 'me');
  const myL3Asks = l3.asks.filter((o) => o.ownerId === 'me');

  const ladderRow = (level, kind) => {
    const max = kind === 'ask' ? maxAskQty : maxBidQty;
    const pct = Math.min(100, (level.qty / max) * 100);
    return (
      <div key={`${kind}-${level.price}`} className="relative flex items-center justify-between px-3 py-1 text-xs">
        <span
          className={`absolute inset-y-0 ${kind === 'ask' ? 'right-0 bg-down/10' : 'right-0 bg-up/10'}`}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
        <span className={`num relative ${kind === 'ask' ? 'text-down' : 'text-up'}`}>{fmtPrice(level.price)}</span>
        <span className="num relative text-muted-foreground">{level.qty.toFixed(4)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <CandlestickChart size={22} className="text-primary" /> Exchange Engine <span className="text-sm font-medium text-muted-foreground">(paper)</span>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Deterministic price-time priority matching, the full order-type set, self-trade prevention, market protection,
            tick/lot enforcement, risk checks, circuit breakers and a kill switch — simulated against live prices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Trading pair" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input-dark !h-9 !w-auto !py-0 text-xs">
            {TRADABLE.map((s) => <option key={s} value={s}>{s}/USDT</option>)}
          </select>
          <button onClick={killSwitch} className="btn-ghost !h-9 !border-destructive/50 !px-3 !text-xs !text-destructive">
            <Power size={14} /> Kill switch
          </button>
          {halt ? (
            <button onClick={resume} className="btn-primary !h-9 !px-3 !text-xs">Resume trading</button>
          ) : null}
        </div>
      </div>

      {halt ? (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <ShieldAlert size={15} /> Trading halted — {halt.reason} ({timeAgo(halt.at)}). New orders are rejected until you resume.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Mark price</p>
          <p className="num mt-1 text-xl font-bold">{markPrice ? fmtPrice(markPrice) : '—'}</p>
          <p className={`num text-[11px] ${cls(row?.pct24)}`}>{row?.pct24 == null ? '' : `${row.pct24 >= 0 ? '+' : ''}${row.pct24.toFixed(2)}%`}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Spread</p>
          <p className="num mt-1 text-xl font-bold">{metrics.spread == null ? '—' : metrics.spread.toFixed(4)}</p>
          <p className="num text-[11px] text-muted-foreground">{metrics.spreadPct == null ? '' : `${metrics.spreadPct.toFixed(3)}%`}</p>
        </Card>
        <Card className="!p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Liquidity score</p>
          <p className="num mt-1 text-xl font-bold">{liq}<span className="text-xs text-muted-foreground">/100</span></p>
          <p className="text-[11px] text-muted-foreground">Imbalance {metrics.imbalance == null ? '—' : `${(metrics.imbalance * 100).toFixed(1)}%`}</p>
        </Card>
        <Card className="!p-4">
          <div className="flex gap-4">
            <Balance label="Base" value={balance.base} unit={symbol} />
            <Balance label="Quote" value={balance.quote.toLocaleString()} unit="USDT" />
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(260px,1fr)_minmax(260px,1fr)]">
        {/* Order entry */}
        <Card className="!p-4">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-input p-0.5" role="group" aria-label="Order side">
            <button
              onClick={() => setSide('buy')}
              aria-pressed={side === 'buy'}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${side === 'buy' ? 'bg-up/20 text-up' : 'text-muted-foreground'}`}
            >
              <ArrowUp size={13} /> Buy
            </button>
            <button
              onClick={() => setSide('sell')}
              aria-pressed={side === 'sell'}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${side === 'sell' ? 'bg-down/20 text-down' : 'text-muted-foreground'}`}
            >
              <ArrowDown size={13} /> Sell
            </button>
          </div>

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-type">Order type</label>
          <select id="order-type" value={type} onChange={(e) => setType(e.target.value)} className="input-dark mb-3 !h-9 text-xs">
            {ORDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {type !== 'market' ? (
            <>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-price">Price (USDT)</label>
              <input id="order-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={markPrice ? String(markPrice) : '0'} className="input-dark mb-3 !h-9 num text-xs" />
            </>
          ) : null}

          {['stop', 'stop-limit', 'take-profit'].includes(type) ? (
            <>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-stop">Stop / trigger price</label>
              <input id="order-stop" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} inputMode="decimal" className="input-dark mb-3 !h-9 num text-xs" />
            </>
          ) : null}

          {type === 'trailing-stop' ? (
            <>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-trail">Trailing distance (%)</label>
              <input id="order-trail" value={trailingPct} onChange={(e) => setTrailingPct(e.target.value)} inputMode="decimal" className="input-dark mb-3 !h-9 num text-xs" />
            </>
          ) : null}

          {type === 'oco' ? (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-tp">Take profit</label>
                <input id="order-tp" value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" className="input-dark !h-9 num text-xs" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-sl">Stop loss</label>
                <input id="order-sl" value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" className="input-dark !h-9 num text-xs" />
              </div>
            </div>
          ) : null}

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="order-qty">Quantity ({symbol})</label>
          <input id="order-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="input-dark mb-2 !h-9 num text-xs" />

          {risk ? (
            <div className="mb-2 space-y-1">
              {risk.errors.map((e) => <p key={e} className="text-[11px] text-destructive">{e}</p>)}
              {risk.warnings.map((w) => <p key={w} className="text-[11px] text-amber-400">{w}</p>)}
              {risk.ok ? <p className="text-[11px] text-muted-foreground">Notional ≈ {fmtCompact(risk.notional)} USDT</p> : null}
            </div>
          ) : null}

          <button onClick={submit} disabled={Boolean(halt)} className="btn-primary w-full !h-10 text-sm">
            {side === 'buy' ? 'Buy' : 'Sell'} {symbol}
          </button>

          {formMsg ? (
            <p role="status" className={`mt-2 text-[11px] ${formMsg.tone === 'error' ? 'text-destructive' : formMsg.tone === 'ok' ? 'text-up' : 'text-muted-foreground'}`}>
              {formMsg.text}
            </p>
          ) : null}

          <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
            Tick {RULES.tickSize} · Step {RULES.stepSize} · Min notional {RULES.minNotional} · Max slippage {RULES.maxSlippagePct}%
          </div>
        </Card>

        {/* Order book */}
        <Card className="overflow-hidden !p-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Layers size={14} className="text-primary" />
            <h2 className="text-sm font-semibold">Order book · {pair}</h2>
            <div className="ml-auto flex items-center gap-1 rounded-md border border-input p-0.5">
              {['l2', 'l3'].map((v) => (
                <button
                  key={v}
                  onClick={() => setBookView(v)}
                  aria-pressed={bookView === v}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${bookView === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="py-1">
            <div className="flex items-center justify-between px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Price</span><span>Size</span>
            </div>
            {[...liveL2.asks].slice(0, 8).reverse().map((l) => ladderRow(l, 'ask'))}
            <div className="my-1 flex items-center justify-between border-y border-border bg-accent/30 px-3 py-1.5 text-xs">
              <span className="num font-semibold">{markPrice ? fmtPrice(markPrice) : '—'}</span>
              <span className="text-muted-foreground">spread {metrics.spread == null ? '—' : metrics.spread.toFixed(4)}</span>
            </div>
            {liveL2.bids.slice(0, 8).map((l) => ladderRow(l, 'bid'))}
          </div>

          {bookView === 'l3' ? (
            <div className="border-t border-border px-3 py-2 text-[11px]">
              <p className="mb-1 font-semibold text-muted-foreground">Order-by-order (L3) — your resting orders</p>
              {myL3Bids.concat(myL3Asks).length ? (
                myL3Bids.concat(myL3Asks).map((o) => (
                  <div key={o.id} className="flex items-center justify-between py-0.5">
                    <span className={o.price >= (markPrice || 0) ? 'text-up' : 'text-down'}>{o.price}</span>
                    <span className="num text-muted-foreground">{o.qty.toFixed(4)}</span>
                    <span className="text-[10px] text-muted-foreground">seq {o.seq}</span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No resting orders of your own. Market depth above is live exchange liquidity.</p>
              )}
            </div>
          ) : null}
        </Card>

        {/* Working orders + fills */}
        <Card className="overflow-hidden !p-0">
          <div className="border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-semibold">Working orders &amp; fills</h2>
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {allOrders.length ? allOrders.map((o) => (
              <div key={o.id} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[11px] last:border-0">
                <span className={`font-semibold ${o.side === 'buy' ? 'text-up' : 'text-down'}`}>{o.side.toUpperCase()}</span>
                <span className="text-muted-foreground">{o.type}</span>
                <span className="num">{o.price ? fmtPrice(o.price) : 'market'}</span>
                <span className="num text-muted-foreground">{Number(o.qty).toFixed(4)}</span>
                {o.status === 'conditional' ? <span className="text-amber-400">armed</span> : null}
                <button onClick={() => cancel(o.id)} aria-label={`Cancel ${o.side} order`} className="ml-auto text-muted-foreground hover:text-destructive">
                  <X size={13} />
                </button>
              </div>
            )) : <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">No working orders.</p>}
          </div>
          <div className="border-t border-border px-3 py-2">
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Recent fills</p>
            {fills.length ? fills.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-0.5 text-[11px]">
                <span className={f.side === 'buy' ? 'text-up' : 'text-down'}>{f.side.toUpperCase()}</span>
                <span className="num">{f.qty.toFixed(4)} @ {fmtPrice(f.price)}</span>
                <span className="text-[10px] text-muted-foreground">{timeAgo(f.at)}</span>
              </div>
            )) : <p className="text-[11px] text-muted-foreground">No fills yet.</p>}
            {lastFill ? <p className="mt-1 text-[10px] text-muted-foreground">Last fill matched at {fmtPrice(lastFill.price)}</p> : null}
          </div>
          {rejections.length ? (
            <div className="border-t border-border px-3 py-2">
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Rejections</p>
              {rejections.map((r) => (
                <p key={r.id} className="truncate text-[10px] text-destructive">{r.error}</p>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      {/* Depth chart + replay */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <h2 className="mb-3 text-sm font-semibold">Depth &amp; liquidity</h2>
          <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="Cumulative order book depth by price level">
            {depthChart.bids.map((l) => (
              <span key={`b${l.price}`} className="flex-1 rounded-t bg-up/50" style={{ height: `${Math.min(100, (l.cumQty / Math.max(1e-9, depthChart.bids[depthChart.bids.length - 1].cumQty)) * 100)}%` }} />
            ))}
            {depthChart.asks.map((l) => (
              <span key={`a${l.price}`} className="flex-1 rounded-t bg-down/50" style={{ height: `${Math.min(100, (l.cumQty / Math.max(1e-9, depthChart.asks[depthChart.asks.length - 1].cumQty)) * 100)}%` }} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>Bid depth {fmtCompact(metrics.bidLiquidity || 0)}</span>
            <span>Ask depth {fmtCompact(metrics.askLiquidity || 0)}</span>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Order-book replay</h2>
            <span className="text-[11px] text-muted-foreground">{snapshotTotal} snapshots recorded</span>
            <button
              onClick={() => setReplaying((v) => !v)}
              className="btn-ghost ml-auto !h-7 !px-2 !text-[11px]"
              disabled={snapshotTotal < 2}
            >
              {replaying ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Play</>}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, snapshotTotal - 1)}
            value={replay.index}
            onChange={(e) => setReplayIdx(Number(e.target.value))}
            aria-label="Replay position"
            className="mt-3 w-full accent-[#FFC105]"
            disabled={snapshotTotal < 2}
          />
          {replay.slice.length ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <span>Bid {replay.slice[replay.slice.length - 1].l1?.bestBid ?? '—'}</span>
              <span>Ask {replay.slice[replay.slice.length - 1].l1?.bestAsk ?? '—'}</span>
              <span>Last {replay.slice[replay.slice.length - 1].lastPrice ?? '—'}</span>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">Recording book snapshots every 15s — replay becomes available shortly.</p>
          )}
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Simulation only: orders match against live exchange liquidity in your browser against paper balances — no real funds,
          no real orders, no custody. Last data engine state: <b className="text-foreground">{engine.status.state}</b>
          {engine.status.host ? ` via ${engine.status.host}` : ''}. Production trading additionally requires a licensed entity,
          custody and audited infrastructure.
        </span>
      </div>
    </div>
  );
}
