import React, { useMemo, useState } from 'react';
import { Check, Sparkles, ArrowRight, ShieldCheck, Activity } from 'lucide-react';
import { useSubscription, pricingPlans } from '../lib/subscription.jsx';
import { annualSaving, purchasablePlans } from '../lib/upgrade.js';
import { formatMoney } from '../lib/currency.jsx';
import { UPGRADE_EVENTS } from '../lib/upgrade.js';
import { trackUpgradeEvent, bufferedEvents, resetBufferedEvents } from '../lib/upgradeEvents.js';
import { beginCheckout } from '../lib/subscribe.js';
import { checkoutStatus } from '../lib/checkout.js';
import { ENFORCEMENT, QUOTA_KEYS, QUOTA_LABELS, enforcementState } from '../lib/entitlements.js';

/** A reason a checkout did not start, said in a way a buyer can act on. */
function checkoutErrorMessage(reason) {
  switch (reason) {
    case 'not-signed-in':
      return 'Please sign in, then choose your plan again.';
    case 'not-configured':
      return 'Checkout is temporarily unavailable. Nothing has been charged — please try again shortly.';
    case 'attribution-not-ready':
      return 'Checkout is not open yet. Nothing has been charged.';
    case 'navigation-failed':
      return 'Your browser blocked the checkout window. Check your pop-up settings and try again.';
    default:
      return 'We could not start checkout. Nothing has been charged — please try again.';
  }
}

/* The pricing page.
 *
 * Every number here comes from `PLANS` in billing.js, through `pricingPlans()`.
 * There is one source of truth, so the figure shown to a customer and the figure
 * a checkout would charge cannot drift apart without something noticing.
 *
 * Two things this page refuses to do:
 *   - It never claims a saving the arithmetic does not support. `annualSaving()`
 *     returns unavailable for a free plan, a missing annual price, or an annual
 *     price that is not cheaper, and the badge is then simply absent.
 *   - It never renders a button that pretends to start a checkout it cannot
 *     start. With no variant mapping configured, the paid CTA is disabled and
 *     says why, rather than sending the customer to a dead end.
 */

// Re-exported so existing importers keep working; the implementation lives in
// lib/upgradeEvents.js so a component can use it without pulling in this page.
export { trackUpgradeEvent, bufferedEvents, resetBufferedEvents };

const fmt = (usd) => (usd == null ? '—' : formatMoney(usd, { code: 'USD', lang: 'en' }));

/** Feature rows derived from the plan's own entitlements, never hand-written. */
export function featureRows(plan) {
  const e = plan.entitlements || {};
  const rows = [];
  const num = (value) => (value == null ? 'Unlimited' : String(value));
  if (plan.rank === 0) rows.push(`${num(e.portfolios)} portfolio`);
  else rows.push(`${num(e.portfolios)} portfolios`);
  rows.push(`${num(e.alerts)} price alerts`);
  rows.push(e.bots ? `${num(e.bots)} trading bots` : 'No trading bots');
  rows.push(e.apiCallsPerMonth == null ? 'Unlimited API calls' : `${Number(e.apiCallsPerMonth).toLocaleString('en-US')} API calls / month`);
  rows.push(`${num(e.seats)} ${Number(e.seats) === 1 ? 'seat' : 'seats'}`);
  rows.push(`${num(e.auditLogDays)}-day audit history`);
  if (e.exportFormats?.length) rows.push(`${e.exportFormats.map((f) => f.toUpperCase()).join(', ')} export`);
  if (e.support) rows.push(`${e.support[0].toUpperCase()}${e.support.slice(1)} support`);
  return rows;
}

/* ---------------------------------------------------------------------------
 * Quota enforcement disclosure
 *
 * The pricing table sells five quotas. Three of them are refused by Postgres
 * (`cx_consume_quota()` / the BEFORE INSERT triggers) and two are counted in the
 * browser only, because there is no row to count yet: portfolios live inside a
 * JSON settings document, and organisation membership tables are not migrated.
 *
 * That difference is invisible to a buyer unless the page states it, and a paid
 * limit that nothing enforces is a false claim on a pricing table — the exact
 * failure `docs/LAUNCH-READINESS.md` P0-2 names. So the split is derived from
 * `ENFORCEMENT` rather than written here, and this page cannot advertise the
 * stronger claim after the weaker one is true.
 * ------------------------------------------------------------------------ */

/** Quotas the database actually refuses past the limit, in this deployment. */
export const SERVER_ENFORCED_KEYS = QUOTA_KEYS.filter((key) => enforcementState(key) === 'server');

/** Quotas a migration would enforce, but which may not be applied yet. */
export const PENDING_KEYS = QUOTA_KEYS.filter((key) => enforcementState(key) === 'pending-migration');

