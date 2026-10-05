import React, { useEffect, useMemo, useRef, useState } from 'react';
import { kagi, pointAndFigure, marketProfile } from '../lib/chartTypes.js';
import { fmtPrice } from '../lib/format.js';

/**
 * Renderers for the chart types that do not share the OHLC pipeline.
 *
 * Renko and range bars emit candle-shaped bars, so ProChart draws them directly.
 * Kagi emits pivot segments, Point & Figure emits columns of boxes, and a market
 * profile is a horizontal histogram — none of those are candles, so they need
 * their own drawing pass. Keeping them here avoids bolting three special cases
 * into the main candlestick renderer.
 */

const PAD = { l: 64, r: 56, t: 14, b: 22 };

const nice = (v) => {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(4);
  return v.toFixed(8);
};

export default function AltChart({ type = 'kagi', candles = [], height = 380, interval = '1h' }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(900);

  /* Responsive width */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w && Math.abs(w - width) > 1) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const data = useMemo(() => {
    const bars = candles || [];
    if (type === 'kagi') return kagi(bars, { reversalPct: 4 });
    if (type === 'pnf') return pointAndFigure(bars, { reversal: 3 });
    if (type === 'profile') return marketProfile(bars, { bins: 26 });
    return null;
  }, [type, candles]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    // jsdom (and any environment without a canvas backend) returns null here.
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const cUp = styles.getPropertyValue('--up').trim() || '#22c55e';
    const cDown = styles.getPropertyValue('--down').trim() || '#ef4444';
    const cText = styles.getPropertyValue('--muted-foreground').trim() || '#94a3b8';
    const cBorder = styles.getPropertyValue('--border').trim() || '#334155';
    const cPrimary = styles.getPropertyValue('--primary').trim() || '#eab308';

    const plotW = Math.max(10, width - PAD.l - PAD.r);
    const plotH = Math.max(10, height - PAD.t - PAD.b);

    const grid = (min, max, xFor) => {
      ctx.strokeStyle = cBorder;
      ctx.fillStyle = cText;
      ctx.lineWidth = 1;
      ctx.font = '10px ui-monospace, monospace';
      const span = max - min || 1;
      for (let g = 0; g <= 4; g += 1) {
        const price = max - (span * g) / 4;
        const y = PAD.t + (plotH * g) / 4;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(PAD.l + plotW, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(nice(price), PAD.l + plotW + 6, y + 3);
      }
      if (xFor) {
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.moveTo(xFor(0) - 12, PAD.t);
        ctx.lineTo(xFor(0) - 12, PAD.t + plotH);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    ctx.fillStyle = cText;
    ctx.font = '11px ui-sans-serif, system-ui';

    /* ---------------- Kagi ---------------- */
    if (type === 'kagi') {
      const segs = data || [];
      if (segs.length < 2) {
        ctx.fillText('Not enough data for a Kagi chart', 12, 24);
        return;
      }
      const prices = segs.map((s) => s.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const span = max - min || 1;
      const xFor = (i) => PAD.l + (plotW * i) / Math.max(1, segs.length - 1);
      const yFor = (p) => PAD.t + plotH - ((p - min) / span) * plotH;

      grid(min - span * 0.05, max + span * 0.05);

      for (let i = 1; i < segs.length; i += 1) {
        const prev = segs[i - 1];
        const cur = segs[i];
        // Yang (rising) segments are drawn heavy; yin (falling) thin.
        ctx.strokeStyle = cur.yang ? cUp : cDown;
        ctx.lineWidth = cur.yang ? 3 : 1.25;
        ctx.beginPath();
        ctx.moveTo(xFor(i - 1), yFor(prev.price));
        if (i > 1) ctx.lineTo(xFor(i - 1), yFor(prev.price));
        ctx.lineTo(xFor(i), yFor(cur.price));
        ctx.stroke();

        // Horizontal shoulder linking this segment to the next.
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xFor(i), yFor(cur.price));
        ctx.lineTo(xFor(i) + (plotW / Math.max(1, segs.length - 1)) * 0.6, yFor(cur.price));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = cText;
      ctx.fillText(`Kagi · ${segs.length} segments · 4% reversal`, PAD.l + 4, PAD.t + plotH + 16);
      return;
    }

    /* ---------------- Point & Figure ---------------- */
    if (type === 'pnf') {
      const cols = data || [];
      const allBoxes = cols.flatMap((c) => c.boxes.map((b) => b.price));
      if (!allBoxes.length) {
        ctx.fillText('Not enough data for a Point & Figure chart', 12, 24);
        return;
      }
      const min = Math.min(...allBoxes);
      const max = Math.max(...allBoxes);
      const box = (max - min) / Math.max(1, Math.round((max - min) / (allBoxes[1] - allBoxes[0] || 1)) || 1);
      const step = Math.max(1e-8, cols[0]?.boxes.length > 1
        ? Math.abs(cols[0].boxes[1].price - cols[0].boxes[0].price)
        : (max - min) / 20);
      const span = max - min || 1;
      const colW = Math.min(26, plotW / Math.max(1, cols.length));
      const xFor = (i) => PAD.l + (plotW * i) / Math.max(1, cols.length);
      const yFor = (p) => PAD.t + plotH - ((p - min) / span) * plotH;

      grid(min - step, max + step);

      cols.forEach((col, ci) => {
        const cx = xFor(ci);
        const rising = col.dir === 1;
        ctx.strokeStyle = rising ? cUp : cDown;
        ctx.lineWidth = 1.6;
        col.boxes.forEach((b) => {
          const y = yFor(b.price);
          const half = Math.min(colW, 22) / 2 - 1;
          const hh = Math.min(plotH / Math.max(1, (max - min) / step), 14) / 2;
          ctx.beginPath();
          if (rising) {
            // X
            ctx.moveTo(cx - half, y - hh);
            ctx.lineTo(cx + half, y + hh);
            ctx.moveTo(cx + half, y - hh);
            ctx.lineTo(cx - half, y + hh);
          } else {
            // O
            ctx.arc(cx, y, Math.max(2, Math.min(half, hh)), 0, Math.PI * 2);
          }
          ctx.stroke();
        });
      });

      ctx.fillStyle = cText;
      ctx.fillText(`Point & Figure · ${cols.length} columns · 3-box reversal`, PAD.l + 4, PAD.t + plotH + 16);
      return;
    }

    /* ---------------- Market profile ---------------- */
    if (type === 'profile') {
      const prof = data;
      const rows = prof?.rows || [];
      if (!rows.length) {
        ctx.fillText('Not enough data for a market profile', 12, 24);
        return;
      }
      // Support whichever count field the profile provides.
      const countOf = (r) => Number(r.volume ?? r.tpo ?? r.count ?? r.v ?? 0);
      const prices = rows.map((r) => r.price ?? r.p ?? 0);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const span = max - min || 1;
      const maxCount = Math.max(1, ...rows.map(countOf));
      const rowH = Math.max(2, plotH / rows.length);
      const yFor = (p) => PAD.t + plotH - ((p - min) / span) * plotH;

      const va = prof.valueArea;
      const poc = prof.poc;

      grid(min - span * 0.05, max + span * 0.05);

      rows.forEach((r) => {
        const p = r.price ?? r.p;
        const n = countOf(r);
        const y = yFor(p) - rowH / 2;
        const w = (n / maxCount) * (plotW * 0.72);
        const isPoc = poc != null && (p === poc || (poc.price != null && poc.price === p));
        const inVA = va && (va.low != null && va.high != null)
          ? p >= Math.min(va.low, va.high) && p <= Math.max(va.low, va.high)
          : false;

        ctx.globalAlpha = isPoc ? 1 : inVA ? 0.72 : 0.32;
        ctx.fillStyle = isPoc ? cPrimary : inVA ? cUp : cText;
        ctx.fillRect(PAD.l, y, w, Math.max(1, rowH - 1));
        ctx.globalAlpha = 1;
      });

      // Mark the point of control.
      const pocPrice = poc?.price ?? poc;
      if (pocPrice != null) {
        const y = yFor(pocPrice);
        ctx.strokeStyle = cPrimary;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(PAD.l + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cPrimary;
        ctx.fillText(`POC ${fmtPrice(pocPrice)}`, PAD.l + 4, y - 3);
      }

      ctx.fillStyle = cText;
      ctx.fillText(
        `Market profile · ${rows.length} price levels${va ? ' · shaded = value area' : ''}`,
        PAD.l + 4,
        PAD.t + plotH + 16
      );
      return;
    }

    ctx.fillText('Nothing to draw', 12, 24);
  }, [type, data, width, height, interval]);

  const label = type === 'kagi' ? 'Kagi' : type === 'pnf' ? 'Point & Figure' : 'Market profile';

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} role="img" aria-label={`${label} chart`} className="block" />
    </div>
  );
}
