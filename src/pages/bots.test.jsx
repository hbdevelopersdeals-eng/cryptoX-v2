import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The Bots page reads market data but never writes to it. */
const market = vi.hoisted(() => ({
  rows: [],
  byId: {},
  getKlines: () => Promise.resolve({ candles: null, source: 'binance' })
}));

vi.mock('../lib/market.jsx', () => ({ useMarket: () => market }));

import BotsPage from './Bots.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  market.rows = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 100000, mcap: 1e12 },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 4000, mcap: 5e11 }
  ];
  market.byId = {
    bitcoin: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    ethereum: { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }
  };
});

describe('Trading Bots page', () => {
  it('renders every bot engine and states clearly that it is paper only', () => {
    wrap(<BotsPage />);
    expect(screen.getByRole('heading', { name: 'Trading Bots' })).toBeTruthy();
    expect(screen.getAllByText(/Paper only\./i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/can never place a real order/i)).toBeTruthy();

    // Every engine must be offered as a chip.
    ['DCA', 'Grid', 'TWAP', 'VWAP', 'Arbitrage', 'Rebalancing', 'Market making',
      'Momentum', 'Mean reversion', 'Breakout', 'Copy strategy', 'Custom strategy']
      .forEach((name) => expect(screen.getByRole('button', { name }), name).toBeTruthy());
  });

  it('exposes risk controls before a bot can be created', () => {
    wrap(<BotsPage />);
    ['Max position %', 'Max order (quote)', 'Halt at drawdown %', 'Halt at daily loss %', 'Max trades / day']
      .forEach((label) => expect(screen.getByText(label), label).toBeTruthy());
  });

  it('creates a bot and lists it as paused', async () => {
    wrap(<BotsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Add bot/i }));

    await waitFor(() => expect(screen.getByText('Your bots')).toBeTruthy());
    expect(screen.getByText('PAUSED')).toBeTruthy();
    expect(screen.getByText('Paused — start it to begin paper trading.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start/i })).toBeTruthy();
  });

  it('shows parameter fields for the selected bot type', async () => {
    wrap(<BotsPage />);
    // DCA defaults
    expect(screen.getByText('Amount per buy (quote)')).toBeTruthy();
    expect(screen.getByText('Buy every N bars')).toBeTruthy();

    // Switching to Grid swaps in the grid parameters.
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(screen.getByText('Number of levels')).toBeTruthy());
    expect(screen.getByText('Lower bound')).toBeTruthy();
    expect(screen.queryByText('Amount per buy (quote)')).toBeNull();
  });

  it('shows the condition builder only for a custom strategy', async () => {
    wrap(<BotsPage />);
    expect(screen.queryByText(/Entry \(all must be true\)/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Custom strategy' }));
    await waitFor(() => expect(screen.getByText(/Entry \(all must be true\)/)).toBeTruthy());
    expect(screen.getByText(/Exit \(all must be true\)/)).toBeTruthy();
  });

  it('renders the marketplace and installs a preset as a paused bot', async () => {
    wrap(<BotsPage />);
    expect(screen.getByText('Strategy marketplace')).toBeTruthy();
    // The install counts must be labelled as not a performance claim. The copy
    // wraps "not" in a <b>, so match on the parent's textContent.
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && /performance claim/i.test(el.textContent || ''))
    ).toBeTruthy();

    const installs = screen.getAllByRole('button', { name: /Install/i });
    expect(installs.length).toBeGreaterThanOrEqual(8);
    fireEvent.click(installs[0]);

    await waitFor(() => expect(screen.getByText('BTC Weekly DCA')).toBeTruthy());
    expect(screen.getByText('PAUSED')).toBeTruthy();
  });

  it('starts and pauses a bot', async () => {
    wrap(<BotsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Add bot/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Start/i })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    await waitFor(() => expect(screen.getByText('RUNNING')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Pause/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
    await waitFor(() => expect(screen.getByText('PAUSED')).toBeTruthy());
  });

  it('persists bots and survives corrupt storage', async () => {
    localStorage.setItem('cx_bots', '{not json');
    wrap(<BotsPage />);
    expect(screen.getByRole('heading', { name: 'Trading Bots' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('No bots yet')).toBeTruthy());
  });
});
