import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellRing, Plus, X, ArrowUp, ArrowDown, Check, Trash2, BellOff, Bell, History,
  Activity, AlertTriangle, Power
} from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useAlerts, useTransactions } from '../lib/prefs.jsx';
import { buildPortfolio } from '../lib/portfolio.js';
import {
  RULE_TYPES, RULE_LABELS, describeRule, evaluateAll, applyCooldown, normaliseAlert, validateRule,
  PORTFOLIO_SYMBOL, PORTFOLIO_RULES
} from '../lib/alertsEngine.js';
import { buildContext, contextReadout, symbolsNeedingCandles } from '../lib/alertContext.js';
import { fmtPrice, fmtUsd, timeAgo } from '../lib/format.js';
import { CoinImg, Card, EmptyState } from '../components/ui.jsx';

const COOLDOWNS = [
  { label: '1 minute', value: 60000 },
  { label: '5 minutes', value: 300000 },
  { label: '15 minutes', value: 900000 },
  { label: '1 hour', value: 3600000 }
];

/* Which inputs each rule type needs. */
const FIELDS = {
  price_above: { value: 'Target price ($)', placeholder: '60000' },
  price_below: { value: 'Target price ($)', placeholder: '60000' },
  pct_change: { value: 'Absolute 24h move (%)', placeholder: '5' },
  volume_spike: { value: 'Multiple of average (×)', placeholder: '3' },
  rsi_above: { value: 'RSI level (0–100)', placeholder: '70' },
  rsi_below: { value: 'RSI level (0–100)', placeholder: '30' },
  ma_cross: { periods: true },
  macd_cross: {},
  breakout: { period: true },
  portfolio_value_above: { value: 'Threshold (USD)', placeholder: '10000' },
  portfolio_value_below: { value: 'Threshold (USD)', placeholder: '10000' }
};

const DEFAULT_FORM = {
  coinId: '',
  type: 'price_above',
  value: '',
  fast: 9,
  slow: 21,
  period: 20,
  cooldownMs: 300000
};

