import React, { useMemo, useState } from 'react';
import { Rocket, ClipboardCheck, PieChart, CalendarClock, Coins } from 'lucide-react';
import {
  validateApplication, validateTokenomics, vestingSchedule, allocate,
  scoreDueDiligence, transition, LISTING_STATES, TRANSITIONS, DUE_DILIGENCE_WEIGHTS
} from '../lib/launchpad.js';
import { fmtUsd, fmtNum } from '../lib/format.js';
import { Card, SectionTitle, Stat } from '../components/ui.jsx';

/* Launchpad.
 *
 * This page is the screening desk, not a sale. Every control below evaluates a
 * real submission: the validator returns the same errors a reviewer would, the
 * tokenomics checker sums the buckets, the vesting table is exact integer
 * arithmetic, and the allocation calculator is the pro-rata engine an
 * oversubscribed round actually needs.
 *
 * There is no live sale, because a live sale needs custody of participant funds
 * and a legal wrapper per jurisdiction. Pretending otherwise would be the most
 * expensive kind of demo.
 */

const initialBuckets = [
  { id: 'community', label: 'Community', pct: 45 },
  { id: 'team', label: 'Team & advisors', pct: 18 },
  { id: 'treasury', label: 'Treasury', pct: 22 },
  { id: 'liquidity', label: 'Liquidity', pct: 15 }
];

