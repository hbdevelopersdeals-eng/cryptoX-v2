import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Check, ArrowRight, ShieldCheck } from 'lucide-react';
import { useSubscription, pricingPlans } from '../lib/subscription.jsx';
import { annualSaving, purchasablePlans, UPGRADE_EVENTS } from '../lib/upgrade.js';
import { planById } from '../lib/plans.js';
import { formatMoney } from '../lib/currency.jsx';
import { trackUpgradeEvent } from '../lib/upgradeEvents.js';

/* The premium upgrade banner for the dashboard.
 *
 * Visually: dark navy panel, a gold sparkle, green verified ticks, the real
 * configured price and interval, and a high-contrast white call to action.
 *
 * Every number and every benefit comes from the plan catalogue — `PLANS` via
 * `pricingPlans()`. Nothing is hard-coded here, so the banner cannot advertise
 * a price or a benefit the application does not actually have. If a limit is
 * unlimited the row says so; if a plan has no annual price the interval toggle
 * is not offered rather than showing a "saving" that does not exist.
 *
 * SUBSCRIPTION AWARE. A user who already holds the advertised plan never sees a
 * Subscribe prompt: the banner becomes a slim status strip instead. Selling
 * someone the plan they are on is the fastest way to lose their trust.
 */

const money = (usd) => (usd == null ? null : formatMoney(usd, { code: 'USD', lang: 'en' }));

/** Benefits rendered from the plan's own entitlements, not hand-written copy. */
export function bannerBenefits(plan) {
  // No entitlements means no verified benefits, so there is nothing truthful to
  // list. Falling through with `|| {}` produced "Unlimited price alerts" for a
  // plan that has no configured limits at all — a benefit invented by the
  // absence of data, which is the exact thing this banner must not do.
  const e = plan?.entitlements;
  if (!e || typeof e !== 'object' || Object.keys(e).length === 0) return [];
  const n = (v, one, many) => (v == null ? `Unlimited ${many}` : `${v} ${v === 1 ? one : many}`);
  const rows = [
    n(e.alerts, 'price alert', 'price alerts'),
    e.bots ? n(e.bots, 'trading bot', 'trading bots') : null,
    n(e.portfolios, 'portfolio', 'portfolios'),
    e.apiCallsPerMonth == null
      ? 'Unlimited API access'
      : `${Number(e.apiCallsPerMonth).toLocaleString('en-US')} API calls per month`,
    n(e.seats, 'team seat', 'team seats')
  ];
  if (e.support) rows.push(`${e.support[0].toUpperCase()}${e.support.slice(1)} support`);
  return rows.filter(Boolean);
}

/** The plan to advertise: the cheapest paid tier above what the user has. */
export function advertisedPlan({ plans, planId }) {
  /*
   * The rank comes from the FULL catalogue, via planById, not from the list
   * passed in. `plans` here is the pricing list, which excludes contact-only
   * tiers — so looking the current plan up in it failed for an Enterprise
   * customer, defaulted the rank to 0, and offered them a "Subscribe Now" for
   * Pro. Selling a plan to someone already above it is the misleading prompt
   * this component exists to avoid.
   */
  const currentRank = planById(planId)?.rank ?? 0;
  const candidates = purchasablePlans(plans).filter((p) => p.rank > currentRank);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (a.rank <= b.rank ? a : b));
}

