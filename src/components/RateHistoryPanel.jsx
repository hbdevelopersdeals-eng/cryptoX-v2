import React, { useEffect, useState } from 'react';
import { AlertTriangle, History, RefreshCw, ScrollText } from 'lucide-react';
import { Card } from './ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useCurrency } from '../lib/currency.jsx';
import { CURRENCIES } from '../lib/currencies.js';
import { historicalRate, HISTORICAL_SUPPORT } from '../lib/rates.js';
import { fromUTC } from '../lib/time.js';

/* Historical exchange rates and the rate-acquisition audit trail.
 *
 * Both of these existed as tested functions with no surface, so "we keep an
 * audit trail" and "we support historical rates" were claims you could not
 * check. This panel is where they become visible.
 *
 * The historical lookup reports what the provider could NOT answer. Falling back
 * to today's rate for a past date would be the worst possible behaviour here:
 * silently wrong, and impossible to notice.
 */

const REASONS = {
  'invalid-date': 'That is not a date we can parse. Use YYYY-MM-DD.',
  'currency-not-in-provider-coverage': 'The ECB set does not publish this currency, so there is no free historical source. Reported as unavailable rather than filled in with today\'s rate.',
  'no-fetch-available': 'No network access in this environment.',
  'provider-cannot-do-history': 'No configured provider supports history.',
  'invalid-base': 'Base currency is not a known ISO 4217 code.'
};

export default function RateHistoryPanel() {
  const { t, lang, timeZone } = useI18n();
  const currency = useCurrency();

  const [date, setDate] = useState('2026-01-02');
  const [quote, setQuote] = useState('EUR');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  /*
   * The audit trail is a mutable object on the provider, so nothing re-renders
   * when a fetch appends to it. Bumping a counter when `asOf` changes is enough
   * to read it fresh — and it cannot loop, because `asOf` is stable between
   * acquisitions.
   */
  const [stamp, setStamp] = useState(0);
  useEffect(() => { setStamp((s) => s + 1); }, [currency.asOf]);

  const entries = currency.audit?.entries || [];
  const failures = currency.audit?.failures?.() || [];

  const lookUp = async () => {
    setBusy(true);
    const out = await historicalRate({ date, base: 'USD', quote });
    setBusy(false);
    setResult(out);
  };

  /*
   * Rates keep four decimals. Using the currency's minor unit here truncated
   * 0.9531 to "0.95" — a 0.3% error on a number whose whole purpose is
   * precision. Small rates get six.
   */
  const rateText = (rate) => (rate >= 0.01 ? rate.toFixed(4) : rate.toFixed(6));

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History size={15} className="text-primary" /> Historical rates &amp; audit trail
      </h2>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Historical lookup */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium">Rate on a past date</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <span id="rate-date-label" className="mb-1 block text-[10px] text-muted-foreground">Rate date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-labelledby="rate-date-label"
                className="input-dark !h-9 !w-40 !text-[12px]"
              />
            </div>
            <div>
              <span id="rate-quote-label" className="mb-1 block text-[10px] text-muted-foreground">Quote currency</span>
              <select
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                aria-labelledby="rate-quote-label"
                className="input-dark !h-9 !w-28 !text-[12px]"
              >
                {CURRENCIES.filter((c) => c.code !== 'USD').map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
            </div>
            <button type="button" disabled={busy} onClick={lookUp} className="btn-primary !h-9 !px-3 !text-[11px] disabled:opacity-40">
              {busy ? 'Looking up…' : 'Look up'}
            </button>
          </div>

          {result ? (
            result.ok ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-[11px]">
                  1 USD = <span className="font-mono font-semibold">{rateText(result.rate)}</span> {result.quote}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {result.date} · source {result.provider} (ECB reference set). Reference rates are published once per working day,
                  so a weekend or holiday answers with the preceding business day.
                </p>
              </div>
            ) : (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {REASONS[result.reason] || `Unavailable (${result.reason}). Not substituted with today's rate.`}
              </p>
            )
          ) : null}

          <p className="text-[10px] text-muted-foreground">{HISTORICAL_SUPPORT.note}</p>
        </div>

        {/* Audit trail */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium">
              <ScrollText size={12} /> Rate audit trail
              <span className="font-normal text-muted-foreground">({entries.length})</span>
            </p>
            <button type="button" onClick={() => setStamp((s) => s + 1)} className="btn-ghost !h-7 !px-2.5 !text-[10px]">
              <RefreshCw size={11} className="mr-1" /> Refresh
            </button>
          </div>

          {entries.length ? (
            <div className="max-h-56 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
              {[...entries].reverse().slice(0, 20).map((e, i) => (
                <div key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[10px]">
                  <span className="font-mono text-muted-foreground">
                    {fromUTC(e.at, timeZone, { timeStyle: 'medium' })}
                  </span>
                  <span className={e.ok ? 'text-emerald-400' : 'text-down'}>{e.ok ? 'ok' : 'failed'}</span>
                  <span className="font-mono">{e.provider || '—'}</span>
                  <span className="text-muted-foreground">base {e.base}</span>
                  {e.quotes?.length ? <span className="text-muted-foreground">{e.quotes.length} quote(s)</span> : null}
                  {e.error ? <span className="truncate text-down">{e.error}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No acquisitions recorded yet in this session. Every rate fetch appends provider, base, quotes, outcome and time.
            </p>
          )}

          <div className="rounded-lg border border-border p-2.5 text-[10px] text-muted-foreground">
            <p>
              Current set: <span className="font-mono">{currency.source}</span>
              {currency.provider ? <> from <span className="font-mono">{currency.provider}</span></> : null}
              {currency.asOf ? <> · provider date <span className="font-mono">{String(currency.asOf).slice(0, 10)}</span></> : null}
            </p>
            <p className="mt-1">
              Failures are recorded too ({failures.length}) — a trail that only logs successes cannot explain a stale rate.
              Entries hold no credentials and are capped at 200.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
