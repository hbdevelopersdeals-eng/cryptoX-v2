import React, { useMemo, useState } from 'react';
import { Store, Download, Check, Wrench, Info, Plus, X } from 'lucide-react';
import {
  INDICATOR_PRESETS, INDICATOR_CATEGORIES, INDICATOR_FAMILIES, MA_TYPES,
  makeCustomIndicator, STUDY_FAMILIES
} from '../lib/indicatorMarketplace.js';
import { Card } from './ui.jsx';

const KEY = 'cx_indicators';

const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* quota */ } };

const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—'
  : Math.abs(n) >= 1000 ? n.toFixed(0)
    : Math.abs(n) >= 1 ? n.toFixed(2)
      : n.toFixed(6));

/**
 * Indicator marketplace + user-created indicators.
 *
 * This is a LOCAL registry shipped with the app — "install" records an indicator
 * configuration in your browser. Nothing is downloaded, and the install counts
 * are illustrative rather than live popularity.
 */
export default function IndicatorMarketplace({ candles = [] }) {
  const [installed, setInstalled] = useState(load);
  const [category, setCategory] = useState('All');
  const [ma, setMa] = useState('wma');
  const [period, setPeriod] = useState(9);
  const [custom, setCustom] = useState([]);

  const persist = (next) => { setInstalled(next); save(next); };

  const toggle = (p) => {
    const key = p.id;
    persist(installed.includes(key) ? installed.filter((x) => x !== key) : [...installed, key]);
  };

  const shown = useMemo(
    () => (category === 'All' ? INDICATOR_PRESETS : INDICATOR_PRESETS.filter((p) => p.category === category)),
    [category]
  );

  /* Live preview of the user's own indicator over the loaded candles. */
  const preview = useMemo(() => {
    if (!candles?.length) return null;
    const r = makeCustomIndicator({ ma, period, source: candles });
    if (!r.ok) return { error: r.errors.join(' · ') };
    const series = r.series || [];
    const last = series[series.length - 1];
    const valid = series.filter((v) => v != null);
    return {
      label: r.spec.label,
      last,
      count: valid.length,
      min: valid.length ? Math.min(...valid) : null,
      max: valid.length ? Math.max(...valid) : null
    };
  }, [ma, period, candles]);

  const addCustom = () => {
    const r = makeCustomIndicator({ ma, period });
    if (!r.ok) return;
    if (custom.some((c) => c.label === r.spec.label)) return;
    setCustom([...custom, r.spec]);
  };

  return (
    <>
      {/* ---------------- custom indicator builder ---------------- */}
      <Card className="!p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Wrench size={15} className="text-primary" /> Create your own indicator
        </h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Compose an indicator from a moving-average type and period. It is validated before use, and the preview is
          computed on the candles currently loaded on the chart.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Average</p>
            <select aria-label="Average type" value={ma} onChange={(e) => setMa(e.target.value)} className="input-dark !h-9 !w-auto !text-xs">
              {MA_TYPES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Period</p>
            <input
              type="number"
              aria-label="Period"
              min="1"
              max="500"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="input-dark !h-9 !w-24 num !text-xs"
            />
          </div>
          <button onClick={addCustom} className="btn-ghost !h-9 !px-3 !text-xs">
            <Plus size={12} /> Add to my indicators
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-border bg-muted/25 p-2.5">
          {preview?.error ? (
            <p className="text-[11px] text-down">{preview.error}</p>
          ) : preview ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">{preview.label}</span>
              <span>latest <b className="num">{fmtNum(preview.last)}</b></span>
              <span className="text-muted-foreground">points {preview.count}</span>
              <span className="text-muted-foreground">range {fmtNum(preview.min)} – {fmtNum(preview.max)}</span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Load a chart to preview your indicator.</p>
          )}
        </div>

        {custom.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {custom.map((c) => (
              <span key={c.label} className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                {c.label}
                <button onClick={() => setCustom(custom.filter((x) => x.label !== c.label))}><X size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ---------------- marketplace ---------------- */}
      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Store size={15} className="text-primary" /> Indicator marketplace
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {INDICATOR_PRESETS.length} presets · {Object.keys(INDICATOR_FAMILIES).length} indicator families.
              Install counts are illustrative — this is a local registry, not live popularity.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['All', ...INDICATOR_CATEGORIES].map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                  category === c ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => {
            const on = installed.includes(p.id);
            const isStudy = STUDY_FAMILIES.includes(p.family);
            return (
              <div key={p.id} className={`rounded-xl border p-3 ${on ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.author}</p>
                  </div>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{p.category}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{p.blurb}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {INDICATOR_FAMILIES[p.family]} · {isStudy ? 'study pane' : 'price overlay'}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{p.installs.toLocaleString()} installs</span>
                  <button onClick={() => toggle(p)} className={`btn-ghost !h-7 !px-2 !text-[10px] ${on ? '!text-primary' : ''}`}>
                    {on ? <><Check size={11} /> Installed</> : <><Download size={11} /> Install</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="flex items-start gap-2 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          <Info size={13} className="mt-0.5 shrink-0 text-primary" />
          <span>
            Installing a preset records its configuration in your browser only. A server-backed marketplace with
            community publishing would need a backend registry, which this client-only build does not have.
          </span>
        </p>
      </Card>
    </>
  );
}
