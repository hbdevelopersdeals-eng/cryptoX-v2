import React from 'react';
import { Activity, Zap, CheckCircle2, ShieldCheck, Database, Radio, TrendingUp, Cpu } from 'lucide-react';

/**
 * Visual strategy badge with algorithmic metrics & vector icon
 */
export function StrategyBadge({
  name = 'RSI Reversal',
  type = 'Momentum',
  sharpe = '2.14',
  winRate = '68.2%',
  risk = 'Medium',
  className = ''
}) {
  const isHighSharpe = parseFloat(sharpe) >= 2.0;

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-card to-background p-4 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Zap size={18} className="transition-transform group-hover:scale-110" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {name}
            </h4>
            <p className="text-xs text-muted-foreground">{type} Preset</p>
          </div>
        </div>

        <span
          className={`rounded px-1.5 py-0.5 text-xs font-mono font-medium ${
            risk === 'Low'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : risk === 'High'
              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {risk}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
        <div>
          <span className="text-muted-foreground">Sharpe Ratio</span>
          <p className={`num font-semibold ${isHighSharpe ? 'text-up' : 'text-foreground'}`}>
            {sharpe}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Historical Win Rate</span>
          <p className="num font-semibold text-foreground">{winRate}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Enhanced Data Provenance Status Badge
 */
export function ProvenancePill({ status = 'live', venue = 'Binance + CoinGecko' }) {
  const isLive = status === 'live';
  const isSimulated = status === 'simulated';

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border ${
        isLive
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : isSimulated
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          : 'border-blue-500/30 bg-blue-500/10 text-blue-400'
      }`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full rounded-full animate-ping opacity-75 ${
            isLive ? 'bg-emerald-400' : isSimulated ? 'bg-amber-400' : 'bg-blue-400'
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            isLive ? 'bg-emerald-500' : isSimulated ? 'bg-amber-500' : 'bg-blue-500'
          }`}
        />
      </span>
      <span className="font-mono font-semibold uppercase">{isLive ? 'LIVE FEED' : isSimulated ? 'FALLBACK GUARD' : 'SYNCING'}</span>
      <span className="text-muted-foreground/80">· {venue}</span>
    </div>
  );
}
