import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Loader2, RefreshCw, Eraser, Info, Layers } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import ProChart from '../components/ProChart.jsx';
import AltChart from '../components/AltChart.jsx';
import IndicatorMarketplace from '../components/IndicatorMarketplace.jsx';
import { renko, rangeBars } from '../lib/chartTypes.js';
import { fmtPrice, timeAgo } from '../lib/format.js';
import { Card } from '../components/ui.jsx';

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'BCH', 'TRX', 'UNI', 'ATOM'];
const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w'];
const TYPES = [
  ['candles', 'Candlestick'], ['hollow', 'Hollow candles'], ['heikin', 'Heikin Ashi'],
  ['line', 'Line'], ['area', 'Area'], ['baseline', 'Baseline'],
  ['renko', 'Renko'], ['range', 'Range bars'],
  ['kagi', 'Kagi'], ['pnf', 'Point & Figure'], ['mprofile', 'Market profile']
];
/* These emit pivots, boxes or a histogram rather than OHLC bars, so they use AltChart. */
const ALT_TYPES = ['kagi', 'pnf', 'mprofile'];

const SCALES = [['linear', 'Linear'], ['log', 'Log'], ['percent', 'Percent']];
const OVERLAY_OPTIONS = [
  ['sma20', 'SMA 20'], ['sma50', 'SMA 50'], ['ema21', 'EMA 21'], ['wma14', 'WMA 14'],
  ['bollinger', 'Bollinger'], ['ichimoku', 'Ichimoku'], ['supertrend', 'Supertrend'], ['custom', 'Custom (WMA 9)']
];
const SUBPANELS = [['none', 'None'], ['rsi', 'RSI'], ['macd', 'MACD'], ['atr', 'ATR'], ['adx', 'ADX'], ['obv', 'OBV'], ['stochastic', 'Stochastic']];
const TOOLS = [['none', 'Cursor'], ['trend', 'Trend line'], ['ray', 'Ray'], ['hline', 'Horizontal'], ['fib', 'Fibonacci'], ['rect', 'Rectangle'], ['measure', 'Measure']];
const LAYOUTS = [1, 2, 4];
const PANE_SUBPANELS = ['rsi', 'macd', 'atr', 'obv'];

