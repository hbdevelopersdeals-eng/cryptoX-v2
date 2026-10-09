/* Global compliance: policies, consent, data-subject requests, retention and
 * legal hold.
 *
 * Two rules drive the design:
 *
 *  1. Consent is bound to the VERSION of the document consented to. Storing a
 *     boolean means a policy change silently inherits consent the user never
 *     gave.
 *  2. Withdrawal is as easy as granting, and never requires a reason. A design
 *     that hides the off-switch is not compliant however good the record is.
 *
 * KYC, AML, sanctions screening, licensing and jurisdiction restrictions are
 * declared, not implemented. They require a licensed entity, provider
 * contracts and server-side checks — a browser cannot screen a sanctions list.
 */

/* ---------------------------------------------------------------------------
 * Policy documents
 * ------------------------------------------------------------------------ */

export const POLICY_TYPES = [
  { id: 'terms', label: 'Terms of Service', requiresAcceptance: true },
  { id: 'privacy', label: 'Privacy Policy', requiresAcceptance: false, acknowledgement: true },
  { id: 'cookies', label: 'Cookie Policy', requiresAcceptance: false },
  { id: 'aup', label: 'Acceptable Use Policy', requiresAcceptance: true },
  { id: 'dpa', label: 'Data Processing Agreement', requiresAcceptance: false, businessOnly: true }
];

/**
 * A published version of a policy.
 * `effectiveAt` in the future means it is scheduled, not yet binding.
 */
export function publishPolicy({ type, version, body = '', effectiveAt = new Date(), supersedes = null } = {}) {
  if (!POLICY_TYPES.some((p) => p.id === type)) return { ok: false, reason: 'unknown-policy-type' };
  if (!version) return { ok: false, reason: 'version-required' };
  return {
    ok: true,
    policy: {
      id: `${type}@${version}`,
      type, version, body,
      effectiveAt: new Date(effectiveAt).toISOString(),
      publishedAt: new Date().toISOString(),
      supersedes
    }
  };
}

/** Which policies a person must have accepted, given what they are doing. */
export function requiredAcceptances({ policies = [], at = new Date(), isBusiness = false } = {}) {
  const now = new Date(at);
  return policies
    .filter((p) => new Date(p.effectiveAt) <= now)
    .filter((p) => {
      const def = POLICY_TYPES.find((t) => t.id === p.type);
      if (!def) return false;
      if (def.businessOnly && !isBusiness) return false;
      return def.requiresAcceptance || def.acknowledgement;
    })
    // Only the newest effective version of each type is required.
    .reduce((acc, p) => {
      const existing = acc.find((x) => x.type === p.type);
      if (!existing || new Date(p.effectiveAt) > new Date(existing.effectiveAt)) {
        return [...acc.filter((x) => x.type !== p.type), p];
      }
      return acc;
    }, []);
}

/**
 * Acceptance is recorded against a specific version. An acceptance of an older
 * version does not satisfy a newer one — that is the whole point of versioning.
 */
export function acceptanceState({ policies = [], acceptances = [], at = new Date(), isBusiness = false } = {}) {
  const required = requiredAcceptances({ policies, at, isBusiness });
  const outstanding = required.filter((p) => !acceptances.some((a) => a.policyId === p.id && a.acceptedAt));
  return {
    required: required.map((p) => p.id),
    accepted: acceptances.filter((a) => required.some((p) => p.id === a.policyId)).map((a) => a.policyId),
    outstanding: outstanding.map((p) => p.id),
    satisfied: outstanding.length === 0
  };
}

export function recordAcceptance({ policyId, userId, method = 'click', at = new Date(), evidence = {} } = {}) {
  if (!policyId || !userId) return { ok: false, reason: 'policy-and-user-required' };
  return {
    ok: true,
    acceptance: {
      policyId, userId, method,
      acceptedAt: new Date(at).toISOString(),
      // Kept because consent must be demonstrable, not merely asserted.
      evidence: { userAgent: evidence.userAgent || null, ip: evidence.ip || null, locale: evidence.locale || null },
      withdrawnAt: null
    }
  };
}

