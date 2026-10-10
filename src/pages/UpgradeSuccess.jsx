import React, { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useSubscription, recordCheckoutReturn } from '../lib/subscription.jsx';

/* Where Lemon Squeezy sends a buyer after checkout.
 *
 * THE ONE THING THIS PAGE MUST NOT DO IS GRANT ANYTHING. A return URL is a
 * query string, and a query string is editable by whoever is holding the
 * browser — so "?status=success" proves nothing at all. Access comes from the
 * cx_subscriptions row that the webhook writes after the payment provider
 * confirms it, and from nowhere else.
 *
 * What it does do is ask the subscription state to re-read itself, because the
 * webhook has probably just landed. If it has not arrived yet, the page says
 * so honestly instead of pretending the purchase completed.
 */

export default function UpgradeSuccess() {
  const [params] = useSearchParams();
  const sub = useSubscription();
  const asked = useRef(false);

  const status = params.get('status');

  useEffect(() => {
    // Once per mount: re-read the subscription. The webhook may have landed.
    if (asked.current) return;
    asked.current = true;
    recordCheckoutReturn({ status });
    sub.refresh();
    // `sub.refresh` is stable per provider render; re-running on every render
    // would poll the database in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const confirmed = sub.isPaid;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <header className="flex items-center gap-2">
        <Sparkles size={22} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight">Thanks for your purchase</h1>
      </header>

      {sub.loading ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Checking your subscription…</p>
        </div>
      ) : confirmed ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium">
              Your <span className="text-primary">{sub.plan?.name}</span> plan is active.
            </p>
            {sub.renewsAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Renews on {new Date(sub.renewsAt).toLocaleDateString()}.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium">We are confirming your payment.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your plan appears here as soon as the payment provider confirms the payment — usually within a few
              seconds. Nothing is activated by returning to this page, so if you have just paid, wait a moment and
              refresh. If it has not appeared after a few minutes, contact support with your receipt.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          to="/account"
          className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go to your account
        </Link>
        <Link
          to="/pricing"
          className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          Back to plans
        </Link>
      </div>
    </div>
  );
}
