import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper, RefreshCw, Radio } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { fmtPrice, fmtCompact, timeAgo, cls } from '../lib/format.js';
import { Card } from '../components/ui.jsx';

/* Honest feed: (1) auto-generated "Market Pulse" summaries from the live feed,
   (2) real exchange/project status updates via the public CoinGecko feed. */

export default function NewsPage() {
  const { rows, global } = useMarket();
  const [ext, setExt] = useState(null);
  const [stamp, setStamp] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/status_updates?per_page=12');
        const j = await res.json();
        if (alive) setExt(j?.status_updates?.map((u) => ({ kind: 'exchange', t: new Date(u.created_at).getTime(), title: u.title || 'Update', desc: u.description, url: u.url })) || null);
      } catch { if (alive) setExt([]); }
    };
    load();
    const iv = setInterval(() => setStamp(Date.now()), 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const pulse = useMemo(() => {
    if (!rows.length) return [];
    const gain = [...rows].sort((a, b) => b.pct24 - a.pct24);
    const loss = [...rows].sort((a, b) => a.pct24 - b.pct24);
    const vol = [...rows].sort((a, b) => b.vol - a.vol);
    const now = stamp;
    const g = gain[0], l = loss[0], v = vol[0], btc = rows.find((r) => r.symbol === 'BTC');
    const items = [];
    const push = (title, desc, tag) => items.push({ kind: 'pulse', t: now - items.length * 18000, title, desc, tag });
    if (g) push(`${g.name} leads today's gainers`, `${g.symbol} is up ${g.pct24 >= 0 ? '+' : ''}${g.pct24?.toFixed(2)}% in 24 hours to ${fmtPrice(g.price)}, the strongest move across the top market.`, 'Top mover');
    if (l && l.id !== g.id) push(`${l.name} under pressure`, `${l.symbol} is down ${Math.abs(l.pct24).toFixed(2)}% over 24h, the largest decline among tracked coins.`, 'Top decliner');
    if (v) push(`${v.name} sees the heaviest volume`, `${v.symbol} traded ${fmtCompact(v.vol)} in the last 24 hours — the most active market right now.`, 'Volume');
    if (btc) push(`Bitcoin trades at ${fmtPrice(btc.price)}`, `BTC is ${btc.pct24 >= 0 ? 'up' : 'down'} ${Math.abs(btc.pct24).toFixed(2)}% today with dominance at ${global.btcDom?.toFixed(1)}% of total market cap.`, 'Market pulse');
    if (global.mcap) push(`Total crypto market cap ${fmtCompact(global.mcap)}`, `Combined 24h volume across exchanges is ${fmtCompact(global.vol)}. Live from the Binance + CoinGecko feed.`, 'Market pulse');
    return items;
  }, [rows, global, stamp]);

  const feed = useMemo(() => {
    const all = [...pulse];
    if (ext) all.push(...ext.map((e) => ({ ...e, kind: 'exchange' })));
    return all.sort((a, b) => b.t - a.t);
  }, [pulse, ext]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">News &amp; Market Pulse</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Latest cryptocurrency news and market updates — auto-generated from the live data feed, refreshed every 30 seconds.
          </p>
        </div>
        <span className="chip !py-1.5"><RefreshCw size={12} className="text-primary" /> auto-refresh 30s</span>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-[11px] text-muted-foreground">
        <Radio size={14} className="mt-0.5 shrink-0 text-primary" />
        <p>"Market pulse" items are generated from real prices in this app's live feed. "Exchange updates" come from the public CoinGecko status feed. This page is not editorial journalism.</p>
      </div>

      {!feed.length ? (
        <Card><p className="py-14 text-center text-sm text-muted-foreground">Gathering headlines from the live feed…</p></Card>
      ) : (
        <div className="space-y-2.5">
          {feed.map((n, i) => (
            <article key={i} className="card-panel p-4 transition-colors hover:bg-card">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${n.kind === 'pulse' ? 'bg-primary/15 text-primary' : 'bg-[#60a5fa]/15 text-[#60a5fa]'}`}>
                  {n.kind === 'pulse' ? n.tag || 'Market Pulse' : 'Exchange update'}
                </span>
                <span>{timeAgo(n.t)}</span>
              </div>
              <h2 className="mt-2 text-[15px] font-semibold leading-snug">{n.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.desc}</p>
              {n.kind === 'exchange' && n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Read more <Newspaper size={12} />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
