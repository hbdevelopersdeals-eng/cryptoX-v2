import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { fmtPrice, fmtCompact, cls } from '../lib/format.js';
import { CoinImg, Card, Sparkline } from '../components/ui.jsx';

function ListCard({ title, icon, items, metric }) {
  return (
    <Card className="overflow-hidden !p-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">{metric}</span>
      </div>
      <div>
        {items.slice(0, 10).map((r, i) => (
          <Link key={r.id} to={`/coin/${r.id}`} className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-0 hover:bg-accent/40">
            <span className="num w-5 text-xs font-semibold text-muted-foreground">{i + 1}</span>
            <CoinImg src={r.image} symbol={r.symbol} size={22} />
            <span className="min-w-0 flex-1 truncate text-sm">{r.name} <span className="text-xs text-muted-foreground">{r.symbol}</span></span>
            <div className="hidden sm:block"><Sparkline data={r.spark} width={72} height={24} /></div>
            <span className="num text-xs text-muted-foreground">{fmtPrice(r.price)}</span>
            <span className={`num w-20 text-right text-sm font-semibold ${cls(r.pct24)}`}>{r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function TrendingPage() {
  const { rows } = useMarket();

  const lists = useMemo(() => {
    const byVol = [...rows].sort((a, b) => b.vol - a.vol);
    const by7 = [...rows].sort((a, b) => (b.pct7 ?? -999) - (a.pct7 ?? -999));
    const heat = [...rows]
      .filter((r) => r.pct24 != null && r.mcap > 5e8)
      .sort((a, b) => Math.abs(b.pct24) - Math.abs(a.pct24));
    const volLeader = rows.length ? [...rows].sort((a, b) => b.vol - a.vol)[0] : null;
    return { byVol, by7, heat, volLeader };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trending</h1>
          <p className="mt-1 text-sm text-muted-foreground">What's moving in the crypto market right now — from the live feed.</p>
        </div>
        {lists.volLeader ? (
          <span className="chip"><Flame size={13} className="text-primary" /> Volume leader: {lists.volLeader.name} · {fmtCompact(lists.volLeader.vol)}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard title="Top by 24h volume" metric="volume" icon={<Flame size={15} className="text-primary" />} items={lists.byVol} />
        <ListCard title="Top 7d gainers" metric="7d change" icon={<Flame size={15} className="text-up" />} items={lists.by7} />
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Biggest 24h swings</h2>
        <p className="mb-3 text-xs text-muted-foreground">Largest absolute moves across mid/large caps — both directions.</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {lists.heat.slice(0, 10).map((r) => (
            <Link key={r.id} to={`/coin/${r.id}`} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:bg-accent/40">
              <CoinImg src={r.image} symbol={r.symbol} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className={`num text-sm font-bold ${cls(r.pct24)}`}>{r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