export function PremiumBanner({ className = '' }) {
  const sub = useSubscription();
  const plans = useMemo(() => pricingPlans(), []);
  const [cycle, setCycle] = useState('monthly');

  const plan = advertisedPlan({ plans, planId: sub.isPaid ? sub.planId : 'free' });
  const saving = plan ? annualSaving({ price: { monthly: plan.monthly, annual: plan.annual } }) : { available: false };
  const showToggle = !!saving.available;

  // Nothing to advertise: either every paid tier is held, or the catalogue is
  // empty. Showing a banner here would be selling something that does not exist.
  if (!sub.loading && !plan) {
    if (!sub.isPaid) return null;
    return (
      <section className={`rounded-xl border border-border bg-card p-4 ${className}`} aria-label="Your subscription">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck size={15} className="text-primary" aria-hidden="true" />
          You are on {sub.plan?.name}, our highest plan.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Thanks for supporting CryptoX. Manage or cancel any time from your billing page.
        </p>
        <Link to="/billing" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Manage subscription <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </section>
    );
  }

  // A paying subscriber gets status, never an advert.
  if (sub.isPaid) {
    return (
      <section
        className={`rounded-xl border border-border bg-card p-4 ${className}`}
        aria-label="Your subscription"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={15} className="text-primary" aria-hidden="true" />
              {sub.plan?.name} plan
              {sub.status ? <span className="text-xs font-normal text-muted-foreground">({sub.status.replace(/_/g, ' ')})</span> : null}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {sub.management?.cancellation
                ? `Ends ${new Date(sub.management.cancellation.scheduledFor).toLocaleDateString()} — access continues until then.`
                : sub.renewsAt
                  ? `Renews ${new Date(sub.renewsAt).toLocaleDateString()}.`
                  : 'Active subscription.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {plan ? (
              <Link
                to="/pricing"
                onClick={() => trackUpgradeEvent(UPGRADE_EVENTS.clicked.name, { context: 'dashboard:status', plan: sub.planId, targetPlan: plan.id })}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent"
              >
                Compare with {plan.name}
              </Link>
            ) : null}
            <Link
              to="/billing"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent"
            >
              Manage
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const price = showToggle && cycle === 'annual' ? plan.annual : plan.monthly;
  const benefits = bannerBenefits(plan);

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-amber-300/20 bg-gradient-to-br from-[#0a1024] via-[#0d1730] to-[#0a1024] p-5 shadow-lg sm:p-6 ${className}`}
      aria-labelledby="premium-banner-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
            <Sparkles size={14} aria-hidden="true" />
            CryptoX {plan.name}
          </p>
          <h2 id="premium-banner-title" className="mt-2 text-lg font-bold tracking-tight text-white sm:text-xl">
            Trade with the limits lifted
          </h2>
          <p className="mt-1 max-w-xl text-xs text-slate-300/90 sm:text-sm">
            Raise the ceilings on the tools you already use — more alerts, automated bots, deeper history and API access.
          </p>

          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {benefits.map((row) => (
              <li key={row} className="flex items-start gap-2 text-xs text-slate-200">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full shrink-0 sm:w-auto">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="flex items-baseline gap-1 text-white">
              <span className="text-2xl font-extrabold tracking-tight">{money(price)}</span>
              <span className="text-xs text-slate-300">/ {cycle === 'annual' && showToggle ? 'year' : 'month'}</span>
            </p>
            {showToggle && saving.available ? (
              <p className="mt-1 text-[11px] text-emerald-300">
                {money(saving.monthlyEquivalent)}/month billed annually — save {money(saving.saving)}
              </p>
            ) : null}
            {plan.trialDays > 0 ? (
              <p className="mt-1 text-[11px] text-slate-300">{plan.trialDays}-day trial on {plan.name}.</p>
            ) : null}

            <Link
              to="/pricing"
              onClick={() => trackUpgradeEvent(UPGRADE_EVENTS.clicked.name, { context: 'dashboard:banner', plan: 'free', targetPlan: plan.id })}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#0a1024] transition-opacity hover:opacity-90"
            >
              Subscribe Now
              <ArrowRight size={14} aria-hidden="true" />
            </Link>

            {showToggle ? (
              <div className="mt-2 flex overflow-hidden rounded-md border border-white/15" role="group" aria-label="Billing interval">
                {[{ id: 'monthly', label: 'Monthly' }, { id: 'annual', label: `Annual · save ${money(saving.saving)}` }].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setCycle(option.id)}
                    aria-pressed={cycle === option.id}
                    className={`flex-1 px-2 py-1 text-[10px] font-semibold transition-colors ${
                      cycle === option.id ? 'bg-white/20 text-white' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              Online checkout is being finalised — this opens the plan comparison. Nothing is charged from this button.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PremiumBanner;