/** Quotas with no server mechanism at all — counted in the app only. */
export const DISPLAY_ONLY_KEYS = QUOTA_KEYS.filter((key) => enforcementState(key) === 'display-only');

/** The migration(s) the pending keys are waiting on, named once. */
export function pendingMigrations(keys = PENDING_KEYS) {
  const names = new Set(keys.map((key) => ENFORCEMENT[key]?.migration).filter(Boolean));
  return [...names];
}

const labelList = (keys, conjunction) => {
  const labels = keys.map((key) => QUOTA_LABELS[key] || key);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} ${conjunction} ${labels.at(-1)}`;
};

/**
 * The sentence the page must show, built from `ENFORCEMENT`.
 *
 * Returns `null` when every quota is server-enforced — at that point there is
 * nothing to disclose, and a permanent disclaimer would just train readers to
 * skip it.
 */
export function enforcementDisclosure({
  enforced = SERVER_ENFORCED_KEYS,
  pending = PENDING_KEYS,
  displayOnly = DISPLAY_ONLY_KEYS,
  migrations = pendingMigrations(pending)
} = {}) {
  if (displayOnly.length === 0 && pending.length === 0) return null;

  const parts = [];
  if (enforced.length) {
    parts.push(
      `${labelList(enforced, 'and')} ${enforced.length === 1 ? 'is' : 'are'} refused by the database: those limits cannot be passed by editing this page.`
    );
  } else {
    parts.push('No quota is refused by the database yet.');
  }

  if (pending.length) {
    const named = migrations.length ? migrations.join(', ') : 'a pending migration';
    parts.push(
      `${labelList(pending, 'and')} ${pending.length === 1 ? 'is' : 'are'} blocked by ${named} as soon as it is applied to this deployment; until then ${pending.length === 1 ? 'it is' : 'they are'} counted in the app only.`
    );
  }

  if (displayOnly.length) {
    parts.push(
      `${labelList(displayOnly, 'and')} ${displayOnly.length === 1 ? 'is' : 'are'} counted in the app with no server mechanism yet, so ${displayOnly.length === 1 ? 'that limit is' : 'those limits are'} a product boundary rather than a guarantee.`
    );
  }

  return parts.join(' ');
}

export function QuotaEnforcementNote() {
  const text = enforcementDisclosure();
  if (!text) return null;
  return (
    <p role="note" data-testid="quota-enforcement" className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
      <strong className="font-semibold text-foreground">How these limits are enforced.</strong> {text}
    </p>
  );
}


export default function Pricing() {
  const sub = useSubscription();
  const plans = useMemo(() => pricingPlans(), []);
  const paid = useMemo(() => purchasablePlans(), []);
  const [cycle, setCycle] = useState('monthly');
  // Checkout state. `pending` names the plan currently being started so only
  // that button changes, and `error` carries a reason a buyer can act on.
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  // The single gate. It is false until the server can attribute a purchase to
  // an account, and it is false if the plan/variant mapping does not agree.
  const checkout = useMemo(() => checkoutStatus(), []);
  const canCheckout = checkout.enabled;

  // Only offer the annual toggle where an annual price genuinely exists.
  const annualOffers = paid.filter((p) => annualSaving(p).available);
  const showCycleToggle = annualOffers.length > 0;

  const currentPlanId = sub.isPaid ? sub.planId : 'free';

  /**
   * Start a checkout for this plan at the currently selected cycle.
   *
   * The browser sends only the plan and the cycle. The server resolves the
   * variant, mints the attribution nonce and returns a URL — so nothing here
   * decides a price, and a "success" redirect still grants nothing.
   */
  const onSelect = async (planId) => {
    trackUpgradeEvent(UPGRADE_EVENTS.clicked.name, { context: '/pricing', plan: currentPlanId, targetPlan: planId });
    if (!canCheckout || pending) return;

    setError(null);
    setPending(planId);

    const result = await beginCheckout({ plan: planId, cycle });

    if (!result.ok) {
      setPending(null);
      setError(checkoutErrorMessage(result.reason));
      return;
    }
    if (!result.opened) {
      // The URL is valid but navigation was blocked. Give the buyer the link
      // rather than silently doing nothing.
      setPending(null);
      setError(`${checkoutErrorMessage('navigation-failed')} ${result.url}`);
    }
    // On success the browser is already leaving for the checkout.
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles size={22} className="text-primary" aria-hidden="true" />
          Plans and pricing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          CryptoX is free to use. Paid plans raise the limits on the features you are already using — more alerts,
          trading bots, API calls and seats — rather than unlocking a different product.
        </p>
      </header>

      {sub.isPaid ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">
            You are on <span className="text-primary">{sub.plan?.name}</span>
            {sub.status ? ` (${sub.status.replace(/_/g, ' ')})` : ''}.
          </p>
          {sub.management?.cancellation ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Your subscription is set to end on {new Date(sub.management.cancellation.scheduledFor).toLocaleDateString()}.
              {' '}Access continues until the end of the period you have paid for.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Manage or cancel from your billing portal.</p>
          )}
        </div>
      ) : null}

      {showCycleToggle ? (
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Billing interval">
          {[{ id: 'monthly', label: 'Monthly' }, { id: 'annual', label: 'Annual' }].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCycle(option.id)}
              aria-pressed={cycle === option.id}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                cycle === option.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const saving = annualSaving({ price: { monthly: plan.monthly, annual: plan.annual } });
          const isCurrent = plan.id === currentPlanId;
          const price = cycle === 'annual' && saving.available ? plan.annual : plan.monthly;
          const isFree = plan.rank === 0;

          return (
            <section
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
              className={`flex flex-col rounded-xl border p-5 ${isCurrent ? 'border-primary/60 bg-primary/5' : 'border-border bg-card'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id={`plan-${plan.id}`} className="text-base font-semibold">{plan.name}</h2>
                {isCurrent ? (
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Current
                  </span>
                ) : null}
              </div>

              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold tracking-tight">{fmt(price)}</span>
                {!isFree ? (
                  <span className="text-xs text-muted-foreground">
                    / {cycle === 'annual' && saving.available ? 'year' : 'month'}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">forever</span>
                )}
              </p>

              {/* Only claimed when the configured prices actually support it. */}
              {!isFree && saving.available ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fmt(saving.monthlyEquivalent)}/month billed annually — {fmt(saving.saving)} less than paying monthly
                  {saving.savingPct > 0 ? ` (${saving.savingPct}% off)` : ''}.
                </p>
              ) : null}
              {!isFree && !saving.available ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Billed monthly.</p>
              ) : null}

              {plan.trialDays > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{plan.trialDays}-day trial available.</p>
              ) : null}

              <ul className="mt-4 flex-1 space-y-1.5">
                {featureRows(plan).map((row) => (
                  <li key={row} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>{row}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={isFree || isCurrent || !canCheckout || pending === plan.id}
                aria-label={isFree ? 'Free plan — no purchase required' : isCurrent ? `${plan.name} is your current plan` : `Upgrade to ${plan.name}`}
                onClick={() => onSelect(plan.id)}
                className={`mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  isFree || isCurrent
                    ? 'cursor-default border border-border text-muted-foreground'
                    : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40'
                }`}
              >
                {isFree
                  ? 'Included'
                  : isCurrent
                    ? 'Your plan'
                    : pending === plan.id
                      ? 'Opening checkout…'
                      : `Upgrade to ${plan.name}`}
                {!isFree && !isCurrent ? <ArrowRight size={13} aria-hidden="true" /> : null}
              </button>
            </section>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-card p-4 text-xs text-muted-foreground"
        >
          {error}
        </p>
      ) : null}

      <QuotaEnforcementNote />

      {/* Visual Trust Guarantee Bar */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3.5">
          <ShieldCheck size={20} className="text-primary shrink-0" />
          <div className="text-xs">
            <p className="font-semibold text-foreground">Zero Custody Risk</p>
            <p className="text-muted-foreground">Never asks for private keys or seed phrases.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3.5">
          <Activity size={20} className="text-up shrink-0" />
          <div className="text-xs">
            <p className="font-semibold text-foreground">Next-Bar Simulation</p>
            <p className="text-muted-foreground">Backtests with realistic fees &amp; slippage.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3.5">
          <Sparkles size={20} className="text-amber-400 shrink-0" />
          <div className="text-xs">
            <p className="font-semibold text-foreground">Cancel Anytime</p>
            <p className="text-muted-foreground">Self-serve billing management &amp; export.</p>
          </div>
        </div>
      </div>

      <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        {canCheckout ? (
          <>
            <strong className="font-semibold text-foreground">Payments are handled by Lemon Squeezy.</strong>{' '}
            You will be taken to their secure checkout to complete the purchase. Your plan is activated once the payment
            is confirmed — returning to this site is not itself proof of payment. Plan changes and cancellations are
            handled through the billing portal.
          </>
        ) : (
          <>
            <strong className="font-semibold text-foreground">Checkout is not yet enabled.</strong>{' '}
            The prices above are the application&apos;s configured list prices. Online checkout is still being finalised, so
            no payment can be taken from this page yet — nothing here will charge you. When checkout opens, plan changes and
            cancellations will be handled through the billing portal.
          </>
        )}
      </p>
    </div>
  );
}
