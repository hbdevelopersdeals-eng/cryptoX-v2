import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rsi, sma } from '../lib/indicators.js';

const UP = '#34d399';
const DOWN = '#f87171';
const TXT = '#8b93a3';
const GRID = '#1F2228';

function nice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toFixed(8);
}

function timeLabel(t, interval) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  if (interval === '1d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function CandleChart({ candles = [], interval = '1h', height = 460, label = 'Price chart' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [w, setW] = useState(720);
  const [hoverIdx, setHoverIdx] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width;
      if (cw) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);

    const n = candles?.length || 0;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

    if (!n) {
      ctx.fillStyle = TXT;
      ctx.textAlign = 'center';
      ctx.fillText('No chart data', w / 2, height / 2);
      return;
    }

    const padL = 10, padR = 78, padT = 16;
    const volH = 56, rsiH = 88, gap = 20;
    const priceH = height - padT - volH - gap - rsiH - 26;
    const plotW = w - padL - padR;
    const xFor = (i) => padL + (i + 0.5) * (plotW / n);
    const cw = Math.max(1.5, (plotW / n) * 0.62);

    const closes = candles.map((c) => c.c);
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    const range = hi - lo || 1;
    const yFor = (v) => padT + (1 - (v - lo) / range) * priceH;

    // volume scale
    let vMax = 1;
    for (const c of candles) if (c.v > vMax) vMax = c.v;
    const volTop = padT + priceH + gap;
    const volY = (v) => volTop + volH * (1 - v / vMax);

    // RSI panel geometry
    const rsiTop = volTop + volH + gap;
    const rsiBot = rsiTop + rsiH;
    const rsiVals = rsi(closes, 14);
    const yRsi = (v) => rsiTop + (1 - Math.max(0, Math.min(100, v)) / 100) * rsiH;

    // grid + price labels
    const ticks = 5;
    ctx.strokeStyle = GRID;
    ctx.fillStyle = TXT;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (range * i) / ticks;
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(nice(v), w - padR + 6, y + 3);
    }
    // time labels
    ctx.textAlign = 'center';
    const xTicks = 6;
    for (let i = 0; i <= xTicks; i++) {
      const idx = Math.min(n - 1, Math.round((i / xTicks) * (n - 1)));
      ctx.fillText(timeLabel(candles[idx].t, interval), xFor(idx), height - 8);
    }
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(w - padR, padT);
    ctx.stroke();

    // volume bars
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const upC = c.c >= c.o;
      ctx.fillStyle = upC ? UP : DOWN;
      ctx.globalAlpha = 0.35;
      const vy = volY(c.v);
      ctx.fillRect(xFor(i) - cw / 2, vy, cw, volTop + volH - vy);
      ctx.globalAlpha = 1;
    }

    // candles: wick + body
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const upC = c.c >= c.o;
      ctx.strokeStyle = upC ? UP : DOWN;
      ctx.fillStyle = upC ? UP : DOWN;
      ctx.beginPath();
      ctx.moveTo(xFor(i), yFor(c.h));
      ctx.lineTo(xFor(i), yFor(c.l));
      ctx.stroke();
      const yO = yFor(c.o), yC = yFor(c.c);
      const top = Math.min(yO, yC);
      const bh = Math.max(1, Math.abs(yO - yC));
      ctx.fillRect(xFor(i) - cw / 2, top, cw, bh);
    }

    // MA overlays
    const drawLine = (values, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null) { started = false; continue; }
        const x = xFor(i), y = yFor(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawLine(sma(closes, 20), '#60a5fa');
    drawLine(sma(closes, 50), '#a78bfa');

    // RSI panel
    ctx.fillStyle = '#a78bfa';
    ctx.textAlign = 'left';
    ctx.fillText('RSI 14', padL, rsiTop - 6);
    for (const lv of [30, 50, 70]) {
      ctx.strokeStyle = GRID;
      ctx.setLineDash(lv === 50 ? [3, 4] : [2, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, yRsi(lv));
      ctx.lineTo(w - padR, yRsi(lv));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(52,211,153,0.05)';
    ctx.fillRect(padL, yRsi(70), plotW, yRsi(30) - yRsi(70));
    ctx.fillStyle = TXT;
    ctx.fillText('30', padL + 2, yRsi(30) - 3);
    ctx.fillText('70', padL + 2, yRsi(70) - 3);
    ctx.strokeStyle = '#FFC105';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let rs = false;
    for (let i = 0; i < rsiVals.length; i++) {
      const v = rsiVals[i];
      if (v == null) { rs = false; continue; }
      const x = xFor(i), y = yRsi(v);
      if (!rs) { ctx.moveTo(x, y); rs = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // last price line + tag
    const lastC = candles[n - 1].c;
    const lcUp = lastC >= candles[0].o || lastC >= candles[n - 2]?.c;
    ctx.strokeStyle = lcUp ? UP : DOWN;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yFor(lastC));
    ctx.lineTo(w - padR, yFor(lastC));
    ctx.stroke();
    ctx.setLineDash([]);

    // legend
    ctx.fillStyle = TXT;
    ctx.textAlign = 'left';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const leg = [['MA20', '#60a5fa'], ['MA50', '#a78bfa'], ['RSI 14', '#FFC105']];
    let lx = padL;
    for (const [name, color] of leg) {
      ctx.fillStyle = color;
      ctx.fillRect(lx, padT - 12, 10, 2);
      ctx.fillText(name, lx + 13, padT - 8);
      lx += 13 + ctx.measureText(name).width + 14;
    }

    // crosshair + OHLC box
    const h = hoverIdx == null ? null : Math.max(0, Math.min(n - 1, hoverIdx));
    if (h != null) {
      const c = candles[h];
      const x = xFor(h);
      ctx.strokeStyle = 'rgba(240,242,245,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, priceH + padT);
      ctx.stroke();
      ctx.setLineDash([]);

      const lines = [
        `${timeLabel(c.t, interval)}`,
        `O ${nice(c.o)}`, `H ${nice(c.h)}`, `L ${nice(c.l)}`, `C ${nice(c.c)}`,
        `V ${c.v >= 1e6 ? (c.v / 1e6).toFixed(2) + 'M' : c.v.toFixed(0)}`
      ];
      const bw = 150;
      const bh = 18 * lines.length + 10;
      let bx = x + 12;
      if (bx + bw > w - padR) bx = x - bw - 12;
      const by = Math.max(padT, Math.min(priceH + padT - bh, h > n / 2 ? padT : priceH + padT - bh - 6));
      ctx.fillStyle = 'rgba(15,17,21,0.96)';
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 8) : ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      lines.forEach((ln, i) => {
        ctx.fillStyle = i === 0 ? '#F0F2F5' : TXT;
        ctx.fillText(ln, bx + 8, by + 16 + i * 18);
      });
    }
  }, [candles, w, height, interval, hoverIdx]);

  const onMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const n = candles?.length || 0;
    const padL = 10, padR = 78;
    const plotW = rect.width - padL - padR;
    if (plotW <= 0 || !n) { setHoverIdx(null); return; }
    const idx = Math.round(((x - padL) / plotW) * n - 0.5);
    setHoverIdx(idx >= 0 && idx < n ? idx : null);
  };

  const onKeyDown = (e) => {
    const n = candles?.length || 0;
    if (!n) return;
    const cur = hoverIdx == null ? n - 1 : hoverIdx;
    if (e.key === 'ArrowRight') { setHoverIdx(Math.min(n - 1, cur + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setHoverIdx(Math.max(0, cur - 1)); e.preventDefault(); }
    else if (e.key === 'Home') { setHoverIdx(0); e.preventDefault(); }
    else if (e.key === 'End') { setHoverIdx(n - 1); e.preventDefault(); }
    else if (e.key === 'Escape') { setHoverIdx(null); e.preventDefault(); }
  };

  const nBars = candles?.length || 0;
  const summary = nBars
    ? `Interactive candle chart with ${nBars} ${interval} bars. Use Left and Right arrow keys to inspect bars, Home and End to jump, Escape to clear. A text data table alternative is available on the page.`
    : 'Chart loading';

  return (
    <div
      ref={wrapRef}
      style={{ height, width: '100%' }}
      className="relative select-none overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="img"
      aria-label={`${label}. ${summary}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: '100%', height, display: 'block' }} />
    </div>
  );
}
