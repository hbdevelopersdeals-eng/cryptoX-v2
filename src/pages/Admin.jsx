import React, { useMemo, useState } from 'react';
import { Settings2, Activity, ListChecks, ShieldAlert, Gauge, Users } from 'lucide-react';
import { useMarket } from '../lib/market.jsx';
import {
  validateFeeConfig, validateRiskConfig, diffConfig, healthSummary, listingReadiness,
  queueSummary, REQUIRES_PRIVILEGED_ROLE, MARKET_LISTING_CHECKLIST, FEE_BOUNDS, RISK_BOUNDS
} from '../lib/adminConfig.js';
import { Card, SectionTitle, Stat } from '../components/ui.jsx';
import { fmtNum } from '../lib/format.js';

/* Admin control plane.
 *
 * What this page is: a configuration console with real validation, a real health
 * read from the live market engine, a real listing checklist and the audit diff
 * a save would produce.
 *
 * What it is not: a view of other users' money. RLS gives a browser session its
 * own row and nothing else, so user counts, volume, deposits, revenue and
 * treasury are listed with the reason they cannot be shown rather than filled
 * with plausible-looking numbers. An operator console that invents a revenue
 * figure is worse than one that admits it is blind.
 */

const SAVED_FEES = { makerBps: 2, takerBps: 10, withdrawalBps: 50, settlementMinutes: 30 };
const SAVED_RISK = { maxLeverage: 5, maxOrderNotionalUsd: 100000, maxDailyWithdrawalUsd: 50000, circuitBreakerPct: 10 };

