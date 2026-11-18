import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import { getErrorLog, clearErrorLog, APP_VERSION, BUILD_STAMP } from '../lib/telemetry.js';
import { AUTH_MODE } from '../lib/auth.jsx';
import { timeAgo, fmtUsd } from '../lib/format.js';
import { Card } from '../components/ui.jsx';

function Row({ label, ok, detail }) {
  const Icon = ok === true ? CheckCircle2 : ok === false ? XCircle : AlertTriangle;
  const tone = ok === true ? 'text-up' : ok === false ? 'text-down' : 'text-amber-400';
  return (
    <div className="flex items-start gap-3 border-b border-border px-1 py-3 last:border-0">
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default function StatusPage() {
  const { feed, conn, global, refresh } = useMarket();
  const [errors, setErrors] = useState(() => getErrorLog());
  const [usage, setUsage] = useState(null);
  const [tickAge, setTickAge] = useState(null);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setErrors(getErrorLog());
      setTickAge(conn.lastTickAt ? Date.now() - conn.lastTickAt : null);
    }, 2000);
    return () => window.clearInterval(iv);
  }, [conn.lastTickAt]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (navigator.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (alive) setUsage(est);
        }
      } catch { /* not supported */ }
    })();
    return () => { alive = false; };
  }, []);

  const realtimeOk = feed.realtime === 'live' && !feed.stale;
  const marketOk = feed.marketSource === 'coingecko';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Activity size={22} className="text-primary" /> System Status
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live health of the data feeds, storage and error budget for this browser session.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="btn-sm-dark"><RefreshCw size={13} /> Reconnect feeds</button>
          <button
            onClick={() => { clearErrorLog(); setErrors([]); }}
            className="btn-sm-dark !text-muted-foreground"
          >
            Clear error log
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Build</p><p className="num mt-1 text-sm font-semibold">{APP_VERSION}</p><p className="text-[10px] text-muted-foreground">{BUILD_STAMP}</p></Card>
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Realtime feed</p><p className={`mt-1 text-sm font-semibold ${realtimeOk ? 'text-up' : 'text-down'}`}>{feed.realtime}{feed.stale ? ' · stale' : ''}</p></Card>
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last tick</p><p className="num mt-1 text-sm font-semibold">{conn.lastTickAt ? timeAgo(conn.lastTickAt) : '—'}</p></Card>
        <Card className="!p-4"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Global market cap</p><p className="num mt-1 text-sm font-semibold">{fmtUsd(global.mcap)}</p></Card>
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Components</h2>
        {/* Identity first: every other row describes data, this one decides whether
            an account, a subscription or a quota exists server-side at all. In demo
            mode a purchase cannot be attributed, so the page says that plainly
            instead of showing a green tick over a localStorage store. */}
        <Row
          label="Identity store"
          ok={AUTH_MODE === 'supabase'}
          detail={
            AUTH_MODE === 'supabase'
              ? 'Supabase sessions. Accounts, subscriptions and quotas are server-side; a purchase is attributable to this account.'
              : 'Demo store in localStorage — no server account exists, so a purchase could not be attributed and plan limits are advisory. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the build environment (see SETUP.md §2.4).'
          }
        />
        <Row
          label="Binance realtime stream (WebSocket)"
          ok={realtimeOk}
          detail={realtimeOk
            ? `Receiving ticks${tickAge != null ? `, last ${Math.round(tickAge / 1000)}s ago` : ''}. Pauses while the tab is hidden.`
            : feed.stale
              ? 'Connected but no ticks for over 20 seconds — treated as stale.'
              : `State: ${feed.realtime}. Retries use exponential backoff with jitter, plus a 60-second slow retry.`}
        />
        <Row
          label="CoinGecko market + global REST"
          ok={marketOk}
          detail={marketOk ? 'Refreshing every 60 seconds.' : 'Unavailable — the app is showing a clearly-labelled simulated snapshot.'}
        />
        <Row
          label="Candle data provenance"
          ok={marketOk}
          detail={marketOk ? 'Candles come from Binance klines. Synthetic candles are never used for signals or paper trades.' : 'Synthetic candles active: signals and paper trades are suspended.'}
        />
        <Row
          label="Session storage"
          ok
          detail={usage ? `${(usage.usage || 0) / 1024 > 1024 ? ((usage.usage || 0) / 1048576).toFixed(2) + ' MB' : Math.round((usage.usage || 0) / 1024) + ' KB'} used of ${((usage.quota || 0) / 1073741824).toFixed(1)} GB available. Accounts, watchlist and portfolios live only in this browser.` : 'Storage estimate unavailable in this browser.'}
        />
        <Row
          label="Client error budget"
          ok={errors.length === 0}
          detail={errors.length === 0 ? 'No errors captured this session.' : `${errors.length} error${errors.length === 1 ? '' : 's'} captured (most recent ${timeAgo(errors[errors.length - 1].t)}). Details are redacted of credentials and shown in the console.`}
        />
      </Card>

      {errors.length ? (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Recent errors</h2>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {[...errors].reverse().slice(0, 10).map((e, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5 text-[11px]">
                <p className="font-medium text-down">{e.error?.name}: {e.error?.message}</p>
                <p className="mt-0.5 text-muted-foreground">{e.kind || 'error'} · {timeAgo(e.t)}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
