/* Disaster recovery (Section 22) and alerting (Section 24).
 *
 * THE RULE THAT DRIVES THIS FILE, from the brief: "A backup that has never been
 * restored successfully should not be considered production-ready."
 *
 * So `productionReady()` exists, it returns false by default, and only a
 * recorded successful restore makes it true. A backup inventory that lists
 * nightly jobs and calls itself ready is the failure mode this prevents.
 *
 * Targets are DATA. An RPO of "4 hours" that exists only in a slide is not a
 * target, it is a wish; putting it in a registry makes it checkable against the
 * backup schedule, which is what `targetGap()` does.
 */

/* --------------------------------------------------------------- DR targets */

export const RPO_TARGET = { hours: 4, label: 'Maximum acceptable data loss', note: 'Loses at most four hours of writes. Copies and notes do not tolerate more than this.' };
export const RTO_TARGET = { hours: 8, label: 'Maximum acceptable recovery time', note: 'Service restored within a working day of a declared incident.' };

export const BACKUP_CLASSES = [
  { id: 'database', label: 'Postgres (Supabase)', frequencyHours: 24, rpoHours: 24, encrypted: true, offSite: true, crossRegion: false, method: 'Provider automated backup + PITR WAL', restoreTestedAt: null, note: 'PITR narrows the effective RPO to minutes, but only if it is enabled on the plan. That must be confirmed on the live project, not assumed.' },
  { id: 'schema', label: 'Schema migrations', frequencyHours: null, rpoHours: 0, encrypted: true, offSite: true, crossRegion: false, method: 'Version-controlled SQL in the repository', restoreTestedAt: null, note: 'Recoverable by definition — every migration is a file in git.' },
  { id: 'storage', label: 'Object storage', frequencyHours: 24, rpoHours: 24, encrypted: true, offSite: true, crossRegion: false, method: 'Provider replication', restoreTestedAt: null },
  { id: 'secrets', label: 'Secrets and keys', frequencyHours: null, rpoHours: 0, encrypted: true, offSite: true, crossRegion: false, method: 'Provider secret store, not backed up to files', restoreTestedAt: null, note: 'Deliberately NOT backed up as a file — a backup of a key is a second copy of the key in a less protected place.' }
];

/**
 * The gate. A class is production-ready only once a restore has succeeded.
 * Returns the reason either way, so a dashboard can say why it is not.
 */
export function productionReady(backupClass) {
  if (!backupClass) return { ready: false, reason: 'unknown-backup-class' };
  const missing = [];
  if (!backupClass.encrypted) missing.push('not encrypted');
  if (!backupClass.offSite) missing.push('not stored off-site');
  if (!backupClass.restoreTestedAt) missing.push('never restore-tested');
  return {
    ready: missing.length === 0,
    reason: missing.length ? missing.join('; ') : 'encrypted, off-site and restore-tested',
    // Stated explicitly because this is the sentence that gets skipped.
    note: missing.includes('never restore-tested')
      ? 'An untested backup is an assumption, not a recovery capability.'
      : undefined
  };
}

/** Compare the declared RPO against what the schedule can actually deliver. */
export function targetGap({ backupClass, rpoTarget = RPO_TARGET } = {}) {
  if (!backupClass) return { ok: false, reason: 'unknown-backup-class' };
  const actual = backupClass.rpoHours;
  if (actual == null) return { ok: true, withinTarget: true, note: 'No data to lose — recoverable from version control.' };
  const withinTarget = actual <= rpoTarget.hours;
  return {
    ok: true,
    withinTarget,
    actualHours: actual,
    targetHours: rpoTarget.hours,
    gapHours: Math.max(0, actual - rpoTarget.hours),
    note: withinTarget ? undefined : `The schedule cannot meet the declared RPO: ${actual}h against a ${rpoTarget.hours}h target.`
  };
}

