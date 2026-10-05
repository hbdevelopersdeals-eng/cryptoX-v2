import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sigma, ShieldAlert, Flame, Info, TrendingUp, TrendingDown, Calculator } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useDerivatives, useLiquidations } from '../lib/derivatives.js';
import {
  contractBySymbol, positionView, liquidate, applyFunding, adlQueue, InsuranceFund,
  nextFundingTime, FUNDING_INTERVAL_MS, initialMargin, maintenanceRequirement
} from '../lib/derivativesEngine.js';
import { bsPrice, bsGreeks, impliedVol, yearsFromDays } from '../lib/options.js';
import { bucketLiquidations, clusterLevels, estimateHeatmap, heatColor } from '../lib/liquidationHeatmap.js';
import { fmtPrice, fmtCompact, fmtUsd, cls, timeAgo } from '../lib/format.js';
import { Card } from '../components/ui.jsx';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const START_WALLET = 25000;

function Metric({ label, value, tone, sub }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`num text-sm font-semibold ${tone || ''}`}>{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function DerivativesPage() {
  const { rows } = useMarket();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const base = symbol.replace('USDT', '');

  const [wallet, setWallet] = useState(START_WALLET);
  const [position, setPosition] = useState(null);
  const [side, setSide] = useState('long');
  const [leverage, setLeverage] = useState(10);
  const [mode, setMode] = useState('isolated');
  const [qty, setQty] = useState('0.05');
  const [msg, setMsg] = useState(null);
  const [closed, setClosed] = useState([]);

  // Options pricer
  const [optType, setOptType] = useState('call');
  const [strike, setStrike] = useState('100000');
  const [days, setDays] = useState('30');
  const [rate, setRate] = useState('2');
  const [vol, setVol] = useState('55');
  const [marketPrice, setMarketPrice] = useState('');

  const fundRef = useRef(new InsuranceFund(START_WALLET * 10));
  const [fund, setFund] = useState({ balance: fundRef.current.balance, needsAdl: false, events: 0 });

  const deriv = useDerivatives({ symbol, enabled: true });
  const liquidations = useLiquidations({ enabled: true, limit: 200 });

  const spot = rows.find((r) => r.symbol === base)?.price ?? null;
  const mark = deriv.funding?.markPrice ?? spot;
  const contract = contractBySymbol(symbol);

  const view = useMemo(() => (position && mark ? positionView(position, mark, wallet) : null), [position, mark, wallet]);

  /* Liquidation engine: runs on every mark update. */
  useEffect(() => {
    if (!position || !view || !mark) return;
    if (view.risk !== 'liquidated') return;
    const closedPos = liquidate(position, mark);
    const fund = fundRef.current;
    const absorbed = fund.absorb(closedPos.shortfall || 0);
    fund.credit(Math.abs(closedPos.loss || 0) * 0.2); // liquidation fee tops the fund back up
    setFund({ balance: fund.balance, needsAdl: fund.needsAdl(), events: fund.events.length });
    // At liquidation the position margin is consumed by the loss; any shortfall
    // beyond it is covered by the insurance fund (absorbed above).
    setWallet((w) => Math.max(0, w + Math.max(0, view.marginBalance)));
    setClosed((c) => [{ ...closedPos, absorbed }, ...c].slice(0, 8));
    setPosition(null);
    setMsg({ tone: 'error', text: `Position liquidated at ${fmtPrice(mark)} — loss ${fmtUsd(closedPos.loss)}${absorbed ? `, insurance fund absorbed ${fmtUsd(absorbed)}` : ''}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, position, view]);

  const adl = useMemo(() => {
    const list = closed.length
      ? closed.map((c) => ({ id: `closed-${c.closedAt}`, margin: 100, unrealizedPnl: c.realizedPnl || 0, leverage: c.leverage || 10 }))
      : [];
    if (position && view) list.push({ id: 'open', margin: view.margin, unrealizedPnl: view.unrealizedPnl, leverage: position.leverage });
    return adlQueue(list);
  }, [closed, position, view]);

  const openPosition = () => {
    setMsg(null);
    const size = Number(qty);
    if (!(size > 0)) return setMsg({ tone: 'error', text: 'Enter a valid size' });
    if (!mark) return setMsg({ tone: 'error', text: 'Waiting for a mark price' });
    if (size % contract.lotSize > 1e-9) return setMsg({ tone: 'error', text: `Lot size must be a multiple of ${contract.lotSize}` });
    const margin = initialMargin(size * mark, leverage);
    if (margin > wallet) return setMsg({ tone: 'error', text: `Insufficient wallet balance (need ${fmtUsd(margin)})` });
    setWallet((w) => w - margin);
    setPosition({ symbol, side, entry: mark, qty: size, leverage, mode, margin, realizedPnl: 0, openedAt: Date.now() });
    setMsg({ tone: 'ok', text: `${side} ${size} ${base} @ ${fmtPrice(mark)} · ${leverage}× ${mode}` });
  };

  const closePosition = () => {
    if (!position || !view) return;
    setWallet((w) => w + view.marginBalance);
    setClosed((c) => [{ ...position, closedAt: Date.now(), closePrice: mark, realizedPnl: view.unrealizedPnl, liquidated: false }, ...c].slice(0, 8));
    setMsg({ tone: 'ok', text: `Closed at ${fmtPrice(mark)} — PnL ${fmtUsd(view.unrealizedPnl)}` });
    setPosition(null);
  };

  const settleFunding = () => {
    if (!position || !deriv.funding?.fundingRate) return;
    const res = applyFunding(position, deriv.funding.fundingRate);
    setPosition((p) => ({ ...p, realizedPnl: res.realizedPnl }));
    setWallet((w) => w + res.payment);
    setMsg({ tone: res.payment >= 0 ? 'ok' : 'info', text: `Funding settled: ${fmtUsd(res.payment)} (${(deriv.funding.fundingRate * 100).toFixed(4)}%)` });
  };

  const heat = useMemo(() => {
    const est = estimateHeatmap({ markPrice: mark, openInterest: deriv.openInterest?.openInterest || 0, levels: 28 });
    const observed = bucketLiquidations(liquidations.events, { bins: 14, min: est.rows.length ? est.rows[0].price : undefined, max: est.rows.length ? est.rows[est.rows.length - 1].price : undefined });
    return { est, observed, clusters: clusterLevels(observed.rows, 3) };
  }, [mark, deriv.openInterest, liquidations.events]);

  const maxHeat = Math.max(...heat.est.rows.map((r) => r.total), 1e-9);

  const optBase = {
    type: optType,
    S: mark || 0,
    K: Number(strike) || 0,
    T: yearsFromDays(Number(days)),
    r: (Number(rate) || 0) / 100,
    sigma: (Number(vol) || 0) / 100
  };
  const optPrice = mark ? bsPrice(optBase) : null;
  const greeks = mark ? bsGreeks(optBase) : null;
  const iv = mark && marketPrice ? impliedVol({ ...optBase, price: Number(marketPrice) }) : null;
  const fundingIn = nextFundingTime() - Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Sigma size={22} className="text-primary" /> Derivatives <span className="text-sm font-medium text-muted-foreground">(paper)</span>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Perpetual futures with leverage, isolated/cross margin, tiered maintenance margin, liquidation engine, funding
            settlement, ADL + insurance fund, Black-Scholes options with Greeks and implied volatility, live open interest and a
            liquidation heatmap.
          </p>
        </div>
        <select aria-label="Contract" value={symbol} onChange={(e) => { setSymbol(e.target.value); setPosition(null); }} className="input-dark !h-9 !w-auto !py-0 text-xs">
          {SYMBOLS.map((s) => <option key={s} value={s}>{s} perpetual</option>)}
        </select>
      </div>

      {/* Market strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="!p-4"><Metric label="Mark price" value={mark ? fmtPrice(mark) : '—'} sub="futures mark" /></Card>
        <Card className="!p-4"><Metric label="Index price" value={deriv.funding?.indexPrice ? fmtPrice(deriv.funding.indexPrice) : '—'} sub="spot index" /></Card>
        <Card className="!p-4">
          <Metric label="Funding rate" value={deriv.funding?.fundingRate == null ? '—' : `${(deriv.funding.fundingRate * 100).toFixed(4)}%`}
            tone={cls(deriv.funding?.fundingRate == null ? 0 : -deriv.funding.fundingRate)}
            sub={`next in ${Math.max(0, Math.floor(fundingIn / 3600000))}h`} />
        </Card>
        <Card className="!p-4"><Metric label="Open interest" value={deriv.openInterest?.openInterest == null ? '—' : fmtCompact(deriv.openInterest.openInterest)} sub={`${deriv.polls} polls`} /></Card>
        <Card className="!p-4"><Metric label="Insurance fund" value={fmtUsd(fund.balance, 0)} tone={fund.needsAdl ? 'text-down' : 'text-up'} sub={fund.needsAdl ? 'ADL armed' : 'healthy'} /></Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-[320px_minmax(260px,1fr)_minmax(260px,1fr)]">
        {/* Order / position */}
        <Card className="!p-4">
          <h2 className="mb-3 text-sm font-semibold">Open perpetual position</h2>
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-input p-0.5" role="group" aria-label="Side">
            <button onClick={() => setSide('long')} aria-pressed={side === 'long'}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${side === 'long' ? 'bg-up/20 text-up' : 'text-muted-foreground'}`}>
              <TrendingUp size={13} /> Long
            </button>
            <button onClick={() => setSide('short')} aria-pressed={side === 'short'}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${side === 'short' ? 'bg-down/20 text-down' : 'text-muted-foreground'}`}>
              <TrendingDown size={13} /> Short
            </button>
          </div>

          <label htmlFor="lev" className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Leverage · {leverage}×
          </label>
          <input id="lev" type="range" min={1} max={contract.maxLeverage} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="mb-3 w-full accent-[#FFC105]" />

          <div className="mb-3 grid grid-cols-2 gap-2">
            {['isolated', 'cross'].map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium capitalize ${mode === m ? 'border-primary text-primary' : 'border-input text-muted-foreground'}`}>
                {m} margin
              </button>
            ))}
          </div>

          <label htmlFor="qty" className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Size ({base})</label>
          <input id="qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="input-dark mb-2 !h-9 num text-xs" />

          <div className="mb-3 space-y-0.5 text-[11px] text-muted-foreground">
            <p>Notional ≈ {mark ? fmtUsd(Number(qty) * mark, 0) : '—'} · margin {mark ? fmtUsd(initialMargin(Number(qty) * mark, leverage), 0) : '—'}</p>
            <p>Lot {contract.lotSize} · max {contract.maxLeverage}× · wallet {fmtUsd(wallet, 0)}</p>
          </div>

          <button onClick={openPosition} disabled={Boolean(position)} className="btn-primary w-full !h-10 text-sm">
            {position ? 'Position open' : `Open ${side}`}
          </button>
          {msg ? <p role="status" className={`mt-2 text-[11px] ${msg.tone === 'error' ? 'text-destructive' : msg.tone === 'ok' ? 'text-up' : 'text-muted-foreground'}`}>{msg.text}</p> : null}
        </Card>

        {/* Position risk */}
        <Card className="!p-4">
          <h2 className="mb-3 text-sm font-semibold">Position risk</h2>
          {!view ? (
            <p className="text-[11px] text-muted-foreground">No open position. Open one to see margin, liquidation price and PnL.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Unrealized PnL" value={fmtUsd(view.unrealizedPnl)} tone={cls(view.unrealizedPnl)} sub={`ROE ${view.roe.toFixed(2)}%`} />
                <Metric label="Margin balance" value={fmtUsd(view.marginBalance, 0)} sub={`initial ${fmtUsd(view.margin, 0)}`} />
                <Metric label="Margin ratio" value={`${(view.marginRatio * 100).toFixed(1)}%`}
                  tone={view.risk === 'safe' ? 'text-up' : view.risk === 'warning' ? 'text-amber-400' : 'text-down'} sub={view.risk} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Metric label="Liquidation price" value={fmtPrice(view.liquidationPrice)} sub={`${view.distancePct?.toFixed(2)}% away`} />
                <Metric label="Maintenance margin" value={fmtUsd(view.maintenanceMargin, 0)} sub={`${(view.mmr * 100).toFixed(2)}% MMR`} />
                <Metric label="Entry / mark" value={`${fmtPrice(position.entry)} / ${fmtPrice(mark)}`} sub={`${position.leverage}× ${position.mode}`} />
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${view.risk === 'safe' ? 'bg-up' : view.risk === 'warning' ? 'bg-amber-400' : 'bg-down'}`}
                  style={{ width: `${Math.min(100, view.marginRatio * 100)}%` }} />
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={closePosition} className="btn-ghost !h-9 flex-1 !text-xs">Close position</button>
                <button onClick={settleFunding} className="btn-ghost !h-9 flex-1 !text-xs">Settle funding</button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Liquidation engine checks every mark update; a breach closes the position and draws on the insurance fund.
              </p>
            </>
          )}
        </Card>

        {/* ADL + closed */}
        <Card className="!p-4">
          <h2 className="mb-3 text-sm font-semibold">ADL queue &amp; history</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Auto-deleveraging ranks by profit × leverage. It triggers only when the insurance fund is depleted.
          </p>
          {adl.length ? adl.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between border-b border-border/60 py-1 text-[11px] last:border-0">
              <span className="text-muted-foreground">#{i + 1} {p.id}</span>
              <span className="num">{p.leverage}×</span>
              <span className={`num ${cls(p.unrealizedPnl)}`}>{fmtUsd(p.unrealizedPnl)}</span>
              <span className="num text-muted-foreground">score {p.adlScore.toFixed(2)}</span>
            </div>
          )) : <p className="text-[11px] text-muted-foreground">No positions to rank.</p>}
          {closed.length ? (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Closed / liquidated</p>
              {closed.map((c) => (
                <div key={`${c.openedAt}-${c.closedAt}`} className="flex items-center justify-between py-0.5 text-[11px]">
                  <span className={c.liquidated ? 'text-down' : 'text-muted-foreground'}>{c.liquidated ? 'LIQUIDATED' : 'closed'}</span>
                  <span className={`num ${cls(c.realizedPnl)}`}>{fmtUsd(c.realizedPnl)}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(c.closedAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Liquidation heatmap */}
        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Flame size={15} className="text-down" />
            <h2 className="text-sm font-semibold">Liquidation heatmap</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {liquidations.received} observed liquidations · {liquidations.status}
            </span>
          </div>
          <div className="mt-3 space-y-[2px]" role="img" aria-label="Estimated liquidation density by price level">
            {heat.est.rows.slice().reverse().map((r) => (
              <div key={r.price} className="flex items-center gap-2">
                <span className="num w-20 text-right text-[10px] text-muted-foreground">{fmtPrice(r.price)}</span>
                <span className="h-2 flex-1 rounded" style={{ background: heatColor(r.total, maxHeat) }} />
              </div>
            ))}
            {!heat.est.rows.length ? <p className="text-[11px] text-muted-foreground">Waiting for mark price and open interest…</p> : null}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Estimated from open interest across leverage bands (5×–100×) — an estimate, not observed positions. Marked clusters:
            {heat.clusters.length ? ` ${heat.clusters.map((c) => fmtPrice(c.price)).join(', ')}` : ' none observed yet'}.
          </p>
        </Card>

        {/* Options pricer */}
        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Calculator size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Options pricer · Black-Scholes</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select aria-label="Option type" value={optType} onChange={(e) => setOptType(e.target.value)} className="input-dark !h-8 !py-0 text-xs">
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
            <input aria-label="Strike" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="Strike" className="input-dark !h-8 num text-xs" />
            <input aria-label="Days to expiry" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" className="input-dark !h-8 num text-xs" />
            <input aria-label="Risk free rate %" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate %" className="input-dark !h-8 num text-xs" />
            <input aria-label="Volatility %" value={vol} onChange={(e) => setVol(e.target.value)} placeholder="Vol %" className="input-dark !h-8 num text-xs" />
            <input aria-label="Market price for IV" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} placeholder="Market px → IV" className="input-dark !h-8 num text-xs" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Metric label="Theoretical price" value={optPrice == null ? '—' : fmtUsd(optPrice)} sub={`S ${mark ? fmtPrice(mark) : '—'}`} />
            <Metric label="Implied vol" value={iv == null ? '—' : `${(iv * 100).toFixed(1)}%`} sub={marketPrice ? 'from market price' : 'enter market px'} />
            <Metric label="Breakeven" value={mark ? fmtPrice(optType === 'call' ? Number(strike) + (optPrice || 0) : Number(strike) - (optPrice || 0)) : '—'} sub="at expiry" />
          </div>
          {greeks ? (
            <div className="mt-3 grid grid-cols-5 gap-2 text-[11px]">
              <Metric label="Delta" value={greeks.delta.toFixed(3)} />
              <Metric label="Gamma" value={greeks.gamma.toExponential(2)} />
              <Metric label="Vega" value={greeks.vega.toFixed(3)} />
              <Metric label="Theta" value={greeks.theta.toFixed(3)} />
              <Metric label="Rho" value={greeks.rho.toFixed(3)} />
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            European pricing with continuous compounding; Greeks per 1% vol / 1 day. No options venue is connected — pricing only.
          </p>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Simulation only: funding, mark/index price, open interest and liquidation events are real live data, but positions,
          margin, the insurance fund and ADL are modelled in your browser. Real futures/options trading requires a licensed
          venue, custody and margin arrangements — that is an enterprise-blueprint item, not this build.
          {deriv.error ? ` Derivatives feed: ${deriv.error}.` : ''}
        </span>
      </div>
    </div>
  );
}
