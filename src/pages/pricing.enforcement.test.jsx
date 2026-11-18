import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  enforcementDisclosure,
  pendingMigrations,
  QuotaEnforcementNote,
  SERVER_ENFORCED_KEYS,
  PENDING_KEYS,
  DISPLAY_ONLY_KEYS
} from './Pricing.jsx';
import { ENFORCEMENT, QUOTA_KEYS, QUOTA_LABELS, enforcementState } from '../lib/entitlements.js';

/* The pricing table sells five quotas. Three are refused by Postgres today, two
 * are refused by migration 0008 once it is applied, and the page must say which
 * is which — in three states, not two.
 *
 * A two-state model ("enforced / not enforced") forced a choice between two
 * lies: claim enforcement for a migration that may not be deployed, or deny the
 * mechanism that already exists. These tests pin the third state.
 *
 * Every expectation is derived from `ENFORCEMENT`, so the day 0008 is applied
 * and the flags flip, these tests keep passing and the note shortens itself.
 */

describe('pricing quota disclosure', () => {
  it('classifies every metered quota exactly once', () => {
    const all = [...SERVER_ENFORCED_KEYS, ...PENDING_KEYS, ...DISPLAY_ONLY_KEYS];
    expect(all.sort()).toEqual([...QUOTA_KEYS].sort());
    expect(new Set(all).size).toBe(QUOTA_KEYS.length);
  });

  it('derives each group from enforcementState, not from a hardcoded list', () => {
    expect(SERVER_ENFORCED_KEYS).toEqual(QUOTA_KEYS.filter((k) => enforcementState(k) === 'server'));
    expect(PENDING_KEYS).toEqual(QUOTA_KEYS.filter((k) => enforcementState(k) === 'pending-migration'));
    expect(DISPLAY_ONLY_KEYS).toEqual(QUOTA_KEYS.filter((k) => enforcementState(k) === 'display-only'));
  });

  it('names the enforced quotas and says the database refuses them', () => {
    /* Synthetic input, because with 0008 applied the live call returns null (every
       quota is enforced, so there is nothing to disclose). The sentence itself is
       still produced whenever at least one quota is enforced. */
    /* One pending key is included because the function returns null when there is
       nothing left to disclose at all — that contract is asserted separately. */
    const text = enforcementDisclosure({ enforced: ['alerts', 'bots'], pending: ['portfolios'], displayOnly: [] });
    for (const key of ['alerts', 'bots']) expect(text).toContain(QUOTA_LABELS[key]);
    expect(text).toMatch(/refused by the database/);
    expect(SERVER_ENFORCED_KEYS).toContain('alerts');
  });

  /* 0008 was applied to the deployment on 18 Nov 2026, so the real pending set is
     now empty and the disclosure shortens itself to nothing. The pending sentence
     is still reachable code — a future migration will use it — so it is tested
     with an explicit input rather than by pretending the live state is pending. */
  it('still renders the pending sentence for a synthetic pending key, with its migration named', () => {
    const text = enforcementDisclosure({ enforced: ['alerts', 'bots', 'apiCallsPerMonth'], pending: ['portfolios'], displayOnly: [] });
    expect(text).toContain(QUOTA_LABELS.portfolios);
    for (const migration of pendingMigrations()) expect(text).toContain(migration);
    expect(text).toMatch(/counted in the app only/);
  });

  it('never claims a pending migration is already enforcing', () => {
    const text = enforcementDisclosure({ enforced: ['alerts'], pending: ['portfolios'], displayOnly: [] });
    // The sentence for pending keys must be conditional, not past tense.
    expect(text).toMatch(/as soon as it is applied/);
    expect(text).not.toMatch(/portfolios and team seats are refused by the database/i);
  });

  it('has no pending or display-only quota left after 0008', () => {
    expect(PENDING_KEYS).toEqual([]);
    expect(DISPLAY_ONLY_KEYS).toEqual([]);
    expect(SERVER_ENFORCED_KEYS).toHaveLength(QUOTA_KEYS.length);
  });

  it('agrees in number: one quota is singular, several are plural', () => {
    expect(enforcementDisclosure({ enforced: ['alerts'], pending: ['seats'], displayOnly: [] })).toContain('Team seats is blocked');
    expect(
      enforcementDisclosure({ enforced: ['alerts'], pending: [], displayOnly: ['seats', 'portfolios'] })
    ).toContain('Team seats and Portfolios are counted');
  });

  it('says nothing once every quota is enforced or has a pending migration', () => {
    expect(enforcementDisclosure({ enforced: QUOTA_KEYS, pending: [], displayOnly: [] })).toBeNull();
  });

  it('drops the pending sentence when the pending set is empty', () => {
    const text = enforcementDisclosure({ enforced: ['alerts'], pending: [], displayOnly: ['seats'] });
    expect(text).not.toMatch(/migration/i);
    expect(text).toMatch(/no server mechanism yet/);
  });

  it('renders nothing once every quota is enforced by the database', () => {
    /* The disclosure exists to admit a gap. With no gap left, rendering an empty
       "how these limits are enforced" panel would be noise that implies one. */
    const { container } = render(<QuotaEnforcementNote />);
    expect(screen.queryByTestId('quota-enforcement')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the enforcement map honest about which keys have a mechanism', () => {
    for (const key of QUOTA_KEYS) {
      const state = enforcementState(key);
      if (state === 'server') expect(ENFORCEMENT[key].mechanism).toBeTruthy();
      if (state === 'pending-migration') expect(ENFORCEMENT[key].migration).toMatch(/^\d{4}_.*\.sql$/);
      if (state === 'display-only') expect(ENFORCEMENT[key].mechanism).toBe('none');
    }
  });
});
