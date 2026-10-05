import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The market provider owns network + websocket state; both pages only read it. */
const market = vi.hoisted(() => ({
  rows: [],
  byId: {},
  bySymbol: {},
  getKlines: () => Promise.resolve({ candles: null, source: 'binance' })
}));

const venues = vi.hoisted(() => ({ results: [], calls: 0 }));

vi.mock('../lib/market.jsx', () => ({ useMarket: () => market }));
vi.mock('../lib/sources.js', () => ({
  fetchAllVenues: () => { venues.calls += 1; return Promise.resolve(venues.results); },
  SUPPORTED_VENUES: []
}));

import AggregatorPage from './Aggregator.jsx';
import AlertsPage from './Alerts.jsx';
import PortfolioPage from './Portfolio.jsx';
import WalletLabPage from './WalletLab.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const VENUE_RESULTS = [
  {
    venueId: 'binance', name: 'Binance', status: 'live', latencyMs: 120,
    quotes: [
      { venue: 'binance', assetId: 'bitcoin', symbol: 'BTC', price: 100000 },
      { venue: 'binance', assetId: 'ethereum', symbol: 'ETH', price: 4000 }
    ]
  },
  {
    venueId: 'okx', name: 'OKX', status: 'live', latencyMs: 210,
    quotes: [
      { venue: 'okx', assetId: 'bitcoin', symbol: 'BTC', price: 101200 },
      { venue: 'okx', assetId: 'ethereum', symbol: 'ETH', price: 4005 }
    ]
  },
  {
    venueId: 'kraken', name: 'Kraken', status: 'down', latencyMs: 0, quotes: [], error: 'timed out'
  }
];

