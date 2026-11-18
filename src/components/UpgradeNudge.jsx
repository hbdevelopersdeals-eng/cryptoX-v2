import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import {
  recommend, shouldShow, recordShown, recordDismissed, readState, ladder,
  STORAGE_KEY, MAX_PER_SESSION
} from '../lib/upsell.js';
import { lsGet, lsSet } from '../lib/storage.js';

/* The upgrade prompt.
 *
 * Two components: `UpgradeNudge` for a context (a quota that is nearly full, a
 * capability the plan does not include) and `TierLadder` for the billing page,
 * where all three tiers are presented side by side because the buyer is
 * comparing rather than being interrupted.
 *
 * The frequency rules live in `upsell.js` and are enforced here without
 * exceptions: one prompt per placement per session, and a 14-day silence after a
 * dismissal. A prompt that reappears after being dismissed is the fastest way to
 * teach someone to ignore every prompt, including the one that matters.
 */

const sessionId = () => {
  try {
    const existing = sessionStorage.getItem('cx_upsell_session');
    if (existing) return existing;
    const fresh = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('cx_upsell_session', fresh);
    return fresh;
  } catch {
    return 'no-storage';
  }
};

export function UpgradeNudge({ context, planId = 'free', usage = {}, compact = false }) {
  const [hidden, setHidden] = useState(false);
  const sid = useMemo(sessionId, []);
  const rec = useMemo(() => recommend({ context, planId, usage }), [context, planId, usage]);

  const gate = useMemo(() => {
    if (!rec.show) return { show: false };
    return shouldShow({ state: lsGet(STORAGE_KEY, null), context, sessionId: sid });
  }, [rec.show, context, sid]);

  /* Recording the impression on mount is what makes the session cap real; doing
     it in an effect keeps render pure and avoids a double count under StrictMode
     because the second pass sees the incremented value and still renders. */
  useEffect(() => {
    if (!rec.show || !gate.show) return;
    const next = recordShown({ state: lsGet(STORAGE_KEY, null), context, sessionId: sid });
    lsSet(STORAGE_KEY, next);
  }, [rec.show, gate.show, context, sid]);

  if (!rec.show || !gate.show || hidden) return null;

  const dismiss = () => {
    lsSet(STORAGE_KEY, recordDismissed({ state: lsGet(STORAGE_KEY, null), context }));
    setHidden(true);
  };

  const { pitch, price } = rec;
  const adds = compact ? pitch.adds.slice(0, 3) : pitch.adds;

  return (
    <aside
      className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3"
      aria-label={`Upgrade suggestion: ${pitch.name}`}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={`Dismiss the ${pitch.name} suggestion`}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
      >
        <X size={13} aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="pr-6 text-sm font-semibold">{pitch.headline}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{pitch.oneLiner}</p>

          {rec.pressure && rec.pressure.limit != null ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, rec.pressure.pct || 0)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {rec.pressure.used} of {rec.pressure.limit} used on {rec.title.toLowerCase()}.
              </p>
            </div>
          ) : null}

          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {adds.map((a) => (
              <li key={a} className="text-[11px] text-muted-foreground">· {a}</li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Link
              to={rec.href}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2"
            >
              {pitch.cta} <ArrowRight size={12} aria-hidden="true" />
            </Link>
            <span className="text-[11px] text-muted-foreground">
              {price.text}
              {price.saving ? ` · save $${price.saving.perYear.toFixed(2)} a year (${price.saving.pct}%)` : ''}
            </span>
          </div>

          <p className="mt-1.5 text-[10px] text-muted-foreground">{pitch.proof}</p>
        </div>
      </div>
    </aside>
  );
}

/**
 * The billing ladder: all paid tiers, each sold to a different buyer.
 * Presenting three tiers together is honest — the reader picks — and it removes
 * the awkwardness of a page that only ever argues for one upgrade.
 */
export function TierLadder({ planId = 'free' }) {
  const rows = ladder(planId);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {rows.map((tier) => (
        <div
          key={tier.id}
          className={
            'relative rounded-xl border px-4 py-3 ' +
            (tier.current ? 'border-primary/50 bg-primary/[0.06]' : 'border-border')
          }
        >
          {tier.current ? (
            <span className="absolute right-2 top-2 rounded-full border border-primary/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
              Current
            </span>
          ) : null}
          <p className="text-sm font-semibold">{tier.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{tier.audience}</p>
          <p className="num mt-2 text-lg font-semibold">
            ${tier.price.monthly.toFixed(2)}
            <span className="text-[11px] font-normal text-muted-foreground">/mo</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            or ${tier.price.annual.toFixed(2)}/yr
            {tier.price.saving ? ` · save ${tier.price.saving.pct}%` : ''}
          </p>

          <ul className="mt-2 space-y-1">
            {tier.adds.map((a) => (
              <li key={a} className="text-[11px] leading-snug text-muted-foreground">· {a}</li>
            ))}
          </ul>

          <Link
            to={tier.id === 'enterprise' ? '/compliance' : '/billing'}
            className={
              'mt-3 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 ' +
              (tier.current
                ? 'border border-border text-muted-foreground'
                : 'bg-primary text-primary-foreground')
            }
          >
            {tier.current ? 'Your plan' : tier.cta}
            {tier.current ? null : <ArrowRight size={12} aria-hidden="true" />}
          </Link>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{tier.proof}</p>
        </div>
      ))}
    </div>
  );
}

export default UpgradeNudge;
