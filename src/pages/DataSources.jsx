import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Database, RefreshCw, Loader2, AlertTriangle, Activity, Radio, Info, Layers } from 'lucide-react';
import { fetchAllVenues, SUPPORTED_VENUES } from '../lib/sources.js';
import { aggregateAsset, qualitySummary, sourceConfidence, isStale } from '../lib/dataQuality.js';
import { ASSETS, VENUES, coverageMatrix } from '../lib/assets.js';
import { useRealtimeEngine, DEFAULT_STREAMS } from '../lib/realtime.js';
import { useDerivatives, useLiquidations } from '../lib/derivatives.js';
import { useWalletEvents } from '../lib/walletEvents.js';
import { useChainHeads } from '../lib/chainHead.js';
import { Reconciler } from '../lib/backpressure.js';
import { fmtPrice, fmtCompact, timeAgo, cls } from '../lib/format.js';
import { CoinImg, Card } from '../components/ui.jsx';

const AUTO_MS = 60000;

function ConfBar({ value }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = v >= 70 ? 'bg-up' : v >= 40 ? 'bg-primary' : 'bg-down';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    live: 'bg-up/15 text-up',
    degraded: 'bg-amber-400/15 text-amber-400',
    down: 'bg-down/15 text-down'
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

export default function DataSourcesPage() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [lastRun, setLastRun] = useState(null);
  const [err, setErr] = useState('');
  const [showDlq, setShowDlq] = useState(false);

  const topRef = useRef({ bid: null, ask: null });
  const reconcilerRef = useRef(new Reconciler());
  const [recon, setRecon] = useState({ checks: 0, mismatches: 0, mismatchRate: 0, worstBps: 0 });

  const onEngineEvent = useCallback(({ stream, data }) => {
    if (stream.includes('depth') && Array.isArray(data?.bids) && data.bids.length && Array.isArray(data?.asks) && data.asks.length) {
      topRef.current = { bid: parseFloat(data.bids[0][0]), ask: parseFloat(data.asks[0][0]) };
    }
  }, []);

  const engine = useRealtimeEngine({ streams: DEFAULT_STREAMS, enabled: true, onEvent: onEngineEvent });
  const derivatives = useDerivatives({ symbol: 'BTCUSDT', enabled: true });
  const liquidations = useLiquidations({ enabled: true, limit: 12 });
  const walletEvents = useWalletEvents({ enabled: true });
  const chainHeads = useChainHeads({ enabled: true });

  /* Data reconciliation: compare the streamed top-of-book with a REST snapshot. */
  useEffect(() => {
    const iv = window.setInterval(async () => {
      const { bid, ask } = topRef.current;
      if (!bid || !ask) return;
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT');
        if (!res.ok) return;
        const j = await res.json();
        reconcilerRef.current.record({ wsBid: bid, wsAsk: ask, restBid: parseFloat(j.bidPrice), restAsk: parseFloat(j.askPrice) });
        setRecon(reconcilerRef.current.summary());
      } catch {
        /* reconciliation is best-effort */
      }
    }, 30000);
    return () => window.clearInterval(iv);
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const now = Date.now();
      const results = await fetchAllVenues();
      const enriched = results.map((r) => ({
        ...r,
        ageSeconds: (now - (r.lastAt || now)) / 1000,
        confidence: sourceConfidence({
          tier: r.tier,
          ageSeconds: (now - (r.lastAt || now)) / 1000,
          quotesReturned: r.quotes.length,
          failed: r.status === 'down'
        })
      }));
      setSources(enriched);
      setLastRun(now);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    if (!auto) return undefined;
    const iv = window.setInterval(run, AUTO_MS);
    return () => window.clearInterval(iv);
  }, [auto, run]);

  const rows = useMemo(() => {
    const now = Date.now();
    const byAsset = new Map();
    sources.forEach((s) => s.quotes.forEach((q) => {
      const arr = byAsset.get(q.assetId) || [];
      arr.push(q);
      byAsset.set(q.assetId, arr);
    }));
    return ASSETS.filter((a) => byAsset.has(a.id)).map((a) => ({
      asset: a,
      ...aggregateAsset(a.id, byAsset.get(a.id), { now })
    }));
  }, [sources]);

  const summary = useMemo(() => qualitySummary(rows, sources), [rows, sources]);
  const matrix = useMemo(() => coverageMatrix(), []);
  const seqStats = engine.sequences();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Database size={22} className="text-primary" /> Market Data Super-Layer
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Multiple exchanges ingested in parallel, normalised to one canonical asset identity, then reconciled into a
            consensus price with outlier, stale-data and confidence scoring.
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

      {lastRun ? (
        <p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          Last ingestion {timeAgo(lastRun)} · {summary.quotesIngested} quotes from {summary.sourcesLive}/{sources.length} venues
        </p>
      ) : null}
      {err ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">{err}</div>
      ) : null}

      {/* Quality summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ['Venues live', `${summary.sourcesLive}/${sources.length || SUPPORTED_VENUES.length}`],
          ['Assets with consensus', summary.assetsWithConsensus],
          ['Quotes ingested', summary.quotesIngested],
          ['Outliers flagged', summary.outliersFlagged],
          ['Stale rejected', summary.staleRejected],
          ['Duplicates merged', summary.duplicatesMerged]
        ].map(([label, value]) => (
          <Card key={label} className="!p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="num mt-1 text-xl font-bold">{value}</p>
          </Card>
        ))}
      </div>

      {/* Sources */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => (
          <Card key={s.venueId} className="!p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radio size={14} className="text-primary" />
                <span className="text-sm font-semibold">{s.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">Tier {s.tier}</span>
              </div>
              <StatusPill status={s.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div>
                <p className="uppercase tracking-wide">Latency</p>
                <p className="num text-foreground">{s.latencyMs} ms</p>
              </div>
              <div>
                <p className="uppercase tracking-wide">Symbols</p>
                <p className="num text-foreground">{s.quotes.length}</p>
              </div>
              <div>
                <p className="uppercase tracking-wide">Updated</p>
                <p className="text-foreground">{s.lastAt ? timeAgo(s.lastAt) : '—'}</p>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Source confidence</span>
                <span className="num">{s.confidence}/100</span>
              </div>
              <ConfBar value={s.confidence} />
            </div>
            {s.error ? <p className="mt-2 text-[11px] text-amber-400">{s.error}</p> : null}
          </Card>
        ))}
      </div>

      {/* Consensus table */}
      <Card className="overflow-hidden !p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Layers size={15} className="text-primary" />
          <h2 className="text-sm font-semibold">Cross-source consensus</h2>
          <span className="ml-auto text-[11px] text-muted-foreground">Median of agreeing sources · outliers excluded</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <caption className="sr-only">Consensus price per asset across venues, with spread, outliers and confidence</caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-semibold">Asset</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Consensus</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Low / High</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Spread</th>
                <th scope="col" className="px-3 py-2 text-center font-semibold">Sources</th>
                <th scope="col" className="px-3 py-2 text-center font-semibold">Outliers</th>
                <th scope="col" className="px-3 py-2 font-semibold">Confidence</th>
                <th scope="col" className="px-4 py-2 font-semibold">Venues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assetId} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2">
                    <span className="text-sm font-semibold">{r.asset.symbol}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{r.asset.name}</span>
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{r.consensus == null ? '—' : fmtPrice(r.consensus)}</td>
                  <td className="num px-3 py-2 text-right text-[11px] text-muted-foreground">
                    {r.min == null ? '—' : `${fmtPrice(r.min)} / ${fmtPrice(r.max)}`}
                  </td>
                  <td className={`num px-3 py-2 text-right ${r.spreadPct > 0.5 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {r.spreadPct == null ? '—' : `${r.spreadPct.toFixed(3)}%`}
                  </td>
                  <td className="num px-3 py-2 text-center">{r.sources}</td>
                  <td className={`num px-3 py-2 text-center ${r.outliers.length ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {r.outliers.length}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="num w-8 text-right text-xs">{r.confidence}</span>
                      <div className="w-20"><ConfBar value={r.confidence} /></div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {r.quotes.map((q) => (
                        <span key={q.venue} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={`${q.nativeSymbol} @ ${fmtPrice(q.price)}`}>
                          {q.venue}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && !loading ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No venue returned data. Check the source cards above for the specific errors.
            </p>
          ) : null}
        </div>
      </Card>

      {/* Real-time engine (section 5) */}
      <Card className="!p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Activity size={15} className="text-primary" />
          <h2 className="text-sm font-semibold">Real-time engine</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            engine.status.state === 'live' ? 'bg-up/15 text-up' : 'bg-amber-400/15 text-amber-400'
          }`}>
            {engine.status.state}
          </span>
          {engine.status.fallback ? (
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">REST FAILOVER</span>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {engine.status.host || '—'} · {engine.status.messages} messages
            {engine.status.silenceMs != null ? ` · silent ${Math.round(engine.status.silenceMs / 1000)}s` : ''}
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Per-stream sequencing and gap statistics</caption>
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-1.5 font-semibold">Stream</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold">Seq</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold">Gaps</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-semibold">Dupes</th>
                </tr>
              </thead>
              <tbody>
                {DEFAULT_STREAMS.map((name) => {
                  const s = seqStats[name] || {};
                  const live = engine.status.streams[name];
                  return (
                    <tr key={name} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5">
                        <span className="text-foreground">{name}</span>
                        {live ? <span className="ml-1.5 text-[10px] text-muted-foreground">{live.messages} msgs</span> : null}
                      </td>
                      <td className="num px-2 py-1.5 text-right text-muted-foreground">{s.last ?? '—'}</td>
                      <td className={`num px-2 py-1.5 text-right ${s.gaps ? 'text-amber-400' : 'text-muted-foreground'}`}>{s.gaps ?? 0}</td>
                      <td className="num px-3 py-1.5 text-right text-muted-foreground">{s.duplicates ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 text-[11px] text-muted-foreground">
            <p>Reconnects: <b className="text-foreground">{engine.status.reconnects}</b> · attempt {engine.status.attempt}</p>
            <p>Replay buffer: <b className="text-foreground">{engine.status.replaySize}</b> events held for replay</p>
            <p>
              Dead-letter queue: <b className="text-foreground">{engine.status.dlqSize}</b>
              {engine.status.dlqSize ? (
                <button onClick={() => setShowDlq((v) => !v)} className="ml-2 text-primary hover:underline">
                  {showDlq ? 'hide' : 'inspect'}
                </button>
              ) : null}
              {engine.status.dlqSize ? (
                <button onClick={() => engine.clearDeadLetters()} className="ml-2 text-primary hover:underline">clear</button>
              ) : null}
            </p>
            {engine.status.lastGap ? (
              <p className="text-amber-400">
                Last gap: {engine.status.lastGap.stream} missed {engine.status.lastGap.missed} event(s) at {timeAgo(engine.status.lastGap.at)}
              </p>
            ) : null}
            {showDlq && engine.status.dlqSize ? (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border p-2 font-mono text-[10px]">
                {engine.deadLetters().map((d, i) => (
                  <p key={i} className="truncate">{d.stream}: {d.error}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Reconnect uses exponential backoff with jitter and alternates hosts (provider failover). If the socket stays silent
          beyond 30s a watchdog forces a reconnect, and a REST poller keeps data flowing meanwhile.
        </p>
      </Card>

      {/* Streams beyond spot: derivatives, liquidations, wallet events, chain heads */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Derivatives feed · BTCUSDT</h2>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${derivatives.error ? 'bg-amber-400/15 text-amber-400' : 'bg-up/15 text-up'}`}>
              {derivatives.error ? 'degraded' : 'live'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="uppercase tracking-wide text-muted-foreground">Funding</p>
              <p className={`num text-sm font-semibold ${cls(derivatives.funding?.fundingRate)}`}>
                {derivatives.funding?.fundingRate == null ? '—' : `${(derivatives.funding.fundingRate * 100).toFixed(4)}%`}
              </p>
            </div>
            <div>
              <p className="uppercase tracking-wide text-muted-foreground">Mark price</p>
              <p className="num text-sm font-semibold">{derivatives.funding?.markPrice == null ? '—' : fmtPrice(derivatives.funding.markPrice)}</p>
            </div>
            <div>
              <p className="uppercase tracking-wide text-muted-foreground">Open interest</p>
              <p className="num text-sm font-semibold">{derivatives.openInterest?.openInterest == null ? '—' : fmtCompact(derivatives.openInterest.openInterest)}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {derivatives.error ? `Poll error: ${derivatives.error}` : `Polled ${derivatives.polls}× · funding every 60s, open interest every 30s`}
          </p>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-down" />
            <h2 className="text-sm font-semibold">Liquidation stream</h2>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${liquidations.status === 'live' ? 'bg-up/15 text-up' : 'bg-amber-400/15 text-amber-400'}`}>
              {liquidations.status}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {liquidations.received} events · {liquidations.reconnects} reconnects
            {liquidations.lastAt ? ` · last ${timeAgo(liquidations.lastAt)}` : ''}
          </p>
          <div className="mt-2 max-h-32 overflow-y-auto">
            {liquidations.events.length ? liquidations.events.map((e) => (
              <div key={`${e.at}-${e.symbol}-${e.price}`} className="flex items-center justify-between py-0.5 text-[11px]">
                <span className={e.side === 'long_liquidation' ? 'text-down' : 'text-up'}>
                  {e.side === 'long_liquidation' ? 'LONG' : 'SHORT'}
                </span>
                <span className="text-muted-foreground">{e.symbol}</span>
                <span className="num">{fmtPrice(e.price)}</span>
                <span className="num text-muted-foreground">{fmtCompact(e.notional)}</span>
              </div>
            )) : <p className="text-[11px] text-muted-foreground">Waiting for liquidation orders…</p>}
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Wallet &amp; portfolio events</h2>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${walletEvents.status === 'live' ? 'bg-up/15 text-up' : walletEvents.status === 'error' ? 'bg-amber-400/15 text-amber-400' : 'bg-muted text-muted-foreground'}`}>
              {walletEvents.status}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Subscribed to holdings, alerts, strategy arms, paper runs and watchlist rows you own ({walletEvents.received} events received).
          </p>
          {walletEvents.lastEvent ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Last: {walletEvents.lastEvent.eventType} on {walletEvents.lastEvent.table} · {timeAgo(walletEvents.lastEvent.at)}
            </p>
          ) : null}
          {walletEvents.hint ? <p className="mt-1 text-[11px] text-amber-400">{walletEvents.hint}</p> : null}
        </Card>

        <Card className="!p-4">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Blockchain heads</h2>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${chainHeads.status === 'live' ? 'bg-up/15 text-up' : 'bg-amber-400/15 text-amber-400'}`}>
              {chainHeads.status}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-[11px]">
            {chainHeads.heads.map((h) => (
              <div key={h.chainId} className="flex items-center justify-between">
                <span className="text-muted-foreground">{h.name}</span>
                {h.block == null ? (
                  <span className="text-amber-400">{h.error}</span>
                ) : (
                  <span className="num">
                    #{h.block.toLocaleString()} <span className="text-muted-foreground">· {h.latencyMs} ms</span>
                  </span>
                )}
              </div>
            ))}
            {!chainHeads.heads.length ? <p className="text-muted-foreground">Polling public RPC nodes…</p> : null}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Head-of-chain only ({chainHeads.advances} blocks advanced). Decoded event indexing needs an indexer service.
          </p>
        </Card>
      </div>

      {/* Engine quality */}
      <Card className="!p-4">
        <h2 className="text-sm font-semibold">Engine quality</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] md:grid-cols-4">
          <div>
            <p className="uppercase tracking-wide text-muted-foreground">Queue depth</p>
            <p className="num text-sm font-semibold">{engine.status.queue?.depth ?? 0} / {engine.status.queue?.capacity ?? 0}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-muted-foreground">Backpressure</p>
            <p className={`num text-sm font-semibold ${(engine.status.queue?.pressure || 0) > 50 ? 'text-amber-400' : ''}`}>
              {engine.status.queue?.pressure ?? 0}%
            </p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-muted-foreground">Dropped events</p>
            <p className={`num text-sm font-semibold ${engine.status.queue?.dropped ? 'text-amber-400' : ''}`}>{engine.status.queue?.dropped ?? 0}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide text-muted-foreground">Reconciliation</p>
            <p className="num text-sm font-semibold">
              {recon.checks ? `${recon.mismatches}/${recon.checks}` : '—'}
              {recon.worstBps ? <span className="text-muted-foreground"> · {recon.worstBps.toFixed(0)} bps</span> : null}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Streamed top-of-book is compared with an independent REST snapshot every 30s; mismatches beyond 8 bps are counted.
        </p>
      </Card>

      {/* Symbol mapping */}
      <Card className="overflow-hidden !p-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Symbol &amp; identity mapping</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            One canonical asset ID per coin, with each venue&apos;s native symbol. Contract addresses shown where the asset is a token.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <caption className="sr-only">Canonical asset identifiers mapped to venue-native symbols</caption>
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-semibold">Asset ID</th>
                <th scope="col" className="px-3 py-2 font-semibold">Symbol</th>
                {VENUES.map((v) => (
                  <th key={v.id} scope="col" className="px-3 py-2 font-semibold">{v.name}</th>
                ))}
                <th scope="col" className="px-4 py-2 font-semibold">Contract</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => {
                const asset = ASSETS.find((a) => a.id === row.assetId);
                return (
                  <tr key={row.assetId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-1.5 font-mono text-[10px] text-muted-foreground">{row.assetId}</td>
                    <td className="px-3 py-1.5 font-semibold">{row.symbol}</td>
                    {VENUES.map((v) => (
                      <td key={v.id} className={`px-3 py-1.5 ${row.symbols?.[v.id] ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                        {row.symbols?.[v.id] || '—'}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {asset?.contract ? `${asset.contract.slice(0, 10)}…` : 'native'}
                      {row.chain ? ` · ${row.chain.name} (${row.chain.id})` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Public venue endpoints only — no API keys, no fabricated prices: a venue that blocks browser access shows as
          <b> down</b> with its error. Licensed institutional feeds (CMC enterprise, CME), DEX subgraphs and blockchain
          indexers need commercial agreements and are part of the enterprise blueprint, not this build.
        </span>
      </div>
    </div>
  );
}
