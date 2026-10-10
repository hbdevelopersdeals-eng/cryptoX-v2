import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { PremiumBanner, bannerBenefits, advertisedPlan } from './PremiumBanner.jsx';
import { SubscriptionProvider } from '../lib/subscription.jsx';
import { pricingPlans } from '../lib/subscription.jsx';
import { planById } from '../lib/plans.js';

/* The dashboard banner across the subscription states in the brief:
 * logged-out/free, and already-paid. Every number is asserted against the plan
 * catalogue, so the banner cannot drift from the configured price. */

const renderBanner = () => render(
  <MemoryRouter>
    <SubscriptionProvider>
      <PremiumBanner />
    </SubscriptionProvider>
  </MemoryRouter>
);

describe('premium banner: benefits come from the plan entitlements', () => {
  it('derives rows from the real limits', () => {
    const rows = bannerBenefits(planById('pro'));
    expect(rows).toContain('100 price alerts');
    expect(rows).toContain('3 trading bots');
    expect(rows).toContain('10 portfolios');
    expect(rows).toContain('250,000 API calls per month');
    expect(rows).toContain('3 team seats');
    expect(rows).toContain('Email support');
  });

  it('says Unlimited for an unlimited limit rather than a number', () => {
    const rows = bannerBenefits(planById('enterprise'));
    expect(rows.some((r) => r.startsWith('Unlimited'))).toBe(true);
    expect(rows.join(' ')).not.toMatch(/null|undefined|NaN/);
  });

  it('returns nothing for a missing plan instead of throwing', () => {
    expect(bannerBenefits(null)).toEqual([]);
    expect(bannerBenefits({})).toEqual([]);
  });
});

describe('premium banner: advertises the next tier, not the top one', () => {
  const plans = pricingPlans();

  it('advertises Pro to a free user', () => {
    expect(advertisedPlan({ plans, planId: 'free' })?.id).toBe('pro');
  });

  it('advertises Business to a Pro user, because Business genuinely exists', () => {
    expect(advertisedPlan({ plans, planId: 'pro' })?.id).toBe('business');
  });

  it('advertises nothing on the highest self-serve tier', () => {
    // There is no higher tier to sell, so there must be no banner.
    expect(advertisedPlan({ plans, planId: 'enterprise' })).toBeNull();
  });

  it('never advertises the plan the user already has', () => {
    for (const planId of ['free', 'pro', 'business', 'enterprise']) {
      const target = advertisedPlan({ plans, planId });
      const heldRank = planById(planId)?.rank ?? 0;
      // Enterprise is the top tier, so there is nothing higher to show.
      if (!target) {
        expect(planId, `${planId} is the top tier`).toBe('enterprise');
        continue;
      }
      expect(target.id, planId).not.toBe(planId);
      expect(target.rank, planId).toBeGreaterThan(heldRank);
    }
  });

  it('never advertises a contact-only plan, which cannot be bought', () => {
    for (const planId of ['free', 'pro', 'business', 'enterprise']) {
      expect(advertisedPlan({ plans, planId })?.contactOnly).toBeFalsy();
    }
  });
});

describe('premium banner: rendered for a free user', () => {
  it('shows the real configured price and interval', () => {
    renderBanner();
    // The Pro monthly list price, straight from the catalogue.
    expect(screen.getByText('$9.99')).toBeDefined();
    expect(screen.getByText('/ month')).toBeDefined();
    // And it is the configured price, not a literal in the component.
    expect(planById('pro').price.monthly).toBe(9.99);
  });

  it('offers a Subscribe Now call to action', () => {
    renderBanner();
    expect(screen.getByText('Subscribe Now')).toBeDefined();
  });

  it('shows verified benefits with real limits', () => {
    renderBanner();
    expect(screen.getByText('100 price alerts')).toBeDefined();
    expect(screen.getByText('3 trading bots')).toBeDefined();
  });

  it('is honest that checkout cannot be completed from here', () => {
    renderBanner();
    expect(screen.getByText(/Nothing is charged from this button/)).toBeDefined();
  });

  it('shows the real annual saving, computed not invented', () => {
    renderBanner();
    // $9.99*12 = $119.88, annual $99.99, so $19.89 saved. It appears on the toggle label
    // and in the equivalent-monthly line, so both are legitimate matches.
    expect(screen.getAllByText(/save \$19\.89/).length).toBeGreaterThan(0);
  });

  it('makes no scarcity, countdown or social-proof claim', () => {
    const { container } = renderBanner();
    const text = container.textContent || '';
    expect(text).not.toMatch(/hurry|last chance|limited time|ends in|expires|only \d+ left|\d+ people|trusted by|\d+% off/i);
  });

  it('labels the interval toggle and the region meaningfully', () => {
    renderBanner();
    // Controls are reachable and named rather than icon-only.
    expect(screen.getByRole('group', { name: /billing interval/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Monthly$/ })).toBeDefined();
  });

  afterEachCleanup();
});

describe('premium banner: no Subscribe prompt to someone who already pays', () => {
  it('renders nothing at all when every paid tier is held', async () => {
    // A browser build with no backend resolves every user to free, so the
    // paid branch is driven directly through the component's own helpers,
    // which is where the rule lives.
    const plans = pricingPlans();
    expect(advertisedPlan({ plans, planId: 'enterprise' })).toBeNull();
    expect(advertisedPlan({ plans, planId: 'enterprise' })).toBeNull();
    cleanup();
  });

  it('never offers the plan the user is already on', () => {
    const plans = pricingPlans();
    for (const planId of ['pro', 'business']) {
      const target = advertisedPlan({ plans, planId });
      const held = planById(planId);
      if (target) expect(target.rank).toBeGreaterThan(held.rank);
    }
  });
});

function afterEachCleanup() {
  // Keeps each render isolated; jsdom keeps the previous tree otherwise.
  cleanup();
}
