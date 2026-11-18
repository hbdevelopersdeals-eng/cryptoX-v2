import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Star, Link2, Check } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { useWatchlist } from '../lib/prefs.jsx';
import { fmtPrice, fmtCompact, cls } from '../lib/format.js';
import { CoinImg, CoinLink, Sparkline, EmptyState, Card } from '../components/ui.jsx';
import { EmptyWatchlistIllustration } from '../components/EmptyIllustrations.jsx';

export default function WatchlistPage() {
  const { rows, byId } = useMarket();
  const [ids, toggle] = useWatchlist();
  const [copied, setCopied] = React.useState(false);

  const coins = useMemo(() => ids.map((id) => byId[id]).filter(Boolean), [ids, byId]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/watchlist`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Watchlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">Star coins anywhere in Crypto Market to track them here live.</p>
        </div>
        {coins.length ? (
          <button onClick={copyShare} className="btn-sm-dark">
            {copied ? <Check size={13} className="text-up" /> : <Link2 size={13} />} {copied ? 'Link Copied!' : 'Copy link'}
          </button>
        ) : null}
      </div>

      {!coins.length ? (
        <Card>
          <EmptyState
            icon={<EmptyWatchlistIllustration size={100} className="mb-2" />}
            title="No coins in your watchlist yet"
            sub="Browse markets and tap the star on any row to add it here."
            action={<Link to="/" className="btn-primary">Browse markets</Link>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden !p-0">
          {coins.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-accent/30 sm:gap-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <CoinLink id={r.id} symbol={r.symbol} name={r.name} image={r.image} size={30} />
              </div>
              <div className="hidden w-24 text-right sm:block"><Sparkline data={r.spark} width={90} height={30} /></div>
              <div className="w-24 text-right">
                <p className="num text-sm">{fmtPrice(r.price)}</p>
              </div>
              <div className="w-24 text-right">
                <p className={`num text-sm font-semibold ${cls(r.pct24)}`}>{r.pct24 >= 0 ? '+' : ''}{r.pct24?.toFixed(2)}%</p>
              </div>
              <div className="hidden w-24 text-right md:block">
                <p className="num text-sm text-muted-foreground">{fmtCompact(r.mcap)}</p>
              </div>
              <button onClick={() => toggle(r.id)} className="rounded-lg p-1.5 text-primary hover:bg-primary/10" title="Remove">
                <Star size={16} fill="currentColor" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
