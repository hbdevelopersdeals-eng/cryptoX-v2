import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, ScrollText, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Card } from '../components/ui.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  loadSecurity, saveSecurity, addOrganization, invite, changeMemberRoles, dropMember,
  recordEvent, grantableRoles, organizationOwners
} from '../lib/securityStore.js';
import { membersOf, seatUsage, describeDevice } from '../lib/accounts.js';
import { authorize, explain, permissionMatrix, ROLE_IDS, ROLES, PERMISSIONS, isKnownRole } from '../lib/rbac.js';
import { LANGUAGES } from '../lib/locales.js';
import { CURRENCIES } from '../lib/currencies.js';
import { ZONE_LIST, formatRelative } from '../lib/time.js';

const Stat = ({ label, value, tone = 'muted' }) => {
  const tones = { good: 'text-emerald-400', warn: 'text-amber-300', bad: 'text-down', muted: '' };
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  );
};

export default function Organization() {
  const { t, lang } = useI18n();
  const auth = useAuth() || {};
  const accountKey = auth.user?.email || auth.user?.username || auth.user?.id || 'local';

  const [state, setState] = useState(() => loadSecurity());
  const [note, setNote] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [probe, setProbe] = useState('billing:approve');
  /* A real toggle, not a demonstration: it feeds the authorize() call below so
   * the explainable "explicit deny beats everything" rule can be seen working. */
  const [simulateDeny, setSimulateDeny] = useState(false);

  const persist = (next) => { setState(next); saveSecurity(next); return next; };
  const flash = (kind, text) => setNote({ kind, text });

  const org = state.organizations.find((o) => o.id === state.activeOrgId) || state.organizations[0] || null;
  const members = org ? membersOf(state.memberships, org.id) : [];

  /* The authorization subject for the signed-in person inside this organization. */
  const myMembership = org ? state.memberships.find((m) => m.organizationId === org.id && m.userId === accountKey) : null;
  const subject = useMemo(() => ({
    userId: accountKey,
    organizationId: org?.id || null,
    roles: myMembership?.roles || [],
    workspaceIds: myMembership?.workspaceIds || [],
    grants: [],
    denies: simulateDeny ? ['*'] : []
  }), [accountKey, org?.id, myMembership, simulateDeny]);

  const allowed = grantableRoles(subject);
  const decision = authorize(subject, probe, { organizationId: org?.id });
  const matrix = useMemo(() => permissionMatrix(), []);
  const seats = org ? seatUsage(org, state.memberships) : null;
  const owners = org ? organizationOwners(state, org.id) : [];

  /* -------------------------------------------------------------- create */

  const createOrg = () => {
    const out = addOrganization(state, {
      name: orgName, ownerId: accountKey, timezone: 'UTC', currency: 'USD', language: 'en'
    });
    if (!out.ok) { flash('bad', out.errors.map((e) => `${e.field}: ${e.reason}`).join(' · ')); return; }
    persist(out.state);
    setOrgName('');
    flash('good', 'Organization created — you are its owner.');
  };

  /* -------------------------------------------------------------- members */

  const sendInvite = () => {
    const out = invite(state, { email: inviteEmail, role: inviteRole, subject, organizationId: org.id });
    if (!out.ok) {
      flash('bad', out.reason === 'role-above-inviter'
        ? `You cannot grant a role above your own. You may grant: ${(out.allowed || []).join(', ') || 'none'}.`
        : String(out.reason));
      return;
    }
    persist(out.state);
    setInviteEmail('');
    flash('good', `Invitation created for ${out.invitation.email} as ${inviteRole}.`);
  };

  const changeRole = (membershipId, role) => {
    const out = changeMemberRoles(state, { membershipId, roles: [role], actor: subject });
    if (!out.ok) {
      flash('bad', out.reason === 'last-owner'
        ? 'Refused: the organization would be left without an owner.'
        : out.reason === 'role-above-actor' ? 'Refused: that role is above your own.' : String(out.reason));
      return;
    }
    persist(out.state);
    flash('good', 'Role updated.');
  };

  const remove = (membershipId) => {
    const out = dropMember(state, { membershipId, actor: subject });
    if (!out.ok) {
      flash('bad', out.reason === 'last-owner' ? 'Refused: the last owner cannot be removed.' : String(out.reason));
      return;
    }
    persist(out.state);
    flash('warn', 'Member removed.');
  };

  const patchOrganization = (patch) => {
    persist({ ...state, organizations: state.organizations.map((o) => (o.id === org.id ? { ...o, ...patch } : o)) });
    flash('good', t('common.saved'));
  };

  const patchPolicy = (patch) => {
    /*
     * The audit entry must be appended to the PATCHED state. Recording it
     * against the previous state and saving that discarded the policy change
     * entirely — the checkbox appeared to work and silently reverted.
     */
    const patched = {
      ...state,
      organizations: state.organizations.map((o) => (
        o.id === org.id ? { ...o, policies: { ...o.policies, ...patch } } : o
      ))
    };
    const logged = recordEvent(patched, {
      action: 'org.updated', actorId: accountKey, organizationId: org.id, metadata: patch
    });
    persist(logged.state);
    flash('good', t('common.saved'));
  };

  /* ----------------------------------------------------------------- view */

  if (!org) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Building2 size={18} className="text-primary" /> Organization</h1>
        <Card className="space-y-3">
          <p className="text-xs text-muted-foreground">
            No organization yet. An organization owns workspaces, members and billing; roles are scoped to it, so a role
            held here grants nothing in another organization.
          </p>
          <div className="flex gap-2">
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Organization name" aria-label="Organization name" className="input-dark !h-10 w-64" />
            <button type="button" disabled={orgName.trim().length < 3} onClick={createOrg} className="btn-primary !h-10 !px-4 !text-[11px] disabled:opacity-40">Create</button>
          </div>
        </Card>
        {note ? <p className={`text-[11px] ${note.kind === 'bad' ? 'text-down' : 'text-emerald-400'}`}>{note.text}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 size={18} className="text-primary" /> {org.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{org.slug}</span> · plan {org.plan} · your roles: <span className="font-mono">{subject.roles.join(', ') || 'none'}</span>
          </p>
        </div>
      </div>

      {note ? (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-[11px] ${
          note.kind === 'bad' ? 'border-down/40 bg-down/10 text-down'
            : note.kind === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'}`}
        >
          <span className="flex-1">{note.text}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Members" value={members.length} />
        <Stat label="Seats" value={`${seats.active}/${seats.seats}`} tone={seats.over ? 'bad' : 'good'} />
        <Stat label="Owners" value={owners.length} tone={owners.length === 1 ? 'warn' : 'good'} />
        <Stat label="Roles you can grant" value={allowed.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Members */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Users size={15} className="text-primary" /> Members</h2>
          <div className="divide-y divide-border/60 rounded-lg border border-border">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{m.userId}{m.userId === accountKey ? ' (you)' : ''}</p>
                  <p className="text-[10px] text-muted-foreground">joined {formatRelative(m.joinedAt, { lang })}</p>
                </div>
                <select
                  value={m.roles[0]}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  aria-label={`Role for ${m.userId}`}
                  className="input-dark !h-7 !w-40 !text-[10px]"
                >
                  {ROLE_IDS.map((r) => (
                    <option key={r} value={r} disabled={!allowed.includes(r) && r !== m.roles[0]}>
                      {r}{allowed.includes(r) ? '' : ' (not grantable)'}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => remove(m.id)} className="btn-ghost !h-7 !px-2 !text-[10px]">Remove</button>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium"><UserPlus size={12} /> Invite</p>
            <div className="flex flex-wrap gap-2">
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="person@example.com" aria-label="Invite email" className="input-dark !h-9 !w-56 !text-[11px]" />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Invite role" className="input-dark !h-9 !w-44 !text-[11px]">
                {allowed.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button type="button" disabled={!inviteEmail || !allowed.length} onClick={sendInvite} className="btn-primary !h-9 !px-3 !text-[11px] disabled:opacity-40">Send</button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              The role list is filtered to what you may grant. Choosing a higher role is refused by the model, not by hiding the option —
              the same check runs again on the server-side request path.
            </p>
          </div>

          {state.invitations.filter((i) => i.organizationId === org.id).length ? (
            <div className="divide-y divide-border/60 rounded-lg border border-border">
              {state.invitations.filter((i) => i.organizationId === org.id).map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-3 py-2 text-[10px]">
                  <span className="truncate font-mono">{i.email}</span>
                  <span className="text-muted-foreground">{i.role}</span>
                  <span className="ml-auto text-muted-foreground">{i.status} · expires {i.expiresAt.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        {/* Settings */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className="text-primary" /> Organization settings</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Time zone</span>
              <select value={org.timezone} onChange={(e) => patchOrganization({ timezone: e.target.value })} className="input-dark !h-10 w-full">
                {[...new Set([org.timezone, ...ZONE_LIST])].map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Currency</span>
              <select value={org.currency} onChange={(e) => patchOrganization({ currency: e.target.value })} className="input-dark !h-10 w-full">
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Language</span>
              <select value={org.language} onChange={(e) => patchOrganization({ language: e.target.value })} className="input-dark !h-10 w-full">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Accent colour</span>
              <input
                type="color"
                value={org.branding.accentColor || '#eab308'}
                onChange={(e) => patchOrganization({ branding: { ...org.branding, accentColor: e.target.value } })}
                className="input-dark !h-10 w-full"
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3 text-[11px]">
            <p className="font-medium">Enterprise policies</p>
            {[
              { key: 'requireMfa', label: 'Require two-factor for all members' },
              { key: 'ssoOnly', label: 'Require SSO sign-in' },
              { key: 'allowPublicInvites', label: 'Allow public invite links' }
            ].map((p) => (
              <label key={p.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!org.policies[p.key]}
                  onChange={(e) => patchPolicy({ [p.key]: e.target.checked })}
                />
                <span>{p.label}</span>
                {p.key === 'ssoOnly' ? <span className="text-[9px] text-amber-300">needs SSO configured</span> : null}
              </label>
            ))}
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Session max</span>
              <input
                type="number"
                defaultValue={org.policies.sessionMaxHours}
                onBlur={(e) => patchPolicy({ sessionMaxHours: Number(e.target.value) || 168 })}
                className="input-dark !h-7 !w-20 !text-[10px]"
              />
              <span className="text-muted-foreground">hours</span>
            </label>
          </div>

          <div className="rounded-lg border border-border p-3 text-[11px]">
            <p className="font-medium">SSO &amp; provisioning</p>
            <p className="mt-1 text-muted-foreground">
              SAML and OIDC need an assertion validated against the identity provider&apos;s certificate, and SCIM needs an
              inbound token from the provider. Both are server-side: a browser cannot authenticate itself. The policy flags
              above are stored so a backend can enforce them, and are honest about being inert until one exists.
            </p>
          </div>
        </Card>
      </div>

      {/* Authorization probe */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} className="text-primary" /> Authorization check</h2>
        <p className="text-[11px] text-muted-foreground">
          Ask the model directly. This is the same function the server-side request path uses — the UI never decides access on its own.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={probe} onChange={(e) => setProbe(e.target.value)} aria-label="Permission to check" className="input-dark !h-9 !w-72 !text-[11px]">
            {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className={`rounded px-2 py-1 text-[11px] font-semibold ${decision.allowed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-down/15 text-down'}`}>
            {decision.allowed ? 'ALLOWED' : 'DENIED'}
          </span>
          <span className="text-[11px] text-muted-foreground">{decision.allowed ? decision.reason : explain(decision)}</span>
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={simulateDeny} onChange={(e) => setSimulateDeny(e.target.checked)} />
          <span>Simulate an explicit deny on every permission</span>
        </label>
        <p className="text-[10px] text-muted-foreground">
          An explicit deny always wins — including over <span className="font-mono">platform_admin</span>. A rule the most powerful role can ignore is not a rule.
        </p>
      </Card>

      {/* Permission matrix */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Role → permission matrix</h2>
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-2 py-1.5">Role</th>
                <th className="px-2 py-1.5">Scope</th>
                <th className="px-2 py-1.5">Inherits</th>
                <th className="px-2 py-1.5">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((m) => (
                <tr key={m.role} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1.5 font-mono">{m.role}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{m.scope}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{m.inherits.join(' ') || '—'}</td>
                  <td className="px-2 py-1.5">
                    {m.all ? <span className="text-amber-300">all ({PERMISSIONS.length})</span> : m.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Roles are names for permission sets. Nothing in the codebase checks a role name to decide access — a check like
          {' '}<span className="font-mono">role === &apos;manager&apos;</span> is how a temporary grant becomes permanent admin.
        </p>
      </Card>

      {/* Audit log */}
      <Card className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText size={15} className="text-primary" /> Audit log
          <span className="text-xs font-normal text-muted-foreground">{state.audit.length} entries</span>
        </h2>
        {state.audit.length ? (
          <div className="max-h-72 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
            {[...state.audit].reverse().slice(0, 40).map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-3 py-2 text-[10px]">
                <span className="w-36 shrink-0 font-mono text-muted-foreground">{e.at.slice(0, 19).replace('T', ' ')}</span>
                <span className="w-40 shrink-0 font-mono">{e.action}</span>
                <span className="truncate">{e.actorId || 'system'}</span>
                {e.targetId ? <span className="ml-auto truncate font-mono text-muted-foreground">{String(e.targetId).slice(0, 24)}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">No events yet. Invitations, role changes and removals are recorded here.</p>
        )}
        <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          Entries are frozen on write — they cannot be edited, only aged out past the cap. Secrets, tokens and full IP addresses are never recorded.
        </p>
      </Card>
    </div>
  );
}
