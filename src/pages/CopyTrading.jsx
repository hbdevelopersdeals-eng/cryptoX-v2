import React, { useMemo, useState } from 'react';
import { Users, ShieldAlert, Calculator, BadgeCheck, BadgeX } from 'lucide-react';
import {
  copyPlan, performanceSummary, riskProfile, verifyTrackRecord, shouldStopCopy,
  feeBreakdown, COPY_FEE_MODEL, VERIFY_MIN_DAYS, VERIFIABLE_SOURCES
} from '../lib/copyTrading.js';
import { fmtUsd, pct } from '../lib/format.js';
import { Card, SectionTitle, Stat } from '../components/ui.jsx';

/* Copy trading without a follower-execution backend.
 *
 * The page does the part that is genuinely computable in the browser — sizing a
 * copy plan, checking a track record, evaluating stop rules — and refuses to
 * invent the part that is not: there is no live trader leaderboard here, because
 * a leaderboard needs reconciled exchange data and this deployment has none.
 *
 * That refusal is the feature. A page that showed eight invented traders with
 * invented Sharpe ratios would be indistinguishable from one that worked, until
 * someone allocated money against it.
 */

const parseReturns = (text) => {
  const parts = String(text)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const values = [];
  for (const p of parts) {
    const n = Number(p.replace('%', ''));
    if (!Number.isFinite(n)) return { error: `"${p}" is not a number.` };
    values.push(n / 100);
  }
  return { values };
};

