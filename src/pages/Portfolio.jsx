import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Plus, X, Download, AlertTriangle, RefreshCw, Loader2, Trash2, Link2,
  PieChart, TrendingUp, Receipt, Shield, Layers, BellRing, Info, Check, Ban
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useTransactions, useSnapshots, useWallets, migrateLegacyHoldings } from '../lib/prefs.jsx';
import { buildPortfolio, annualised, calendarGrid } from '../lib/portfolio.js';
import { VENUES, chainLabelForAsset, CHAINS } from '../lib/assets.js';
import { SUPPORTED_CHAINS, SYNC_METHODS, TRACKING_LIMITS, fetchWalletBalance, validateAddress, chainMeta } from '../lib/wallets.js';
import { fmtPrice, fmtUsd, cls, timeAgo } from '../lib/format.js';
import { CoinImg, Card, EmptyState } from '../components/ui.jsx';

const TABS = [
  { id: 'holdings', label: 'Holdings', icon: Wallet },
  { id: 'allocation', label: 'Allocation', icon: PieChart },
  { id: 'performance', label: 'Performance', icon: TrendingUp },
  { id: 'tax', label: 'Tax & Calendar', icon: Receipt },
  { id: 'risk', label: 'Risk', icon: Shield },
  { id: 'wallets', label: 'Wallets', icon: Link2 }
];

const SIDES = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
  { id: 'transfer_in', label: 'Transfer in' },
  { id: 'transfer_out', label: 'Transfer out' }
];

const DEFAULT_PORTFOLIO = 'Main';

const fmtPctOr = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

