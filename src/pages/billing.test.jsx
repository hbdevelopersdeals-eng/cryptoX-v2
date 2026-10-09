import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Billing from './Billing.jsx';
import Compliance from './Compliance.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Billing & Tax page', () => {
  it('renders the plan arithmetic and names the proration direction', () => {
    wrap(<Billing />);
    expect(screen.getByRole('heading', { name: /Billing & Tax/i })).toBeTruthy();
    expect(screen.getByText(/Unused credit from current plan/i)).toBeTruthy();
    expect(screen.getByText(/Charge for remainder of cycle/i)).toBeTruthy();
  });

  it('shows graduated and volume metered pricing as different numbers', () => {
    wrap(<Billing />);
    // 5000 units: 1000*0.10 + 4000*0.05 = 300 graduated; 5000*0.05 = 250 volume.
    expect(screen.getByText('$300')).toBeTruthy();
    expect(screen.getByText('$250')).toBeTruthy();
    expect(screen.getByText(/mis-bills by a large factor/i)).toBeTruthy();
  });

  it('REFUSES a payment status asserted by the client, in the UI', async () => {
    wrap(<Billing />);
    fireEvent.click(screen.getByRole('button', { name: /Client says paid/i }));
    await waitFor(() => expect(screen.getByText(/untrusted-source/i)).toBeTruthy());
    // The status must not have moved to paid.
    expect(screen.queryByText('paid')).toBeNull();
    expect(screen.getByText('requires_payment')).toBeTruthy();
  });

  it('accepts a verified webhook and reports the origin', async () => {
    wrap(<Billing />);
    fireEvent.click(screen.getByRole('button', { name: /Raise invoice/i }));
    await waitFor(() => expect(screen.getByText('INV-2026-000001')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Verified webhook/i }));
    await waitFor(() => expect(screen.getByText(/Accepted from webhook-verified/i)).toBeTruthy());
  });

  it('numbers invoices gaplessly and caps a refund at what was paid', async () => {
    wrap(<Billing />);
    fireEvent.click(screen.getByRole('button', { name: /Raise invoice/i }));
    await waitFor(() => expect(screen.getByText('INV-2026-000001')).toBeTruthy());

    // Nothing has been paid, so there is nothing to refund.
    fireEvent.click(screen.getByRole('button', { name: /Refund \$10/i }));
    await waitFor(() => expect(screen.getByText(/nothing-refundable/i)).toBeTruthy());
  });

  it('verifies a tax identifier and says what was actually checked', async () => {
    wrap(<Billing />);
    // DE123456789 matches the published German pattern.
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText('valid')).toBeTruthy());
    expect(screen.getByText(/VIES|registry/i)).toBeTruthy();
  });

  it('refuses to invent a US rate rather than showing tax-free', async () => {
    wrap(<Billing />);
    fireEvent.change(screen.getByLabelText('Tax jurisdiction'), { target: { value: 'US' } });
    await waitFor(() => expect(screen.getByText(/rate-must-be-set-locally/i)).toBeTruthy());
  });

  it('zero-rates a cross-border B2B supply once the tax ID is verified', async () => {
    wrap(<Billing />);
    fireEvent.change(screen.getByLabelText('Tax jurisdiction'), { target: { value: 'FR' } });
    // A German identifier cannot satisfy the French pattern.
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: 'FRAB123456789' } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/marked verified/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Buyer type'), { target: { value: 'business' } });
    await waitFor(() => expect(screen.getByText(/reverse-charge/i)).toBeTruthy());
  });

  it('shows which declines must not be retried', () => {
    wrap(<Billing />);
    expect(screen.getByText('Card expired')).toBeTruthy();
    expect(screen.getAllByText(/do not retry/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/can never succeed/i)).toBeTruthy();
  });
});

describe('Compliance page', () => {
  it('treats a new policy version as outstanding acceptance', async () => {
    wrap(<Compliance />);
    expect(screen.getByRole('heading', { name: /^Compliance$/ })).toBeTruthy();
    // Terms v1.0 is required up front.
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /^Accept$/ })[0]);
    await waitFor(() => expect(screen.getAllByText(/accepted/i).length).toBeGreaterThan(0));

    // Publishing v2.0 invalidates the v1.0 acceptance.
    fireEvent.click(screen.getByRole('button', { name: /Publish Terms v2.0/i }));
    await waitFor(() => expect(screen.getByText(/does not carry over/i)).toBeTruthy());
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);
  });

  it('locks the strictly-necessary consent category and refuses to withdraw it', async () => {
    wrap(<Compliance />);
    const necessary = screen.getByLabelText(/Strictly necessary/i);
    expect(necessary.disabled).toBe(true);

    // Marketing can be turned on, then withdrawn without a reason.
    fireEvent.click(screen.getByLabelText(/^Marketing$/));
    await waitFor(() => expect(screen.getByRole('button', { name: /Withdraw/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Withdraw/i }));
    await waitFor(() => expect(screen.getByText(/No reason is required/i)).toBeTruthy());
  });

  it('defaults analytics and marketing to off', () => {
    wrap(<Compliance />);
    expect(screen.getByLabelText(/^Analytics$/).checked).toBe(false);
    expect(screen.getByLabelText(/^Marketing$/).checked).toBe(false);
  });

  it('opens a DSR with the jurisdiction clock and blocks an illegal transition', async () => {
    wrap(<Compliance />);
    fireEvent.change(screen.getByLabelText('Jurisdiction'), { target: { value: 'ccpa' } });
    fireEvent.click(screen.getByRole('button', { name: /Open request/i }));
    await waitFor(() => expect(screen.getAllByText(/45d/).length).toBeGreaterThan(0));

    // received → completed is not an allowed transition.
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    await waitFor(() => expect(screen.getByText(/illegal-transition/i)).toBeTruthy());

    // The legal path works.
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText('verifying')).toBeTruthy());
  });

  it('blocks deletion of tax records regardless of an erasure request', () => {
    wrap(<Compliance />);
    expect(screen.getByText(/legal-retention/i)).toBeTruthy();
    // Consent-backed location data stays deletable.
    expect(screen.getAllByText('deletable').length).toBeGreaterThan(0);
  });

  it('places a legal hold that blocks deletion, and lifts it again', async () => {
    wrap(<Compliance />);
    fireEvent.click(screen.getByRole('button', { name: /Place hold on account data/i }));
    await waitFor(() => expect(screen.getByText(/Deletion of held data is now blocked/i)).toBeTruthy());
    expect(screen.getAllByText(/legal-hold/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Release hold/i }));
    await waitFor(() => expect(screen.getByText(/Deletion is permitted again/i)).toBeTruthy());
  });

  it('declares regulated activity instead of simulating it', () => {
    wrap(<Compliance />);
    expect(screen.getByText(/KYC \(identity verification\)/)).toBeTruthy();
    expect(screen.getByText(/Sanctions and PEP screening/)).toBeTruthy();
    expect(screen.getAllByText('server-only').length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot screen a sanctions list/i)).toBeTruthy();
  });

  it('separates what is built from what each framework still needs', () => {
    wrap(<Compliance />);
    expect(screen.getByText(/DPO appointment and EU representative/)).toBeTruthy();
    expect(screen.getAllByText('Still needed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Built').length).toBeGreaterThan(0);
  });
});