/* ---------------------------------------------------------------------------
 * Consent
 * ------------------------------------------------------------------------ */

export const CONSENT_CATEGORIES = [
  { id: 'necessary', label: 'Strictly necessary', required: true, lawfulBasis: 'contract', note: 'Cannot be disabled — without it the service does not function.' },
  { id: 'preferences', label: 'Preferences', required: false, lawfulBasis: 'consent', note: 'Remembers language, currency and layout.' },
  { id: 'analytics', label: 'Analytics', required: false, lawfulBasis: 'consent', note: 'Aggregate product usage.' },
  { id: 'marketing', label: 'Marketing', required: false, lawfulBasis: 'consent', note: 'Campaigns and remarketing; separate from analytics on purpose.' }
];

/** Categories that can never be turned off. */
export const REQUIRED_CATEGORIES = CONSENT_CATEGORIES.filter((c) => c.required).map((c) => c.id);

export const DEFAULT_CONSENT = { necessary: true, preferences: false, analytics: false, marketing: false };

/** Normalise a selection: required categories are forced on, unknown keys dropped. */
export function normaliseConsent(selection = {}) {
  const out = { ...DEFAULT_CONSENT };
  for (const category of CONSENT_CATEGORIES) {
    if (category.required) { out[category.id] = true; continue; }
    out[category.id] = selection[category.id] === true;
  }
  return out;
}

export function recordConsent({ current = DEFAULT_CONSENT, selection, userId = null, at = new Date(), policyVersion = null, evidence = {} } = {}) {
  const next = normaliseConsent({ ...current, ...selection });
  return {
    state: next,
    record: {
      at: new Date(at).toISOString(),
      userId,
      // Bound to the policy version in force, so a later change is detectable.
      policyVersion,
      categories: next,
      changed: Object.keys(next).filter((k) => next[k] !== current[k]),
      evidence: { locale: evidence.locale || null }
    }
  };
}

export function withdrawConsent({ current = DEFAULT_CONSENT, category, at = new Date() } = {}) {
  if (REQUIRED_CATEGORIES.includes(category)) {
    return { ok: false, reason: 'required-category', state: current, note: 'Strictly necessary processing cannot be withdrawn while the account exists — closing the account is the route.' };
  }
  if (!CONSENT_CATEGORIES.some((c) => c.id === category)) return { ok: false, reason: 'unknown-category', state: current };
  // No reason is requested, and the withdrawal takes effect immediately.
  return { ok: true, state: { ...current, [category]: false }, at: new Date(at).toISOString(), immediate: true };
}

/** Is a category actually permitted right now? */
export const consentGranted = (state, category) => {
  const def = CONSENT_CATEGORIES.find((c) => c.id === category);
  if (!def) return false;
  if (def.required) return true;
  return state?.[category] === true;
};

export function consentSummary(state = DEFAULT_CONSENT) {
  return CONSENT_CATEGORIES.map((c) => ({
    id: c.id, label: c.label, granted: consentGiven(state, c), required: c.required, lawfulBasis: c.lawfulBasis
  }));
}
const consentGiven = (state, c) => (c.required ? true : state?.[c.id] === true);

/* ---------------------------------------------------------------------------
 * Data-subject requests
 * ------------------------------------------------------------------------ */

export const DSR_TYPES = ['access', 'export', 'correction', 'deletion', 'portability', 'objection'];

/*
 * Response windows are set by jurisdiction, and they differ. Hard-coding 30 days
 * would be wrong for California and wrong for Brazil.
 */