/* Minimal inline SVG equity curve — no chart dependency. */
function EquityChart({ series, height = 160 }) {
  if (!series || series.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough history yet. A snapshot is recorded as you use the app, so this chart fills in over time.
      </p>
    );
  }
  const w = 720;
  const pad = 8;
  const values = series.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? '#34d399' : '#f87171';
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`Portfolio equity from ${fmtUsd(min)} to ${fmtUsd(max)}`}>
      <path d={`${path} L${x(series.length - 1)},${height - pad} L${x(0)},${height - pad} Z`} fill={stroke} opacity="0.12" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Bar({ pct, tone = 'primary' }) {
  const width = Math.max(0, Math.min(100, pct || 0));
  const bg = tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-primary';
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${bg}`} style={{ width: `${width}%` }} />
    </span>
  );
}

export default function PortfolioPage() {
  const { rows, byId } = useMarket();
  const [txs, txApi] = useTransactions();
  const [snapshots, snapApi] = useSnapshots();
  const [wallets, walletApi] = useWallets();

  const [tab, setTab] = useState('holdings');
  const [portfolio, setPortfolio] = useState('All');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ coinId: '', side: 'buy', amount: '', price: '', fee: '', date: '', venue: '', chain: '', note: '', portfolio: '' });
  const [formErr, setFormErr] = useState(null);
  const [walletForm, setWalletForm] = useState({ chain: 'bitcoin', address: '', label: '' });
  const [walletStates, setWalletStates] = useState({});
  const [walletBusy, setWalletBusy] = useState(false);
  const [alertForm, setAlertForm] = useState({ type: 'portfolio_value_above', value: '' });
  const [alertMsg, setAlertMsg] = useState(null);

  /* One-time migration of the old { amount, buyPrice } holdings list. */
  useEffect(() => {
    const migrated = migrateLegacyHoldings();
    if (migrated.length) txApi.importMany(migrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const top = useMemo(() => [...(rows || [])].sort((a, b) => b.mcap - a.mcap).slice(0, 150), [rows]);

  const portfolios = useMemo(() => {
    const set = new Set([DEFAULT_PORTFOLIO]);
    txs.forEach((t) => set.add(t.portfolio || DEFAULT_PORTFOLIO));
    return [...set];
  }, [txs]);

  const active = useMemo(
    () => (portfolio === 'All' ? txs : txs.filter((t) => (t.portfolio || DEFAULT_PORTFOLIO) === portfolio)),
    [txs, portfolio]
  );

  const priceById = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { m[r.id] = r.price; });
    return m;
  }, [rows]);

  const metaById = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { m[r.id] = { symbol: r.symbol, name: r.name, image: r.image }; });
    return m;
  }, [rows]);

  const venueLabel = useCallback((id) => VENUES.find((v) => v.id === id)?.name || id, []);

  const data = useMemo(
    () => buildPortfolio({
      transactions: active,
      priceById,
      metaById,
      chainOf: (coinId) => chainLabelForAsset(coinId),
      venueLabelOf: venueLabel,
      equitySeries: snapshots
    }),
    [active, priceById, metaById, venueLabel, snapshots]
  );

  /* Record an hourly equity snapshot while the page is open. */
  const totalsValue = data.totals.value;
  useEffect(() => {
    if (!data.totals.positions || !totalsValue) return;
    snapApi.record({ t: Date.now(), v: totalsValue });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalsValue]);

  const ann = useMemo(() => {
    const first = data.equity.first;
    if (!first) return annualised({ roiPct: null, days: null });
    const days = (Date.now() - first.t) / 86400000;
    return annualised({ roiPct: data.equity.changePct, days });
  }, [data.equity]);

  const unrealizedPct = data.totals.costBasis > 0
    ? (data.totals.unrealized / data.totals.costBasis) * 100
    : null;

  /* ---------------- actions ---------------- */
  const submitTx = () => {
    const amt = parseFloat(form.amount);
    if (!form.coinId || !(amt > 0)) { setFormErr('Choose a coin and enter an amount greater than 0.'); return; }
    const needsPrice = form.side === 'buy' || form.side === 'sell';
    const price = parseFloat(form.price);
    if (needsPrice && !(price >= 0)) { setFormErr('Enter the unit price for a buy or a sell.'); return; }
    const r = byId[form.coinId];
    txApi.add({
      coinId: form.coinId,
      symbol: r?.symbol || null,
      side: form.side,
      amount: amt,
      price: Number.isFinite(price) ? price : null,
      fee: parseFloat(form.fee) || 0,
      at: form.date ? new Date(form.date).getTime() : Date.now(),
      venue: form.venue || null,
      chain: form.chain || null,
      note: form.note || null,
      // Defaults to the portfolio currently being viewed; "All" needs a name.
      portfolio: (form.portfolio || '').trim() || (portfolio === 'All' ? DEFAULT_PORTFOLIO : portfolio)
    });
    setOpen(false);
    setForm({ coinId: '', side: 'buy', amount: '', price: '', fee: '', date: '', venue: '', chain: '', note: '', portfolio: '' });
    setFormErr(null);
  };

  const exportHoldings = () => {
    const head = 'Coin,Symbol,Portfolio,Amount,Avg Entry,Current Price,Cost Basis,Value,Unrealized,Realized,Total P&L,ROI %,Weight %\n';
    const body = data.positions.map((p) => [
      p.name || '', p.symbol || '', portfolio, p.amount, p.avgEntry ?? '', p.price ?? '',
      p.costBasis.toFixed(2), p.value ?? '', p.unrealized ?? '', p.realized.toFixed(2),
      p.totalPnl ?? '', p.roiPct?.toFixed(2) ?? '', p.weightPct?.toFixed(2) ?? ''
    ].join(',')).join('\n');
    downloadCsv(head + body, 'cryptox-portfolio.csv');
  };

  const exportTax = () => {
    const head = 'Disposed At,Coin,Amount,Proceeds,Cost Basis,Gain,Gain %,Holding Days,Term,Cost Basis Known\n';
    const body = data.tax.map((t) => [
      new Date(t.disposedAt).toISOString().slice(0, 10), t.symbol || t.coinId, t.amount,
      t.proceeds?.toFixed(2) ?? '', t.costBasis?.toFixed(2) ?? '', t.gain?.toFixed(2) ?? '',
      t.gainPct?.toFixed(2) ?? '', t.holdingDays ?? '', t.term, t.basisKnown
    ].join(',')).join('\n');
    downloadCsv(head + body, 'cryptox-tax-lots.csv');
  };

  const refreshWallets = async () => {
    setWalletBusy(true);
    const next = { ...walletStates };
    for (const w of wallets) {
      next[w.id] = { status: 'loading' };
      setWalletStates({ ...next });
      const res = await fetchWalletBalance(w.chain, w.address);
      next[w.id] = res;
      setWalletStates({ ...next });
    }
    setWalletBusy(false);
  };

  const addWallet = () => {
    const check = validateAddress(walletForm.chain, walletForm.address);
    if (!check.ok) { setWalletStates((s) => ({ ...s, __form: { error: check.reason } })); return; }
    walletApi.add({ chain: walletForm.chain, address: check.address, label: walletForm.label || chainMeta(walletForm.chain)?.name });
    setWalletForm({ chain: walletForm.chain, address: '', label: '' });
    setWalletStates((s) => ({ ...s, __form: { error: null } }));
  };

  const createPortfolioAlert = () => {
    const v = parseFloat(alertForm.value);
    if (!(v > 0)) { setAlertMsg({ ok: false, text: 'Enter a positive threshold.' }); return; }
    const raw = localStorage.getItem('cx_alerts');
    let list = [];
    try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list.push({
      id: `pf-${Date.now().toString(36)}`,
      symbol: 'PORTFOLIO',
      name: 'Portfolio',
      rule: { type: alertForm.type, value: v, symbol: 'PORTFOLIO' },
      cooldownMs: 300000,
      enabled: true,
      at: Date.now()
    });
    localStorage.setItem('cx_alerts', JSON.stringify(list));
    setAlertMsg({ ok: true, text: `Alert created. Manage it on the Alerts page.` });
    setAlertForm({ ...alertForm, value: '' });
  };

  const hasPositions = data.positions.length > 0;
  const selectedCoin = byId[form.coinId];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Portfolio</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Manual portfolios with FIFO lots, cost basis, realized and unrealized P&L, allocation, tax lots, a P/L
            calendar and risk — all computed locally from your own entries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={portfolio} onChange={(e) => setPortfolio(e.target.value)} className="input-dark !h-9 !w-auto !text-xs" aria-label="Portfolio">
            <option value="All">All portfolios</option>
            {portfolios.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={exportHoldings} className="btn-ghost !h-9 !px-3 !text-xs" disabled={!hasPositions}><Download size={13} /> Holdings CSV</button>
          <button onClick={() => { setFormErr(null); setOpen(true); }} className="btn-primary !h-9 px-3 !text-xs"><Plus size={14} /> Add transaction</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        {[
          ['Total value', fmtUsd(data.totals.value), null],
          ['Cost basis', fmtUsd(data.totals.costBasis), null],
          ['Unrealized', `${data.totals.unrealized >= 0 ? '+' : ''}${fmtUsd(data.totals.unrealized)}`, data.totals.unrealized],
          ['Realized', `${data.totals.realized >= 0 ? '+' : ''}${fmtUsd(data.totals.realized)}`, data.totals.realized],
          ['Total P&L', `${data.totals.totalPnl >= 0 ? '+' : ''}${fmtUsd(data.totals.totalPnl)}`, data.totals.totalPnl],
          ['ROI', fmtPctOr(data.totals.roiPct), data.totals.roiPct],
          ['Unrealized %', fmtPctOr(unrealizedPct), unrealizedPct],
          ['Positions', data.totals.positions, null]
        ].map(([label, value, tone]) => (
          <Card key={label} className="!p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`num mt-1 text-lg font-bold ${tone == null ? '' : cls(tone)}`}>{value}</p>
          </Card>
        ))}
      </div>

      {/* Warnings from the lot engine — never hidden */}
      {data.warnings.length ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-primary"><AlertTriangle size={14} /> Cost-basis warnings</p>
          <ul className="mt-2 space-y-1">
            {data.warnings.slice(0, 6).map((w, i) => (
              <li key={`${w.kind}-${w.coinId}-${i}`} className="text-[11px] text-muted-foreground">
                <b className="text-foreground">{metaById[w.coinId]?.symbol || w.coinId}</b> — {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${on ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {!txs.length ? (
        <Card>
          <EmptyState
            icon={<Wallet size={28} className="text-muted-foreground" />}
            title="No transactions yet"
            sub="Add each buy, sell and transfer. Every figure in this page is derived from that history."
            action={<button onClick={() => setOpen(true)} className="btn-primary"><Plus size={15} /> Add transaction</button>}
          />
        </Card>
      ) : null}

      {/* ---------------- Holdings ---------------- */}
      {txs.length && tab === 'holdings' ? (
        <>
          {!hasPositions ? (
            <Card><p className="py-6 text-center text-sm text-muted-foreground">No open positions — everything has been sold or transferred out.</p></Card>
          ) : (
            <Card className="!p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 font-semibold">Asset</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Avg entry</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Value</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Unrealized</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Realized</th>
                      <th className="px-3 py-2.5 text-right font-semibold">ROI</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Weight</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={p.coinId} className="border-b border-border last:border-0 hover:bg-accent/30">
                        <td className="px-4 py-2.5">
                          <Link to={`/coin/${p.coinId}`} className="flex items-center gap-2.5">
                            <CoinImg src={p.image || byId[p.coinId]?.image} symbol={p.symbol || p.coinId} size={24} />
                            <span>
                              {p.name || p.coinId}
                              <span className="ml-1.5 text-xs text-muted-foreground">{p.symbol}</span>
                              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {chainLabelForAsset(p.coinId)}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num px-3 py-2.5 text-right">{p.amount.toPrecision(6)}</td>
                        <td className="num px-3 py-2.5 text-right text-muted-foreground">{p.avgEntry == null ? '—' : fmtPrice(p.avgEntry)}</td>
                        <td className="num px-3 py-2.5 text-right">{p.price == null ? '—' : fmtPrice(p.price)}</td>
                        <td className="num px-3 py-2.5 text-right font-medium">{p.value == null ? '—' : fmtUsd(p.value)}</td>
                        <td className={`num px-3 py-2.5 text-right font-semibold ${cls(p.unrealized)}`}>
                          {p.unrealized == null ? '—' : `${p.unrealized >= 0 ? '+' : ''}${fmtUsd(p.unrealized)}`}
                        </td>
                        <td className={`num px-3 py-2.5 text-right ${cls(p.realized)}`}>
                          {p.realized ? `${p.realized >= 0 ? '+' : ''}${fmtUsd(p.realized)}` : '—'}
                        </td>
                        <td className={`num px-3 py-2.5 text-right ${cls(p.roiPct)}`}>{fmtPctOr(p.roiPct)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="num text-xs">{p.weightPct == null ? '—' : `${p.weightPct.toFixed(1)}%`}</span>
                          <span className="mt-1 block w-16"><Bar pct={p.weightPct} /></span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => {
                              const last = [...active].filter((t) => t.coinId === p.coinId).sort((a, b) => b.at - a.at)[0];
                              if (last) txApi.remove(last.id);
                            }}
                            title="Remove the most recent transaction for this asset"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-down/10 hover:text-down"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Transaction history */}
          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Transaction history <span className="text-xs font-normal text-muted-foreground">({active.length})</span></p>
              {/* Clears only what is currently in view, so one portfolio cannot wipe another. */}
              <button
                onClick={() => active.forEach((t) => txApi.remove(t.id))}
                className="btn-ghost !h-8 !px-2.5 !text-[11px]"
              >
                <Trash2 size={12} /> Clear {portfolio === 'All' ? 'all portfolios' : portfolio}
              </button>
            </div>
            <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
              {[...active].sort((a, b) => b.at - a.at).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      t.side === 'buy' ? 'bg-up/15 text-up' : t.side === 'sell' ? 'bg-down/15 text-down' : 'bg-muted text-muted-foreground'
                    }`}>{t.side.replace('_', ' ')}</span>
                    <b>{metaById[t.coinId]?.symbol || t.coinId}</b>
                    <span className="num text-muted-foreground">{t.amount} @ {t.price == null ? '—' : fmtPrice(t.price)}</span>
                    {t.venue ? <span className="hidden text-muted-foreground sm:inline">· {venueLabel(t.venue)}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                    <span>{timeAgo(t.at)}</span>
                    <button onClick={() => txApi.remove(t.id)} className="rounded p-1 hover:bg-down/10 hover:text-down"><X size={12} /></button>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {/* ---------------- Allocation ---------------- */}
      {txs.length && tab === 'allocation' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {[
            { title: 'By asset', data: { rows: data.positions.map((p) => ({ key: p.symbol || p.coinId, value: p.value || 0, weightPct: p.weightPct, costBasis: p.costBasis })), total: data.totals.value } },
            { title: 'By chain', data: data.byChain },
            { title: 'By custody venue', data: data.byVenue }
          ].map(({ title, data: block }) => (
            <Card key={title} className="!p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{block.rows.length} bucket{block.rows.length === 1 ? '' : 's'} · {fmtUsd(block.total)}</p>
              </div>
              {!block.rows.length ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing to allocate.</p>
              ) : (
                <div className="divide-y divide-border/60">
                  {block.rows.map((r) => (
                    <div key={r.key} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{r.key}</span>
                        <span className="num shrink-0 text-muted-foreground">
                          {r.weightPct == null ? '—' : `${r.weightPct.toFixed(1)}%`} · {fmtUsd(r.value)}
                        </span>
                      </div>
                      <span className="mt-1.5 block"><Bar pct={r.weightPct} /></span>
                    </div>
                  ))}
                </div>
              )}
              {title === 'By custody venue' ? (
                <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  Allocated per LOT, so a coin held on two exchanges is split rather than merged.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {/* ---------------- Performance ---------------- */}
      {txs.length && tab === 'performance' ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Portfolio value history</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} · one point per hour while the app is open
                </p>
              </div>
              <button onClick={snapApi.clear} className="btn-ghost !h-8 !px-2.5 !text-[11px]"><Trash2 size={12} /> Reset history</button>
            </div>
            <div className="mt-3"><EquityChart series={snapshots} /></div>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="!p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Annualised (APR / APY)</p>
              {ann.annualisable ? (
                <>
                  <p className="num mt-1 text-xl font-bold">{fmtPctOr(ann.apr)} <span className="text-sm text-muted-foreground">APR</span></p>
                  <p className="num text-sm text-muted-foreground">{fmtPctOr(ann.apy)} APY · over {Math.round(ann.days)} days</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Needs at least a full day of history before annualising.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Naive annualisation of the holding-period return — not a money-weighted (IRR) figure, and it ignores the
                timing of your deposits and withdrawals.
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Max drawdown</p>
              <p className="num mt-1 text-xl font-bold text-down">
                {data.equity.maxDrawdownPct == null ? '—' : `${data.equity.maxDrawdownPct.toFixed(2)}%`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {data.equity.insufficient ? 'Not enough snapshots yet.' : 'Largest peak-to-trough fall in recorded value.'}
              </p>
            </Card>
            <Card className="!p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Change since first snapshot</p>
              <p className={`num mt-1 text-xl font-bold ${cls(data.equity.changePct)}`}>{fmtPctOr(data.equity.changePct)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {data.equity.first ? `Since ${new Date(data.equity.first.t).toLocaleDateString()}` : 'No snapshots yet.'}
              </p>
            </Card>
          </div>

          <Card>
            <p className="flex items-center gap-2 text-sm font-semibold"><BellRing size={15} className="text-primary" /> Portfolio value alerts</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Fires when your total portfolio value crosses a threshold. Evaluated on the Alerts page against live prices.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Condition</p>
                <select value={alertForm.type} onChange={(e) => setAlertForm({ ...alertForm, type: e.target.value })} className="input-dark !h-9 !w-auto !text-xs">
                  <option value="portfolio_value_above">Value rises above</option>
                  <option value="portfolio_value_below">Value falls below</option>
                </select>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Threshold (USD)</p>
                <input type="number" step="any" value={alertForm.value} onChange={(e) => setAlertForm({ ...alertForm, value: e.target.value })} placeholder="10000" className="input-dark !h-9 !w-40 !text-xs num" />
              </div>
              <button onClick={createPortfolioAlert} className="btn-primary !h-9 px-3 !text-xs"><Plus size={13} /> Create alert</button>
              <Link to="/alerts" className="text-xs font-medium text-primary hover:underline">Manage alerts</Link>
            </div>
            {alertMsg ? (
              <p className={`mt-2 text-[11px] ${alertMsg.ok ? 'text-up' : 'text-down'}`}>{alertMsg.text}</p>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* ---------------- Tax & calendar ---------------- */}
      {txs.length && tab === 'tax' ? (
        <>
          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Tax lots (FIFO disposals)</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  One row per sale, oldest lot consumed first. Fees reduce proceeds; buys include their fee in basis.
                </p>
              </div>
              <button onClick={exportTax} className="btn-ghost !h-8 !px-2.5 !text-[11px]" disabled={!data.tax.length}><Download size={12} /> Tax CSV</button>
            </div>
            {!data.tax.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No disposals recorded, so there are no taxable events to report.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Disposed</th>
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 text-right font-medium">Amount</th>
                      <th className="px-4 py-2 text-right font-medium">Proceeds</th>
                      <th className="px-4 py-2 text-right font-medium">Cost basis</th>
                      <th className="px-4 py-2 text-right font-medium">Gain</th>
                      <th className="px-4 py-2 text-right font-medium">Held</th>
                      <th className="px-4 py-2 font-medium">Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tax.slice(0, 100).map((t, i) => (
                      <tr key={`${t.disposedAt}-${t.coinId}-${i}`} className="border-t border-border/60">
                        <td className="px-4 py-2 text-muted-foreground">{new Date(t.disposedAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2 font-semibold">{t.symbol || t.coinId}</td>
                        <td className="num px-4 py-2 text-right">{t.amount.toPrecision(6)}</td>
                        <td className="num px-4 py-2 text-right">{t.proceeds == null ? '—' : fmtUsd(t.proceeds)}</td>
                        <td className="num px-4 py-2 text-right">{fmtUsd(t.costBasis)}</td>
                        <td className={`num px-4 py-2 text-right font-semibold ${cls(t.gain)}`}>
                          {t.gain == null ? '—' : `${t.gain >= 0 ? '+' : ''}${fmtUsd(t.gain)}`}
                          {t.gainPct != null ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">({fmtPctOr(t.gainPct, 1)})</span> : null}
                        </td>
                        <td className="num px-4 py-2 text-right text-muted-foreground">{t.holdingDays == null ? '—' : `${t.holdingDays}d`}</td>
                        <td className="px-4 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            t.term === 'long' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                          }`}>{t.term}{t.basisKnown ? '' : ' *'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <Info size={12} className="mr-1 inline" />
              FIFO is one common convention; your jurisdiction may require a different method. A <b>*</b> marks a disposal
              whose cost basis is incomplete (for example units transferred in without a stated cost). This is a record-keeping
              tool, not tax advice.
            </p>
          </Card>

          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Profit / loss calendar</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Realized P&L per day · {data.calendar.monthly.count} disposal{data.calendar.monthly.count === 1 ? '' : 's'} ·{' '}
                <span className={cls(data.calendar.monthly.gain)}>total {fmtUsd(data.calendar.monthly.gain)}</span>
              </p>
            </div>
            {!Object.keys(data.calendar.days).length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No realized P&L recorded yet.</p>
            ) : (
              <CalendarView days={data.calendar.days} />
            )}
          </Card>
        </>
      ) : null}

      {/* ---------------- Risk ---------------- */}
      {txs.length && tab === 'risk' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Card className="!p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Concentration (HHI)</p>
            <p className="num mt-1 text-2xl font-bold">{data.risk.hhi ? data.risk.hhi.toFixed(3) : '—'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.risk.concentrationLabel || 'No positions'} · effective positions{' '}
              <b className="text-foreground">{data.risk.effectivePositions ? data.risk.effectivePositions.toFixed(2) : '—'}</b>
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Sum of squared weights. 1.00 = everything in one asset; lower is more diversified.
            </p>
          </Card>

          <Card className="!p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Largest positions</p>
            <p className="num mt-1 text-2xl font-bold">{data.risk.top1Pct == null ? '—' : `${data.risk.top1Pct.toFixed(1)}%`}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Top holding: <b className="text-foreground">{data.risk.top1 || '—'}</b> · top 3{' '}
              {data.risk.top3Pct == null ? '—' : `${data.risk.top3Pct.toFixed(1)}%`}
            </p>
            <span className="mt-2 block"><Bar pct={data.risk.top1Pct} tone={data.risk.top1Pct > 50 ? 'down' : 'primary'} /></span>
          </Card>

          <Card className="!p-4 md:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Weighted daily volatility</p>
            <p className="num mt-1 text-2xl font-bold">
              {data.risk.weightedDailyVolPct == null ? '—' : `${data.risk.weightedDailyVolPct.toFixed(2)}%`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Coverage: <b className="text-foreground">{data.risk.volCoveragePct ? `${data.risk.volCoveragePct.toFixed(0)}%` : '0%'}</b> of
              portfolio value has price history available.
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Weighted average of each coin's own volatility. <b>Correlation between assets is not modelled</b>, so real
                portfolio risk will be higher than this number suggests. Exposure coverage improves as more history is
                gathered by the charting and scanner pages.
              </span>
            </p>
          </Card>

          <Card className="!p-4 md:col-span-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Drawdown from recorded history</p>
            <p className="num mt-1 text-2xl font-bold text-down">
              {data.equity.maxDrawdownPct == null ? '—' : `${data.equity.maxDrawdownPct.toFixed(2)}%`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Peak {data.equity.peak == null ? '—' : fmtUsd(data.equity.peak)} · current drawdown{' '}
              {data.equity.currentDrawdownPct == null ? '—' : `${data.equity.currentDrawdownPct.toFixed(2)}%`}
            </p>
          </Card>
        </div>
      ) : null}

      {/* ---------------- Wallets ---------------- */}
      {tab === 'wallets' ? (
        <>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Shield size={14} className="mt-0.5 shrink-0 text-primary" />
              <span>
                <b className="text-foreground">Read-only, public addresses only.</b> CryptoX never asks for a seed phrase,
                private key or exchange API secret, and cannot sign or move funds. There is nothing here to compromise.
              </span>
            </p>
          </div>

          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Watched addresses <span className="text-xs font-normal text-muted-foreground">({wallets.length})</span></p>
              <button onClick={refreshWallets} disabled={walletBusy || !wallets.length} className="btn-ghost !h-8 !px-2.5 !text-[11px]">
                {walletBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh balances
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Chain</p>
                <select value={walletForm.chain} onChange={(e) => setWalletForm({ ...walletForm, chain: e.target.value })} className="input-dark !h-9 !w-auto !text-xs">
                  {SUPPORTED_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="min-w-[16rem] flex-1">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Public address</p>
                <input
                  value={walletForm.address}
                  onChange={(e) => setWalletForm({ ...walletForm, address: e.target.value })}
                  placeholder="Paste a public address"
                  className="input-dark !h-9 !text-xs"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Label (optional)</p>
                <input value={walletForm.label} onChange={(e) => setWalletForm({ ...walletForm, label: e.target.value })} placeholder="Cold storage" className="input-dark !h-9 !w-40 !text-xs" />
              </div>
              <button onClick={addWallet} className="btn-primary !h-9 px-3 !text-xs"><Plus size={13} /> Watch</button>
            </div>

            {walletStates.__form?.error ? (
              <p className="border-b border-border px-4 py-2 text-[11px] text-down">{walletStates.__form.error}</p>
            ) : null}

            {!wallets.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No addresses watched yet. Balances are read from public endpoints — no account or key needed.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {wallets.map((w) => {
                  const st = walletStates[w.id];
                  return (
                    <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-xs font-semibold">
                          {w.label || chainMeta(w.chain)?.name}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{chainMeta(w.chain)?.name || w.chain}</span>
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{w.address}</p>
                        {st?.status === 'error' ? (
                          <p className="mt-1 text-[11px] text-down">{st.error}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="num text-right text-sm font-semibold">
                          {!st ? <span className="text-muted-foreground">not loaded</span>
                            : st.status === 'loading' ? <Loader2 size={13} className="animate-spin text-muted-foreground" />
                              : st.balance == null ? <span className="text-muted-foreground">—</span>
                                : `${st.balance.toPrecision(8)} ${st.unit || chainMeta(w.chain)?.unit || ''}`}
                        </span>
                        <button onClick={() => walletApi.remove(w.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-down/10 hover:text-down"><X size={14} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <Info size={12} className="mr-1 inline" />
              Watched balances are shown for information only and are <b>not</b> added to your portfolio totals or cost basis —
              a spot balance has no acquisition history to derive basis from.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="!p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold"><Layers size={15} className="text-primary" /> Sync methods</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">What each connection can honestly do in a client-only app.</p>
              </div>
              <div className="divide-y divide-border/60">
                {SYNC_METHODS.map((m) => (
                  <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${m.available ? 'bg-up/15 text-up' : 'bg-muted text-muted-foreground'}`}>
                      {m.available ? <Check size={12} /> : <Ban size={12} />}
                    </span>
                    <div>
                      <p className="text-xs font-semibold">{m.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{m.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="!p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={15} className="text-primary" /> Tracking limits</p>
              <ul className="mt-2 space-y-2">
                {TRACKING_LIMITS.map((l) => (
                  <li key={l} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    {l}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      ) : null}

      {/* ---------------- Add transaction modal ---------------- */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Add transaction</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Type</p>
                <div className="grid grid-cols-4 gap-1 rounded-lg border border-input bg-background p-0.5">
                  {SIDES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setForm({ ...form, side: s.id })}
                      className={`rounded-md py-2 text-[11px] font-semibold ${form.side === s.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Coin</p>
                <select
                  value={form.coinId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const r = byId[id];
                    setForm({ ...form, coinId: id, price: r?.price ? String(r.price) : form.price });
                  }}
                  className="input-dark !h-10"
                >
                  <option value="">Choose…</option>
                  {top.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.symbol})</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Amount</p>
                  <input type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" className="input-dark !h-10 num" />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Unit price (USD){form.side.startsWith('transfer') ? ' — optional basis' : ''}
                  </p>
                  <input type="number" step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder={form.side.startsWith('transfer') ? 'leave blank if unknown' : '0.00'} className="input-dark !h-10 num" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Fee (USD)</p>
                  <input type="number" step="any" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="0.00" className="input-dark !h-10 num" />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Date</p>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-dark !h-10 !text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Custody venue</p>
                  <select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} className="input-dark !h-10 !text-xs">
                    <option value="">Unassigned</option>
                    {VENUES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Chain</p>
                  <select value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} className="input-dark !h-10 !text-xs">
                    <option value="">Auto from asset</option>
                    {Object.entries(CHAINS).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Portfolio</p>
                <input
                  value={form.portfolio || (portfolio === 'All' ? DEFAULT_PORTFOLIO : portfolio)}
                  onChange={(e) => setForm({ ...form, portfolio: e.target.value })}
                  placeholder="Main"
                  className="input-dark !h-10 !text-xs"
                />
              </div>

              {selectedCoin ? (
                <p className="text-[11px] text-muted-foreground">
                  {selectedCoin.name} trades at <span className="num text-foreground">{fmtPrice(selectedCoin.price)}</span> right now.
                </p>
              ) : null}

              {formErr ? (
                <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{formErr}</p>
              ) : null}

              <button onClick={submitTx} className="btn-primary w-full !h-10" disabled={!form.coinId}>Save transaction</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Month grid with realized P&L per day. */
function CalendarView({ days }) {
  const [cursor, setCursor] = useState(() => {
    const keys = Object.keys(days).sort();
    const base = keys.length ? new Date(days[keys[keys.length - 1]].at) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  // Uses the unit-tested grid builder so month layout logic lives in one place.
  const cells = useMemo(() => calendarGrid(cursor.year, cursor.month), [cursor]);

  const monthTotal = Object.values(days)
    .filter((c) => {
      const d = new Date(c.at);
      return d.getFullYear() === cursor.year && d.getMonth() === cursor.month;
    })
    .reduce((a, c) => a + c.gain, 0);

  const shift = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold">
          {new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <span className="flex items-center gap-2">
          <span className={`num text-xs font-semibold ${cls(monthTotal)}`}>
            {monthTotal >= 0 ? '+' : ''}{fmtUsd(monthTotal)}
          </span>
          <button onClick={() => shift(-1)} className="btn-ghost !h-7 !px-2 !text-[11px]">‹</button>
          <button onClick={() => shift(1)} className="btn-ghost !h-7 !px-2 !text-[11px]">›</button>
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <span key={`pad-${i}`} className="h-14 rounded-lg" />;
          const cell = days[c.key];
          const tone = !cell ? 'bg-muted/20' : cell.gain >= 0 ? 'bg-up/15' : 'bg-down/15';
          return (
            <span
              key={c.key}
              title={cell ? `${cell.count} disposal(s) · ${fmtUsd(cell.gain)}` : 'No disposals'}
              className={`flex h-14 flex-col items-center justify-center rounded-lg border border-border/60 ${tone}`}
            >
              <span className="text-[10px] text-muted-foreground">{c.day}</span>
              {cell ? (
                <span className={`num text-[10px] font-semibold ${cls(cell.gain)}`}>
                  {cell.gain >= 0 ? '+' : ''}{cell.gain >= 1000 || cell.gain <= -1000
                    ? `${(cell.gain / 1000).toFixed(1)}k`
                    : cell.gain.toFixed(0)}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
