import React, { useMemo, useState } from 'react';
import { Copy, Check, Link2, Percent, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import {
  referralCode, referralLink, tierFor, commissionFor, payoutStatus, fraudCheck,
  REFERRAL_TIERS, ATTRIBUTION_WINDOW_DAYS, PAYOUT_HOLD_DAYS, MIN_PAYOUT_USD, FRAUD_WEIGHTS
} from '../lib/referral.js';
import { PLANS } from '../lib/plans.js';
import { fmtUsd } from '../lib/format.js';
import { Card, SectionTitle, Stat } from '../components/ui.jsx';

/* Affiliate programme surface.
 *
 * The link and the arithmetic are real. The earnings table is empty because this
 * deployment has no attributed events: a referral dashboard showing invented
 * clicks would be the easiest lie in the product to tell, and the one a partner
 * checks first.
 */

export default function ReferralPage() {
  const auth = useAuth() || {};
  const accountKey = auth.user?.id || auth.user?.email || '';
  const code = referralCode(accountKey);
  const link = code ? referralLink(code, { base: typeof window !== 'undefined' ? window.location.origin : undefined }) : null;

  const [copied, setCopied] = useState(false);
  const [planId, setPlanId] = useState('pro');
  const [amount, setAmount] = useState('9.99');
  const [conversions, setConversions] = useState('12');
  const [monthsActive, setMonthsActive] = useState('1');
  const [kyc, setKyc] = useState(false);
  const [earned, setEarned] = useState('0');

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the link is still visible to copy by hand */ }
  };

  const nConversions = Number(conversions) || 0;
  const tier = tierFor(nConversions);
  const commission = useMemo(
    () =>
      commissionFor({
        planId,
        amount: Number(amount) || 0,
        conversions: nConversions,
        monthsActive: Number(monthsActive) || 1
      }),
    [planId, amount, nConversions, monthsActive]
  );

  const payout = useMemo(
    () =>
      payoutStatus({
        earned: Number(earned) || 0,
        paid: 0,
        pending: 0,
        firstEarningAt: Number(earned) > 0 ? new Date().toISOString() : null,
        kycVerified: kyc
      }),
    [earned, kyc]
  );

  const fraud = fraudCheck({});

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Referral & affiliate"
        sub={`Share a link, earn ${tier.ratePct}% of the first payment${tier.recurring ? ' and of renewals' : ''}. Attribution lasts ${ATTRIBUTION_WINDOW_DAYS} days and requires a click.`}
      />

      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Link2 size={15} className="text-primary" aria-hidden="true" /> Your link
        </h2>
        {!code ? (
          <p className="text-sm text-muted-foreground">Sign in to generate a referral code — the code is derived from your account, so it cannot exist before the account does.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={link}
                aria-label="Your referral link"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
              />
              <button
                type="button"
                onClick={copy}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2"
              >
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Code" value={code} />
              <Stat label="Tier" value={tier.label} />
              <Stat label="Rate" value={`${tier.ratePct}%`} hint={tier.recurring ? 'incl. renewals' : 'first payment'} />
              <Stat label="Window" value={`${ATTRIBUTION_WINDOW_DAYS} days`} hint="last click wins" />
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Percent size={15} className="text-primary" aria-hidden="true" /> Commission estimate
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Plan referred
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                aria-label="Plan referred"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              >
                {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Payment (USD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Payment amount in US dollars"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Paying customers (12 mo)
              <input
                type="number"
                min="0"
                value={conversions}
                onChange={(e) => setConversions(e.target.value)}
                aria-label="Number of paying customers referred in the last twelve months"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Months active
              <input
                type="number"
                min="1"
                value={monthsActive}
                onChange={(e) => setMonthsActive(e.target.value)}
                aria-label="Number of months the subscription has been active"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              />
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-border px-3 py-2.5" aria-live="polite">
            <p className="text-xs text-muted-foreground">{commission.reason}</p>
            <p className="num mt-0.5 text-lg font-semibold">{fmtUsd(commission.payable)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tier.recurring
                ? 'Recurring tiers earn on every renewal while the subscription stays active.'
                : 'Starter earns on the first payment only. Ten paying customers unlocks recurring commission.'}
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={15} className="text-primary" aria-hidden="true" /> Payout readiness
          </h2>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <input
              type="checkbox"
              checked={kyc}
              onChange={(e) => setKyc(e.target.checked)}
              aria-label="Identity verification completed"
              className="h-4 w-4 rounded border-border"
            />
            Identity verification completed
          </label>
          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            Accrued earnings (USD)
            <input
              type="number"
              min="0"
              step="1"
              value={earned}
              onChange={(e) => setEarned(e.target.value)}
              aria-label="Accrued referral earnings in US dollars"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
            />
          </label>

          <div className="mt-3 rounded-lg border border-border px-3 py-2.5">
            <p className="text-xs font-semibold">Payable: {fmtUsd(payout.payable)}</p>
            {payout.blocked.length ? (
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {payout.blocked.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">Eligible for the next payout run.</p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Commission becomes payable after a {PAYOUT_HOLD_DAYS}-day refund hold, above a {fmtUsd(MIN_PAYOUT_USD)} minimum,
            and only after identity verification. A refund claws the earning back rather than adjusting a balance quietly.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Tiers</h2>
          <div className="space-y-2">
            {REFERRAL_TIERS.map((t) => (
              <div
                key={t.id}
                className={'flex items-center justify-between rounded-xl border px-3 py-2.5 ' + (t.id === tier.id ? 'border-primary/40 bg-primary/5' : 'border-border')}
              >
                <div>
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.minConversions}+ paying customers{t.recurring ? ' · recurring' : ' · first payment only'}
                  </p>
                </div>
                <span className="num text-sm font-semibold">{t.ratePct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Fraud controls</h2>
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-xs font-semibold">This account: {fraud.decision}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{fraud.note}</p>
          </div>
          <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            {Object.entries(FRAUD_WEIGHTS).map(([id, weight]) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span>{id.replace(/-/g, ' ')}</span>
                <span className="num">{weight}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Blocks at 80 points, manual review at 40. The weights are fixed here so two reviewers looking at the same
            account reach the same decision.
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Earnings activity</h2>
        <p className="text-sm text-muted-foreground">
          No attributed events yet. Clicks, signups and conversions appear here once a referral link is used and the
          attribution service records it — the browser does not invent the figures.
        </p>
      </Card>
    </div>
  );
}
