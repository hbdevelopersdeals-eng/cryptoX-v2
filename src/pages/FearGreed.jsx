import React, { useEffect, useState } from 'react';
import { Smile } from 'lucide-react';
import { fetchFearGreed } from '../lib/market.jsx';
import { Card } from '../components/ui.jsx';
import { FearGreedGauge, getFearGreedColor } from '../components/FearGreedGauge.jsx';

function colorFor(v) {
  return getFearGreedColor(v);
}
const ZONES = [
  ['0 – 24', 'Extreme Fear', '#f87171'],
  ['25 – 44', 'Fear', '#fb923c'],
  ['45 – 54', 'Neutral', '#737B8C'],
  ['55 – 74', 'Greed', '#a3e635'],
  ['75 – 100', 'Extreme Greed', '#34d399']
];

export default function FearGreedPage() {
  const [series, setSeries] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    fetchFearGreed()
      .then((res) => { if (!alive) return; setSeries(res.series); setSource(res.source); })
      .catch(() => { if (alive) setErr('Index unavailable'); });
    return () => { alive = false; };
  }, []);

  const [source, setSource] = useState('live');
  const cur = series?.[0];
  const value = cur?.value ?? null;

  // semicircle gauge
  const R = 90;
  const CIRC = Math.PI * R; // half circumference
  const frac = value == null ? 0 : value / 100;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Fear &amp; Greed Index</h1>
          <p className="mt-1 text-sm text-muted-foreground">Market sentiment — derived from volatility, momentum and volume. Updates daily.</p>
        </div>
        {source === 'simulated' ? (
          <span className="chip !border-amber-400/30 !bg-amber-400/10 !py-1.5 text-amber-400" role="status">
            Simulated index — live sentiment feed unavailable
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center p-6 lg:col-span-1">
          {value == null ? (
            <p className="py-16 text-sm text-muted-foreground">{err || 'Loading index…'}</p>
          ) : (
            <FearGreedGauge
              value={value}
              label={cur?.label || 'Neutral'}
              date={cur ? `Alternative.me · ${new Date(cur.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
              className="w-full"
            />
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Smile size={15} className="text-primary" /> What the zones mean</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ZONES.map(([range, label, color]) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-[11px] text-muted-foreground">{range}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Extreme fear can signal a buying opportunity; extreme greed often warns of froth. Sentiment is a contrarian input — combine it with your own research, never trade on this number alone.
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-semibold">Last 30 days</h2>
        {!series?.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading history…</p>
        ) : (
          <div className="flex h-40 items-end gap-1">
            {[...series].reverse().map((d, i) => (
              <div key={i} className="group relative flex flex-1 flex-col items-center justify-end" title={`${d.label} ${d.value} — ${new Date(d.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}>
                <span className="num mb-1 hidden text-[9px] text-muted-foreground group-hover:block">{d.value}</span>
                <div className="w-full rounded-t-sm transition-opacity group-hover:opacity-100" style={{ height: `${d.value}%`, background: colorFor(d.value), opacity: 0.9 }} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>30 days ago</span><span>Today</span>
        </div>
      </Card>
    </div>
  );
}
