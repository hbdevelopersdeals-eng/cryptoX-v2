import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, CreditCard, Download, Lock, Receipt, ShieldAlert
} from 'lucide-react';
import { Card } from '../components/ui.jsx';
import {
  PLANS, planById, prorate, trialState, evaluateCoupon, usageCharge,
  nextRetry, classifyDecline, planRefund, applyPaymentUpdate, PAYMENT_PROVIDERS,
  REGIONAL_METHODS, BILLING_CYCLES
} from '../lib/billing.js';
import {
  verifyTaxId, taxIdSchemeFor, resolveTax, JURISDICTIONS, jurisdictionFor, jurisdictionCoverage,
  createSeries, allocateNumber, issueCreditNote, invoiceBalance, appendFinancialEvent, accountingExport
} from '../lib/tax.js';

const Pill = ({ tone = 'muted', children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-400',
    warn: 'bg-amber-400/15 text-amber-300',
    bad: 'bg-down/15 text-down',
    muted: 'bg-muted text-muted-foreground'
  };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${tones[tone]}`}>{children}</span>;
};

const Row = ({ label, value, tone }) => (
  <p className="flex items-baseline justify-between gap-2 text-[11px]">
    <span className="text-muted-foreground">{label}</span>
    <span className={`font-mono ${tone || ''}`}>{value}</span>
  </p>
);

export default function Billing() {
  const [cycle, setCycle] = useState('monthly');
  const [currentPlan, setCurrentPlan] = useState('free');
  const [targetPlan, setTargetPlan] = useState('pro');
  const [couponCode, setCouponCode] = useState('SAVE20');
  const [couponPct, setCouponPct] = useState(20);
  const [units, setUnits] = useState(5000);
  const [usageMode, setUsageMode] = useState('graduated');

  const [taxCountry, setTaxCountry] = useState('DE');
  const [taxId, setTaxId] = useState('DE123456789');
  const [buyerType, setBuyerType] = useState('consumer');
  const [taxVerified, setTaxVerified] = useState(false);

  const [invoice, setInvoice] = useState(null);
  const [series, setSeries] = useState(() => createSeries({ prefix: 'INV', year: 2026 }));
  const [creditSeries, setCreditSeries] = useState(() => createSeries({ prefix: 'CN', year: 2026 }));
  const [finLog, setFinLog] = useState([]);
  const [status, setStatus] = useState('requires_payment');
  const [notice, setNotice] = useState(null);

  const target = planById(targetPlan);
  const price = target?.price?.[cycle] ?? 0;

  const pro = useMemo(() => prorate({
    fromPlanId: currentPlan, toPlanId: targetPlan, cycle,
    subscriptionStart: '2026-09-01T00:00:00Z', at: new Date('2026-09-21T00:00:00Z')
  }), [currentPlan, targetPlan, cycle]);

  const trial = useMemo(
    () => trialState({ planId: targetPlan, startedAt: '2026-09-20T00:00:00Z', at: new Date('2026-09-25T00:00:00Z') }),
    [targetPlan]
  );

  const coupon = useMemo(() => evaluateCoupon({
    coupon: { code: couponCode, percentOff: Number(couponPct), duration: 'once' },
    subtotal: price
  }), [couponCode, couponPct, price]);

  const tiers = [
    { upTo: 1000, rate: 0.10 }, { upTo: 10000, rate: 0.05 }, { upTo: Infinity, rate: 0.01 }
  ];
  const graduated = usageCharge({ units: Number(units), tiers, mode: 'graduated' });
  const volume = usageCharge({ units: Number(units), tiers, mode: 'volume' });

  const taxIdResult = verifyTaxId({ value: taxId, country: taxCountry });
  const taxRule = resolveTax({
    sellerCountry: 'DE', buyerCountry: taxCountry,
    buyer: { type: buyerType, taxIdVerified: taxVerified },
    product: { digital: true }
  });
  const jurisdiction = jurisdictionFor(taxCountry);

  const raiseInvoice = () => {
    const net = price;
    const resolved = taxRule.taxable ? net * (taxRule.rate / 100) : 0;
    const { number, series: nextSeries } = allocateNumber(series);
    setSeries(nextSeries);
    const created = {
      id: `inv_${number}`, number, currency: 'USD',
      net: Number(net.toFixed(2)), tax: Number(resolved.toFixed(2)),
      total: Number((net + resolved).toFixed(2)),
      paid: 0, refunded: 0, credited: 0,
      taxCountry: taxCountry, taxRate: taxRule.taxable ? taxRule.rate : 0,
      issuedAt: new Date().toISOString()
    };
    const logged = appendFinancialEvent(finLog, { action: 'invoice.created', actorId: 'local', targetId: number });
    setFinLog(logged.log);
    setInvoice(created);
    setStatus('requires_payment');
    setNotice({ kind: 'good', text: `Invoice ${number} raised with the next number in the series.` });
  };

  const attemptPay = (source) => {
    const out = applyPaymentUpdate({
      currentStatus: status,
      update: {
        status: 'paid',
        source,
        signatureVerifiedAt: source === 'webhook-verified' ? new Date().toISOString() : undefined
      }
    });
    if (!out.ok) {
      setNotice({ kind: 'warn', text: `${out.reason} — refused. ${out.note || ''}` });
      return;
    }
    setStatus(out.status);
    setInvoice({ ...invoice, paid: invoice.total });
    const logged = appendFinancialEvent(finLog, { action: 'invoice.paid', actorId: 'system' });
    setFinLog(logged.log);
    setNotice({ kind: 'good', text: `Accepted from ${source}.` });
  };

  const doRefund = (amount) => {
    const out = planRefund({ invoice, amount, reason: 'goodwill' });
    if (!out.ok) { setNotice({ kind: 'bad', text: `${out.reason}${out.available != null ? ` (available ${out.available})` : ''}` }); return; }
    setInvoice({ ...invoice, refunded: (invoice.refunded || 0) + out.refund.amount });
    const logged = appendFinancialEvent(finLog, { action: 'refund.settled', actorId: 'local' });
    setFinLog(logged.log);
    setNotice({ kind: 'good', text: `${out.refund.kind} refund of ${out.refund.amount} recorded.` });
  };

  const doCreditNote = () => {
    const out = issueCreditNote({ invoice, amount: 10, reason: 'goodwill', series: creditSeries });
    if (!out.ok) { setNotice({ kind: 'bad', text: `Credit note refused: ${out.reason}${out.remaining != null ? ` (remaining ${out.remaining})` : ''}` }); return; }
    setCreditSeries(out.series);
    setInvoice({ ...invoice, credited: out.credit.creditedAfter });
    const logged = appendFinancialEvent(finLog, { action: 'credit_note.issued', actorId: 'local' });
    setFinLog(logged.log);
    setNotice({ kind: 'good', text: `Credit note ${out.credit.number} for ${out.credit.amount}.` });
  };

  const exportCsv = () => {
    const out = accountingExport({ invoices: invoice ? [invoice] : [], credits: [] });
    const url = URL.createObjectURL(new Blob([out.text], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cryptox-ledger.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const balance = invoiceBalance(invoice);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <CreditCard size={18} className="text-primary" /> Billing &amp; Tax
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plan and tax arithmetic, invoices and credit notes. No payment is processed here — status only changes when a
          verified server origin reports it.
        </p>
      </div>

      {notice ? (
        <div className={`rounded-xl border px-4 py-2.5 text-[11px] ${
          notice.kind === 'bad' ? 'border-down/40 bg-down/10 text-down'
            : notice.kind === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'}`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Plans and proration */}
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Plans &amp; proration</h2>
          <div className="flex flex-wrap gap-2">
            <select value={currentPlan} onChange={(e) => setCurrentPlan(e.target.value)} aria-label="Current plan" className="input-dark !h-9 !w-36 !text-[11px]">
              {PLANS.map((p) => <option key={p.id} value={p.id}>from {p.name}</option>)}
            </select>
            <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)} aria-label="Target plan" className="input-dark !h-9 !w-36 !text-[11px]">
              {PLANS.map((p) => <option key={p.id} value={p.id}>to {p.name}</option>)}
            </select>
            <select value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="Billing cycle" className="input-dark !h-9 !w-28 !text-[11px]">
              {BILLING_CYCLES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div className="rounded-lg border border-border p-3">
            <Row label={`${target?.name} ${cycle} list price`} value={price == null ? 'contact sales' : `$${price}`} />
            <Row label="Unused credit from current plan" value={`$${pro.credit ?? 0}`} />
            <Row label="Charge for remainder of cycle" value={`$${pro.charge ?? 0}`} />
            <Row label={`Net (${pro.direction || '—'})`} value={`$${pro.net ?? 0}`} tone={pro.net < 0 ? 'text-emerald-400' : ''} />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Prorated at {pro.remainingDays}/{pro.totalDays} days remaining. A negative net is a credit the customer is owed, not a zero charge.
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Pill tone={trial.onTrial ? 'good' : 'muted'}>{trial.onTrial ? 'on trial' : 'no trial'}</Pill>
              <span className="text-[11px]">{trial.daysLeft ?? 0} day(s) left</span>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              On expiry: {trial.onExpiry || '—'}. A trial ending without a payment method degrades to free rather than silently
              keeping paid entitlements.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {PLANS.filter((p) => !p.contactOnly).map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-2">
                <p className="text-[11px] font-medium">{p.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {p.entitlements.alerts == null ? 'unlimited' : p.entitlements.alerts} alerts · {p.entitlements.seats} seat(s)
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Coupons and usage */}
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Coupons &amp; metered usage</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Code</span>
              <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} aria-label="Coupon code" className="input-dark !h-9 !w-32 !text-[11px]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Percent off</span>
              <input type="number" value={couponPct} onChange={(e) => setCouponPct(e.target.value)} aria-label="Percent off" className="input-dark !h-9 !w-20 !text-[11px]" />
            </label>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Pill tone={coupon.ok ? 'good' : 'bad'}>{coupon.ok ? 'applies' : coupon.reason}</Pill>
              <span className="text-[11px] font-mono">−${coupon.discount ?? 0}</span>
            </div>
            <Row label="Total after discount" value={`$${coupon.total ?? price}`} />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              A &ldquo;once&rdquo; coupon applies to the first invoice only; the duration is part of the coupon, not the caller&apos;s choice.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Units</span>
              <input type="number" value={units} onChange={(e) => setUnits(e.target.value)} aria-label="Units" className="input-dark !h-9 !w-24 !text-[11px]" />
            </label>
            <select value={usageMode} onChange={(e) => setUsageMode(e.target.value)} aria-label="Usage mode" className="input-dark !h-9 !w-32 !text-[11px]">
              <option value="graduated">graduated</option>
              <option value="volume">volume</option>
            </select>
          </div>
          <div className="rounded-lg border border-border p-3">
            <Row label="Graduated total" value={`$${graduated.amount ?? '—'}`} />
            <Row label="Volume total" value={`$${volume.amount ?? '—'}`} />
            <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-amber-300">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              These differ. Graduated charges each tier only for the units inside it; volume applies the landing tier&apos;s rate to
              every unit. Confusing the two mis-bills by a large factor.
            </p>
          </div>
        </Card>
      </div>

      {/* Payment authority */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lock size={15} className="text-primary" /> Payment status authority
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Try to mark this invoice paid from the client. The update is refused, because a status the browser can assert is a status
          an attacker can assert.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={status === 'paid' ? 'good' : 'warn'}>{status}</Pill>
          <button type="button" onClick={() => attemptPay('client')} className="btn-ghost !h-8 !px-3 !text-[11px]">Client says paid</button>
          <button type="button" onClick={() => attemptPay('server-reconciliation')} className="btn-ghost !h-8 !px-3 !text-[11px]">Server reconciliation</button>
          <button type="button" onClick={() => attemptPay('webhook-verified')} className="btn-primary !h-8 !px-3 !text-[11px]">Verified webhook</button>
        </div>
        <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <ShieldAlert size={11} className="mt-0.5 shrink-0" />
          Webhook signature verification is HMAC-SHA256 in constant time, and it must run server-side — the signing secret can
          never ship to a browser. The client half is this refusal.
        </p>
      </Card>

      {/* Invoice, refunds, credit notes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Receipt size={15} className="text-primary" /> Invoice</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={raiseInvoice} className="btn-primary !h-8 !px-3 !text-[11px]">Raise invoice</button>
            <button type="button" disabled={!invoice || invoice.paid < invoice.total} onClick={() => doRefund(null)} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">Refund in full</button>
            <button type="button" disabled={!invoice} onClick={() => doRefund(10)} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">Refund $10</button>
            <button type="button" disabled={!invoice} onClick={doCreditNote} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">Credit note $10</button>
          </div>
          {invoice ? (
            <div className="rounded-lg border border-border p-3">
              <Row label="Number" value={invoice.number} />
              <Row label="Net" value={`$${invoice.net.toFixed(2)}`} />
              <Row label={`Tax (${invoice.taxRate}%)`} value={`$${invoice.tax.toFixed(2)}`} />
              <Row label="Total" value={`$${invoice.total.toFixed(2)}`} />
              <Row label="Balance" value={`$${balance.balance.toFixed(2)}`} tone={balance.settled ? 'text-emerald-400' : ''} />
              {balance.overpaid ? <Row label="Overpaid" value={`$${Math.abs(balance.balance).toFixed(2)}`} tone="text-amber-300" /> : null}
            </div>
          ) : <p className="text-[11px] text-muted-foreground">No invoice yet. Numbers come from a gapless per-series sequence and are never reused.</p>}
          <button type="button" onClick={exportCsv} disabled={!invoice} className="btn-ghost !h-8 !px-3 !text-[11px] disabled:opacity-40">
            <Download size={12} className="mr-1.5" /> Export ledger CSV
          </button>
          <p className="text-[10px] text-muted-foreground">
            Amounts export as exact decimal strings. A CSV carrying money as a float loses cents at scale, invisibly.
            Audit entries: {finLog.length}.
          </p>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Tax &amp; business identifiers</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Jurisdiction</span>
              <select value={taxCountry} onChange={(e) => { setTaxCountry(e.target.value); setTaxVerified(false); }} aria-label="Tax jurisdiction" className="input-dark !h-9 !w-24 !text-[11px]">
                {JURISDICTIONS.map((j) => <option key={j.country} value={j.country}>{j.country}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Tax ID</span>
              <input value={taxId} onChange={(e) => { setTaxId(e.target.value); setTaxVerified(false); }} aria-label="Tax ID" className="input-dark !h-9 !w-48 font-mono !text-[11px]" />
            </label>
            <button
              type="button"
              onClick={() => setTaxVerified(taxIdResult.ok)}
              disabled={!taxIdSchemeFor(taxCountry)}
              className="btn-ghost !h-9 !px-3 !text-[11px] disabled:opacity-40"
            >
              Verify
            </button>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={taxIdResult.ok ? 'good' : 'bad'}>{taxIdResult.ok ? 'valid' : taxIdResult.reason}</Pill>
              {taxIdResult.scheme ? <span className="text-[10px] text-muted-foreground">{taxIdResult.scheme} · {taxIdResult.coverage}</span> : null}
              {taxVerified ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><BadgeCheck size={11} /> marked verified</span> : null}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">{taxIdResult.note || 'No identifier scheme is configured for this jurisdiction.'}</p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-muted-foreground">Buyer type</span>
              <select value={buyerType} onChange={(e) => setBuyerType(e.target.value)} aria-label="Buyer type" className="input-dark !h-9 !w-32 !text-[11px]">
                <option value="consumer">consumer</option>
                <option value="business">business</option>
              </select>
            </label>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Pill tone={taxRule.taxable ? 'warn' : 'good'}>{taxRule.reason}</Pill>
              <span className="text-[11px]">{taxRule.taxable ? `${taxRule.rate}%` : 'no tax charged'}</span>
            </div>
            <Row label="Type" value={jurisdiction ? jurisdiction.type : 'not configured'} />
            {taxRule.steps?.map((s) => <p key={s} className="mt-1 text-[10px] text-muted-foreground">· {s}</p>)}
            {jurisdiction?.note ? <p className="mt-1 text-[10px] text-amber-300">{jurisdiction.note}</p> : null}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Configured jurisdictions: {jurisdictionCoverage().configured}. Rates here are starting configuration, not tax law — and
            where a single national rate would be wrong, none is applied.
          </p>
        </Card>
      </div>

      {/* Dunning and providers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Failed payments</h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {[
              { code: 'insufficient_funds', label: 'Insufficient funds' },
              { code: 'card_expired', label: 'Card expired' },
              { code: 'authentication_required', label: 'Authentication required' },
              { code: 'fraud_suspected', label: 'Fraud suspected' }
            ].map((c) => {
              const d = classifyDecline(c.code);
              return (
                <div key={c.code} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[10px]">
                  <Pill tone={d.retryable ? 'warn' : 'bad'}>{d.retryable ? 'retryable' : 'do not retry'}</Pill>
                  <span className="flex-1">{c.label}</span>
                  <span className="font-mono text-muted-foreground">{d.action}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Retrying an expired card can never succeed, so the schedule stops rather than burning attempts. Next retry after failure
            #{' '}
            {nextRetry({ failedAt: new Date().toISOString(), attempts: 0 }).attempt}: {nextRetry({ failedAt: new Date().toISOString(), attempts: 0 }).note}
          </p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Providers &amp; regional methods</h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {PAYMENT_PROVIDERS.map((p) => (
              <div key={p.id} className="px-2.5 py-1.5">
                <p className="text-[11px] font-medium">{p.label}</p>
                <p className="text-[10px] text-muted-foreground">needs {p.requires}</p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border p-2.5 text-[10px] text-muted-foreground">
            {REGIONAL_METHODS.map((r) => (
              <p key={r.region}><span className="font-medium text-foreground">{r.region}</span>: {r.methods.join(', ')}</p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
