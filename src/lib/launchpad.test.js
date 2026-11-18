import { describe, it, expect } from 'vitest';
import {
  validateApplication, validateTokenomics, vestingSchedule, allocate,
  subscriptionEligibility, transition, scoreDueDiligence, LISTING_STATES
} from './launchpad.js';

const app = {
  projectName: 'Example Protocol',
  ticker: 'EXM',
  chain: 'Ethereum',
  contractAddress: '0x' + 'a'.repeat(40),
  website: 'https://example.org',
  whitepaper: 'https://example.org/wp.pdf',
  description: 'x'.repeat(200),
  team: [{ name: 'A', linkedin: 'https://linkedin.com/in/a' }],
  totalSupply: 100000000,
  raiseTarget: 500000
};

describe('application validation', () => {
  it('accepts a complete application', () => {
    const r = validateApplication(app);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('names every missing required field', () => {
    const r = validateApplication({});
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(8);
    expect(r.errors.join(' ')).toMatch(/Project name is required/);
  });

  it('rejects a malformed ticker, URL and short description', () => {
    const r = validateApplication({ ...app, ticker: 'exm!', website: 'javascript:alert(1)', description: 'short' });
    expect(r.errors.join(' ')).toMatch(/ticker/i);
    expect(r.errors.join(' ')).toMatch(/http\(s\) URL/);
    expect(r.errors.join(' ')).toMatch(/at least 120/);
  });

  it('warns, but does not fail, on an unverifiable team', () => {
    const r = validateApplication({ ...app, team: [{ name: 'Anon' }] });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/LinkedIn or GitHub/);
  });

  it('warns on an address that is neither EVM nor Solana shaped', () => {
    const r = validateApplication({ ...app, contractAddress: 'hello' });
    expect(r.warnings.join(' ')).toMatch(/EVM or Solana/);
  });
});

describe('tokenomics', () => {
  const good = [
    { id: 'team', label: 'Team', pct: 20 },
    { id: 'community', label: 'Community', pct: 50 },
    { id: 'treasury', label: 'Treasury', pct: 30 }
  ];

  it('accepts a 100% allocation with a team cliff', () => {
    const r = validateTokenomics({ allocations: good, tgeUnlockPct: 10, teamCliffMonths: 12 });
    expect(r.valid).toBe(true);
    expect(r.total).toBe(100);
  });

  it('fails when allocations do not sum to 100', () => {
    const r = validateTokenomics({ allocations: [{ id: 'a', label: 'A', pct: 40 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sum to 40.00%/);
  });

  it('fails on a negative bucket', () => {
    const r = validateTokenomics({ allocations: [{ id: 'a', label: 'A', pct: 120 }, { id: 'b', label: 'B', pct: -20 }] });
    expect(r.valid).toBe(false);
  });

  it('warns on concentration, TGE size and a missing team cliff', () => {
    const r = validateTokenomics({ allocations: [{ id: 'team', label: 'Team', pct: 40 }, { id: 'c', label: 'C', pct: 60 }], tgeUnlockPct: 40 });
    expect(r.warnings.join(' ')).toMatch(/30% concentration/);
    expect(r.warnings.join(' ')).toMatch(/TGE unlocks/);
    expect(r.warnings.join(' ')).toMatch(/cliff/);
  });

  it('requires at least one bucket', () => {
    expect(validateTokenomics({ allocations: [] }).valid).toBe(false);
  });
});

describe('vesting', () => {
  it('unlocks TGE then vests linearly, summing exactly', () => {
    const s = vestingSchedule({ totalTokens: 1000000, tgePct: 10, cliffMonths: 6, vestMonths: 10, startDate: '2026-01-01T00:00:00Z' });
    expect(s.rows[0].unlock).toBe(100000);
    expect(s.totalsTo).toBe(1000000);
    expect(s.balanced).toBe(true);
    expect(s.durationMonths).toBe(16);
    expect(s.rows.at(-1).cumulative).toBe(1000000);
  });

  it('absorbs integer dust in the final period', () => {
    const s = vestingSchedule({ totalTokens: 1000, tgePct: 0, vestMonths: 3 });
    expect(s.rows.at(-1).unlock).toBe(334);
    expect(s.totalsTo).toBe(1000);
  });

  it('rejects impossible inputs', () => {
    expect(vestingSchedule({ totalTokens: 0 }).error).toBeTruthy();
    expect(vestingSchedule({ totalTokens: 100, vestMonths: 0 }).error).toBeTruthy();
    expect(vestingSchedule({ totalTokens: 100, tgePct: 150 }).error).toBeTruthy();
  });
});

describe('allocation', () => {
  it('fills completely when under-subscribed and refunds nothing', () => {
    const r = allocate({ participants: [{ id: 'a', requested: 100 }, { id: 'b', requested: 200 }], raiseCapUsd: 1000, pricePerToken: 1 });
    expect(r.ok).toBe(true);
    expect(r.oversubscribed).toBe(false);
    expect(r.raised).toBe(300);
    expect(r.allocations.every((a) => a.refund === 0)).toBe(true);
  });

  it('pro-rates an oversubscribed sale and reports the dust', () => {
    const r = allocate({ participants: [{ id: 'a', requested: 1000 }, { id: 'b', requested: 1000 }], raiseCapUsd: 500, pricePerToken: 2 });
    expect(r.oversubscribed).toBe(true);
    expect(r.scale).toBe(0.25);
    expect(r.tokensSold).toBe(250);
    expect(r.raised).toBe(500);
    expect(r.dust).toBe(0);
  });

  it('never allocates fractional tokens', () => {
    const r = allocate({ participants: [{ id: 'a', requested: 100 }], raiseCapUsd: 100, pricePerToken: 3 });
    expect(Number.isInteger(r.allocations[0].tokens)).toBe(true);
    expect(r.allocations[0].refund).toBeGreaterThanOrEqual(0);
  });

  it('rejects a non-positive cap or price', () => {
    expect(allocate({ participants: [{ id: 'a', requested: 10 }], raiseCapUsd: 0 }).ok).toBe(false);
    expect(allocate({ participants: [{ id: 'a', requested: 10 }], raiseCapUsd: 10, pricePerToken: 0 }).ok).toBe(false);
  });
});

describe('subscription eligibility', () => {
  const ok = { whitelisted: true, kycStatus: 'approved', country: 'PK' };

  it('admits a whitelisted, verified participant in an open window', () => {
    expect(subscriptionEligibility(ok).eligible).toBe(true);
  });

  it('names every blocker', () => {
    const r = subscriptionEligibility({ whitelisted: false, kycStatus: 'pending', alreadySubscribed: true });
    expect(r.eligible).toBe(false);
    expect(r.blockers).toHaveLength(3);
  });

  it('blocks a restricted country', () => {
    const r = subscriptionEligibility({ ...ok, country: 'US', restrictedCountries: ['us'] });
    expect(r.blockers.join(' ')).toMatch(/Residents of US/);
  });

  it('enforces the window', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    expect(subscriptionEligibility({ ...ok, opensAt: '2026-07-01T00:00:00Z', now }).blockers.join(' ')).toMatch(/not opened/);
    expect(subscriptionEligibility({ ...ok, closesAt: '2026-05-01T00:00:00Z', now }).blockers.join(' ')).toMatch(/closed/);
  });
});

describe('listing workflow', () => {
  it('walks the happy path to listed', () => {
    let state = 'applied';
    for (const next of ['screening', 'due_diligence', 'approved', 'whitelist', 'subscription', 'distribution', 'listed']) {
      const r = transition(state, next);
      expect(r.ok).toBe(true);
      state = r.state;
    }
    expect(state).toBe('listed');
  });

  it('refuses to skip due diligence', () => {
    const r = transition('screening', 'subscription');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Allowed/);
  });

  it('treats listed and rejected as terminal', () => {
    expect(transition('listed', 'subscription').ok).toBe(false);
    expect(transition('rejected', 'screening').ok).toBe(false);
  });

  it('rejects an unknown state name', () => {
    expect(transition('applied', 'moon').ok).toBe(false);
  });

  it('declares every state in the transition table', () => {
    for (const s of LISTING_STATES) expect(() => transition(s, s)).not.toThrow();
  });
});

describe('due diligence scoring', () => {
  const strong = { team: 90, product: 85, tokenomics: 80, legal: 85, security: 90, audit: true };

  it('approves a strong application with every gate cleared', () => {
    const r = scoreDueDiligence({ ...strong, tokenomicsValid: true });
    expect(r.verdict).toBe('approve');
    expect(r.score).toBeGreaterThan(75);
    expect(r.blockers).toEqual([]);
  });

  it('cannot approve without an audit, however good the deck', () => {
    const r = scoreDueDiligence({ ...strong, audit: false });
    expect(r.verdict).not.toBe('approve');
    expect(r.blockers.join(' ')).toMatch(/audit/);
  });

  it('rejects an anonymous team with a sanctions hit', () => {
    const r = scoreDueDiligence({ team: 20, product: 20, tokenomics: 20, legal: 20, security: 20, audit: true, anonymousTeam: true, sanctionsHit: true });
    expect(r.verdict).toBe('reject');
    expect(r.blockers.length).toBe(2);
  });

  it('clamps out-of-range criteria instead of trusting them', () => {
    const r = scoreDueDiligence({ team: 9999, product: -50, tokenomics: 0, legal: 0, security: 0, audit: true });
    expect(r.scores.team).toBe(100);
    expect(r.scores.product).toBe(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
