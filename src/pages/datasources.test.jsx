import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Stable identity: the panel loads quotes in an effect that depends on the
 * fetch fn, so a fresh object per render would loop forever. */
const venues = vi.hoisted(() => ({ results: [] }));
vi.mock('../lib/sources.js', () => ({
  fetchAllVenues: () => Promise.resolve(venues.results),
  SUPPORTED_VENUES: ['binance', 'coinbase', 'kraken']
}));

import DataSourcesPage from './DataSources.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const NOW = Date.now();

beforeEach(() => {
  localStorage.clear();
  venues.results = [
    { venueId: 'binance', name: 'Binance', status: 'live', latencyMs: 90, quotes: [
      { venue: 'binance', assetId: 'bitcoin', symbol: 'BTC', price: 100000, volumeQuote: 5000000, ts: NOW },
      { venue: 'binance', assetId: 'ethereum', symbol: 'ETH', price: 4000, volumeQuote: 2000000, ts: NOW }
    ] },
    { venueId: 'coinbase', name: 'Coinbase', status: 'live', latencyMs: 120, quotes: [
      { venue: 'coinbase', assetId: 'bitcoin', symbol: 'BTC', price: 100050, volumeQuote: 1000000, ts: NOW }
    ] },
    { venueId: 'kraken', name: 'Kraken', status: 'error', latencyMs: null, error: 'blocked', quotes: [] }
  ];
});

describe('Market Data page — Section 4 coverage', () => {
  it('renders the source registry with live and licence-gated counts', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    // Registry summary counts must be present.
    expect(screen.getByText(/licence-gated/i)).toBeTruthy();
  });

  it('lists every source with a kind, licence and status', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    // A representative spread across the categories the spec names.
    ['Binance', 'Coinbase', 'Deribit', 'DexScreener', 'CoinGecko', 'Blockstream Esplora'].forEach((n) => {
      expect(screen.getAllByText(n).length, n).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('unavailable').length).toBeGreaterThanOrEqual(1);
  });

  it('declares the licence gaps with a reason rather than hiding them', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Gaps & licences' }));
    // "not carried" wraps "not" in a <b>, so match the parent's textContent.
    await waitFor(() => expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && /not\s+carried/i.test(el.textContent || ''))
    ).toBeTruthy());
    expect(screen.getByText('CME Group')).toBeTruthy();
    expect(screen.getByText('CoinMarketCap')).toBeTruthy();
    // Present in the registry entry and in the footer note.
    expect(screen.getAllByText(/Licensed institutional feeds/).length).toBeGreaterThanOrEqual(1);
    // Each gap must carry its own explanation.
    expect(screen.getByText(/data agreement/i)).toBeTruthy();
  });

  it('documents identifier spaces and the normalisation contract', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'IDs & normalisation' }));
    await waitFor(() => expect(screen.getByText(/Identifier spaces/i)).toBeTruthy());
    ['Asset IDs', 'Exchange IDs', 'Chain IDs', 'Contract addresses', 'Venue symbols'].forEach((l) => {
      expect(screen.getByText(l), l).toBeTruthy();
    });
    expect(screen.getByText(/Normalised quote contract/i)).toBeTruthy();
    expect(screen.getByText('nativeSymbol')).toBeTruthy();
    expect(screen.getByText('venue')).toBeTruthy();
  });

  it('computes the CX-Index composite from quality-gated venue quotes', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'CX-Index' }));

    await waitFor(() => expect(screen.getByText(/proprietary composite/i)).toBeTruthy());
    // Two assets survive; the errored venue contributes nothing.
    await waitFor(() => expect(screen.getAllByText('BTC').length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText('ETH').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/confidence/i).length).toBeGreaterThanOrEqual(1);
    // It must disclaim being an investable index.
    expect(screen.getByText(/not an investable index/i)).toBeTruthy();
  });

  it('still reports a blocked venue as down rather than inventing a price', async () => {
    wrap(<DataSourcesPage />);
    await waitFor(() => expect(screen.getByText('Source registry')).toBeTruthy());
    expect(screen.getAllByText(/down/i).length).toBeGreaterThanOrEqual(1);
  });
});