export default function AlertsPage() {
  const { rows, byId, getKlines } = useMarket();
  const [alerts, api, state, stateApi] = useAlerts();
  const [txs] = useTransactions();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formErr, setFormErr] = useState(null);
  const [notifyOn, setNotifyOn] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );

  const top = useMemo(() => [...(rows || [])].sort((a, b) => b.mcap - a.mcap).slice(0, 150), [rows]);

  /* Live portfolio value, so portfolio rules can be evaluated alongside coins. */
  const portfolioValue = useMemo(() => {
    if (!txs?.length) return null;
    const priceById = {};
    (rows || []).forEach((r) => { priceById[r.id] = r.price; });
    try {
      return buildPortfolio({ transactions: txs, priceById }).totals.value || null;
    } catch {
      return null;
    }
  }, [txs, rows]);

  const isPortfolioForm = form.coinId === '__portfolio__';
  const conditionOptions = useMemo(
    () => (isPortfolioForm ? RULE_TYPES.filter((t) => PORTFOLIO_RULES.has(t)) : RULE_TYPES.filter((t) => !PORTFOLIO_RULES.has(t))),
    [isPortfolioForm]
  );

  /* Keep the newest rows / kline fetcher reachable from the 1s tick without
   * re-creating the interval on every quote. */
  const rowsRef = useRef(rows);
  const klinesRef = useRef(getKlines);
  const notifyRef = useRef(notifyOn);
  const portfolioRef = useRef(portfolioValue);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { klinesRef.current = getKlines; }, [getKlines]);
  useEffect(() => { notifyRef.current = notifyOn; }, [notifyOn]);
  useEffect(() => { portfolioRef.current = portfolioValue; }, [portfolioValue]);

  const normalised = useMemo(() => (alerts || []).map(normaliseAlert).filter(Boolean), [alerts]);

  const prevRef = useRef({});
  const candleRef = useRef({}); // symbol -> { candles, source, at }
  const [readouts, setReadouts] = useState({}); // alertId -> live readout string

  /* The 1s loop reads the newest state through refs. If `tick` depended on live
   * state directly, every setReadouts would rebuild it, restart the effect and
   * spin the page. */
  const alertsRef = useRef(normalised);
  const stateRef = useRef(state);
  const stateApiRef = useRef(stateApi);
  alertsRef.current = normalised;
  stateRef.current = state;
  stateApiRef.current = stateApi;

  const tick = useCallback(async () => {
    const list = alertsRef.current.filter((a) => a.enabled !== false);
    if (!list.length) {
      setReadouts((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }

    const live = rowsRef.current || [];
    const idx = {};
    live.forEach((r) => { idx[r.symbol] = r; });

    /* ---- Fetch candle history for the symbols that need it ---- */
    const need = symbolsNeedingCandles(list);
    const now = Date.now();
    for (const symbol of need) {
      const cached = candleRef.current[symbol];
      if (cached && now - cached.at < 60000) continue;
      try {
        const res = await klinesRef.current(symbol, '1h', 200);
        // Never feed simulated candles into an indicator: they must not fire a signal.
        const usable = res?.source && res.source !== 'simulated' ? res.candles : null;
        candleRef.current[symbol] = { candles: usable, source: res?.source || 'unavailable', at: now };
      } catch {
        candleRef.current[symbol] = { candles: null, source: 'error', at: now };
      }
    }

    /* ---- Build the context map ---- */
    const ctxBySymbol = {};
    const nextReadouts = {};
    const bySymbolRules = {};
    list.forEach((a) => {
      const s = a.rule?.symbol;
      if (!s) return;
      (bySymbolRules[s] = bySymbolRules[s] || []).push(a.rule);
    });

    Object.keys(bySymbolRules).forEach((symbol) => {
      const row = idx[symbol];
      const entry = candleRef.current[symbol];
      ctxBySymbol[symbol] = buildContext(row, prevRef.current[symbol], entry?.candles, bySymbolRules[symbol]);
    });

    // Portfolio rules read the live total rather than a coin context.
    const usesPortfolio = list.some((a) => PORTFOLIO_RULES.has(a.rule?.type));
    if (usesPortfolio) {
      ctxBySymbol[PORTFOLIO_SYMBOL] = {
        portfolioValue: portfolioRef.current,
        prevPortfolioValue: prevRef.current[PORTFOLIO_SYMBOL]?.portfolioValue
      };
    }

    list.forEach((a) => {
      nextReadouts[a.id] = contextReadout(a.rule, ctxBySymbol[a.rule?.symbol] || {});
    });
    // Only re-render when a readout actually changed.
    setReadouts((prev) => {
      const keys = Object.keys(nextReadouts);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === nextReadouts[k])) return prev;
      return nextReadouts;
    });

    /* ---- Evaluate + de-duplicate ---- */
    const hits = evaluateAll(list.map((a) => ({ ...a.rule, id: a.id, enabled: true })), ctxBySymbol, now);
    if (hits.length) {
      const cdFor = (hit) => list.find((a) => a.id === hit.ruleId)?.cooldownMs;
      const { fired, lastFired } = applyCooldown(hits, stateRef.current.lastFired || {}, cdFor, now);
      if (fired.length) {
        stateApiRef.current.commitLastFired(lastFired);
        const enriched = fired.map((h) => {
          const alert = list.find((a) => a.id === h.ruleId);
          return {
            ...h,
            label: alert ? describeRule(alert.rule) : h.type,
            price: ctxBySymbol[alert?.rule?.symbol]?.price ?? null
          };
        });
        stateApiRef.current.recordFired(enriched);
        if (notifyRef.current && typeof Notification !== 'undefined') {
          enriched.forEach((e) => {
            try { new Notification('CryptoX alert', { body: `${e.label} — ${e.detail || ''}` }); } catch { /* ignore */ }
          });
        }
      }
    }

    /* ---- Snapshot for next-tick crossover detection ---- */
    const snap = {};
    Object.keys(bySymbolRules).forEach((symbol) => {
      const r = idx[symbol];
      if (r) snap[symbol] = { price: r.price, pct24: r.pct24 };
    });
    if (usesPortfolio) snap[PORTFOLIO_SYMBOL] = { portfolioValue: portfolioRef.current };
    prevRef.current = snap;
  }, []); // deps intentionally empty — `tick` reads everything through refs

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) tick(); };
    run();
    const iv = window.setInterval(run, 1000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [tick]);

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setNotifyOn(p === 'granted');
    } catch { /* ignore */ }
  };

  const submit = () => {
    if (isPortfolioForm) {
      const rule = { type: form.type, value: parseFloat(form.value), symbol: PORTFOLIO_SYMBOL };
      const check = validateRule(rule);
      if (!check.ok) { setFormErr(check.errors.join(' · ')); return; }
      if (portfolioValue == null) {
        setFormErr('No portfolio value yet — add holdings on the Portfolio page first.');
        return;
      }
      api.add({ coinId: '__portfolio__', symbol: 'Portfolio', name: 'Portfolio value', rule, cooldownMs: form.cooldownMs });
      setOpen(false);
      setForm(DEFAULT_FORM);
      setFormErr(null);
      return;
    }

    const r = byId[form.coinId];
    if (!r) { setFormErr('Choose a coin first.'); return; }

    const rule = { type: form.type, symbol: r.symbol };
    if (['price_above', 'price_below', 'pct_change', 'volume_spike', 'rsi_above', 'rsi_below'].includes(form.type)) {
      rule.value = parseFloat(form.value);
    }
    if (form.type === 'ma_cross') rule.periods = [Number(form.fast) || 0, Number(form.slow) || 0];
    if (form.type === 'breakout') rule.periods = [Number(form.period) || 0];

    const check = validateRule(rule);
    if (!check.ok) { setFormErr(check.errors.join(' · ')); return; }

    api.add({ coinId: form.coinId, symbol: r.symbol, name: r.name, rule, cooldownMs: form.cooldownMs });
    setOpen(false);
    setForm(DEFAULT_FORM);
    setFormErr(null);
  };

  const recentLog = (state.log || []).slice(0, 40);
  const feedIsSimulated = (rows?.[0]?.source === 'simulated');
  const fields = FIELDS[form.type] || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Alert Engine</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Rules are evaluated against the live feed every second — price, 24h move, volume spikes, RSI, moving-average
            crosses, MACD crosses and range breakouts, each with its own cooldown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!notifyOn ? (
            <button onClick={enableNotifications} className="btn-ghost !h-9 !px-3 !text-xs">
              <Bell size={14} /> Enable notifications
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell size={13} /> Notifications on</span>
          )}
          <button onClick={() => { setForm(DEFAULT_FORM); setFormErr(null); setOpen(true); }} className="btn-primary !h-9 px-3 !text-xs">
            <Plus size={14} /> Create Alert
          </button>
        </div>
      </div>

      {feedIsSimulated ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <b>The market feed is currently simulated.</b> Indicator-based rules are held back rather than firing on
          synthetic data, so you never act on a signal that was never real.
        </div>
      ) : null}

      {/* Active rules */}
      {!normalised.length ? (
        <Card>
          <EmptyState
            icon={<BellRing size={28} className="text-muted-foreground" />}
            title="No alert rules yet"
            sub="Try “RSI below 30 on BTC” or “SOL volume 3× average”, then leave the page open — rules are checked every second."
            action={<button onClick={() => setOpen(true)} className="btn-primary"><Plus size={15} /> Create Alert</button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {normalised.map((a) => {
            const readout = readouts[a.id];
            const off = a.enabled === false;
            return (
              <div key={a.id} className={`card-panel p-4 ${off ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <CoinImg src={byId[a.coinId]?.image} symbol={a.symbol} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {byId[a.coinId]?.name || a.symbol}
                      <span className="text-xs font-normal text-muted-foreground">{a.symbol}</span>
                      {off ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">paused</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{describeRule(a.rule)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => api.patch(a.id, { enabled: off })}
                      title={off ? 'Resume' : 'Pause'}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Power size={14} />
                    </button>
                    <button
                      onClick={() => api.remove(a.id)}
                      title="Delete"
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-down/10 hover:text-down"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-xs">
                  <span className="text-muted-foreground">
                    {readout ? <>Now <span className="num text-foreground">{readout}</span></> : 'Waiting for data…'}
                  </span>
                  <Link to={byId[a.coinId] ? `/coin/${a.coinId}` : '/'} className="font-medium text-primary hover:underline">
                    View
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Firing history */}
      <Card className="!p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <History size={15} className="text-primary" /> Trigger History
            <span className="text-xs font-normal text-muted-foreground">({(state.log || []).length})</span>
          </p>
          <div className="flex items-center gap-2">
            <button onClick={stateApi.resetCooldowns} className="btn-ghost !h-8 !px-2.5 !text-[11px]">
              <Activity size={12} /> Reset cooldowns
            </button>
            <button onClick={stateApi.clearLog} className="btn-ghost !h-8 !px-2.5 !text-[11px]">
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>
        {!recentLog.length ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing has triggered yet. History is kept locally in this browser.
          </p>
        ) : (
          <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
            {recentLog.map((e, i) => (
              <div key={`${e.at}-${e.ruleId}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <Check size={13} className="shrink-0 text-up" />
                  <span className="truncate font-medium">{e.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  {e.detail ? <span className="num hidden sm:inline">{e.detail}</span> : null}
                  <span>{timeAgo(e.at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Create dialog */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Alert Rule</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X size={16} /></button>
            </div>

            <div className="space-y-3.5">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Coin</p>
                <select
                  value={form.coinId}
                  onChange={(e) => {
                    const coinId = e.target.value;
                    const isPf = coinId === '__portfolio__';
                    // Switching target swaps the rule families, so reset the condition.
                    setForm({ ...form, coinId, type: isPf ? 'portfolio_value_above' : 'price_above', value: '' });
                    setFormErr(null);
                  }}
                  className="input-dark !h-10"
                >
                  <option value="">Choose…</option>
                  <option value="__portfolio__">Portfolio — total value{portfolioValue ? ` (now ${fmtUsd(portfolioValue)})` : ''}</option>
                  {top.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.symbol})</option>)}
                </select>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Condition</p>
                <select
                  value={form.type}
                  onChange={(e) => { setForm({ ...form, type: e.target.value, value: '' }); setFormErr(null); }}
                  className="input-dark !h-10"
                >
                  {conditionOptions.map((t) => <option key={t} value={t}>{RULE_LABELS[t]}</option>)}
                </select>
              </div>

              {fields.value ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{fields.value}</p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="any"
                      value={form.value}
                      onChange={(e) => setForm({ ...form, value: e.target.value })}
                      placeholder={fields.placeholder}
                      className="input-dark !h-10 num"
                    />
                    {['price_above', 'price_below'].includes(form.type) && byId[form.coinId]?.price ? (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, value: String(byId[form.coinId].price) })}
                        className="btn-ghost shrink-0 !h-10 !px-3 !text-[11px]"
                      >
                        Use current
                      </button>
                    ) : null}
                    {isPortfolioForm && portfolioValue ? (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, value: portfolioValue.toFixed(2) })}
                        className="btn-ghost shrink-0 !h-10 !px-3 !text-[11px]"
                      >
                        Use current
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {fields.periods ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Fast MA</p>
                    <input
                      type="number"
                      value={form.fast}
                      onChange={(e) => setForm({ ...form, fast: e.target.value })}
                      className="input-dark !h-10 num"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Slow MA</p>
                    <input
                      type="number"
                      value={form.slow}
                      onChange={(e) => setForm({ ...form, slow: e.target.value })}
                      className="input-dark !h-10 num"
                    />
                  </div>
                </div>
              ) : null}

              {fields.period ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Range length (bars)</p>
                  <input
                    type="number"
                    value={form.period}
                    onChange={(e) => setForm({ ...form, period: e.target.value })}
                    className="input-dark !h-10 num"
                  />
                </div>
              ) : null}

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Don’t repeat more than once per</p>
                <select
                  value={form.cooldownMs}
                  onChange={(e) => setForm({ ...form, cooldownMs: Number(e.target.value) })}
                  className="input-dark !h-10"
                >
                  {COOLDOWNS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              {['rsi_above', 'rsi_below', 'ma_cross', 'macd_cross', 'breakout', 'volume_spike'].includes(form.type) ? (
                <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  This rule needs price history. It stays quiet until enough candles load, and it will not fire on
                  simulated data.
                </p>
              ) : null}

              {formErr ? (
                <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {formErr}
                </p>
              ) : null}

              <button onClick={submit} className="btn-primary w-full !h-10" disabled={!form.coinId}>
                Create Alert
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
