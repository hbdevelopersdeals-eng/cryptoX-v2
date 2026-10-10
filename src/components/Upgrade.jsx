import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Lock, Sparkles, X, ArrowRight, Settings } from 'lucide-react';
import { useSubscription } from '../lib/subscription.jsx';
import { upgradePromptFor, ctaFor, dismiss, shouldSuppress, routeGate } from '../lib/upgrade.js';
import { UPGRADE_EVENTS } from '../lib/upgrade.js';
// From the leaf module, not from the Pricing page — importing a page here put
// the whole page in the initial bundle.
import { trackUpgradeEvent } from '../lib/upgradeEvents.js';

/* Upgrade surfaces.
 *
 * A NOTE ON WHAT A GATE HERE ACTUALLY IS. Everything in this file runs in the
 * browser, so it changes what a user SEES. It is not access control: the values
 * it reads are editable by the person using the app. The paid features have to
 * be enforced where the data lives. Saying "premium" over a hidden button would
 * be a security claim this code cannot make.
 *
 * A prompt is shown only where the plan data says the user genuinely lacks
 * something, only once per flow, and never to someone who has already dismissed
 * it. There is no mechanism here for countdowns, scarcity or discounts.
 */

const DISMISS_KEY = 'cx_upgrade_dismissals';

function readDismissals() {
  try {
    return JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '{}') || {};
  } catch {
    return {}; // a corrupt record must not hide prompts for ever
  }
}

function writeDismissals(next) {
  try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
}

/** The panel shown in place of a gated page, or as a contextual prompt. */
export function UpgradePanel({ prompt, cta, onDismiss, compact = false }) {
  if (!prompt) return null;
  return (
    <section
      aria-labelledby="upgrade-panel-title"
      className={`mx-auto max-w-xl rounded-xl border border-border bg-card ${compact ? 'p-4' : 'p-6'}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary" aria-hidden="true">
          <Lock size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="upgrade-panel-title" className="text-sm font-semibold">{prompt.title}</h2>
          {prompt.detail ? <p className="mt-1 text-xs text-muted-foreground">{prompt.detail}</p> : null}
          {prompt.benefit ? <p className="mt-1 text-xs text-muted-foreground">{prompt.benefit}</p> : null}
          {prompt.resetsNote ? <p className="mt-1 text-[11px] text-muted-foreground/80">{prompt.resetsNote}</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/pricing"
              onClick={() => trackUpgradeEvent(UPGRADE_EVENTS.clicked.name, {
                context: prompt.key, plan: 'free', targetPlan: prompt.targetPlanId || 'compare'
              })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {cta?.label || prompt.cta}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss this upgrade suggestion"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
              >
                <X size={12} aria-hidden="true" />
                Not now
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Wrap a page so a user without the entitlement sees why, instead of a broken
 * screen. `context` is the route, which is what makes conversions attributable.
 */
export function UpgradeGate({ children, route = null }) {
  const sub = useSubscription();
  const location = useLocation();
  const context = route || location.pathname;
  const [dismissals, setDismissals] = useState(readDismissals);
  const [flowSeen] = useState(() => new Set());

  const gate = routeGate(context, sub.isPaid ? sub.planId : 'free');

  const prompt = useMemo(() => {
    if (!gate.gated) return null;
    return upgradePromptFor({
      route: context,
      planId: sub.isPaid ? sub.planId : 'free',
      dismissals,
      flow: 'page'
    });
  }, [gate.gated, context, sub.isPaid, sub.planId, dismissals]);

  // A prompt inside a re-rendering component would otherwise be counted many
  // times, making the funnel meaningless.
  const [emitted] = useState(() => ({ key: null }));
  useEffect(() => {
    if (!prompt) return;
    const key = `${prompt.key}`;
    if (emitted.key === key) return;
    emitted.key = key;
    trackUpgradeEvent(UPGRADE_EVENTS.promptViewed.name, {
      context: prompt.key,
      plan: sub.isPaid ? sub.planId : 'free',
      kind: prompt.kind
    });
  }, [prompt, emitted, sub.isPaid, sub.planId]);

  if (sub.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Checking your subscription…</p>
      </div>
    );
  }

  if (!gate.gated) return children;

  // Dismissed: let them through rather than blocking navigation repeatedly.
  if (!prompt) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <UpgradePanel
          compact
          prompt={{
            title: `${gate.title} needs a paid plan`,
            detail: gate.reason,
            resetsNote: null,
            targetPlanId: null
          }}
          cta={ctaFor({ kind: 'compare' })}
        />
      </div>
    );
  }

  const onDismiss = () => {
    const next = dismiss(dismissals, `page:${prompt.key}`);
    setDismissals(next);
    writeDismissals(next);
  };

  return (
    <div className="flex min-h-[50vh] items-center p-4 sm:p-6">
      <UpgradePanel
        prompt={prompt}
        cta={ctaFor({ kind: prompt.kind, entitlement: prompt.entitlement, targetPlan: prompt.targetPlanId, featureTitle: gate.title })}
        onDismiss={onDismiss}
      />
    </div>
  );
}

/**
 * The consistent header entry. A paying subscriber sees their plan and a link to
 * manage it; a free user sees one upgrade route. It never nags.
 */
export function UpgradeButton({ compact = false }) {
  const sub = useSubscription();
  const path = useLocation().pathname;

  if (sub.isPaid) {
    return (
      <Link
        to="/billing"
        aria-label={`Manage your ${sub.plan?.name || ''} subscription`}
        className="chip !border-primary/25 !bg-primary/10 text-primary"
      >
        <Settings size={12} aria-hidden="true" />
        {compact ? sub.plan?.name : `${sub.plan?.name || 'Paid'} · Manage`}
      </Link>
    );
  }

  return (
    <Link
      to="/pricing"
      aria-label="Upgrade your CryptoX plan"
      onClick={() => trackUpgradeEvent(UPGRADE_EVENTS.clicked.name, { context: `header:${path}`, plan: 'free', targetPlan: 'compare' })}
      className="chip !border-primary/30 !bg-primary/10 text-primary hover:!bg-primary/15"
    >
      <Sparkles size={12} aria-hidden="true" />
      {compact ? 'Pro' : 'Upgrade'}
    </Link>
  );
}

/** True when a prompt has been dismissed recently — exported for tests. */
export const isDismissed = (dismissals, key, now = new Date()) => shouldSuppress(dismissals, `page:${key}`, now);

export { readDismissals, writeDismissals, DISMISS_KEY };