export const DSR_RULES = {
  gdpr: { label: 'GDPR (EU/UK)', days: 30, extensionDays: 60, extensionRequiresReason: true, note: 'One calendar month, extendable by two further months for complex requests.' },
  ccpa: { label: 'CCPA/CPRA (California)', days: 45, extensionDays: 45, extensionRequiresReason: true, note: '45 days, extendable once by a further 45 with notice.' },
  lgpd: { label: 'LGPD (Brazil)', days: 15, extensionDays: 0, extensionRequiresReason: false, note: '15 days for confirmation of processing.' },
  pipeda: { label: 'PIPEDA (Canada)', days: 30, extensionDays: 30, extensionRequiresReason: true },
  appi: { label: 'APPI (Japan)', days: 14, extensionDays: 0, extensionRequiresReason: false },
  popia: { label: 'POPIA (South Africa)', days: 30, extensionDays: 0, extensionRequiresReason: false },
  default: { label: 'No specific rule configured', days: 30, extensionDays: 0, extensionRequiresReason: true, note: 'Falling back to 30 days. Confirm the actual requirement for this jurisdiction before committing to it.' }
};

export const dsrRuleFor = (jurisdiction) => DSR_RULES[jurisdiction] || DSR_RULES.default;

export const DSR_STATES = ['received', 'verifying', 'processing', 'awaiting-subject', 'completed', 'refused'];

/** Allowed transitions. A request may not move backwards or skip verification. */
const DSR_TRANSITIONS = {
  received: ['verifying', 'refused'],
  verifying: ['processing', 'awaiting-subject', 'refused'],
  processing: ['completed', 'awaiting-subject', 'refused'],
  'awaiting-subject': ['processing', 'refused'],
  completed: [],
  refused: []
};

export function createDsr({ type, userId, jurisdiction = 'default', detail = null, at = new Date() } = {}) {
  if (!DSR_TYPES.includes(type)) return { ok: false, reason: 'unknown-type' };
  if (!userId) return { ok: false, reason: 'user-required' };
  const rule = dsrRuleFor(jurisdiction);
  const due = new Date(new Date(at).getTime() + rule.days * 86400000);
  return {
    ok: true,
    request: {
      id: `dsr_${type}_${Date.now()}`,
      type, userId, jurisdiction, detail,
      state: 'received',
      receivedAt: new Date(at).toISOString(),
      dueAt: due.toISOString(),
      ruleDays: rule.days,
      extension: null,
      history: [{ state: 'received', at: new Date(at).toISOString() }]
    }
  };
}

export function advanceDsr({ request, nextState, at = new Date(), note = null, extensionReason = null } = {}) {
  if (!request) return { ok: false, reason: 'no-request' };
  if (!DSR_STATES.includes(nextState)) return { ok: false, reason: 'unknown-state' };
  if (!DSR_TRANSITIONS[request.state]?.includes(nextState)) {
    return { ok: false, reason: 'illegal-transition', from: request.state, to: nextState };
  }

  const rule = dsrRuleFor(request.jurisdiction);
  let dueAt = request.dueAt;
  let extension = request.extension;

  // An extension must be justified and is available only once.
  if (extensionReason) {
    if (!rule.extensionRequiresReason) return { ok: false, reason: 'extension-not-available' };
    if (request.extension) return { ok: false, reason: 'extension-already-used' };
    dueAt = new Date(new Date(request.dueAt).getTime() + rule.extensionDays * 86400000).toISOString();
    extension = { reason: extensionReason, days: rule.extensionDays, at: new Date(at).toISOString() };
  }

  return {
    ok: true,
    request: {
      ...request,
      state: nextState,
      dueAt,
      extension,
      history: [...request.history, { state: nextState, at: new Date(at).toISOString(), note }]
    }
  };
}

export function dsrStatus({ request, at = new Date() } = {}) {
  if (!request) return null;
  const now = new Date(at);
  const due = new Date(request.dueAt);
  const daysLeft = Math.ceil((due - now) / 86400000);
  return {
    state: request.state,
    dueAt: request.dueAt,
    daysLeft,
    overdue: daysLeft < 0 && !['completed', 'refused'].includes(request.state),
    closed: ['completed', 'refused'].includes(request.state)
  };
}

/* ---------------------------------------------------------------------------
 * Retention and legal hold
 * ------------------------------------------------------------------------ */