export default function ChartingPage() {
  const { rows, bySymbol, getKlines, feed } = useMarket();
  const [symbol, setSymbol] = useState('BTC');
  const [interval, setIntervalKey] = useState('1h');
  const [type, setType] = useState('candles');
  const [scale, setScale] = useState('linear');
  const [overlays, setOverlays] = useState(['sma20', 'sma50']);
  const [subpanel, setSubpanel] = useState('rsi');
  const [layout, setLayout] = useState(1);
  const [tool, setTool] = useState('none');
  const [drawings, setDrawings] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [showDepth, setShowDepth] = useState(false);
  const [candles, setCandles] = useState(null);
  const [source, setSource] = useState('binance');
  const [loading, setLoading] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const [hover, setHover] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getKlines(symbol, interval, 320);
      setCandles(res.candles);
      setSource(res.source);
      setLastAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, getKlines]);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 60000);
    return () => window.clearInterval(iv);
  }, [load]);

  const row = bySymbol?.[symbol];
  const livePrice = row?.price ?? null;

  /* Live last candle so the chart moves with the tape. */
  const live = useMemo(() => {
    if (!candles?.length || !livePrice) return candles;
    const last = candles[candles.length - 1];
    if (Math.abs(livePrice - last.c) < 1e-12) return candles;
    const copy = [...candles];
    copy[copy.length - 1] = { ...last, c: livePrice, h: Math.max(last.h, livePrice), l: Math.min(last.l, livePrice) };
    return copy;
  }, [candles, livePrice]);

  /* Non-time-based transforms are derived from the same bars. */
  const display = useMemo(() => {
    if (!live?.length) return live;
    if (type === 'renko') return renko(live, {});
    if (type === 'range') return rangeBars(live, {});
    return live;
  }, [live, type]);

  const depth = useMemo(() => (showDepth ? { bids: [], asks: [] } : null), [showDepth]);

  const toggleOverlay = (key) => {
    setOverlays((o) => (o.includes(key) ? o.filter((x) => x !== key) : [...o, key]));
  };

  const paneCount = layout;
  const panes = Array.from({ length: paneCount }, (_, i) => ({
    key: i,
    subpanel: paneCount === 1 ? subpanel : PANE_SUBPANELS[i % PANE_SUBPANELS.length],
    height: paneCount === 1 ? 460 : paneCount === 2 ? 300 : 250
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <LineChart size={22} className="text-primary" /> Professional Charting
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Eight chart types, linear/log/percent scales, multi-pane layouts with synchronised crosshair, {OVERLAY_OPTIONS.length}+
            overlay indicators, seven study panels, volume profile, DOM overlay and drawing tools.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="btn-ghost !h-9 !px-3 !text-xs">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="input-dark !h-8 !w-auto !py-0 text-xs">
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}/USDT</option>)}
          </select>

          <div className="flex items-center gap-1 rounded-lg border border-input p-0.5" role="group" aria-label="Timeframe">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setIntervalKey(iv)}
                aria-pressed={interval === iv}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${interval === iv ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {iv}
              </button>
            ))}
          </div>

          <select aria-label="Chart type" value={type} onChange={(e) => setType(e.target.value)} className="input-dark !h-8 !w-auto !py-0 text-xs">
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <select aria-label="Scale" value={scale} onChange={(e) => setScale(e.target.value)} className="input-dark !h-8 !w-auto !py-0 text-xs">
            {SCALES.map(([v, l]) => <option key={v} value={v}>{l} scale</option>)}
          </select>

          <div className="flex items-center gap-1 rounded-lg border border-input p-0.5" role="group" aria-label="Layout">
            {LAYOUTS.map((n) => (
              <button
                key={n}
                onClick={() => setLayout(n)}
                aria-pressed={layout === n}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${layout === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {n} pane{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {OVERLAY_OPTIONS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-muted-foreground">
              <input type="checkbox" checked={overlays.includes(key)} onChange={() => toggleOverlay(key)} className="accent-[#FFC105]" />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked={showProfile} onChange={(e) => setShowProfile(e.target.checked)} className="accent-[#FFC105]" />
            Volume profile
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked={showDepth} onChange={(e) => setShowDepth(e.target.checked)} className="accent-[#FFC105]" />
            DOM overlay
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-input p-0.5" role="group" aria-label="Drawing tool">
            {TOOLS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTool(key)}
                aria-pressed={tool === key}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${tool === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {paneCount === 1 ? (
            <select aria-label="Study panel" value={subpanel} onChange={(e) => setSubpanel(e.target.value)} className="input-dark !h-8 !w-auto !py-0 text-xs">
              {SUBPANELS.map(([v, l]) => <option key={v} value={v}>{l} panel</option>)}
            </select>
          ) : null}
          <button onClick={() => setDrawings([])} className="btn-ghost !h-8 !px-2 !text-[11px]">
            <Eraser size={12} /> Clear drawings
          </button>
          <span className="text-[11px] text-muted-foreground">
            {lastAt ? `Updated ${timeAgo(lastAt)}` : ''} · {drawings.length} drawing(s) · hover synced across panes
          </span>
        </div>
      </Card>

      {source === 'simulated' ? (
        <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[11px] text-amber-300">
          Live candle data is unavailable — this chart shows synthetic bars for layout only. Do not use it for decisions.
        </div>
      ) : null}

      {/* Charts */}
      <div className={paneCount === 1 ? '' : 'grid gap-3 lg:grid-cols-2'}>
        {panes.map((pane, idx) => (
          <Card key={pane.key} className="overflow-hidden !p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <Layers size={13} className="text-primary" />
              <span className="text-xs font-semibold">{symbol}/USDT · {interval} · {TYPES.find((t) => t[0] === type)?.[1]}</span>
              {livePrice && idx === 0 ? <span className="num text-xs text-muted-foreground">{fmtPrice(livePrice)}</span> : null}
              {paneCount > 1 ? <span className="ml-auto text-[11px] text-muted-foreground">pane {idx + 1} · {pane.subpanel}</span> : null}
            </div>
            {display?.length ? (ALT_TYPES.includes(type) ? (
              <AltChart type={type} candles={display} interval={interval} height={pane.height} />
            ) : (
              <ProChart
                candles={display}
                symbol={symbol}
                interval={interval}
                type={type}
                scale={scale}
                overlays={overlays}
                subpanel={pane.subpanel}
                drawings={idx === 0 ? drawings : []}
                tool={idx === 0 ? tool : 'none'}
                onDrawingsChange={setDrawings}
                showVolumeProfile={showProfile}
                showVwap={overlays.includes('sma20')}
                depth={depth}
                showDepth={showDepth && idx === 0}
                height={pane.height}
                externalHover={hover}
                onHover={(h) => { if (idx === 0) setHover(h); }}
                label={`${symbol} ${interval} chart`}
              />
            )) : (
              <div role="status" className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                {loading ? <><Loader2 size={18} className="mr-2 animate-spin" /> Loading candles…</> : 'No chart data'}
              </div>
            )}
          </Card>
        ))}
      </div>

      <IndicatorMarketplace candles={display || []} />

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Indicators: SMA, EMA, WMA, Bollinger, Ichimoku, Supertrend, VWAP + studies RSI, MACD, ATR, ADX, OBV, Stochastic.
          Kagi, Point &amp; Figure and market profile have dedicated renderers; the indicator marketplace and
          user-created indicators live below. {feed.simulated ? 'Feed degraded — signals paused.' : ''}
        </span>
      </div>
    </div>
  );
}