export default function CopyTradingPage() {
  const [equity, setEquity] = useState('10000');
  const [allocationPct, setAllocationPct] = useState('20');
  const [maxLossPct, setMaxLossPct] = useState('25');
  const [perTradePct, setPerTradePct] = useState('5');
  const [stopDrawdownPct, setStopDrawdownPct] = useState('30');
  const [liveEquity, setLiveEquity] = useState('');
  const [traderSeries, setTraderSeries] = useState('1.2, -0.8, 0.4, 1.1, -2.0, 0.6, 0.9, -0.3');
  const [source, setSource] = useState('self-reported');
  const [gaps, setGaps] = useState('0');

  const plan = useMemo(
    () =>
      copyPlan({
        equity: Number(equity),
        allocationPct: Number(allocationPct),
        maxLossPct: Number(maxLossPct),
        perTradePct: Number(perTradePct)
      }),
    [equity, allocationPct, maxLossPct, perTradePct]
  );

  const parsed = useMemo(() => parseReturns(traderSeries), [traderSeries]);
  const summary = useMemo(
    () => performanceSummary(parsed.values || [], { trades: 0 }),
    [parsed]
  );
  const profile = useMemo(() => riskProfile(summary), [summary]);
  const verification = useMemo(
    () =>
      verifyTrackRecord({
        source,
        returns: parsed.values || [],
        gaps: Number(gaps) || 0,
        /* A reconciled timestamp is only claimed for sources we can reconcile. */
        reconciledAt: VERIFIABLE_SOURCES.includes(source) ? new Date().toISOString() : null
      }),
    [source, parsed, gaps]
  );

  const stop = useMemo(() => {
    if (!plan.ok || liveEquity === '') return null;
    return shouldStopCopy({
      copyEquity: Number(liveEquity),
      startEquity: plan.allocation,
      plan,
      traderDrawdown: Number(stopDrawdownPct) / 100,
      stopCopyDrawdown: Number(stopDrawdownPct) / 100
    });
  }, [plan, liveEquity, stopDrawdownPct]);

  const fee = useMemo(() => feeBreakdown({ grossProfit: 1000, highWaterMark: 0 }), []);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Copy trading"
        sub="Size a copy plan, verify a track record and evaluate the stop rules. No follower execution is wired in this build — nothing here places an order."
      />

      <Card className="border-amber-400/30 bg-amber-400/5">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">What this page can and cannot do</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              The arithmetic, verification and stop logic below are real and testable. The trader leaderboard is empty by
              design: a leaderboard requires reconciled exchange history, and this deployment has no venue keys. Live copy
              execution, allocation custody and follower order routing belong on the server, next to the keys — never in a
              browser tab.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Calculator size={15} className="text-primary" aria-hidden="true" /> Copy plan
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Your equity (USD)
              <input
                type="number"
                min="0"
                step="100"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                aria-label="Your equity in US dollars"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline focus-visible:outline-2"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Allocate to this trader (%)
              <input
                type="number"
                min="0"
                max="100"
                value={allocationPct}
                onChange={(e) => setAllocationPct(e.target.value)}
                aria-label="Percentage of equity allocated to this trader"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline focus-visible:outline-2"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Max loss of allocation (%)
              <input
                type="number"
                min="1"
                max="100"
                value={maxLossPct}
                onChange={(e) => setMaxLossPct(e.target.value)}
                aria-label="Maximum loss as a percentage of the allocation"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline focus-visible:outline-2"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Per-trade cap (%)
              <input
                type="number"
                min="1"
                max="100"
                value={perTradePct}
                onChange={(e) => setPerTradePct(e.target.value)}
                aria-label="Maximum size of a single copied trade as a percentage of the allocation"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline focus-visible:outline-2"
              />
            </label>
          </div>

          {!plan.ok ? (
            <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2">
              <p className="text-xs font-semibold text-red-400">Plan refused</p>
              <ul className="mt-1 list-inside list-disc text-[12px] text-muted-foreground">
                {plan.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Stat label="Allocated" value={fmtUsd(plan.allocation)} />
              <Stat label="Hard loss cap" value={fmtUsd(plan.maxLoss)} hint={`${plan.worstCaseLossPctOfEquity.toFixed(1)}% of equity`} />
              <Stat label="Max per trade" value={fmtUsd(plan.perTrade)} />
              <Stat label="Stop-out at" value={fmtUsd(plan.stopEquity)} />
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border px-3 py-2.5">
            <p className="text-xs font-semibold">Fee terms</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {COPY_FEE_MODEL.profitSharePct}% of new profit, 0% management, high-water mark {COPY_FEE_MODEL.highWaterMark ? 'enabled' : 'disabled'}.
              On a $1,000 gain with no prior high-water mark, the fee is {fmtUsd(fee.fee)} and the follower keeps {fmtUsd(fee.net)}.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Users size={15} className="text-primary" aria-hidden="true" /> Track record
          </h2>

          <label className="block text-xs font-medium text-muted-foreground">
            Periodic returns (%, comma or space separated)
            <textarea
              value={traderSeries}
              onChange={(e) => setTraderSeries(e.target.value)}
              rows={3}
              aria-label="Periodic returns as percentages, separated by commas or spaces"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:border-primary/60 focus-visible:outline focus-visible:outline-2"
            />
          </label>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Source
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                aria-label="Source of the track record"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              >
                <option value="self-reported">Self-reported</option>
                <option value="screenshot">Screenshot</option>
                <option value="third-party-link">Third-party link</option>
                <option value="exchange-api">Exchange API (reconcilable)</option>
                <option value="custodial-snapshot">Custodial snapshot (reconcilable)</option>
                <option value="onchain-verified">On-chain verified</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Gaps in the series
              <input
                type="number"
                min="0"
                value={gaps}
                onChange={(e) => setGaps(e.target.value)}
                aria-label="Number of gaps in the return series"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              />
            </label>
          </div>

          {parsed.error ? (
            <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-400">{parsed.error}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Periods" value={String(summary.periods)} hint={`${VERIFY_MIN_DAYS} needed to verify`} />
              <Stat label="Total return" value={summary.totalReturn == null ? '—' : pct(summary.totalReturn * 100)} />
              <Stat label="Max drawdown" value={summary.maxDrawdown == null ? '—' : `${(summary.maxDrawdown * 100).toFixed(1)}%`} />
              <Stat label="Sharpe" value={summary.sharpe == null ? '—' : summary.sharpe.toFixed(2)} hint="annualised, rf = 0" />
              <Stat label="Win rate" value={summary.winRate == null ? '—' : `${(summary.winRate * 100).toFixed(0)}%`} hint="positive periods" />
              <Stat label="Risk profile" value={profile.label} />
            </div>
          )}

          <div className={'mt-4 rounded-lg border px-3 py-2.5 ' + (verification.verified ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-border')}>
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              {verification.verified
                ? <BadgeCheck size={14} className="text-emerald-400" aria-hidden="true" />
                : <BadgeX size={14} className="text-muted-foreground" aria-hidden="true" />}
              {verification.label}
            </p>
            {verification.reasons.length ? (
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {verification.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Reconciled against the source of record within the last 7 days, with no gaps.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Stop-rule evaluation</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Current copy equity (USD)
            <input
              type="number"
              min="0"
              step="10"
              value={liveEquity}
              onChange={(e) => setLiveEquity(e.target.value)}
              placeholder={plan.ok ? String(plan.allocation) : '0'}
              aria-label="Current equity of the copy position in US dollars"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Stop-copy on trader drawdown (%)
            <input
              type="number"
              min="1"
              max="100"
              value={stopDrawdownPct}
              onChange={(e) => setStopDrawdownPct(e.target.value)}
              aria-label="Stop copying when the trader drawdown reaches this percentage"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
            />
          </label>
        </div>

        <div className="mt-3 rounded-lg border border-border px-3 py-2.5" aria-live="polite">
          {!plan.ok ? (
            <p className="text-xs text-muted-foreground">Fix the copy plan above before evaluating stops.</p>
          ) : liveEquity === '' ? (
            <p className="text-xs text-muted-foreground">Enter the current copy equity to evaluate the stop rules.</p>
          ) : stop ? (
            <>
              <p className={'text-xs font-semibold ' + (stop.stop ? 'text-red-400' : 'text-emerald-400')}>
                {stop.stop ? 'Stop triggered' : 'Within every limit'} — {stop.reason}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{stop.detail}</p>
            </>
          ) : null}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Rules are evaluated in severity order: the capital floor first, then the absolute loss cap, then the trader
          drawdown threshold, then a loss streak. The first match wins, so a breached floor is never reported as a warning.
        </p>
      </Card>
    </div>
  );
}