/** Record a restore rehearsal. This is what flips productionReady to true. */
export function recordRestoreTest({ backupClassId, at = new Date(), durationMinutes = null, succeeded = true, restoredTo = null, notes = null } = {}) {
  if (!backupClassId) return { ok: false, reason: 'backup-class-required' };
  return {
    ok: true,
    test: {
      id: `rt_${backupClassId}_${Date.now()}`,
      backupClassId,
      at: new Date(at).toISOString(),
      durationMinutes,
      succeeded,
      restoredTo,
      notes,
      // A failed rehearsal must not count as verification.
      countsAsVerification: succeeded === true
    }
  };
}

export const drSummary = (classes = BACKUP_CLASSES) => ({
  classes: classes.length,
  ready: classes.filter((c) => productionReady(c).ready).length,
  untested: classes.filter((c) => !c.restoreTestedAt).length,
  rpoTargetHours: RPO_TARGET.hours,
  rtoTargetHours: RTO_TARGET.hours,
  crossRegion: classes.filter((c) => c.crossRegion).length
});

/* ----------------------------------------------------------------- runbooks */

/*
 * Runbooks as data, so they can be rendered during an incident rather than
 * looked up in a wiki that may be the thing that is down.
 */
export const RUNBOOKS = [
  {
    id: 'db-unavailable',
    title: 'Database unavailable',
    severity: 'P0',
    detect: 'Supabase probe unhealthy; sign-in and every write fails.',
    steps: [
      'Confirm from an independent network — a local DNS or proxy fault looks identical.',
      'Check the provider status page before assuming an outage.',
      'If the provider reports healthy, verify the project is not paused for inactivity.',
      'If writes fail but reads succeed, put the client into maintenance read-only mode.',
      'Notify users on /status with the maintenance message.',
      'Escalate to the provider with the trace id from the failing request.'
    ],
    rollback: 'No rollback — this is a dependency outage. Mitigate by degrading.'
  },
  {
    id: 'bad-deploy',
    title: 'Bad deployment',
    severity: 'P0',
    detect: 'Error rate rises sharply after a publish; new JS chunk fails to parse.',
    steps: [
      'Confirm the regression correlates with the publish time.',
      'Re-publish the previous known-good build (the artifact is on the CDN with a content hash).',
      'Verify the entry chunk hash served matches the intended build.',
      'Open a post-incident review; do not re-deploy the bad build to "fix forward" during an incident.'
    ],
    rollback: 'Publishing the previous build. Static assets make this fast and near-riskless.'
  },
  {
    id: 'compromised-key',
    title: 'Suspected credential compromise',
    severity: 'P0',
    detect: 'Security log shows repeated failed authorisation, or anomalous administrative actions.',
    steps: [
      'Rotate the affected key first, before investigating. Investigation can continue afterwards.',
      'Revoke all sessions for the affected actor.',
      'Query the audit log for actions taken with that credential.',
      'Check whether any data was exported.',
      'If personal data was involved, the breach-notification clock starts now — 72 hours under GDPR.'
    ],
    rollback: 'Not applicable. Containment is the objective.'
  },
  {
    id: 'payment-failures',
    title: 'Elevated payment failures',
    severity: 'P1',
    detect: 'payment.failed revenue events spike above baseline.',
    steps: [
      'Group failures by decline code — a single code spiking is a provider or issuer issue, a spread is a product issue.',
      'Check whether the provider is degraded.',
      'Confirm the retry schedule is running and not exhausted.',
      'Do not retry non-retryable codes; notify affected customers instead.'
    ]
  },
  {
    id: 'cdn-origin-mismatch',
    title: 'Stale or mismatched CDN content',
    severity: 'P2',
    detect: 'The entry chunk in the served HTML does not exist in the deployment.',
    steps: [
      'Compare the entry hash in index.html against the assets present on the CDN.',
      'Purge the CDN cache for index.html.',
      'Re-publish if the asset is genuinely missing.'
    ],
    note: 'This exact failure happened once: a stale index.html referenced a deleted chunk and fresh visitors saw a blank page.'
  }
];