export default function AdminPage() {
  const market = useMarket() || {};
  const conn = market.conn || {};

  const [fees, setFees] = useState({ ...SAVED_FEES });
  const [risk, setRisk] = useState({ ...SAVED_RISK });
  const [reason, setReason] = useState('');
  const [applied, setApplied] = useState(null);
  const [listing, setListing] = useState({ legal: true, audit: true, sanctions: true, oracle: true });

  const feeCheck = useMemo(() => validateFeeConfig(fees), [fees]);
  const riskCheck = useMemo(() => validateRiskConfig(risk), [risk]);
  const feeDiff = useMemo(() => diffConfig(SAVED_FEES, fees), [fees]);
  const riskDiff = useMemo(() => diffConfig(SAVED_RISK, risk), [risk]);
  const changes = feeDiff.length + riskDiff.length;

  const health = useMemo(() => healthSummary([
    {
      id: 'ws',
      label: 'Exchange WebSocket',
      status: conn.ws === 'live' ? 'ok' : conn.ws === 'offline' ? 'down' : 'degraded',
      latencyMs: conn.lastTickAt ? Math.max(0, Date.now() - conn.lastTickAt) : null
    },
    {
      id: 'rest',
      label: 'Market REST provider',
      status: conn.cg === 'live' ? 'ok' : conn.cg === 'offline' ? 'down' : 'degraded'
    },
    {
      id: 'stale',
      label: 'Feed freshness',
      status: conn.stale ? 'degraded' : conn.ws === 'offline' ? 'degraded' : 'ok'
    }
  ]), [conn]);

  const readiness = useMemo(() => listingReadiness(listing), [listing]);

  /* Queues are genuinely empty here: no KYC case manager and no ticketing system
     is integrated in this build, so the honest output is zeroes plus the reason. */
  const kycQueue = useMemo(() => queueSummary([]), []);
  const supportQueue = useMemo(() => queueSummary([], { slaHours: 12 }), []);

  const canApply = feeCheck.valid && riskCheck.valid && changes > 0 && reason.trim().length >= 10;

  const apply = () => {
    if (!canApply) return;
    setApplied({
      at: new Date().toISOString(),
      reason: reason.trim(),
      changes: [...feeDiff, ...riskDiff]
    });
    setReason('');
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Admin"
        sub="Configuration validation, feed health, market listing gates and audit diffs. Cross-user data needs the privileged role and is listed, not simulated."
      />

      <Card className="border-amber-400/30 bg-amber-400/5">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Sections this session cannot read</p>
            <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
              {REQUIRES_PRIVILEGED_ROLE.map((r) => (
                <li key={r.section}><span className="font-medium text-foreground">{r.section}:</span> {r.reason}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A privileged-role console is a separate, network-restricted deployment with its own authentication. Putting that
              key in a browser bundle would hand every visitor full write access to the platform.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Feed" value={health.overall.toUpperCase()} hint={`${health.ok}/${health.total} healthy`} icon={<Activity size={16} />} />
        <Stat label="Unknown segments" value={String(REQUIRES_PRIVILEGED_ROLE.length)} hint="privileged role required" icon={<Users size={16} />} />
        <Stat label="KYC queue" value={String(kycQueue.open)} hint={`SLA ${kycQueue.slaHours}h`} icon={<ListChecks size={16} />} />
        <Stat label="Support queue" value={String(supportQueue.open)} hint={`SLA ${supportQueue.slaHours}h`} icon={<Gauge size={16} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Settings2 size={15} className="text-primary" aria-hidden="true" /> Fees
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FEE_BOUNDS).map(([key, bound]) => (
              <label key={key} className="block text-xs font-medium text-muted-foreground">
                {bound.label}
                <input
                  type="number"
                  value={fees[key]}
                  onChange={(e) => setFees((f) => ({ ...f, [key]: e.target.value }))}
                  aria-label={bound.label}
                  min={bound.min}
                  max={bound.max}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:border-primary/60"
                />
              </label>
            ))}
          </div>
          {feeCheck.errors.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-red-400" aria-live="polite">
              {feeCheck.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-emerald-400" aria-live="polite">Within bounds.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Gauge size={15} className="text-primary" aria-hidden="true" /> Risk limits
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(RISK_BOUNDS).map(([key, bound]) => (
              <label key={key} className="block text-xs font-medium text-muted-foreground">
                {bound.label}
                <input
                  type="number"
                  value={risk[key]}
                  onChange={(e) => setRisk((r) => ({ ...r, [key]: e.target.value }))}
                  aria-label={bound.label}
                  min={bound.min}
                  max={bound.max}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:border-primary/60"
                />
              </label>
            ))}
          </div>
          {riskCheck.errors.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-red-400" aria-live="polite">
              {riskCheck.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-emerald-400" aria-live="polite">Within bounds.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Pending configuration change</h2>
        {changes === 0 ? (
          <p className="text-sm text-muted-foreground">No changes. Edit a fee or a risk limit above.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Configuration fields that would change</caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">Field</th>
                    <th scope="col" className="py-1 pr-3 font-medium">From</th>
                    <th scope="col" className="py-1 pr-3 font-medium">To</th>
                    <th scope="col" className="py-1 font-medium">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {[...feeDiff, ...riskDiff].map((c) => (
                    <tr key={c.key} className="border-t border-border/60">
                      <td className="py-1 pr-3 font-mono">{c.key}</td>
                      <td className="num py-1 pr-3">{String(c.before)}</td>
                      <td className="num py-1 pr-3">{String(c.after)}</td>
                      <td className="py-1">{c.direction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="mt-3 block text-xs font-medium text-muted-foreground">
              Reason (recorded with the change; 10+ characters)
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Reason for the configuration change"
                placeholder="e.g. Q3 fee review approved by treasury"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-primary/60"
              />
            </label>

            <button
              type="button"
              onClick={apply}
              disabled={!canApply}
              className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2"
            >
              Record change
            </button>
            {!canApply ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                A change cannot be recorded while a field is out of bounds or the reason is too short.
              </p>
            ) : null}
          </>
        )}

        {applied ? (
          <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2.5" aria-live="polite">
            <p className="text-xs font-semibold text-emerald-400">Recorded locally at {applied.at.slice(0, 19).replace('T', ' ')} UTC</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {applied.changes.length} field(s) · reason “{applied.reason}”. This is the audit entry that would be written to
              <span className="font-mono"> cx_audit_log</span>; no server write is performed from this build.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Service health</h2>
          <div className="space-y-1.5">
            {health.rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: r.status === 'ok' ? '#34d399' : r.status === 'degraded' ? '#fbbf24' : '#f87171' }}
                    aria-hidden="true"
                  />
                  {r.label}
                </span>
                <span className="num text-muted-foreground">
                  {r.latencyMs != null ? `${fmtNum(r.latencyMs)} ms` : r.status}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Read from the live market engine in this tab. A provider that is offline is reported as down, not as “unknown”,
            because a stale quote is a trading hazard.
          </p>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Market listing readiness</h2>
          <ul className="space-y-1.5">
            {MARKET_LISTING_CHECKLIST.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={Boolean(listing[item.id])}
                  onChange={(e) => setListing((l) => ({ ...l, [item.id]: e.target.checked }))}
                  aria-label={item.label}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span className={listing[item.id] ? 'text-muted-foreground line-through' : ''}>
                  {item.label}
                  {item.critical ? <span className="ml-1 text-[10px] uppercase text-amber-400">critical</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <div className={'mt-3 rounded-lg border px-3 py-2.5 ' + (readiness.ready ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-red-400/30 bg-red-400/5')} aria-live="polite">
            <p className={'text-xs font-semibold ' + (readiness.ready ? 'text-emerald-400' : 'text-red-400')}>
              {readiness.ready ? 'Cleared to list' : `${readiness.blockers.length} critical gate(s) open`} · {readiness.completed}/{readiness.total}
            </p>
            {readiness.blockers.length ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : readiness.warnings.length ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-400/90">
                {readiness.warnings.map((w) => <li key={w}>Advisory: {w}</li>)}
              </ul>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