export const RETENTION_CLASSES = [
  { id: 'account', label: 'Account and profile', days: 1095, basis: 'contract', note: 'Kept while the account exists plus a short wind-down.' },
  { id: 'financial', label: 'Invoices and tax records', days: 3650, basis: 'legal-obligation', note: 'Tax law typically requires 7–10 years. Not user-deletable.' },
  { id: 'audit', label: 'Audit log', days: 2555, basis: 'legal-obligation' },
  { id: 'usage', label: 'Product usage events', days: 400, basis: 'legitimate-interest' },
  { id: 'location', label: 'Location history', days: 90, basis: 'consent', note: 'Deletable at will; consent-backed.' },
  { id: 'support', label: 'Support conversations', days: 730, basis: 'contract' },
  { id: 'marketing', label: 'Marketing consent records', days: 2555, basis: 'consent', note: 'The record of consent is kept longer than the consent itself, because demonstrating it is the obligation.' }
];

export const retentionFor = (id) => RETENTION_CLASSES.find((r) => r.id === id) || null;

/**
 * Legal hold.
 *
 * A hold overrides deletion. Without one, a litigation or investigation could
 * find that the records were destroyed by an automated retention job — which is
 * itself a separate offence.
 */
export function createLegalHold({ scope, reason, custodian, at = new Date(), reviewAt = null } = {}) {
  if (!scope) return { ok: false, reason: 'scope-required' };
  if (!reason) return { ok: false, reason: 'reason-required', note: 'A hold without a recorded reason cannot be reviewed or lifted.' };
  return {
    ok: true,
    hold: {
      id: `hold_${Date.now()}`,
      scope,
      reason,
      custodian: custodian || null,
      placedAt: new Date(at).toISOString(),
      // Holds are reviewed rather than open-ended, so they do not become permanent by neglect.
      reviewAt: reviewAt ? new Date(reviewAt).toISOString() : new Date(new Date(at).getTime() + 90 * 86400000).toISOString(),
      releasedAt: null,
      releaseReason: null
    }
  };
}

export const activeHolds = (holds = []) => holds.filter((h) => !h.releasedAt);

export const isUnderHold = (holds = [], scope) =>
  activeHolds(holds).some((h) => h.scope === scope || h.scope === '*');

export function releaseHold({ hold, reason, at = new Date() } = {}) {
  if (!hold) return { ok: false, reason: 'no-hold' };
  if (hold.releasedAt) return { ok: false, reason: 'already-released' };
  if (!reason) return { ok: false, reason: 'release-reason-required' };
  return { ok: true, hold: { ...hold, releasedAt: new Date(at).toISOString(), releaseReason: reason } };
}

/**
 * Whether a deletion may proceed. This is the function that protects the
 * records a hold exists to protect.
 */
export function canDelete({ holds = [], retentionClass, at = new Date(), requestedBySubject = true } = {}) {
  if (isUnderHold(holds, retentionClass)) {
    return { allowed: false, reason: 'legal-hold', note: 'Records under hold cannot be deleted, including on a valid erasure request.' };
  }
  const cls = retentionFor(retentionClass);
  if (cls && cls.basis === 'legal-obligation' && requestedBySubject) {
    return { allowed: false, reason: 'legal-retention', note: `${cls.label} must be retained (${cls.days} days) to meet a legal obligation; an erasure request does not override it.` };
  }
  return { allowed: true, reason: 'no-blocker' };
}

export function purgeCandidates({ records = [], at = new Date() } = {}) {
  const now = new Date(at);
  return records.filter((r) => {
    const cls = retentionFor(r.retentionClass);
    if (!cls) return false;
    const age = (now - new Date(r.createdAt)) / 86400000;
    return age > cls.days;
  });
}

/* ---------------------------------------------------------------------------
 * Readiness matrix and regulated-activity scope
 * ------------------------------------------------------------------------ */

