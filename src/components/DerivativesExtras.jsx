import React, { useMemo, useState } from 'react';
import { CalendarClock, ArrowLeftRight, Layers, Sigma, Info, TrendingUp, TrendingDown } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useDerivatives } from '../lib/derivatives.js';
import {
  CONTRACTS, datedContracts, daysToExpiry, priceBasis, fundingFromPremium,
  annualisedBasis, fairFuturesPrice, closePartial, realizeFunding, crossWallet,
  initialMargin, maintenanceRequirement
} from '../lib/derivativesEngine.js';
import { Card } from './ui.jsx';
import { fmtPrice, fmtUsd, cls } from '../lib/format.js';

const pct = (v, d = 4) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted-foreground');

function Row({ label, value, tone: t }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`num text-xs font-semibold ${t || ''}`}>{value}</span>
    </div>
  );
}

/**
 * Section 2 supplements: dated futures term structure, mark/index basis,
 * realized PnL on a partial close, and cross-margin aggregation.
 * Self-contained — it pulls its own live feed so the host page needs one tag.
 */
export default function DerivativesExtras({ symbol = 'BTCUSDT' }) {
  const { rows } = useMarket();
  const deriv = useDerivatives({ symbol });

  const base = CONTRACTS.find((c) => c.symbol === symbol) || CONTRACTS[0];
  const [contractSymbol, setContractSymbol] = useState(base.symbol);
  const [rate, setRate] = useState(0.05); // carry rate for the fair-value curve

  const mark = deriv?.markPrice ?? null;
  const index = deriv?.indexPrice ?? null;
  const live = deriv?.fundingRate ?? null;

  const spot = useMemo(
    () => (rows || []).find((r) => r.symbol === base.base)?.price ?? null,
    [rows, base.base]
  );

  /* ---------- term structure ---------- */
  const dated = useMemo(() => datedContracts(Date.now(), base), [base]);
  // With no live dated quotes we model the curve from cost of carry and label
  // it as modelled rather than presenting invented market prices as real.
  const term = useMemo(() => {
    const idx = index ?? spot ?? mark;
    if (!idx) return [];
    return dated.map((c) => {
      const days = daysToExpiry(c.expiry);
      const fair = fairFuturesPrice({ indexPrice: idx, days, rate: rate / 100 });
      return {
        ...c,
        days,
        fair,
        basis: annualisedBasis({ futuresPrice: fair, indexPrice: idx, days })
      };
    });
  }, [dated, index, spot, mark, rate]);

  /* ---------- mark vs index ---------- */
  const basis = useMemo(() => priceBasis({ markPrice: mark, indexPrice: index }), [mark, index]);
  const premiumPct = basis ? basis.pct / 100 : null;
  const impliedFunding = premiumPct == null ? null : fundingFromPremium({ premiumPct });

  /* ---------- realized PnL lab ---------- */
  const [entry, setEntry] = useState('');
  const [qty, setQty] = useState('');
  const [closeQty, setCloseQty] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [side, setSide] = useState('long');

  const closePreview = useMemo(() => {
    const e = parseFloat(entry) || (mark ?? 0);
    const q = parseFloat(qty) || 1;
    const cq = parseFloat(closeQty) || q;
    if (!e || !mark) return null;
    const pos = { symbol: base.symbol, side, entry: e, qty: q, leverage, realizedPnl: 0 };
    const r = closePartial(pos, { qty: cq, price: mark });
    if (!r) return null;
    const funded = realizeFunding({ ...pos, qty: r.remainingQty || 0 }, impliedFunding ?? 0);
    return { ...r, fundingOnRemainder: funded.payment, marginUsed: initialMargin(e * cq, leverage) };
  }, [entry, qty, closeQty, leverage, side, mark, base.symbol, impliedFunding]);

  /* ---------- cross margin ---------- */
  const crossPositions = useMemo(() => {
    if (!mark) return [];
    // A representative book: a directional pair plus a hedge.
    return [
      { symbol: base.symbol, side: 'long', entry: mark * 0.98, qty: 0.5, leverage: 10 },
      { symbol: base.symbol, side: 'short', entry: mark * 1.02, qty: 0.2, leverage: 10 },
      { symbol: base.symbol, side: 'long', entry: mark * 0.9, qty: 0.3, leverage: 20 }
    ];
  }, [mark, base.symbol]);

  const marks = useMemo(() => (mark ? { [base.symbol]: mark } : {}), [mark, base.symbol]);
  const cross = useMemo(
    () => crossWallet({ positions: crossPositions, walletBalance: 5000, marks }),
    [crossPositions, marks]
  );

  return (
    <>
      {/* ---------- dated futures / term structure ---------- */}
      <Card className="!p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={15} className="text-primary" /> Dated futures · term structure
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">carry rate</span>
            <input
              type="number"
              value={rate}
              step="0.5"
              onChange={(e) => setRate(Number(e.target.value))}
              className="input-dark !h-7 !w-16 num !text-[11px]"
            />
            <span className="text-[10px] text-muted-foreground">% p.a.</span>
          </div>
        </div>

        <p className="mb-2 text-[11px] text-muted-foreground">
          Expiries are derived from the calendar (last Friday of Mar/Jun/Sep/Dec), not hard-coded. With no live dated
          quotes the curve is <b>modelled</b> by cost of carry — treat it as an illustration, not a market price.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 font-medium">Contract</th>
                <th className="py-1.5 text-right font-medium">Expiry</th>
                <th className="py-1.5 text-right font-medium">Days</th>
                <th className="py-1.5 text-right font-medium">Fair (carry)</th>
                <th className="py-1.5 text-right font-medium">Basis</th>
                <th className="py-1.5 text-right font-medium">Annualised</th>
                <th className="py-1.5 text-right font-medium">Max lev</th>
              </tr>
            </thead>
            <tbody>
              {term.map((t) => (
                <tr key={t.symbol} className="border-t border-border/60">
                  <td className="py-1.5 font-semibold">{t.symbol}</td>
                  <td className="num py-1.5 text-right text-xs">{t.expiryLabel}</td>
                  <td className="num py-1.5 text-right text-xs">{t.days.toFixed(1)}</td>
                  <td className="num py-1.5 text-right text-xs">{fmtPrice(t.fair)}</td>
                  <td className={`num py-1.5 text-right text-xs ${tone(t.basis?.pct)}`}>{pct(t.basis?.pct)}</td>
                  <td className={`num py-1.5 text-right text-xs ${tone(t.basis?.annualisedPct)}`}>{pct(t.basis?.annualisedPct, 2)}</td>
                  <td className="num py-1.5 text-right text-xs">{t.maxLeverage}×</td>
                </tr>
              ))}
              {!term.length ? (
                <tr><td colSpan={7} className="py-4 text-center text-xs text-muted-foreground">Waiting for a reference price…</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- mark vs index ---------- */}
      <Card className="!p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ArrowLeftRight size={15} className="text-primary" /> Mark vs index price
        </h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Exchanges settle PnL and trigger liquidation on the <b>mark</b> price, never the last traded price — the mark is
          pulled toward the index to resist manipulation.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <div>
            <Row label="Mark price" value={mark ? fmtPrice(mark) : '—'} />
            <Row label="Index price" value={index ? fmtPrice(index) : '—'} />
            <Row label="Basis (mark − index)" value={basis ? fmtPrice(basis.abs) : '—'} tone={basis ? tone(basis.pct) : ''} />
            <Row label="Basis %" value={basis ? pct(basis.pct, 3) : '—'} tone={basis ? tone(basis.pct) : ''} />
          </div>
          <div>
            <Row label="Live funding (8h)" value={live == null ? '—' : pct(live * 100, 4)} tone={live == null ? '' : tone(live)} />
            <Row label="Implied funding from premium" value={impliedFunding == null ? '—' : pct(impliedFunding * 100, 4)} tone={impliedFunding == null ? '' : tone(impliedFunding)} />
            <Row label="Spot reference" value={spot ? fmtPrice(spot) : '—'} />
            <Row label="Perp premium vs spot" value={mark && spot ? pct(((mark - spot) / spot) * 100, 3) : '—'} tone={mark && spot ? tone(mark - spot) : ''} />
          </div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Implied funding applies the published premium + interest-rate clamp (±0.05%), capped at ±0.75% per interval.
        </p>
      </Card>

      {/* ---------- realized PnL ---------- */}
      <Card className="!p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Sigma size={15} className="text-primary" /> Realized PnL · partial close
        </h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Closing part of a position realizes PnL immediately, net of taker fees, and pro-rates the margin used. Funding
          accrues into realized PnL too.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <p className="mb-0.5 text-[10px] text-muted-foreground">Side</p>
            <select value={side} onChange={(e) => setSide(e.target.value)} className="input-dark !h-8 !text-[11px]">
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </div>
          <div>
            <p className="mb-0.5 text-[10px] text-muted-foreground">Entry</p>
            <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={mark ? String(mark) : '0'} className="input-dark !h-8 num !text-[11px]" />
          </div>
          <div>
            <p className="mb-0.5 text-[10px] text-muted-foreground">Size</p>
            <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" className="input-dark !h-8 num !text-[11px]" />
          </div>
          <div>
            <p className="mb-0.5 text-[10px] text-muted-foreground">Close qty</p>
            <input value={closeQty} onChange={(e) => setCloseQty(e.target.value)} placeholder={qty || '1'} className="input-dark !h-8 num !text-[11px]" />
          </div>
          <div>
            <p className="mb-0.5 text-[10px] text-muted-foreground">Leverage</p>
            <input type="number" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} className="input-dark !h-8 num !text-[11px]" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div>
            <Row label="Realized (gross)" value={closePreview ? fmtUsd(closePreview.gross, 2) : '—'} tone={closePreview ? tone(closePreview.gross) : ''} />
            <Row label="Fee" value={closePreview ? fmtUsd(-closePreview.fee, 2) : '—'} tone="text-down" />
            <Row label="Realized (net)" value={closePreview ? fmtUsd(closePreview.realizedPnl, 2) : '—'} tone={closePreview ? tone(closePreview.realizedPnl) : ''} />
          </div>
          <div>
            <Row label="Margin used on the close" value={closePreview ? fmtUsd(closePreview.marginUsed, 2) : '—'} />
            <Row label="ROE on the close" value={closePreview?.roe != null ? pct(closePreview.roe, 2) : '—'} tone={closePreview?.roe != null ? tone(closePreview.roe) : ''} />
            <Row label="Remaining open" value={closePreview ? `${closePreview.remainingQty}` : '—'} />
          </div>
        </div>
        {closePreview ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Mark {fmtPrice(mark)} · funding accrued on the remainder at the implied rate:{' '}
            <span className={tone(closePreview.fundingOnRemainder)}>{fmtUsd(closePreview.fundingOnRemainder, 4)}</span>
          </p>
        ) : (
          <p className="mt-2 text-[10px] text-muted-foreground">Enter an entry price to preview the realization.</p>
        )}
      </Card>

      {/* ---------- cross margin ---------- */}
      <Card className="!p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Layers size={15} className="text-primary" /> Cross-margin wallet
        </h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Under <b>cross</b> margin one collateral pool backs every position, so the aggregate ratio decides liquidation —
          a single deep loser can take the whole account with it. Under <b>isolated</b>, only that position&apos;s own
          margin is at risk.
        </p>

        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div>
            <Row label="Positions" value={cross.positions} />
            <Row label="Total notional" value={fmtUsd(cross.totalNotional, 2)} />
            <Row label="Initial margin required" value={fmtUsd(cross.totalInitial, 2)} />
            <Row label="Maintenance margin" value={fmtUsd(cross.totalMaintenance, 2)} />
          </div>
          <div>
            <Row label="Unrealized PnL" value={fmtUsd(cross.totalUnrealized, 2)} tone={tone(cross.totalUnrealized)} />
            <Row label="Margin balance" value={fmtUsd(cross.marginBalance, 2)} />
            <Row label="Margin ratio" value={`${(cross.marginRatio * 100).toFixed(2)}%`} />
            <Row label="Cushion before liquidation" value={fmtUsd(cross.cushion, 2)} tone={cross.cushion > 0 ? 'text-up' : 'text-down'} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">Aggregate risk</span>
          <span className={cls(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold',
            cross.risk === 'safe' ? 'bg-up/15 text-up' : cross.risk === 'warning' ? 'bg-primary/15 text-primary' : 'bg-down/15 text-down'
          )}>
            {cross.risk}
          </span>
          {cross.risk === 'safe' ? <TrendingUp size={12} className="text-up" /> : <TrendingDown size={12} className="text-down" />}
        </div>
      </Card>
    </>
  );
}
