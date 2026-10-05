import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, AlertTriangle, Info, RefreshCw, Loader2, ShieldCheck, Network } from 'lucide-react';
import { fetchAllVenues } from '../lib/sources.js';
import { assetById } from '../lib/assets.js';
import {
  SOURCES, SOURCE_KINDS, LICENCE, registrySummary, QUOTE_CONTRACT, ID_SPACES,
  cxComposite, confidenceBand
} from '../lib/sourceRegistry.js';
import { Card } from './ui.jsx';
import { fmtPrice, cls, timeAgo } from '../lib/format.js';

const BAND = {
  high: 'bg-up/15 text-up',
  medium: 'bg-primary/15 text-primary',
  low: 'bg-down/15 text-down',
  none: 'bg-muted text-muted-foreground'
};
const STATUS = {
  live: 'bg-up/15 text-up',
  available: 'bg-primary/15 text-primary',
  unavailable: 'bg-down/15 text-down'
};

/**
 * Market-data source registry, licence posture and the proprietary CX-Index.
 * Fetches its own venue quotes so the host page needs a single tag.
 */
export default function SourceRegistryPanel() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(null);
  const [tab, setTab] = useState('sources');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAllVenues();
      setSources(res || []);
      setAt(Date.now());
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    const iv = window.setInterval(load, 90000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [load]);

  /* Build per-asset rows so the composite can quality-gate venue by venue. */
  const rows = useMemo(() => {
    const byAsset = new Map();
    sources.forEach((s) => (s.quotes || []).forEach((q) => {
      if (!q?.assetId) return;
      const arr = byAsset.get(q.assetId) || [];
      arr.push(q);
      byAsset.set(q.assetId, arr);
    }));
    return [...byAsset.entries()].map(([assetId, quotes]) => {
      const a = assetById(assetId);
      return { assetId, symbol: a?.symbol || quotes[0]?.symbol || assetId, quotes, mcap: null };
    });
  }, [sources]);

  const summary = useMemo(() => registrySummary(), []);
  const composite = useMemo(() => cxComposite(rows), [rows]);

  const tabs = [
    { id: 'sources', label: 'Sources' },
    { id: 'gaps', label: 'Gaps & licences' },
    { id: 'identity', label: 'IDs & normalisation' },
    { id: 'index', label: 'CX-Index' }
  ];

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Database size={15} className="text-primary" /> Source registry
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary.live} live · {summary.available} available on demand · {summary.unavailable} licence-gated
            {at ? ` · updated ${timeAgo(at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cls('rounded-lg border px-2 py-1 text-[10px] font-semibold',
                tab === t.id ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-accent')}
            >
              {t.label}
            </button>
          ))}
          <button onClick={load} className="btn-ghost !h-7 !px-2 !text-[10px]">
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
        </div>
      </div>

      {/* ---------------- sources ---------------- */}
      {tab === 'sources' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Licence</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Provides</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.id} className="border-t border-border/60 align-top">
                  <td className="px-4 py-2">
                    <span className="text-xs font-semibold">{s.name}</span>
                    <span className="num ml-1 text-[10px] text-muted-foreground">T{s.tier}</span>
                  </td>
                  <td className="px-4 py-2 text-[11px] text-muted-foreground">{SOURCE_KINDS[s.kind]}</td>
                  <td className="px-4 py-2 text-[11px]">
                    <span className={s.licence === 'open' ? 'text-up' : 'text-down'}>{s.licence}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={cls('rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS[s.status])}>{s.status}</span>
                  </td>
                  <td className="px-4 py-2 text-[10px] text-muted-foreground">{s.provides.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ---------------- gaps ---------------- */}
      {tab === 'gaps' ? (
        <div className="space-y-3 p-4">
          <p className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-[11px]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              These sources are listed but <b>not</b> carried. Each needs a commercial agreement we do not hold —
              substituting a scrape for a licensed feed would breach the provider&apos;s terms, so the gap is declared
              instead of faked.
            </span>
          </p>
          {summary.missingReasons.map((m) => (
            <div key={m.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">{m.name}</span>
                <span className="rounded bg-down/15 px-1.5 py-0.5 text-[10px] font-semibold text-down">{m.licence}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{m.note}</p>
            </div>
          ))}
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold">What replaces them</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The open venues plus the CX-Index composite cover price discovery without licensed redistribution. Missing
              coverage is narrow: consolidated tape, depth-of-book and regulated futures term structure.
            </p>
          </div>
        </div>
      ) : null}

      {/* ---------------- identity ---------------- */}
      {tab === 'identity' ? (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Network size={13} className="text-primary" /> Identifier spaces
            </p>
            <div className="space-y-2">
              {ID_SPACES.map((i) => (
                <div key={i.id} className="rounded-lg border border-border p-2.5">
                  <p className="text-[11px] font-semibold">{i.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="num">{i.example}</span> · from {i.source}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{i.note}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <ShieldCheck size={13} className="text-primary" /> Normalised quote contract
            </p>
            <div className="space-y-1.5">
              {QUOTE_CONTRACT.map((f) => (
                <div key={f.field} className="flex items-start justify-between gap-3 rounded-lg border border-border px-2.5 py-1.5">
                  <div className="min-w-0">
                    <span className="num text-[11px] font-semibold">{f.field}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{f.type}</span>
                    <p className="text-[10px] text-muted-foreground">{f.note}</p>
                  </div>
                  <span className={cls('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    f.required ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                    {f.required ? 'required' : 'optional'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- CX-Index ---------------- */}
      {tab === 'index' ? (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold">CX-Index — proprietary composite</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Quality-gated: stale quotes dropped, third and later quotes outlier-checked, survivors volume-weighted
                where comparable volume exists.
              </p>
            </div>
            <span className={cls('rounded px-2 py-1 text-[10px] font-semibold', BAND[confidenceBand(composite.confidence)])}>
              confidence {composite.confidence}/100
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Assets in composite', composite.assetsIncluded],
              ['Avg venues / asset', composite.avgVenuesPerAsset],
              ['Weighting', composite.weighting || '—'],
              ['Level (raw)', composite.level != null ? composite.level.toFixed(2) : '—']
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="num mt-0.5 text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Asset</th>
                  <th className="py-2 text-right font-medium">Composite</th>
                  <th className="py-2 text-right font-medium">Median</th>
                  <th className="py-2 text-right font-medium">Dispersion</th>
                  <th className="py-2 text-right font-medium">Venues</th>
                  <th className="py-2 text-right font-medium">Dropped</th>
                  <th className="py-2 text-right font-medium">Weight</th>
                  <th className="py-2 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {composite.assets.map((a) => (
                  <tr key={a.assetId} className="border-t border-border/60">
                    <td className="py-1.5 font-semibold">{a.symbol}</td>
                    <td className="num py-1.5 text-right text-xs">{fmtPrice(a.price)}</td>
                    <td className="num py-1.5 text-right text-xs text-muted-foreground">{fmtPrice(a.median)}</td>
                    <td className="num py-1.5 text-right text-xs">{a.dispersionPct == null ? '—' : `${a.dispersionPct.toFixed(3)}%`}</td>
                    <td className="num py-1.5 text-right text-xs">{a.venues}</td>
                    <td className={cls('num py-1.5 text-right text-xs', a.dropped ? 'text-down' : 'text-muted-foreground')}>{a.dropped}</td>
                    <td className="py-1.5 text-right text-[10px] text-muted-foreground">{a.weighting}</td>
                    <td className="py-1.5 text-right">
                      <span className={cls('rounded px-1.5 py-0.5 text-[10px] font-semibold', BAND[confidenceBand(a.confidence)])}>
                        {a.confidence.toFixed(0)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!composite.assets.length ? (
                  <tr><td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">Waiting for venue quotes…</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/25 p-2.5 text-[11px] text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0 text-primary" />
            <span>{composite.disclaimer}</span>
          </p>
        </div>
      ) : null}
    </Card>
  );
}