/*
 * KYC, AML, sanctions screening, licensing and jurisdiction restrictions are
 * declared here rather than implemented. Each needs a licensed entity, a
 * provider contract and server-side checks — a browser cannot screen a
 * sanctions list, and pretending otherwise would be the most dangerous claim in
 * this file.
 */
export const REGULATED_SCOPE = [
  { item: 'KYC (identity verification)', status: 'server-only', requires: 'A licensed onboarding provider (e.g. Onfido, Sumsub) plus an operating entity permitted to serve the customer jurisdiction.', why: 'Document capture, liveness and government-database checks cannot run client-side.' },
  { item: 'AML transaction monitoring', status: 'server-only', requires: 'Server-side rules engine over the full ledger plus an alerting queue.', why: 'Monitoring one client session sees nothing; the pattern is only visible across all transactions.' },
  { item: 'Sanctions and PEP screening', status: 'server-only', requires: 'A licensed screening provider with its own sanctions data licence.', why: 'The lists are licensed data and must be checked at onboarding and on an ongoing basis.' },
  { item: 'Travel rule (FATF)', status: 'server-only', requires: 'Counterparty VASP messaging and originator/beneficiary data exchange.', why: 'Applies between regulated entities; there is no client-side equivalent.' },
  { item: 'Licensing and registration', status: 'not-applicable', requires: 'Legal determination per country and activity.', why: 'Whether a licence is required depends on the actual activity and is a legal question, not a code one.' },
  { item: 'Jurisdiction restriction', status: 'implemented', requires: 'A blocklist checked at sign-up and at transaction time, enforced server-side.', why: 'The client half is built here; the enforcing half is server-side and must not be trusted to the client alone.' },
  { item: 'Transaction monitoring for fraud', status: 'implemented', requires: 'Scoring at the point of action, with server-side re-scoring.', why: 'Client scoring raises a signal; it cannot be the decision.' }
];

export const COMPLIANCE_READINESS = [
  { framework: 'GDPR (EU/UK)', built: ['Policy versioning', 'Consent with version binding', 'Granular withdrawal', 'DSR with 30-day clock and extension', 'Retention by data class', 'Legal hold', 'Erasure blockers for legal retention'], needs: ['DPO appointment and EU representative', 'Records of processing (RoPA)', 'DPIA for high-risk processing', 'Breach notification runbook (72h)', 'Standard contractual clauses for transfers'] },
  { framework: 'CCPA/CPRA (California)', built: ['Right to know via export', 'Right to delete', 'Right to correct', '45-day clock with a single extension', 'No-sale default (marketing consent is off by default)'], needs: ['Do-not-sell/share link handling for third parties', 'Notice at collection', 'Authorised-agent handling', 'Financial-incentive terms if any'] },
  { framework: 'LGPD (Brazil)', built: ['Access and portability', '15-day clock', 'Legal basis recorded per category'], needs: ['Encarregado (DPO) designation', 'International transfer mechanism'] },
  { framework: 'PIPEDA (Canada)', built: ['Access and correction', '30-day clock'], needs: ['Designated privacy officer', 'Breach reporting to the Commissioner'] },
  { framework: 'Cookie and marketing consent', built: ['Four granular categories', 'Necessary category locked on', 'Withdrawal with no reason required', 'Consent record kept longer than the consent'], needs: ['Consent-mode signals to ad platforms', 'Cookie banner that blocks non-essential scripts before consent'] }
];

export const complianceSummary = () => ({
  policies: POLICY_TYPES.length,
  consentCategories: CONSENT_CATEGORIES.length,
  requiredCategories: REQUIRED_CATEGORIES.length,
  dsrJurisdictions: Object.keys(DSR_RULES).length - 1,
  retentionClasses: RETENTION_CLASSES.length,
  regulated: {
    implemented: REGULATED_SCOPE.filter((r) => r.status === 'implemented').length,
    'server-only': REGULATED_SCOPE.filter((r) => r.status === 'server-only').length,
    'not-applicable': REGULATED_SCOPE.filter((r) => r.status === 'not-applicable').length
  }
});
