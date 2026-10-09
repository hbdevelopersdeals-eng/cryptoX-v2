import React, { useMemo, useState } from 'react';
import { AlertTriangle, BookLock, FileCheck2, Gavel, Scale, ScrollText } from 'lucide-react';
import { Card } from '../components/ui.jsx';
import {
  POLICY_TYPES, publishPolicy, requiredAcceptances, acceptanceState, recordAcceptance,
  CONSENT_CATEGORIES, DEFAULT_CONSENT, normaliseConsent, recordConsent, withdrawConsent,
  consentSummary, DSR_TYPES, DSR_RULES, createDsr, advanceDsr, dsrStatus, RETENTION_CLASSES,
  createLegalHold, releaseHold, activeHolds, canDelete, purgeCandidates, REGULATED_SCOPE,
  COMPLIANCE_READINESS, complianceSummary
} from '../lib/compliance.js';

const Pill = ({ tone = 'muted', children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-400',
    warn: 'bg-amber-400/15 text-amber-300',
    bad: 'bg-down/15 text-down',
    muted: 'bg-muted text-muted-foreground'
  };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${tones[tone]}`}>{children}</span>;
};

const STATUS_TONE = { implemented: 'good', 'server-only': 'warn', 'not-applicable': 'muted' };

export default function Compliance() {
  const [policies, setPolicies] = useState(() => [
    publishPolicy({ type: 'terms', version: '1.0', effectiveAt: '2026-01-01T00:00:00Z' }).policy,
    publishPolicy({ type: 'privacy', version: '1.0', effectiveAt: '2026-01-01T00:00:00Z' }).policy,
    publishPolicy({ type: 'cookies', version: '1.0', effectiveAt: '2026-01-01T00:00:00Z' }).policy
  ]);
  const [acceptances, setAcceptances] = useState([]);
  const [consent, setConsent] = useState(DEFAULT_CONSENT);
  const [consentLog, setConsentLog] = useState([]);
  const [dsr, setDsr] = useState([]);
  const [dsrType, setDsrType] = useState('access');
  const [jurisdiction, setJurisdiction] = useState('gdpr');
  const [holds, setHolds] = useState([]);
  const [notice, setNotice] = useState(null);

  const required = useMemo(() => requiredAcceptances({ policies, at: new Date() }), [policies]);
  const acceptance = useMemo(() => acceptanceState({ policies, acceptances, at: new Date() }), [policies, acceptances]);
  const summary = useMemo(() => complianceSummary(), []);

  const publishV2 = () => {
    const next = publishPolicy({
      type: 'terms', version: '2.0', effectiveAt: new Date().toISOString(), supersedes: 'terms@1.0'
    });
    setPolicies([...policies, next.policy]);
    setNotice({ kind: 'warn', text: 'Terms v2.0 published. Prior acceptance does not carry over — it must be re-obtained.' });
  };

  const accept = (policyId) => {
    const a = recordAcceptance({
      policyId, userId: 'local', evidence: { userAgent: navigator.userAgent, locale: navigator.language }
    });
    setAcceptances([...acceptances, a.acceptance]);
    setNotice({ kind: 'good', text: `Accepted ${policyId}, recorded against that exact version.` });
  };

  const toggleConsent = (id) => {
    const { state, record } = recordConsent({ current: consent, selection: { [id]: !consent[id] }, userId: 'local', policyVersion: 'privacy@1.0' });
    setConsent(state);
    setConsentLog([...consentLog, record]);
  };

  const withdraw = (id) => {
    const out = withdrawConsent({ current: consent, category: id });
    if (!out.ok) { setNotice({ kind: 'warn', text: `${out.reason} — ${out.note}` }); return; }
    setConsent(out.state);
    setConsentLog([...consentLog, { at: out.at, changed: [id], categories: out.state, withdrawal: true }]);
    setNotice({ kind: 'good', text: `Withdrawn. No reason is required and it takes effect immediately.` });
  };

  const addDsr = () => {
    const out = createDsr({ type: dsrType, userId: 'local', jurisdiction });
    if (!out.ok) { setNotice({ kind: 'bad', text: out.reason }); return; }
    setDsr([...dsr, out.request]);
    setNotice({ kind: 'good', text: `${dsrType} request opened under ${DSR_RULES[jurisdiction].label} — due ${out.request.dueAt.slice(0, 10)}.` });
  };

  const advance = (id, nextState, extensionReason = null) => {
    const current = dsr.find((r) => r.id === id);
    const out = advanceDsr({ request: current, nextState, extensionReason });
    if (!out.ok) {
      setNotice({ kind: 'bad', text: `Refused: ${out.reason}${out.from ? ` (${out.from} → ${out.to})` : ''}` });
      return;
    }
    setDsr(dsr.map((r) => (r.id === id ? out.request : r)));
    if (extensionReason) setNotice({ kind: 'warn', text: `Extended once by ${DSR_RULES[current.jurisdiction].extensionDays} days with a recorded reason.` });
  };

  const placeHold = () => {
    const out = createLegalHold({ scope: 'account', reason: 'Regulator request 2026-10', custodian: 'legal@example.com' });
    if (!out.ok) { setNotice({ kind: 'bad', text: out.reason }); return; }
    setHolds([...holds, out.hold]);
    setNotice({ kind: 'warn', text: 'Legal hold placed. Deletion of held data is now blocked, including on a valid erasure request.' });
  };

  const liftHold = (id) => {
    const current = holds.find((h) => h.id === id);
    const out = releaseHold({ hold: current, reason: 'matter closed' });
    if (!out.ok) { setNotice({ kind: 'bad', text: out.reason }); return; }
    setHolds(holds.map((h) => (h.id === id ? out.hold : h)));
    setNotice({ kind: 'good', text: 'Hold released. Deletion is permitted again.' });
  };

  const financialBlock = canDelete({ holds, retentionClass: 'financial' });
  const accountBlock = canDelete({ holds, retentionClass: 'account' });
  const locationBlock = canDelete({ holds, retentionClass: 'location' });

  const staleLocation = purgeCandidates({
    records: [{ id: 'loc_old', retentionClass: 'location', createdAt: '2024-01-01T00:00:00Z' }],
    at: new Date()
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Scale size={18} className="text-primary" /> Compliance
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Policies, consent, data-subject requests, retention and legal hold. Regulated activities are declared, not simulated.
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
        {/* Policies */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={15} className="text-primary" /> Policies &amp; acceptance</h2>
          <div className="flex items-center gap-2">
            <Pill tone={acceptance.satisfied ? 'good' : 'warn'}>
              {acceptance.satisfied ? 'up to date' : `${acceptance.outstanding.length} outstanding`}
            </Pill>
            <button type="button" onClick={publishV2} className="btn-ghost !h-7 !px-2.5 !text-[10px]">Publish Terms v2.0</button>
          </div>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {required.map((p) => {
              const done = acceptance.accepted.includes(p.id);
              const def = POLICY_TYPES.find((x) => x.id === p.type);
              return (
                <div key={p.id} className="flex items-center gap-2 px-2.5 py-2 text-[11px]">
                  <Pill tone={done ? 'good' : 'warn'}>{done ? 'accepted' : 'required'}</Pill>
                  <span className="flex-1">{def?.label} <span className="font-mono text-muted-foreground">{p.version}</span></span>
                  {!done ? (
                    <button type="button" onClick={() => accept(p.id)} className="btn-ghost !h-6 !px-2 !text-[10px]">Accept</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Acceptance is recorded against a specific version. Publishing v2.0 makes every prior acceptance insufficient — a stored
            boolean would have silently inherited consent the user never gave.
          </p>
          <p className="text-[10px] text-muted-foreground">{POLICY_TYPES.length} document types configured.</p>
        </Card>

        {/* Consent */}
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Consent</h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {CONSENT_CATEGORIES.map((c) => {
              const on = c.required ? true : consent[c.id];
              return (
                <div key={c.id} className="flex items-center gap-2 px-2.5 py-2">
                  <label className="flex flex-1 items-center gap-2 text-[11px]">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={c.required}
                      onChange={() => toggleConsent(c.id)}
                      aria-label={c.label}
                    />
                    <span>{c.label}{c.required ? ' (always on)' : ''}</span>
                  </label>
                  <span className="text-[10px] text-muted-foreground">{c.lawfulBasis}</span>
                  {!c.required && on ? (
                    <button type="button" onClick={() => withdraw(c.id)} className="btn-ghost !h-6 !px-2 !text-[10px]">Withdraw</button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border border-border p-2.5 text-[10px] text-muted-foreground">
            <p>Analytics and marketing default to OFF. Marketing is separate from analytics on purpose — measuring usage is not
              permission to advertise.</p>
            <p className="mt-1">Records kept: {consentLog.length}. Withdrawal requires no reason and applies immediately.</p>
            <p className="mt-1">Granted: {consentSummary(consent).filter((c) => c.granted).map((c) => c.label).join(', ') || 'none'}.</p>
          </div>
        </Card>
      </div>

      {/* DSR */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ScrollText size={15} className="text-primary" /> Data-subject requests</h2>
        <div className="flex flex-wrap items-end gap-2">
          <select value={dsrType} onChange={(e) => setDsrType(e.target.value)} aria-label="Request type" className="input-dark !h-9 !w-36 !text-[11px]">
            {DSR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} aria-label="Jurisdiction" className="input-dark !h-9 !w-44 !text-[11px]">
            {Object.entries(DSR_RULES).filter(([k]) => k !== 'default').map(([k, v]) => (
              <option key={k} value={k}>{v.label} ({v.days}d)</option>
            ))}
          </select>
          <button type="button" onClick={addDsr} className="btn-primary !h-9 !px-3 !text-[11px]">Open request</button>
        </div>
        <p className="text-[10px] text-muted-foreground">{DSR_RULES[jurisdiction].note}</p>

        {dsr.length ? (
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {dsr.map((r) => {
              const st = dsrStatus({ request: r });
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-[10px]">
                  <Pill tone={st.closed ? 'good' : st.overdue ? 'bad' : 'warn'}>{r.state}</Pill>
                  <span className="font-medium capitalize">{r.type}</span>
                  <span className="text-muted-foreground">{r.jurisdiction} · {r.ruleDays}d</span>
                  <span className={st.overdue ? 'text-down' : 'text-muted-foreground'}>
                    {st.closed ? 'closed' : st.overdue ? `${Math.abs(st.daysLeft)}d overdue` : `${st.daysLeft}d left`}
                  </span>
                  {r.extension ? <Pill tone="warn">extended +{r.extension.days}d</Pill> : null}
                  {!st.closed ? (
                    <span className="ml-auto flex gap-1">
                      {r.state === 'received' ? <button type="button" onClick={() => advance(r.id, 'verifying')} className="btn-ghost !h-6 !px-2 !text-[10px]">Verify</button> : null}
                      {r.state === 'verifying' ? <button type="button" onClick={() => advance(r.id, 'processing')} className="btn-ghost !h-6 !px-2 !text-[10px]">Process</button> : null}
                      {!r.extension && DSR_RULES[r.jurisdiction].extensionDays ? (
                        <button type="button" onClick={() => advance(r.id, 'processing', 'complex request')} className="btn-ghost !h-6 !px-2 !text-[10px]">Extend</button>
                      ) : null}
                      <button type="button" onClick={() => advance(r.id, 'completed')} className="btn-ghost !h-6 !px-2 !text-[10px]">Close</button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No requests. The response window is set by jurisdiction — 30 days under GDPR, 45 under CCPA, 15 under LGPD — and the
            clock is fixed at creation.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Retention and legal hold */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Gavel size={15} className="text-primary" /> Retention &amp; legal hold</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={placeHold} className="btn-ghost !h-8 !px-3 !text-[11px]">Place hold on account data</button>
            {activeHolds(holds).map((h) => (
              <button key={h.id} type="button" onClick={() => liftHold(h.id)} className="btn-ghost !h-8 !px-3 !text-[11px] text-down">
                Release hold
              </button>
            ))}
          </div>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {[
              { cls: 'financial', check: financialBlock },
              { cls: 'account', check: accountBlock },
              { cls: 'location', check: locationBlock }
            ].map(({ cls, check }) => {
              const def = RETENTION_CLASSES.find((r) => r.id === cls);
              return (
                <div key={cls} className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-[10px]">
                  <Pill tone={check.allowed ? 'good' : 'bad'}>{check.allowed ? 'deletable' : check.reason}</Pill>
                  <span className="flex-1">{def.label}</span>
                  <span className="text-muted-foreground">{def.days}d · {def.basis}</span>
                </div>
              );
            })}
          </div>
          {!financialBlock.allowed ? (
            <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {financialBlock.note}
            </p>
          ) : null}
          <p className="text-[10px] text-muted-foreground">
            Purge candidates by age: {staleLocation.length}. A hold overrides every retention rule — destroying records under hold is
            a separate offence from keeping them.
          </p>
        </Card>

        {/* Regulated scope */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><BookLock size={15} className="text-primary" /> Regulated activity</h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {REGULATED_SCOPE.map((r) => (
              <div key={r.item} className="px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                  <span className="text-[11px] font-medium">{r.item}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{r.why}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {summary.regulated.implemented} implemented · {summary.regulated['server-only']} need a server ·{' '}
            {summary.regulated['not-applicable']} are legal determinations. A browser cannot screen a sanctions list.
          </p>
        </Card>
      </div>

      {/* Readiness */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Framework readiness</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {COMPLIANCE_READINESS.map((f) => (
            <div key={f.framework} className="rounded-lg border border-border p-3">
              <p className="text-[11px] font-medium">{f.framework}</p>
              <p className="mt-1.5 text-[10px] font-medium text-emerald-400">Built</p>
              <ul className="mt-0.5 space-y-0.5">
                {f.built.map((b) => <li key={b} className="text-[10px] text-muted-foreground">· {b}</li>)}
              </ul>
              <p className="mt-1.5 text-[10px] font-medium text-amber-300">Still needed</p>
              <ul className="mt-0.5 space-y-0.5">
                {f.needs.map((n) => <li key={n} className="text-[10px] text-muted-foreground">· {n}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {summary.policies} policy types · {summary.consentCategories} consent categories ({summary.requiredCategories} locked on) ·{' '}
          {summary.dsrJurisdictions} jurisdictions with their own response clock · {summary.retentionClasses} retention classes.
        </p>
      </Card>
    </div>
  );
}
