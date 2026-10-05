import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const market = vi.hoisted(() => ({ rows: [] }));
const deriv = vi.hoisted(() => ({
  state: { markPrice: 100000, indexPrice: 99900, fundingRate: 0.0001, openInterest: 12345, error: null }
}));

vi.mock('../lib/market.jsx', () => ({ useMarket: () => market }));
vi.mock('../lib/derivatives.js', () => ({
  useDerivatives: () => deriv.state,
  useLiquidations: () => ({ events: [] })
}));

import DerivativesPage from './Derivatives.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  market.rows = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 99950, mcap: 1e12 }
  ];
  deriv.state = { markPrice: 100000, indexPrice: 99900, fundingRate: 0.0001, openInterest: 12345, error: null };
});

describe('Derivatives page — Section 2 coverage', () => {
  it('renders the original perpetual, ADL, heatmap and options panels', () => {
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Open perpetual position/i)).toBeTruthy();
    expect(screen.getByText(/Position risk/i)).toBeTruthy();
    expect(screen.getByText(/ADL queue/i)).toBeTruthy();
    expect(screen.getAllByText(/Liquidation heatmap/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Black-Scholes/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders dated futures with derived quarterly expiries', () => {
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Dated futures/i)).toBeTruthy();
    // Contracts are derived, so two BTCUSDT_YYMMDD rows must exist.
    expect(screen.getAllByText(/BTCUSDT_\d{6}/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Expiry/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Annualised/i)).toBeTruthy();
  });

  it('renders the mark vs index panel, since liquidation follows the mark', () => {
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Mark vs index price/i)).toBeTruthy();
    expect(screen.getAllByText(/Mark price/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Index price/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Basis \(mark − index\)/i)).toBeTruthy();
    expect(screen.getByText(/Implied funding from premium/i)).toBeTruthy();
  });

  it('renders the realized PnL partial-close calculator', () => {
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Realized PnL · partial close/i)).toBeTruthy();
    expect(screen.getByText(/Realized \(net\)/i)).toBeTruthy();
    expect(screen.getByText(/ROE on the close/i)).toBeTruthy();
    expect(screen.getByText(/Remaining open/i)).toBeTruthy();
  });

  it('renders cross-margin aggregation and states the cross-vs-isolated difference', () => {
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Cross-margin wallet/i)).toBeTruthy();
    expect(screen.getAllByText(/Maintenance margin/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Cushion before liquidation/i)).toBeTruthy();
    expect(screen.getByText(/Aggregate risk/i)).toBeTruthy();
    // The distinction must be explained, not just labelled.
    expect(screen.getByText(/one collateral pool backs every position/i)).toBeTruthy();
  });

  it('survives a missing derivatives feed without blanking', () => {
    deriv.state = { markPrice: null, indexPrice: null, fundingRate: null, openInterest: null, error: 'feed down' };
    wrap(<DerivativesPage />);
    expect(screen.getByText(/Dated futures/i)).toBeTruthy();
    expect(screen.getByText(/Cross-margin wallet/i)).toBeTruthy();
  });
});
