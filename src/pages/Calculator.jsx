import React, { useMemo, useState } from 'react';
import { Calculator as CalcIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Card } from '../components/ui.jsx';
import { cls } from '../lib/format.js';

const inputCls = 'input-dark !h-10 num';
const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground';

export default function CalculatorPage() {
  const [entry, setEntry] = useState('100');
  const [exit, setExit] = useState('120');
  const [invest, setInvest] = useState('1000');
  const [lev, setLev] = useState('1');
  const [fee, setFee] = useState('0.1');
  const [side, setSide] = useState('long');

  const r = useMemo(() => {
    const e = parseFloat(entry) || 0;
    const x = parseFloat(exit) || 0;
    const inv = parseFloat(invest) || 0;
    const l = parseFloat(lev) || 1;
    const f = (parseFloat(fee) || 0) / 100;
    if (!e || !inv) return null;
    const ret = side === 'long' ? (x - e) / e : (e - x) / e;
    const notional = inv * l;
    const gross = notional * ret;
    const feeIn = notional * f;
    const feeOut = Math.abs(notional + gross) * f;
    const fees = feeIn + feeOut;
    const net = gross - fees;
    const roi = (net / inv) * 100;
    const liq = side === 'long' ? e * (1 - 1 / l) : e * (1 + 1 / l);
    const breakeven = side === 'long' ? e * (1 + f * (2 * l) / l) : e * (1 - (f * 2 * l) / l);
    return { ret: ret * 100, gross, fees, net, roi, liq, breakeven, notional };
  }, [entry, exit, invest, lev, fee, side]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Calculator</h1>
        <p className="mt-1 text-sm text-muted-foreground">Calculate P&L, fees, breakeven and liquidation price.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex gap-1 rounded-lg border border-input bg-background p-0.5">
            <button onClick={() => setSide('long')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${side === 'long' ? 'bg-up/15 text-up' : 'text-muted-foreground'}`}>
              <ArrowUpRight size={14} /> Long / Buy
            </button>
            <button onClick={() => setSide('short')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${side === 'short' ? 'bg-down/15 text-down' : 'text-muted-foreground'}`}>
              <ArrowDownRight size={14} /> Short / Sell
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <label><span className={labelCls}>Entry Price ($)</span><input type="number" value={entry} onChange={(e) => setEntry(e.target.value)} className={inputCls} /></label>
            <label><span className={labelCls}>Exit Price ($)</span><input type="number" value={exit} onChange={(e) => setExit(e.target.value)} className={inputCls} /></label>
            <label><span className={labelCls}>Investment ($)</span><input type="number" value={invest} onChange={(e) => setInvest(e.target.value)} className={inputCls} /></label>
            <label>
              <span className={labelCls}>Leverage</span>
              <select value={lev} onChange={(e) => setLev(e.target.value)} className="input-dark !h-10">
                {[1, 2, 5, 10, 20, 50, 100].map((l) => <option key={l} value={l}>{l}x</option>)}
              </select>
            </label>
          </div>

          <label className="mt-3.5 block">
            <span className={labelCls}>Fee tier (%) — Maker 0.1 · Taker 0.1 · VIP 0.05</span>
            <select value={fee} onChange={(e) => setFee(e.target.value)} className="input-dark !h-10">
              {[['0.1', 'Taker 0.1%'], ['0.1', 'Maker 0.1%'], ['0.05', 'VIP 0.05%']].map(([v, t]) => <option key={t} value={v}>{t}</option>)}
            </select>
          </label>
        </Card>

        <Card className="lg:col-span-3">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><CalcIcon size={15} className="text-primary" /> Results</h2>
          {!r ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Enter valid values to see the analysis.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Price Move</p>
                  <p className={`num mt-1 text-lg font-bold ${cls(r.ret)}`}>{r.ret >= 0 ? '+' : ''}{r.ret.toFixed(2)}%</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Gross P&L</p>
                  <p className={`num mt-1 text-lg font-bold ${cls(r.gross)}`}>{r.gross >= 0 ? '+' : ''}${r.gross.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Fees (est.)</p>
                  <p className="num mt-1 text-lg font-bold text-muted-foreground">${r.fees.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-primary">Net P&L / ROI</p>
                  <p className={`num mt-1 text-lg font-bold ${cls(r.net)}`}>{r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}</p>
                  <p className={`num text-xs ${cls(r.roi)}`}>{r.roi >= 0 ? '+' : ''}{r.roi.toFixed(2)}% on investment</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Est. Liquidation Price</p>
                  <p className="num mt-1 text-lg font-bold text-down">${Math.max(0, r.liq).toFixed(6)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{side === 'long' ? 'isolated long' : 'isolated short'} · approx.</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Breakeven Price</p>
                  <p className="num mt-1 text-lg font-bold">${Math.max(0, r.breakeven).toFixed(6)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">after both fees</p>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Notional = ${r.notional.toFixed(2)} ({invest}$ × {lev}x). Estimated fees use your fee tier on entry and exit. Liquidation is approximate (isolated, ignores maintenance margin). Educational tool — not financial advice.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