export function runbookFor(id) {
  const rb = RUNBOOKS.find((r) => r.id === id);
  if (!rb) return { ok: false, reason: 'unknown-runbook' };
  return { ok: true, runbook: rb, steps: rb.steps.length };
}

/* -------------------------------------------------------- incident response */

export const SEVERITIES = [
  { id: 'P0', label: 'Critical', responseMinutes: 5, notify: ['on-call', 'engineering-lead', 'status-page'], note: 'Total outage, data loss or a security breach. Page immediately.' },
  { id: 'P1', label: 'High', responseMinutes: 30, notify: ['on-call', 'engineering-lead'], note: 'Major function degraded for many users.' },
  { id: 'P2', label: 'Medium', responseMinutes: 240, notify: ['on-call'], note: 'Degraded for some users, or a workaround exists.' },
  { id: 'P3', label: 'Low', responseMinutes: 1440, notify: ['backlog'], note: 'Cosmetic or a single-user issue. No page.' }
];

export const severityById = (id) => SEVERITIES.find((s) => s.id === id) || null;

export const INCIDENT_STATES = ['detected', 'acknowledged', 'mitigating', 'monitoring', 'resolved', 'post-mortem'];

export function declareIncident({ title, severity, at = new Date(), runbookId = null, detectedBy = null } = {}) {
  const sev = severityById(severity);
  if (!sev) return { ok: false, reason: 'unknown-severity' };
  if (!title) return { ok: false, reason: 'title-required' };
  return {
    ok: true,
    incident: {
      id: `inc_${Date.now()}`,
      title, severity,
      state: 'detected',
      declaredAt: new Date(at).toISOString(),
      respondBy: new Date(new Date(at).getTime() + sev.responseMinutes * 60000).toISOString(),
      notify: sev.notify,
      runbookId,
      detectedBy,
      history: [{ state: 'detected', at: new Date(at).toISOString() }]
    }
  };
}

export function advanceIncident({ incident, nextState, at = new Date(), note = null } = {}) {
  if (!incident) return { ok: false, reason: 'no-incident' };
  if (!INCIDENT_STATES.includes(nextState)) return { ok: false, reason: 'unknown-state' };
  if (nextState === 'post-mortem' && incident.state !== 'resolved') {
    return { ok: false, reason: 'must-resolve-first' };
  }
  return {
    ok: true,
    incident: {
      ...incident,
      state: nextState,
      resolvedAt: nextState === 'resolved' ? new Date(at).toISOString() : incident.resolvedAt,
      history: [...incident.history, { state: nextState, at: new Date(at).toISOString(), note }]
    }
  };
}

export function timeToResolve(incident) {
  if (!incident?.resolvedAt) return null;
  return {
    minutes: (new Date(incident.resolvedAt) - new Date(incident.declaredAt)) / 60000,
    metResponseTarget: new Date(incident.history.find((h) => h.state === 'acknowledged')?.at || incident.resolvedAt) <= new Date(incident.respondBy)
  };
}

/* ------------------------------------------------------------------ alerting */

/*
 * Rules keyed on signals this build actually emits. `condition` is a predicate
 * over a sample so the logic is testable without a metrics backend.
 */