beforeEach(() => {
  localStorage.clear();
  venues.results = [];
  venues.calls = 0;
  market.rows = [];
  market.byId = {};
  // No page under test should reach the network by default.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' })
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Aggregator page', () => {
  it('renders the heading and the honesty gate before any data arrives', async () => {
    wrap(<AggregatorPage />);
    expect(screen.getByRole('heading', { name: 'Exchange Aggregator' })).toBeTruthy();
    expect(screen.getByText(/not tradeable profit/i)).toBeTruthy();
    await waitFor(() => expect(venues.calls).toBeGreaterThan(0));
  });

  it('shows an empty state when no venue returns quotes', async () => {
    venues.results = [];
    wrap(<AggregatorPage />);
    await waitFor(() => expect(screen.getByText(/No venue quotes available yet/i)).toBeTruthy());
  });

  it('aggregates quotes into the price-gap, best-price and leaderboard tables', async () => {
    venues.results = VENUE_RESULTS;
    wrap(<AggregatorPage />);

    await waitFor(() => expect(screen.getByText('Cross-Venue Price Gaps')).toBeTruthy());

    // BTC is 100k on Binance and 101.2k on OKX → a 1.2% gross gap must appear.
    await waitFor(() => expect(screen.getByText('1.200%')).toBeTruthy());
    // 1.2% gross − 0.2% round-trip fees: shown both as the "Best net gap" tile and in the table.
    expect(screen.getAllByText('1.000%').length).toBeGreaterThanOrEqual(2);

    // Best-price table and leaderboard render too.
    expect(screen.getByText('Best Buy / Best Sell by Asset')).toBeTruthy();
    expect(screen.getByText('Venue Leaderboard')).toBeTruthy();
    expect(screen.getByText('Venue Ingestion Health')).toBeTruthy();

    // Section 7 coverage: per-exchange comparison, best execution, liquidity.
    expect(screen.getByText('Per-Exchange Price Comparison')).toBeTruthy();
    expect(screen.getByText('Best Execution Venue')).toBeTruthy();
    expect(screen.getByText('Liquidity & Volume')).toBeTruthy();

    // BTC cross-venue global average of 100,000 and 101,200.
    expect(screen.getAllByText('100,600.00').length).toBeGreaterThanOrEqual(1);

    // The unreachable venue is reported honestly rather than back-filled.
    expect(screen.getByText(/2\/3 venues live/)).toBeTruthy();
    expect(screen.getAllByText('live').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('down')).toBeTruthy();
  });

  it('totals only quote-currency volume and names the excluded venue', async () => {
    venues.results = [
      {
        venueId: 'binance', name: 'Binance', status: 'live', latencyMs: 100,
        quotes: [{ venue: 'binance', assetId: 'bitcoin', symbol: 'BTC', price: 100000, volumeQuote: 5000000 }]
      },
      {
        venueId: 'okx', name: 'OKX', status: 'live', latencyMs: 100,
        // OKX reports base-asset volume, so it must NOT be added to the total.
        quotes: [{ venue: 'okx', assetId: 'bitcoin', symbol: 'BTC', price: 101200, volumeQuote: 999999 }]
      }
    ];
    wrap(<AggregatorPage />);

    await waitFor(() => expect(screen.getByText('Liquidity & Volume')).toBeTruthy());
    // Only Binance is comparable → $5.00M (never $5.99M).
    await waitFor(() => expect(screen.getAllByText('$5.00M').length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText('$5.99M')).toBeNull();
    // OKX is surfaced by name as an excluded source rather than silently dropped.
    expect(screen.getByText('1 venue')).toBeTruthy();
    expect(screen.getAllByText('not comparable').length).toBeGreaterThanOrEqual(1);
  });

  it('survives a venue set with a single venue (no gaps, no crash)', async () => {
    venues.results = [VENUE_RESULTS[0]];
    wrap(<AggregatorPage />);
    await waitFor(() => expect(screen.getByText('Venue Ingestion Health')).toBeTruthy());
    expect(screen.getByText(/No gaps above/i)).toBeTruthy();
  });
});

describe('Alerts page', () => {
  it('renders the empty state when no rules exist', async () => {
    wrap(<AlertsPage />);
    expect(screen.getByRole('heading', { name: 'Alert Engine' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/No alert rules yet/i)).toBeTruthy());
    expect(screen.getByText('Trigger History')).toBeTruthy();
  });

  it('migrates a legacy price alert into a rule and lists it', async () => {
    localStorage.setItem('cx_alerts', JSON.stringify([
      { id: 'a1', coinId: 'bitcoin', symbol: 'BTC', dir: 'above', target: 60000, at: 1 }
    ]));
    market.byId = { bitcoin: { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', price: 105000 } };

    wrap(<AlertsPage />);

    // Stored as { dir, target } but must be shown through the new rule engine.
    await waitFor(() => expect(screen.getByText('BTC price above 60000')).toBeTruthy());
    expect(screen.getByText('Bitcoin')).toBeTruthy();
    expect(screen.queryByText(/No alert rules yet/i)).toBeNull();
  });

  it('renders indicator-based rules without crashing', async () => {
    localStorage.setItem('cx_alerts', JSON.stringify([
      { id: 'r1', coinId: 'bitcoin', symbol: 'BTC', rule: { type: 'rsi_below', symbol: 'BTC', value: 30 }, cooldownMs: 60000 },
      { id: 'r2', coinId: 'ethereum', symbol: 'ETH', rule: { type: 'ma_cross', symbol: 'ETH', periods: [9, 21] }, enabled: false }
    ]));
    market.byId = {
      bitcoin: { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', price: 105000 },
      ethereum: { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', price: 4000 }
    };

    wrap(<AlertsPage />);

    await waitFor(() => expect(screen.getByText('BTC RSI below 30')).toBeTruthy());
    expect(screen.getByText('ETH MA9 crosses MA21')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
    // With no candle history the readout must say so instead of inventing a value.
    expect(screen.getByText('RSI unavailable')).toBeTruthy();
  });

  it('tolerates corrupt stored alerts without blanking the page', async () => {
    localStorage.setItem('cx_alerts', '{not json');
    wrap(<AlertsPage />);
    expect(screen.getByRole('heading', { name: 'Alert Engine' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Trigger History')).toBeTruthy());
  });
});

describe('Portfolio + Wallet Lab pages', () => {
  const withPrices = () => {
    market.rows = [
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 200, mcap: 100 },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 40, mcap: 50 }
    ];
    market.byId = Object.fromEntries(market.rows.map((r) => [r.id, r]));
  };

  const seed = (txs) => localStorage.setItem('cx_tx', JSON.stringify(txs));

  it('renders the empty state with no transactions', async () => {
    withPrices();
    wrap(<PortfolioPage />);
    expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/No transactions yet/i)).toBeTruthy());
  });

  it('computes cost basis, unrealized P&L and total value from FIFO lots', async () => {
    withPrices();
    seed([
      { id: 't1', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 1, price: 100, fee: 0, at: 1000, venue: 'binance' },
      { id: 't2', coinId: 'ethereum', symbol: 'ETH', side: 'buy', amount: 10, price: 10, fee: 0, at: 1000, venue: 'kraken' }
    ]);
    wrap(<PortfolioPage />);

    // 1 BTC @200 + 10 ETH @40 = 600 value, 200 basis, +400 unrealized.
    await waitFor(() => expect(screen.getByText('$600.00')).toBeTruthy());
    expect(screen.getAllByText('$200.00').length).toBeGreaterThanOrEqual(1); // cost basis
    // Unrealized and Total P&L both read +400 (no realized P&L yet).
    expect(screen.getAllByText('+$400.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('+200.00%').length).toBeGreaterThanOrEqual(1); // ROI (tile + row)
    expect(screen.getByRole('button', { name: /Holdings CSV/i })).toBeTruthy();
  });

  it('migrates legacy holdings into transactions', async () => {
    withPrices();
    localStorage.setItem('cx_portfolio', JSON.stringify([{ coinId: 'bitcoin', amount: 2, buyPrice: 50 }]));
    wrap(<PortfolioPage />);

    // 2 BTC @200 = 400 value against a 100 basis (tile + row).
    await waitFor(() => expect(screen.getAllByText('$400.00').length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText('+300.00%').length).toBeGreaterThanOrEqual(1);
    // The legacy key is cleared once migrated.
    expect(localStorage.getItem('cx_portfolio')).toBeNull();
  });

  it('warns instead of silently accepting an oversell', async () => {
    withPrices();
    seed([
      { id: 't1', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 1, price: 100, at: 1000 },
      { id: 't2', coinId: 'bitcoin', symbol: 'BTC', side: 'sell', amount: 5, price: 200, at: 2000 }
    ]);
    wrap(<PortfolioPage />);
    await waitFor(() => expect(screen.getByText(/Cost-basis warnings/i)).toBeTruthy());
    expect(screen.getByText(/only 1 was held/i)).toBeTruthy();
  });

  it('renders every tab without crashing', async () => {
    withPrices();
    seed([{ id: 't1', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 1, price: 100, at: 1000, venue: 'binance' }]);
    wrap(<PortfolioPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Allocation/i })).toBeTruthy());

    for (const label of ['Allocation', 'Performance', 'Tax & Calendar', 'Risk', 'Wallets']) {
      screen.getByRole('button', { name: new RegExp(label) }).click();
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByText(new RegExp(label))).toBeTruthy());
    }
  });

  it('says plainly that it holds no keys and cannot sign', async () => {
    withPrices();
    wrap(<WalletLabPage />);
    expect(screen.getByRole('heading', { name: 'Wallet Lab' })).toBeTruthy();
    expect(screen.getByText(/not a wallet, and it cannot move funds/i)).toBeTruthy();
    // The custody policy must be visible without any interaction.
    expect(screen.getByText(/never ask for a seed phrase or private key/i)).toBeTruthy();
    expect(screen.getByText(/can sign or broadcast a transaction/i)).toBeTruthy();
  });

  it('renders every tab and never offers a signing action', async () => {
    withPrices();
    wrap(<WalletLabPage />);

    for (const label of ['Address check', 'Chains & paths', 'Gas & simulate', 'Approvals', 'Capabilities']) {
      screen.getByRole('button', { name: new RegExp(label) }).click();
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy());
    }

    // Capabilities tab must list the refused features explicitly.
    expect(screen.getAllByText('Not offered').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Swap')).toBeTruthy();
    expect(screen.getByText('WalletConnect')).toBeTruthy();
    expect(screen.getByText('Ledger / Trezor')).toBeTruthy();
  });

  it('validates an EVM address offline and flags a corrupted checksum', async () => {
    withPrices();
    // Keep the contract probe deterministic — no real RPC call.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' })
    })));
    wrap(<WalletLabPage />);
    screen.getByRole('button', { name: /Address check/i }).click();

    const input = await screen.findByPlaceholderText(/Paste the full address/i);
    fireEvent.change(input, { target: { value: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));

    await waitFor(() => expect(screen.getByText('Format accepted')).toBeTruthy());
    expect(screen.getAllByText(/checksum verified/i).length).toBeGreaterThanOrEqual(1);

    // Now corrupt the checksum case pattern.
    fireEvent.change(input, { target: { value: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }));
    await waitFor(() => expect(screen.getByText('Rejected')).toBeTruthy());
  });

  it('states that exchange API sync and wallet connect are unavailable', async () => {
    withPrices();
    seed([{ id: 't1', coinId: 'bitcoin', symbol: 'BTC', side: 'buy', amount: 1, price: 100, at: 1000 }]);
    wrap(<PortfolioPage />);
    screen.getByRole('button', { name: /Wallets/i }).click();
    await waitFor(() => expect(screen.getByText('Sync methods')).toBeTruthy());
    expect(screen.getByText('Exchange API sync')).toBeTruthy();
    expect(screen.getByText(/cannot hold exchange API keys safely/i)).toBeTruthy();
    expect(screen.getByText(/never asks for a seed phrase/i)).toBeTruthy();
  });
});
