import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { heikinAshi, volumeProfile, scaleValue } from '../lib/chartTypes.js';
import { sma, ema, macd as macdCalc, rsi, bollinger, stochastic } from '../lib/indicators.js';
import { wma, atr, adx, obv, ichimoku, supertrend, buildCustom } from '../lib/indicators2.js';

const UP = '#34d399';
const DOWN = '#f87171';
const GRID = 'rgba(31,34,40,0.85)';
const TXT = '#8b93a3';
const PAD = { l: 8, r: 74, t: 12, b: 22 };

const nice = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toFixed(8);
};

function timeLabel(t, interval) {
  const d = new Date(t);
  if (['1d', '3d', '1w', '1M'].includes(interval)) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function ProChart({
  candles = [],
  symbol = '',
  interval = '1h',
  type = 'candles',
  scale = 'linear',
  overlays = ['sma20'],
  subpanel = 'rsi',
  drawings = [],
  tool = 'none',
  onDrawingsChange,
  showVolumeProfile = false,
  showVwap = true,
  depth = null,
  showDepth = false,
  height = 420,
  onHover,
  externalHover = null,
  label = 'Price chart'
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [w, setW] = useState(720);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [drag, setDrag] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth || 720);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (externalHover == null) return;
    setHoverIdx(externalHover);
  }, [externalHover]);

  const prepared = useMemo(() => {
    if (!candles?.length) return { bars: [], closes: [] };
    const bars = type === 'heikin' ? heikinAshi(candles) : candles;
    return { bars, closes: bars.map((b) => b.c) };
  }, [candles, type]);

  const profile = useMemo(
    () => (showVolumeProfile ? volumeProfile(prepared.bars, { bins: 26 }) : null),
    [prepared.bars, showVolumeProfile]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    const bars = prepared.bars;
    const n = bars?.length || 0;
    if (!n) {
      ctx.fillStyle = TXT;
      ctx.fillText('No chart data', 12, 24);
      return;
    }

    const hasSub = subpanel !== 'none';
    const priceH = showVolumeProfile ? (hasSub ? height * 0.5 : height * 0.62) : (hasSub ? height * 0.62 : height * 0.78);
    const volH = height * 0.12;
    const subTop = PAD.t + priceH + volH + 10;
    const subH = hasSub ? Math.max(50, height - subTop - PAD.b - 4) : 0;
    const plotW = w - PAD.l - PAD.r;

    // ---- y scale -------------------------------------------------------
    const lows = bars.map((b) => b.l);
    const highs = bars.map((b) => b.h);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (scale === 'log' && min <= 0) min = Math.max(1e-8, max * 0.01);
    const base = scale === 'percent' ? bars[0].c : null;
    const mapVal = (v) => scaleValue(v, { mode: scale, base });
    const mapped = bars.map((b) => ({ lo: mapVal(b.l), hi: mapVal(b.h) }));
    const mMmin = Math.min(...mapped.map((m) => m.lo).filter((v) => v != null));
    const mMmax = Math.max(...mapped.map((m) => m.hi).filter((v) => v != null));
    const span = (mMmax - mMmin) || 1;
    const yFor = (price) => {
      const v = mapVal(price);
      if (v == null) return PAD.t + priceH;
      return PAD.t + priceH - ((v - mMmin) / span) * priceH;
    };
    const xFor = (i) => PAD.l + (plotW * (i + 0.5)) / n;

    // ---- axes / grid ---------------------------------------------------
    ctx.strokeStyle = GRID;
    ctx.fillStyle = TXT;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = PAD.t + (priceH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + plotW, y);
      ctx.stroke();
      const price = scale === 'log'
        ? 10 ** (mMmax - (span * g) / 4)
        : scale === 'percent'
          ? (base || 0) * (1 + ((mMmax - (span * g) / 4) / 100))
          : mMmax - (span * g) / 4;
      ctx.fillText(scale === 'percent' ? `${((mMmax - (span * g) / 4)).toFixed(2)}%` : nice(price), PAD.l + plotW + 6, y + 3);
    }
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
      ctx.fillText(timeLabel(bars[i].t, interval), xFor(i) - 14, height - 6);
    }

    // ---- volume --------------------------------------------------------
    const maxVol = Math.max(...bars.map((b) => b.v || 0), 1);
    bars.forEach((b, i) => {
      const vh = ((b.v || 0) / maxVol) * (volH - 4);
      ctx.fillStyle = b.c >= b.o ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)';
      ctx.fillRect(xFor(i) - Math.max(1, plotW / n / 3), PAD.t + priceH + (volH - vh), Math.max(1.5, plotW / n / 1.6), vh);
    });

    // ---- volume profile ------------------------------------------------
    if (profile?.rows?.length) {
      const maxTotal = Math.max(...profile.rows.map((r) => r.total), 1);
      profile.rows.forEach((row) => {
        const y = yFor(row.price);
        const bw = (row.total / maxTotal) * Math.min(90, plotW * 0.18);
        const inVa = profile.valueArea && row.price >= profile.valueArea.low && row.price <= profile.valueArea.high;
        ctx.fillStyle = inVa ? 'rgba(255,193,5,0.28)' : 'rgba(115,123,140,0.18)';
        ctx.fillRect(PAD.l + plotW - bw, y - 3, bw, 5);
      });
      const pocY = yFor(profile.poc);
      ctx.strokeStyle = 'rgba(255,193,5,0.7)';
      ctx.beginPath();
      ctx.moveTo(PAD.l, pocY);
      ctx.lineTo(PAD.l + plotW, pocY);
      ctx.stroke();
    }

    // ---- price series --------------------------------------------------
    const bw = Math.max(1.5, (plotW / n) * 0.62);
    const linePath = () => {
      ctx.beginPath();
      bars.forEach((b, i) => {
        const x = xFor(i);
        const y = yFor(b.c);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    if (type === 'line' || type === 'area' || type === 'baseline') {
      ctx.strokeStyle = '#FFC105';
      ctx.lineWidth = 1.6;
      linePath();
      if (type === 'area') {
        ctx.lineTo(xFor(n - 1), PAD.t + priceH);
        ctx.lineTo(xFor(0), PAD.t + priceH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,193,5,0.12)';
        ctx.fill();
      }
      if (type === 'baseline' && base) {
        const y = yFor(base);
        ctx.strokeStyle = 'rgba(115,123,140,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(PAD.l + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      bars.forEach((b, i) => {
        const x = xFor(i);
        const up = b.c >= b.o;
        ctx.strokeStyle = up ? UP : DOWN;
        ctx.fillStyle = up ? UP : DOWN;
        ctx.beginPath();
        ctx.moveTo(x, yFor(b.h));
        ctx.lineTo(x, yFor(b.l));
        ctx.stroke();
        const top = yFor(Math.max(b.o, b.c));
        const bot = yFor(Math.min(b.o, b.c));
        const h = Math.max(1, bot - top);
        if (type === 'hollow') {
          ctx.strokeRect(x - bw / 2, top, bw, h);
        } else {
          ctx.fillRect(x - bw / 2, top, bw, h);
        }
      });
    }

    // ---- overlays ------------------------------------------------------
    const drawLine = (series, color, dash = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      series.forEach((v, i) => {
        if (v == null) return;
        const x = xFor(i);
        const y = yFor(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const closes = prepared.closes;
    if (overlays.includes('sma20')) drawLine(sma(closes, 20), '#60a5fa');
    if (overlays.includes('sma50')) drawLine(sma(closes, 50), '#a78bfa');
    if (overlays.includes('ema21')) drawLine(ema(closes, 21), '#f59e0b');
    if (overlays.includes('wma14')) drawLine(wma(closes, 14), '#22d3ee');
    if (overlays.includes('bollinger')) {
      const b = bollinger(closes, 20, 2);
      drawLine(b.upper, 'rgba(115,123,140,0.7)', [3, 3]);
      drawLine(b.lower, 'rgba(115,123,140,0.7)', [3, 3]);
    }
    if (overlays.includes('ichimoku')) {
      const ich = ichimoku(highs, lows, closes);
      drawLine(ich.tenkan, '#f472b6');
      drawLine(ich.kijun, '#38bdf8');
      drawLine(ich.senkouB, 'rgba(52,211,153,0.6)', [4, 3]);
    }
    if (overlays.includes('supertrend')) {
      const st = supertrend(highs, lows, closes);
      drawLine(st.line, '#fbbf24');
    }
    if (showVwap) {
      const vwapSeries = [];
      let pv = 0;
      let vv = 0;
      bars.forEach((b) => {
        const tp = (b.h + b.l + b.c) / 3;
        pv += tp * (b.v || 0);
        vv += b.v || 0;
        vwapSeries.push(vv ? pv / vv : null);
      });
      drawLine(vwapSeries, '#e879f9', [5, 3]);
    }
    if (overlays.includes('custom')) {
      drawLine(buildCustom(closes, { ma: 'wma', period: 9 }), '#4ade80', [2, 3]);
    }

    // ---- depth overlay (DOM) -------------------------------------------
    if (showDepth && depth?.bids?.length) {
      const maxQ = Math.max(...depth.bids.map((l) => l.qty), ...depth.asks.map((l) => l.qty), 1e-9);
      depth.asks.slice(0, 6).forEach((l, i) => {
        const y = PAD.t + 14 + i * 12;
        const bwid = (l.qty / maxQ) * 60;
        ctx.fillStyle = 'rgba(248,113,113,0.35)';
        ctx.fillRect(PAD.l + plotW - bwid, y - 5, bwid, 8);
        ctx.fillStyle = TXT;
        ctx.fillText(nice(l.price), PAD.l + 4, y + 2);
      });
      depth.bids.slice(0, 6).forEach((l, i) => {
        const y = PAD.t + 14 + (6 + i) * 12;
        const bwid = (l.qty / maxQ) * 60;
        ctx.fillStyle = 'rgba(52,211,153,0.35)';
        ctx.fillRect(PAD.l + plotW - bwid, y - 5, bwid, 8);
        ctx.fillStyle = TXT;
        ctx.fillText(nice(l.price), PAD.l + 4, y + 2);
      });
    }

    // ---- subpanel ------------------------------------------------------
    if (hasSub) {
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(PAD.l, subTop);
      ctx.lineTo(PAD.l + plotW, subTop);
      ctx.stroke();

      const drawOsc = (series, color, min0, max0) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        series.forEach((v, i) => {
          if (v == null) return;
          const x = xFor(i);
          const y = subTop + subH - ((v - min0) / (max0 - min0)) * subH;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      };

      if (subpanel === 'rsi') {
        drawOsc(rsi(closes, 14), '#FFC105', 0, 100);
        [30, 70].forEach((lvl) => {
          const y = subTop + subH - (lvl / 100) * subH;
          ctx.strokeStyle = 'rgba(115,123,140,0.4)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(PAD.l, y);
          ctx.lineTo(PAD.l + plotW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = TXT;
          ctx.fillText(String(lvl), PAD.l + plotW + 6, y + 3);
        });
        const last = rsi(closes, 14).filter((v) => v != null).pop();
        ctx.fillStyle = TXT;
        ctx.fillText(`RSI ${last == null ? '—' : last.toFixed(1)}`, PAD.l + 4, subTop + 10);
      } else if (subpanel === 'macd') {
        const m = macdCalc(closes);
        const vals = [...m.line, ...m.signal, ...m.hist].filter((v) => v != null);
        const lo = Math.min(...vals, 0);
        const hi = Math.max(...vals, 0);
        drawOsc(m.line, '#60a5fa', lo, hi);
        drawOsc(m.signal, '#f59e0b', lo, hi);
        m.hist.forEach((v, i) => {
          if (v == null) return;
          const x = xFor(i);
          const zero = subTop + subH - ((0 - lo) / (hi - lo)) * subH;
          const y = subTop + subH - ((v - lo) / (hi - lo)) * subH;
          ctx.fillStyle = v >= 0 ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)';
          ctx.fillRect(x - 1, Math.min(y, zero), 2, Math.abs(zero - y));
        });
        ctx.fillStyle = TXT;
        ctx.fillText('MACD 12/26/9', PAD.l + 4, subTop + 10);
      } else if (subpanel === 'atr') {
        const a = atr(highs, lows, closes, 14).filter((v) => v != null);
        drawOsc(atr(highs, lows, closes, 14), '#a78bfa', 0, Math.max(...a, 1e-9));
        ctx.fillStyle = TXT;
        ctx.fillText(`ATR ${a.length ? a[a.length - 1].toFixed(4) : '—'}`, PAD.l + 4, subTop + 10);
      } else if (subpanel === 'adx') {
        const a = adx(highs, lows, closes, 14);
        drawOsc(a.adx, '#FFC105', 0, 100);
        drawOsc(a.plusDI, '#34d399', 0, 100);
        drawOsc(a.minusDI, '#f87171', 0, 100);
        ctx.fillStyle = TXT;
        ctx.fillText('ADX 14 (DI+/DI-)', PAD.l + 4, subTop + 10);
      } else if (subpanel === 'obv') {
        const o = obv(closes, bars.map((b) => b.v || 0)).filter((v) => v != null);
        const lo = Math.min(...o, 0);
        const hi = Math.max(...o, 1);
        drawOsc(obv(closes, bars.map((b) => b.v || 0)), '#22d3ee', lo, hi);
        ctx.fillStyle = TXT;
        ctx.fillText('OBV', PAD.l + 4, subTop + 10);
      } else if (subpanel === 'stochastic') {
        const st = stochastic(highs, lows, closes, 14, 3);
        drawOsc(st.k, '#FFC105', 0, 100);
        drawOsc(st.d, '#60a5fa', 0, 100);
        ctx.fillStyle = TXT;
        ctx.fillText('Stoch %K/%D', PAD.l + 4, subTop + 10);
      }
    }

    // ---- drawings ------------------------------------------------------
    const px = (i) => xFor(i);
    drawings.forEach((d) => {
      ctx.strokeStyle = '#FFC105';
      ctx.fillStyle = 'rgba(255,193,5,0.12)';
      ctx.lineWidth = 1.3;
      const x1 = px(d.from.i);
      const y1 = yFor(d.from.price);
      const x2 = px(d.to.i);
      const y2 = yFor(d.to.price);
      if (d.kind === 'trend' || d.kind === 'ray') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const dx = x2 - x1;
        const dy = y2 - y1;
        if (d.kind === 'ray' && dx !== 0) {
          const scaleF = (PAD.l + plotW - x1) / dx;
          ctx.lineTo(PAD.l + plotW, y1 + dy * scaleF);
        } else {
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      } else if (d.kind === 'hline') {
        ctx.beginPath();
        ctx.moveTo(PAD.l, y1);
        ctx.lineTo(PAD.l + plotW, y1);
        ctx.stroke();
        ctx.fillText(nice(d.from.price), PAD.l + plotW + 6, y1 - 3);
      } else if (d.kind === 'rect') {
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      } else if (d.kind === 'fib') {
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        levels.forEach((lv) => {
          const price = d.from.price + (d.to.price - d.from.price) * lv;
          const y = yFor(price);
          ctx.strokeStyle = lv === 0 || lv === 1 ? '#FFC105' : 'rgba(255,193,5,0.55)';
          ctx.setLineDash(lv === 0 || lv === 1 ? [] : [4, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.min(x1, x2), y);
          ctx.lineTo(Math.max(x1, x2), y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = TXT;
          ctx.fillText(`${(lv * 100).toFixed(1)}% ${nice(price)}`, Math.min(x1, x2) + 4, y - 2);
        });
      } else if (d.kind === 'measure') {
        ctx.strokeStyle = '#8b93a3';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        const pctMove = ((d.to.price - d.from.price) / d.from.price) * 100;
        const bars_ = d.to.i - d.from.i;
        ctx.fillStyle = pctMove >= 0 ? UP : DOWN;
        ctx.fillText(`${pctMove >= 0 ? '+' : ''}${pctMove.toFixed(2)}% · ${bars_} bars`, Math.max(x1, x2) + 6, Math.min(y1, y2) + 10);
      }
    });
    if (drag?.from && drag?.to) {
      ctx.strokeStyle = 'rgba(255,193,5,0.6)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px(drag.from.i), yFor(drag.from.price));
      ctx.lineTo(px(drag.to.i), yFor(drag.to.price));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ---- crosshair -----------------------------------------------------
    if (hoverIdx != null && bars[hoverIdx]) {
      const b = bars[hoverIdx];
      const x = xFor(hoverIdx);
      ctx.strokeStyle = 'rgba(139,147,163,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, height - PAD.b);
      ctx.moveTo(PAD.l, yFor(b.c));
      ctx.lineTo(PAD.l + plotW, yFor(b.c));
      ctx.stroke();
      ctx.setLineDash([]);

      const chg = ((b.c - b.o) / b.o) * 100;
      const lines = [
        `${timeLabel(b.t, interval)}`,
        `O ${nice(b.o)}  H ${nice(b.h)}`,
        `L ${nice(b.l)}  C ${nice(b.c)}`,
        `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%  Vol ${b.v ? Math.round(b.v).toLocaleString() : '—'}`
      ];
      const boxW = 168;
      const boxX = Math.min(Math.max(PAD.l + 4, x + 8), PAD.l + plotW - boxW);
      ctx.fillStyle = 'rgba(15,17,21,0.92)';
      ctx.fillRect(boxX, PAD.t + 4, boxW, 14 * lines.length + 8);
      ctx.fillStyle = '#e5e7eb';
      lines.forEach((ln, k) => ctx.fillText(ln, boxX + 6, PAD.t + 18 + k * 14));
    }
  }, [prepared, w, height, type, scale, overlays, subpanel, drawings, drag, hoverIdx, showVolumeProfile, profile, showVwap, depth, showDepth, interval]);

  const idxFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const n = prepared.bars.length || 1;
    const plotW = w - PAD.l - PAD.r;
    const clamped = Math.min(plotW - 1, Math.max(0, e.clientX - rect.left - PAD.l));
    return Math.round((clamped / plotW) * n - 0.5);
  };

  const onMove = (e) => {
    const i = Math.max(0, Math.min((prepared.bars.length || 1) - 1, idxFromEvent(e)));
    setHoverIdx(i);
    onHover?.(i);
    if (drag?.from) {
      setDrag({ from: drag.from, to: { i, price: prepared.bars[i]?.c ?? drag.from.price } });
    }
  };

  const onDown = () => {
    if (tool === 'none' || !prepared.bars.length) return;
    const i = Math.max(0, Math.min(prepared.bars.length - 1, hoverIdx ?? prepared.bars.length - 1));
    const price = prepared.bars[i].c;
    if (tool === 'hline') {
      onDrawingsChange?.([...drawings, { id: `d${Date.now()}`, kind: 'hline', from: { i, price }, to: { i, price } }]);
      return;
    }
    setDrag({ from: { i, price }, to: { i, price } });
  };

  const onUp = () => {
    if (!drag?.from || !drag?.to) return;
    onDrawingsChange?.([...drawings, { id: `d${Date.now()}`, kind: tool === 'none' ? 'trend' : tool, from: drag.from, to: drag.to }]);
    setDrag(null);
  };

  return (
    <div ref={wrapRef} style={{ height, width: '100%' }} className="relative select-none overflow-hidden" data-chart-type={type}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, display: 'block', cursor: tool === 'none' ? 'crosshair' : 'copy' }}
        role="img"
        aria-label={`${label}, ${type} chart, ${scale} scale`}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseLeave={() => { setHoverIdx(null); onHover?.(null); }}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onKeyDown={(e) => {
          const n = prepared.bars.length;
          if (!n) return;
          const cur = hoverIdx ?? n - 1;
          if (e.key === 'ArrowRight') { setHoverIdx(Math.min(n - 1, cur + 1)); onHover?.(Math.min(n - 1, cur + 1)); e.preventDefault(); }
          if (e.key === 'ArrowLeft') { setHoverIdx(Math.max(0, cur - 1)); onHover?.(Math.max(0, cur - 1)); e.preventDefault(); }
          if (e.key === 'Home') { setHoverIdx(0); onHover?.(0); e.preventDefault(); }
          if (e.key === 'End') { setHoverIdx(n - 1); onHover?.(n - 1); e.preventDefault(); }
        }}
      />
    </div>
  );
}