export default function LaunchpadPage() {
  const [app, setApp] = useState({
    projectName: '',
    ticker: '',
    chain: 'Ethereum',
    website: '',
    whitepaper: '',
    description: '',
    totalSupply: '100000000',
    raiseTarget: '500000'
  });
  const [buckets, setBuckets] = useState(initialBuckets);
  const [tgePct, setTgePct] = useState('10');
  const [cliffMonths, setCliffMonths] = useState('6');
  const [vestMonths, setVestMonths] = useState('18');
  const [cap, setCap] = useState('500000');
  const [price, setPrice] = useState('0.05');
  const [reqA, setReqA] = useState('300000');
  const [reqB, setReqB] = useState('400000');
  const [dd, setDd] = useState({ team: 70, product: 65, tokenomics: 60, legal: 55, security: 40 });
  const [audit, setAudit] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [state, setState] = useState('applied');

  const application = useMemo(
    () => validateApplication({
      ...app,
      team: [{ name: 'Submitted team', linkedin: app.website ? app.website : null }]
    }),
    [app]
  );

  const tokenomics = useMemo(() => validateTokenomics({
    allocations: buckets,
    tgeUnlockPct: Number(tgePct) || 0,
    teamCliffMonths: Number(cliffMonths) || 0
  }), [buckets, tgePct, cliffMonths]);

  const vesting = useMemo(
    () => vestingSchedule({
      totalTokens: Number(app.totalSupply) || 0,
      tgePct: Number(tgePct) || 0,
      cliffMonths: Number(cliffMonths) || 0,
      vestMonths: Number(vestMonths) || 1,
      startDate: '2026-01-01T00:00:00Z'
    }),
    [app.totalSupply, tgePct, cliffMonths, vestMonths]
  );

  const allocation = useMemo(
    () => allocate({
      participants: [
        { id: 'A', requested: Number(reqA) || 0 },
        { id: 'B', requested: Number(reqB) || 0 }
      ],
      raiseCapUsd: Number(cap) || 0,
      pricePerToken: Number(price) || 1
    }),
    [reqA, reqB, cap, price]
  );

  const diligence = useMemo(
    () => scoreDueDiligence({ ...dd, audit, anonymousTeam: anonymous, tokenomicsValid: tokenomics.valid }),
    [dd, audit, anonymous, tokenomics.valid]
  );

  const allowed = TRANSITIONS[state] || [];

  const setBucket = (id, pct) =>
    setBuckets((rows) => rows.map((r) => (r.id === id ? { ...r, pct } : r)));

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Launchpad"
        sub="Screening desk for token sales: application validation, tokenomics, vesting, pro-rata allocation and the listing workflow."
      />

      <Card className="border-amber-400/30 bg-amber-400/5">
        <div className="flex items-start gap-3">
          <Rocket size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            These are screening tools, not an offering. Submitting the form does not create a sale, reserve an allocation or
            take custody of funds — a live launchpad requires per-jurisdiction legal review, KYC integration and escrow,
            none of which exists in this build.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ClipboardCheck size={15} className="text-primary" aria-hidden="true" /> Application
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              ['projectName', 'Project name', 'text'],
              ['ticker', 'Ticker', 'text'],
              ['chain', 'Chain', 'text'],
              ['website', 'Website', 'url'],
              ['whitepaper', 'Whitepaper URL', 'url'],
              ['totalSupply', 'Total supply', 'number'],
              ['raiseTarget', 'Raise target (USD)', 'number']
            ].map(([key, label, type]) => (
              <label key={key} className="block text-xs font-medium text-muted-foreground">
                {label}
                <input
                  type={type}
                  value={app[key]}
                  onChange={(e) => setApp((a) => ({ ...a, [key]: e.target.value }))}
                  aria-label={label}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:border-primary/60"
                />
              </label>
            ))}
          </div>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">
            Description (120+ characters)
            <textarea
              rows={3}
              value={app.description}
              onChange={(e) => setApp((a) => ({ ...a, description: e.target.value }))}
              aria-label="Project description"
              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus-visible:border-primary/60"
            />
          </label>

          <div className="mt-3 rounded-lg border border-border px-3 py-2.5" aria-live="polite">
            <p className={'text-xs font-semibold ' + (application.valid ? 'text-emerald-400' : 'text-amber-400')}>
              {application.valid ? 'Passes schema validation' : `${application.errors.length} field(s) need attention`}
            </p>
            {application.errors.length ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                {application.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {application.warnings.length ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-400/90">
                {application.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <PieChart size={15} className="text-primary" aria-hidden="true" /> Tokenomics
          </h2>
          <div className="space-y-2">
            {buckets.map((b) => (
              <div key={b.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{b.label}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={b.pct}
                  onChange={(e) => setBucket(b.id, Number(e.target.value))}
                  aria-label={`${b.label} allocation percentage`}
                  className="h-1.5 w-full accent-[color:var(--primary,#4f8cff)]"
                />
                <span className="num w-12 shrink-0 text-right text-xs">{b.pct}%</span>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Total" value={`${tokenomics.total.toFixed(1)}%`} hint={tokenomics.valid ? 'balances' : 'must equal 100%'} />
            <Stat label="Team + advisors" value={`${buckets.find((b) => b.id === 'team')?.pct ?? 0}%`} hint="guideline ≤ 30%" />
          </div>

          {tokenomics.warnings.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-400/90" aria-live="polite">
              {tokenomics.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          ) : null}
          {tokenomics.errors.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-red-400" aria-live="polite">
              {tokenomics.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={15} className="text-primary" aria-hidden="true" /> Vesting
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-muted-foreground">
              TGE %
              <input
                type="number" min="0" max="100" value={tgePct}
                onChange={(e) => setTgePct(e.target.value)}
                aria-label="Tokens unlocked at generation event, percent"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Cliff (mo)
              <input
                type="number" min="0" value={cliffMonths}
                onChange={(e) => setCliffMonths(e.target.value)}
                aria-label="Cliff in months"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Vest (mo)
              <input
                type="number" min="1" value={vestMonths}
                onChange={(e) => setVestMonths(e.target.value)}
                aria-label="Vesting period in months"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
          </div>

          {vesting.error ? (
            <p className="mt-3 text-xs text-red-400">{vesting.error}</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="TGE unlock" value={fmtNum(vesting.tgeTokens)} />
                <Stat label="Fully vested" value={`${vesting.durationMonths} mo`} hint={vesting.balanced ? 'sums exactly' : 'check inputs'} />
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <caption className="sr-only">Vesting schedule, first and last periods</caption>
                  <thead className="text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 pr-2 font-medium">Period</th>
                      <th scope="col" className="py-1 pr-2 font-medium">Date</th>
                      <th scope="col" className="py-1 pr-2 text-right font-medium">Unlock</th>
                      <th scope="col" className="py-1 text-right font-medium">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...vesting.rows.slice(0, 3), ...vesting.rows.slice(-2)].map((r, i) => (
                      <tr key={`${r.month}-${i}`} className="border-t border-border/60">
                        <td className="py-1 pr-2">{r.note === 'TGE' ? 'TGE' : `M${r.month}`}</td>
                        <td className="py-1 pr-2">{r.date}</td>
                        <td className="num py-1 pr-2 text-right">{fmtNum(r.unlock)}</td>
                        <td className="num py-1 text-right">{fmtNum(r.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Coins size={15} className="text-primary" aria-hidden="true" /> Allocation
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-muted-foreground">
              Raise cap (USD)
              <input
                type="number" min="0" value={cap} onChange={(e) => setCap(e.target.value)}
                aria-label="Raise cap in US dollars"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Price per token
              <input
                type="number" min="0" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)}
                aria-label="Price per token in US dollars"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Participant A (USD)
              <input
                type="number" min="0" value={reqA} onChange={(e) => setReqA(e.target.value)}
                aria-label="Participant A requested amount"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Participant B (USD)
              <input
                type="number" min="0" value={reqB} onChange={(e) => setReqB(e.target.value)}
                aria-label="Participant B requested amount"
                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus-visible:border-primary/60"
              />
            </label>
          </div>

          <div className="mt-3 rounded-lg border border-border px-3 py-2.5" aria-live="polite">
            {!allocation.ok ? (
              <p className="text-xs text-red-400">{allocation.error}</p>
            ) : (
              <>
                <p className="text-xs font-semibold">
                  {allocation.oversubscribed ? `Oversubscribed — filled at ${(allocation.scale * 100).toFixed(1)}%` : 'Fully filled'}
                </p>
                <div className="mt-2 space-y-1">
                  {allocation.allocations.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{a.id}: requested {fmtUsd(a.requested)}</span>
                      <span className="num">{fmtNum(a.tokens)} tokens · {fmtUsd(a.cash)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Raised {fmtUsd(allocation.raised)} of {fmtUsd(Number(cap))}. Tokens are whole units; the {fmtUsd(allocation.dust)} remainder is not retained.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Due diligence</h2>
          <div className="space-y-2">
            {Object.entries(DUE_DILIGENCE_WEIGHTS).map(([key, weight]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs capitalize text-muted-foreground">{key} ({weight})</span>
                <input
                  type="range" min="0" max="100" value={dd[key]}
                  onChange={(e) => setDd((d) => ({ ...d, [key]: Number(e.target.value) }))}
                  aria-label={`${key} score`}
                  className="h-1.5 w-full accent-[color:var(--primary,#4f8cff)]"
                />
                <span className="num w-8 shrink-0 text-right text-xs">{dd[key]}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} aria-label="Independent audit on file" className="h-4 w-4" />
              Audit on file
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} aria-label="Team is anonymous" className="h-4 w-4" />
              Anonymous team
            </label>
          </div>

          <div className={'mt-3 rounded-lg border px-3 py-2.5 ' + (diligence.verdict === 'approve' ? 'border-emerald-400/30 bg-emerald-400/5' : diligence.verdict === 'review' ? 'border-amber-400/30 bg-amber-400/5' : 'border-red-400/30 bg-red-400/5')} aria-live="polite">
            <p className="text-xs font-semibold capitalize">{diligence.verdict} · {diligence.score}/100</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{diligence.explanation}</p>
            {diligence.blockers.length ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-400/90">
                {diligence.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Listing workflow</h2>
          <div className="flex flex-wrap gap-1.5">
            {LISTING_STATES.map((s) => (
              <span
                key={s}
                className={'rounded-full border px-2 py-0.5 text-[11px] ' + (s === state ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
              >
                {s.replace(/_/g, ' ')}
              </span>
            ))}
          </div>

          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            Move to
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const r = transition(state, e.target.value);
                if (r.ok) setState(r.state);
              }}
              aria-label="Advance the listing to another state"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:border-primary/60"
            >
              <option value="">Choose a transition…</option>
              {(TRANSITIONS[state] || []).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {allowed.length
              ? `From “${state}” the workflow allows: ${allowed.join(', ')}.`
              : `“${state}” is terminal. A rejected project must resubmit so the first decision stays in the audit trail.`}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Funds are taken at subscription and tokens are distributed once. The state machine refuses a second
            distribution, which is the failure that cannot be undone.
          </p>
        </Card>
      </div>
    </div>
  );
}
