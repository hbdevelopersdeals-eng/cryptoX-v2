import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarket } from '../lib/market.jsx';
import { mulberry32 } from '../lib/indicators.js';
import { fmtPrice, cls } from '../lib/format.js';

/* Bubble chart: circle area ~ market cap, color = 24h change. */

export default function BubblesPage() {
  const { rows } = useMarket();
  const nav = useNavigate();
  const boxRef = useRef(null);
  const [size, setSize] = useState({ w: 900, h: 600 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bubbles = useMemo(() => {
    const coins = [...rows].sort((a, b) => b.mcap - a.mcap).slice(0, 60);
    if (!coins.length) return [];
    const min = Math.log10(Math.max(coins[coins.length - 1].mcap, 1e6));
    const max = Math.log10(Math.max(coins[0].mcap, 1e6));
    const placed = [];
    const W = Math.max(size.w - 24, 320);
    const H = Math.max(size.h - 24, 320);
    const rnd = mulberry32(1234);

    for (const c of coins) {
      const lr = Math.log10(Math.max(c.mcap, 1e6));
      const r = Math.max(7, Math.min(78, 14 + ((lr - min) / (max - min || 1)) * 60));
      let px = r + 10, py = r + 10, ok = false;
      for (let t = 0; t < 260; t++) {
        const x = r + 10 + rnd() * (W - 2 * r - 20);
        const y = r + 10 + rnd() * (H - 2 * r - 20);
        let good = true;
        for (const p of placed) {
          const dx = x - p.x, dy = y - p.y;
          if (dx * dx + dy * dy < (r + p.r + 3) ** 2) { good = false; break; }
        }
        if (good) { px = x; py = y; ok = true; break; }
      }
      if (!ok) { px = r + 10 + rnd() * (W - 2 * r - 20); py = r + 10 + rnd() * (H - 2 * r - 20); }
      placed.push({ x: px, y: py, r, c });
    }
    return placed;
  }, [rows, size]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Crypto Bubbles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bubble size = market cap · colour = 24h change · click any bubble for the full chart
        </p>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-up" /> Gainers</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-down" /> Losers</span>
        <span className="ml-auto num">Top 60 by market cap</span>
      </div>
      <div ref={boxRef} className="card-panel relative h-[62vh] min-h-[420px] overflow-hidden">
        {!bubbles.length ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading bubbles…</div>
        ) : (
          bubbles.map(({ x, y, r, c }, i) => {
            const up = (c.pct24 ?? 0) >= 0;
            return (
              <button
                key={c.id + i}
                onClick={() => nav(`/coin/${c.id}`)}
                title={`${c.name} (${c.symbol}) · $${c.price?.toLocaleString()} · ${c.pct24 >= 0 ? '+' : ''}${c.pct24?.toFixed(2)}% · MCap $${(c.mcap / 1e9).toFixed(1)}B`}
                className="absolute flex items-center justify-center rounded-full border border-white/10 transition-transform duration-200 hover:z-20 hover:scale-105"
                style={{
                  left: x - r, top: y - r, width: r * 2, height: r * 2,
                  background: up ? 'radial-gradient(circle at 32% 28%, rgba(52,211,153,0.55), rgba(52,211,153,0.10))' : 'radial-gradient(circle at 32% 28%, rgba(248,113,113,0.55), rgba(248,113,113,0.10))',
                  boxShadow: `0 0 ${Math.max(6, r / 4)}px ${up ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`
                }}
              >
                {r > 13 ? (
                  <span className={`pointer-events-none select-none font-bold ${r > 30 ? 'text-[13px]' : 'text-[9px]'}`}>{c.symbol}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
