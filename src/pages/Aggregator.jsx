import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers, RefreshCw, Loader2, AlertTriangle, Trophy, ArrowRightLeft, Info, Gauge,
  Grid3x3, Crosshair, Droplets
} from 'lucide-react';
import { fetchAllVenues } from '../lib/sources.js';
import { assetById, VENUES as ALL_VENUES } from '../lib/assets.js';
import { useMarket } from '../lib/market.jsx';
import { aggregateVenues, summariseAggregate, priceMatrix } from '../lib/aggregator.js';
import { Card, EmptyState, CoinImg } from '../components/ui.jsx';
import { fmtPrice, fmtCompact, timeAgo } from '../lib/format.js';

const THRESHOLDS = [
  { label: '0.05% (tight)', value: 0.05 },
  { label: '0.25%', value: 0.25 },
  { label: '0.50%', value: 0.5 },
  { label: '1.00% (wide)', value: 1 }
];

const FEES = [
  { label: '0.10% taker ×2', value: 0.1 },
  { label: '0.20% taker ×2', value: 0.2 },
  { label: '0.50% taker ×2', value: 0.5 }
];

const fmtPct = (n, d = 3) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`);

export default function AggregatorPage() {
  const { byId: coinsById } = useMarket();
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [auto, setAuto] = useState(true);
  const [minGrossPct, setMinGrossPct] = useState(0.05);
  const [feePct, setFeePct] = useState(0.1);
  const [onlyProfitable, setOnlyProfitable] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const results = await fetchAllVenues();
      if (!mounted.current) return;
      setSources(results);
      setLastRun(Date.now());
    } catch (e) {
      if (mounted.current) setErr(e?.message || 'Venue aggregation failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  useEffect(() => {
    if (!auto) return undefined;
    const iv = window.setInterval(run, 60000);
    return () => window.clearInterval(iv);
  }, [auto, run]);

  const venueName = useMemo(() => {
    const m = {};
    sources.forEach((s) => { m[s.venueId] = s.name || s.venueId; });
    return m;
  }, [sources]);

  const nameOf = useCallback((id) => venueName[id] || id, [venueName]);

  /* Real logo from the live market feed; CoinImg falls back to a letter avatar. */
  const imgFor = useCallback(
    (assetId) => coinsById?.[assetById(assetId)?.cg || assetId]?.image || undefined,
    [coinsById]
  );

  /* Group the normalized venue quotes by canonical asset. */
  const rows = useMemo(() => {
    const byAsset = new Map();
    sources.forEach((s) => {
      (s.quotes || []).forEach((q) => {
        if (!q?.assetId || !Number.isFinite(q.price) || q.price <= 0) return;
        const arr = byAsset.get(q.assetId) || [];
        arr.push(q);
        byAsset.set(q.assetId, arr);
      });
    });
    const out = [];
    for (const [assetId, quotes] of byAsset) {
      const a = assetById(assetId);
      out.push({
        assetId,
        symbol: a?.symbol || quotes[0]?.symbol || assetId,
        name: a?.name || assetId,
        quotes
      });
    }
    return out;
  }, [sources]);

  const agg = useMemo(
    () => aggregateVenues(rows, { arbitrage: { minGrossPct, feePct } }),
    [rows, minGrossPct, feePct]
  );
  const summary = useMemo(() => summariseAggregate(agg), [agg]);

  /* Per-exchange price comparison grid: only venues that actually returned a
   * quote get a column, so empty columns never imply coverage we don't have. */
  const matrix = useMemo(() => {
    const activeIds = ALL_VENUES.map((v) => v.id).filter((id) => rows.some((r) => r.quotes.some((q) => q.venue === id)));
    return priceMatrix(rows, { venueIds: activeIds });
  }, [rows]);

  /* Widest disagreement first — that is what the comparison is for. */
  const matrixRows = useMemo(
    () => [...matrix.rows].sort((a, b) => (b.spreadPct ?? -1) - (a.spreadPct ?? -1)),
    [matrix.rows]
  );

  const sourceVenueLabel = useCallback((id) => ALL_VENUES.find((v) => v.id === id)?.name || id, []);

  /* Assets that quote on 2+ venues — the only ones where comparison is meaningful. */
  const comparable = useMemo(
    () => [...agg.perAsset].filter((r) => r.best?.venues > 1).sort((a, b) => (b.liquidity?.totalVolumeUsd || 0) - (a.liquidity?.totalVolumeUsd || 0)),
    [agg.perAsset]
  );

  const liquidRows = useMemo(
    () => [...agg.perAsset].sort((a, b) => (b.liquidity?.totalVolumeUsd || 0) - (a.liquidity?.totalVolumeUsd || 0)),
    [agg.perAsset]
  );

  const totalContributingVenues = useMemo(
    () => liquidRows.reduce((a, r) => a + (r.liquidity?.volumeVenues || 0), 0),
    [liquidRows]
  );

  const venuesLive = sources.filter((s) => s.status === 'live').length;
  const venuesDown = sources.filter((s) => s.status === 'down').length;

  const opportunities = useMemo(
    () => (onlyProfitable ? agg.opportunities.filter((o) => o.netPct > 0) : agg.opportunities),
    [agg.opportunities, onlyProfitable]
  );

  const bestRows = useMemo(
    () => [...agg.perAsset].filter((r) => r.best?.venues > 1)
      .sort((a, b) => (b.best.spreadPct ?? -1) - (a.best.spreadPct ?? -1)),
    [agg.perAsset]
  );

  const hasData = rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Exchange Aggregator</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            One consolidated view across every connected venue: the cheapest place to buy, the dearest to sell,
            cross-venue price gaps and a venue-by-venue leaderboard — all from normalised public tickers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[#FFC105]" />
            Auto-refresh 60s
          </label>
          <button onClick={run} disabled={loading} className="btn-ghost !h-9 !px-3 !text-xs">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      {/* Honesty gate — this is the single most important thing on the page. */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <b className="text-foreground">These are gross price differences between public last trades — not tradeable profit.</b>{' '}
            They ignore order-book depth, execution latency, withdrawal limits, network/transfer costs and regional restrictions.
            A positive net figure means “worth investigating”, never “guaranteed edge”. Nothing here places an order.
          </span>
        </p>
      </div>

      {err ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {err}
        </div>
      ) : null}

      {lastRun ? (
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          Last aggregation {timeAgo(lastRun)} · {venuesLive}/{sources.length} venues live
          {venuesDown ? ` · ${venuesDown} unreachable (excluded, never back-filled)` : ''}
        </p>
      ) : null}

      {!hasData && !loading ? (
        <Card>
          <EmptyState
            icon={<Layers size={28} className="text-muted-foreground" />}
            title="No venue quotes available yet"
            sub="Aggregation needs at least one reachable public venue. Refresh to try again."
            action={<button onClick={run} className="btn-primary"><RefreshCw size={15} /> Refresh venues</button>}
          />
        </Card>
      ) : null}

      {hasData ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            {[
              ['Venues live', `${venuesLive}/${sources.length || '—'}`],
              ['Assets aggregated', summary.assets],
              ['Multi-venue assets', summary.multiVenueAssets],
              ['Price gaps found', summary.opportunities],
              ['Positive after fees', summary.profitableAfterFees],
              ['Avg cross-venue spread', fmtPct(summary.avgCrossVenueSpreadPct)],
              ['Best net gap', fmtPct(summary.bestNetPct)],
              ['Comparable 24h volume', summary.comparableVolumeUsd ? fmtCompact(summary.comparableVolumeUsd) : 'n/a']
            ].map(([label, value]) => (
              <Card key={label} className="!p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="num mt-1 text-xl font-bold">{value}</p>
              </Card>
            ))}
          </div>

          {/* Controls */}
          <Card className="!p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Minimum gross gap</p>
                <select
                  value={minGrossPct}
                  onChange={(e) => setMinGrossPct(Number(e.target.value))}
                  className="input-dark !h-9 !w-auto !text-xs"
                >
                  {THRESHOLDS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Assumed round-trip fee</p>
                <select
                  value={feePct}
                  onChange={(e) => setFeePct(Number(e.target.value))}
                  className="input-dark !h-9 !w-auto !text-xs"
                >
                  {FEES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyProfitable}
                  onChange={(e) => setOnlyProfitable(e.target.checked)}
                  className="accent-[#FFC105]"
                />
                Only show gaps that survive fees
              </label>
              <p className="pb-2 text-[11px] text-muted-foreground">
                <Info size={12} className="mr-1 inline" />
                Fees are a flat assumption you choose — real fees depend on venue, tier and pair.
              </p>
            </div>
          </Card>

          {/* Arbitrage monitor */}
          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ArrowRightLeft size={15} className="text-primary" /> Cross-Venue Price Gaps
                <span className="text-xs font-normal text-muted-foreground">({opportunities.length})</span>
              </p>
            </div>
            {!opportunities.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No gaps above {minGrossPct}% right now. Venues are currently aligned{onlyProfitable ? ' after fees' : ''}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 font-medium">Buy at</th>
                      <th className="px-4 py-2 font-medium">Sell at</th>
                      <th className="px-4 py-2 text-right font-medium">Gross</th>
                      <th className="px-4 py-2 text-right font-medium">Net after fees</th>
                      <th className="px-4 py-2 text-right font-medium">Per $10k</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.slice(0, 60).map((o) => (
                      <tr key={`${o.assetId}-${o.buyVenue}-${o.sellVenue}`} className="border-t border-border/60">
                        <td className="px-4 py-2">
                          <Link to={`/coin/${o.assetId}`} className="flex items-center gap-2 font-semibold hover:text-primary">
                            <CoinImg src={imgFor(o.assetId)} symbol={o.symbol} size={20} />
                            {o.symbol}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-muted-foreground">{nameOf(o.buyVenue)}</span>
                          <span className="num ml-2 font-medium">{fmtPrice(o.buyPrice)}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-muted-foreground">{nameOf(o.sellVenue)}</span>
                          <span className="num ml-2 font-medium">{fmtPrice(o.sellPrice)}</span>
                        </td>
                        <td className="num px-4 py-2 text-right">{fmtPct(o.grossPct)}</td>
                        <td className={`num px-4 py-2 text-right font-semibold ${o.netPct > 0 ? 'text-up' : 'text-down'}`}>
                          {fmtPct(o.netPct)}
                        </td>
                        <td className={`num px-4 py-2 text-right ${o.netPct > 0 ? 'text-up' : 'text-muted-foreground'}`}>
                          {o.notionalPer10k.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              “Per $10k” is the gross cash difference on a $10,000 notional before fees, slippage and transfer costs.
            </p>
          </Card>

          {/* Best buy / sell per asset */}
          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Gauge size={15} className="text-primary" /> Best Buy / Best Sell by Asset
              </p>
              {summary.tightestSpread ? (
                <p className="text-[11px] text-muted-foreground">
                  Tightest: <b className="text-foreground">{summary.tightestSpread.symbol}</b> at {fmtPct(summary.tightestSpread.spreadPct)}
                </p>
              ) : null}
            </div>
            {!bestRows.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No asset is currently quoted on two or more venues.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 font-medium">Best buy (cheapest)</th>
                      <th className="px-4 py-2 font-medium">Best sell (dearest)</th>
                      <th className="px-4 py-2 text-right font-medium">Spread</th>
                      <th className="px-4 py-2 text-right font-medium">Spread %</th>
                      <th className="px-4 py-2 text-right font-medium">Venues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bestRows.slice(0, 60).map((r) => (
                      <tr key={r.assetId} className="border-t border-border/60">
                        <td className="px-4 py-2">
                          <Link to={`/coin/${r.assetId}`} className="flex items-center gap-2 font-semibold hover:text-primary">
                            <CoinImg src={imgFor(r.assetId)} symbol={r.symbol} size={20} />
                            {r.symbol}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-muted-foreground">{nameOf(r.best.bestBuy.venue)}</span>
                          <span className="num ml-2 font-medium text-up">{fmtPrice(r.best.bestBuy.price)}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-muted-foreground">{nameOf(r.best.bestSell.venue)}</span>
                          <span className="num ml-2 font-medium text-down">{fmtPrice(r.best.bestSell.price)}</span>
                        </td>
                        <td className="num px-4 py-2 text-right">{fmtPrice(r.best.spread)}</td>
                        <td className="num px-4 py-2 text-right font-semibold">{fmtPct(r.best.spreadPct)}</td>
                        <td className="num px-4 py-2 text-right text-muted-foreground">{r.best.venues}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Per-exchange price comparison */}
          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Grid3x3 size={15} className="text-primary" /> Per-Exchange Price Comparison
              </p>
              <p className="text-[11px] text-muted-foreground">
                {matrix.venueIds.length} venues quoting · cheapest venue per asset highlighted
              </p>
            </div>
            {!matrix.rows.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No venue prices to compare.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-card px-4 py-2 font-medium">Asset</th>
                      {matrix.venueIds.map((id) => (
                        <th key={id} className="whitespace-nowrap px-3 py-2 text-right font-medium">{sourceVenueLabel(id)}</th>
                      ))}
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-primary">Global avg</th>
                      <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Spread %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.slice(0, 40).map((r) => (
                      <tr key={r.assetId} className="border-t border-border/60">
                        <td className="sticky left-0 z-10 bg-card px-4 py-2">
                          <Link to={`/coin/${r.assetId}`} className="flex items-center gap-2 font-semibold hover:text-primary">
                            <CoinImg src={imgFor(r.assetId)} symbol={r.symbol} size={18} />
                            {r.symbol}
                          </Link>
                        </td>
                        {matrix.venueIds.map((id) => {
                          const p = r.prices[id];
                          const cheapest = p != null && p === r.lowest && r.venueCount > 1;
                          return (
                            <td
                              key={id}
                              className={`num whitespace-nowrap px-3 py-2 text-right ${
                                p == null ? 'text-muted-foreground/40' : cheapest ? 'font-semibold text-up' : ''
                              }`}
                            >
                              {p == null ? '—' : fmtPrice(p)}
                            </td>
                          );
                        })}
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-semibold text-primary">
                          {r.average == null ? '—' : fmtPrice(r.average)}
                        </td>
                        <td className="num whitespace-nowrap px-4 py-2 text-right">{fmtPct(r.spreadPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              “Global avg” is that coin’s cross-venue average price. Green marks the cheapest venue. A dash means the venue does not quote the asset — it is not zero and not missing data we invented.
            </p>
          </Card>

          {/* Best execution venue */}
          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Crosshair size={15} className="text-primary" /> Best Execution Venue
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Where to route a buy (cheapest venue) and a sell (dearest venue) per asset, and how far that price sits from the cross-venue average.
              </p>
            </div>
            {!comparable.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No asset is quoted on two or more venues, so there is nothing to route between.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 font-medium">Route a BUY to</th>
                      <th className="px-4 py-2 font-medium">Route a SELL to</th>
                      <th className="px-4 py-2 text-right font-medium">Global avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparable.slice(0, 40).map((r) => (
                      <tr key={r.assetId} className="border-t border-border/60">
                        <td className="px-4 py-2">
                          <Link to={`/coin/${r.assetId}`} className="flex items-center gap-2 font-semibold hover:text-primary">
                            <CoinImg src={imgFor(r.assetId)} symbol={r.symbol} size={20} />
                            {r.symbol}
                          </Link>
                        </td>
                        {['buy', 'sell'].map((side) => {
                          const ex = r.execution?.[side];
                          if (!ex?.venue) return <td key={side} className="px-4 py-2 text-muted-foreground">—</td>;
                          const good = (ex.deltaPct ?? 0) < 0;
                          return (
                            <td key={side} className="px-4 py-2">
                              <span className="flex flex-wrap items-center gap-2">
                                <b>{nameOf(ex.venue)}</b>
                                <span className="num">{fmtPrice(ex.price)}</span>
                                <span className={`num rounded px-1.5 py-0.5 text-[10px] font-semibold ${good ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>
                                  {ex.deltaPct == null ? '—' : `${ex.deltaPct > 0 ? '+' : ''}${ex.deltaPct.toFixed(3)}% vs avg`}
                                </span>
                              </span>
                            </td>
                          );
                        })}
                        <td className="num px-4 py-2 text-right text-muted-foreground">
                          {r.average?.mean == null ? '—' : fmtPrice(r.average.mean)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              A negative “vs avg” on a buy (or positive on a sell) means the venue beats the cross-venue average price. Routing also depends on fees, transfer time and available size — this is a price comparison only.
            </p>
          </Card>

          {/* Liquidity & volume */}
          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Droplets size={15} className="text-primary" /> Liquidity &amp; Volume
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                24h volume is totalled <b>only</b> across venues that report it in quote currency. Venues publishing base-asset volume are named and excluded rather than blended.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-border p-4 md:grid-cols-4">
              {[
                ['Venues contributing', totalContributingVenues],
                ['Assets with volume data', liquidRows.filter((r) => r.liquidity?.totalVolumeUsd).length],
                ['DEX pool liquidity', summary.poolLiquidityUsd ? fmtCompact(summary.poolLiquidityUsd) : 'none'],
                ['Order-book depth', 'not published']
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="num mt-1 text-lg font-bold">{value}</p>
                </div>
              ))}
            </div>
            {!liquidRows.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No liquidity data available.</p>
            ) : (
              <div className="max-h-[26rem] overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Asset</th>
                      <th className="px-4 py-2 text-right font-medium">Venues</th>
                      <th className="px-4 py-2 text-right font-medium">Comparable 24h volume</th>
                      <th className="px-4 py-2 font-medium">Most active venue</th>
                      <th className="px-4 py-2 text-right font-medium">Top share</th>
                      <th className="px-4 py-2 font-medium">Excluded sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liquidRows.slice(0, 40).map((r) => {
                      const lq = r.liquidity || {};
                      return (
                        <tr key={r.assetId} className="border-t border-border/60">
                          <td className="px-4 py-2">
                            <Link to={`/coin/${r.assetId}`} className="flex items-center gap-2 font-semibold hover:text-primary">
                              <CoinImg src={imgFor(r.assetId)} symbol={r.symbol} size={20} />
                              {r.symbol}
                            </Link>
                          </td>
                          <td className="num px-4 py-2 text-right">{lq.venuesQuoted ?? 0}</td>
                          <td className="num px-4 py-2 text-right">
                            {lq.totalVolumeUsd ? fmtCompact(lq.totalVolumeUsd) : <span className="text-muted-foreground">n/a</span>}
                            {lq.poolLiquidityUsd ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">+ ${fmtCompact(lq.poolLiquidityUsd)} pool</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            {lq.topVenue ? nameOf(lq.topVenue) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="num px-4 py-2 text-right">
                            {lq.topSharePct == null ? '—' : `${lq.topSharePct.toFixed(1)}%`}
                          </td>
                          <td className="px-4 py-2">
                            {lq.nonComparableVenues?.length ? (
                              <span className="text-[11px] text-muted-foreground" title={lq.nonComparableVenues.join(', ')}>
                                {lq.nonComparableVenues.length} venue{lq.nonComparableVenues.length === 1 ? '' : 's'}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">none</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <Info size={12} className="mr-1 inline" />
              Public tickers publish 24h volume, not resting order-book depth. “Top share” shows how concentrated that coin’s reported volume is in one venue — a concentration note, not a depth guarantee. DEX pool liquidity is quoted separately and never added to CEX volume.
            </p>
          </Card>

          {/* Venue leaderboard */}
          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Trophy size={15} className="text-primary" /> Venue Leaderboard
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                “Wins” counts how often a venue held the best price on an asset. Lower average spread means its quote sat
                closer to the cross-venue mid.
              </p>
            </div>
            {!agg.leaderboard.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No venue statistics available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Venue</th>
                      <th className="px-4 py-2 text-right font-medium">Assets</th>
                      <th className="px-4 py-2 text-right font-medium">Best-price wins</th>
                      <th className="px-4 py-2 text-right font-medium">Avg spread (bps)</th>
                      <th className="px-4 py-2 text-right font-medium">Reported 24h volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.leaderboard.map((v, i) => (
                      <tr key={v.venue} className="border-t border-border/60">
                        <td className="num px-4 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2 font-semibold">{nameOf(v.venue)}</td>
                        <td className="num px-4 py-2 text-right">{v.assets}</td>
                        <td className={`num px-4 py-2 text-right font-semibold ${v.wins > 0 ? 'text-up' : 'text-muted-foreground'}`}>
                          {v.wins}
                        </td>
                        <td className="num px-4 py-2 text-right text-muted-foreground">
                          {v.avgSpreadBps == null ? '—' : v.avgSpreadBps.toFixed(1)}
                        </td>
                        <td className="num px-4 py-2 text-right">
                          {v.volumeUsd ? fmtCompact(v.volumeUsd) : (
                            <span className="text-[11px] text-muted-foreground" title={`volume unit: ${v.volumeUnit}`}>
                              not comparable
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Venue health */}
          <Card className="!p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Venue Ingestion Health</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                A venue that fails is excluded entirely — prices are never fabricated to fill a gap.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((s) => (
                <div key={s.venueId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{s.name || s.venueId}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="num text-muted-foreground">{s.quotes?.length || 0} sym</span>
                    <span className="num text-muted-foreground">{s.latencyMs != null ? `${s.latencyMs}ms` : '—'}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      s.status === 'live' ? 'bg-up/15 text-up'
                        : s.status === 'degraded' ? 'bg-primary/15 text-primary'
                          : 'bg-down/15 text-down'
                    }`}>
                      {s.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