export const ALERT_RULES = [
  { id: 'api-failures', category: 'availability', severity: 'P0', signal: 'api.error_rate', condition: (s) => s.value >= 0.25, for: '5m', summary: 'API error rate above 25%' },
  { id: 'service-down', category: 'availability', severity: 'P0', signal: 'dependency.state', condition: (s) => s.critical && s.state === 'unhealthy', summary: 'A critical dependency is unreachable' },
  { id: 'payment-failures', category: 'revenue', severity: 'P1', signal: 'payment.failed', condition: (s) => s.rate >= 0.10, for: '15m', summary: 'Payment failure rate above 10%' },
  { id: 'auth-anomaly', category: 'security', severity: 'P0', signal: 'auth.failure_rate', condition: (s) => s.value >= 0.30, for: '10m', summary: 'Authentication failures above 30%' },
  { id: 'security-event', category: 'security', severity: 'P1', signal: 'security.event', condition: (s) => s.severity === 'high', summary: 'A high-severity security event was logged' },
  { id: 'elevated-latency', category: 'performance', severity: 'P2', signal: 'api.latency.p75', condition: (s) => s.value > 1000, for: '10m', summary: 'p75 API latency above 1s' },
  { id: 'db-failures', category: 'availability', severity: 'P0', signal: 'db.state', condition: (s) => s.state === 'unhealthy', summary: 'Database unreachable' },
  { id: 'queue-failures', category: 'reliability', severity: 'P2', signal: 'queue.dead_letter', condition: (s) => s.depth > 10, summary: 'Dead-letter queue depth above 10' },
  { id: 'capacity', category: 'capacity', severity: 'P2', signal: 'heap.used_mb', condition: (s) => s.value > 1200, for: '15m', summary: 'JS heap above 1.2 GB' },
  { id: 'infra-failure', category: 'infrastructure', severity: 'P0', signal: 'infra.state', condition: (s) => s.state === 'unhealthy', summary: 'Infrastructure health check failing' }
];

export const alertRuleById = (id) => ALERT_RULES.find((r) => r.id === id) || null;

/**
 * Evaluate signals into alerts, applying de-duplication and cooldown.
 *
 * Alert fatigue is a real failure mode, so three things are enforced:
 *   - one open alert per rule, however often the condition holds;
 *   - a cooldown after resolution, so a flapping signal does not re-alert;
 *   - a resolvable alert auto-closes when the condition stops holding.
 */
export function createAlertEngine({ rules = ALERT_RULES, cooldownMs = 15 * 60000, now = () => Date.now() } = {}) {
  const open = new Map();
  const lastResolved = new Map();

  return {
    /** Feed a batch of signals. Returns only what changed. */
    evaluate(signals = []) {
      const fired = [];
      const resolved = [];

      for (const rule of rules) {
        const signal = signals.find((s) => s.signal === rule.signal);
        const matches = signal ? rule.condition(signal) : false;
        const existing = open.get(rule.id);
        const at = now();

        if (matches && !existing) {
          const cooledUntil = lastResolved.get(rule.id) || 0;
          if (at < cooledUntil) continue; // suppressed, and not counted as fired
          const alert = {
            id: `al_${rule.id}_${at}`,
            ruleId: rule.id,
            severity: rule.severity,
            category: rule.category,
            summary: rule.summary,
            openedAt: new Date(at).toISOString(),
            signal: { name: rule.signal, value: signal.value ?? signal.state ?? null }
          };
          open.set(rule.id, alert);
          fired.push(alert);
        } else if (!matches && existing) {
          open.delete(rule.id);
          lastResolved.set(rule.id, at + cooldownMs);
          resolved.push({ ...existing, resolvedAt: new Date(at).toISOString() });
        }
        // matches && existing → already open, so nothing changes. This is the
        // de-duplication that stops one bad hour becoming 700 alerts.
      }

      return { fired, resolved, open: [...open.values()] };
    },
    open: () => [...open.values()],
    /** Sort by severity then age, which is the order to work them in. */
    queue() {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return [...open.values()].sort((a, b) => (rank[a.severity] - rank[b.severity]) || String(a.openedAt).localeCompare(String(b.openedAt)));
    },
    reset() { open.clear(); lastResolved.clear(); }
  };
}

export const alertingSummary = () => ({
  rules: ALERT_RULES.length,
  severities: SEVERITIES.length,
  bySeverity: SEVERITIES.map((s) => ({ severity: s.id, rules: ALERT_RULES.filter((r) => r.severity === s.id).length })),
  runbooks: RUNBOOKS.length
});
