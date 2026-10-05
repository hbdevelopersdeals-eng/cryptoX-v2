import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const candles = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 6 + i * 0.3;
  return { t: 1700000000000 + i * 3600000, o: c - 0.4, c, h: c + 1.2, l: c - 1.4, v: 100 + (i % 7) * 10 };
});

/* IMPORTANT: the mock must return a STABLE object identity.
 * The page loads candles in an effect that depends on `getKlines`; returning a
 * fresh object literal from useMarket() would hand it a new function on every
 * render, re-firing the effect forever and hanging the test run. */
const market = vi.hoisted(() => ({
  klines: [],
  api: {
    rows: [],
    bySymbol: {},
    getKlines: () => Promise.resolve({ candles: [], source: 'binance' }),
    feed: { simulated: false }
  }
}));

market.api.getKlines = () => Promise.resolve({ candles: market.klines, source: 'binance' });

vi.mock('../lib/market.jsx', () => ({ useMarket: () => market.api }));

import ChartingPage from './Charting.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const optionNames = (select) => within(select).getAllByRole('option').map((o) => o.textContent);

beforeEach(() => {
  localStorage.clear();
  market.klines = candles;
  // Stable identity across renders — see the note above.
  market.api.rows = [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 132, mcap: 1e12 }];
  market.api.bySymbol = { BTC: { id: 'bitcoin', symbol: 'BTC', price: 132 } };
  market.api.feed = { simulated: false };
});

describe('Professional Charting page — Section 3 coverage', () => {
  it('offers every chart type the checklist names, including the derived ones', async () => {
    wrap(<ChartingPage />);
    const select = await screen.findByLabelText('Chart type');
    const names = optionNames(select);

    ['Candlestick', 'Hollow candles', 'Heikin Ashi', 'Line', 'Area', 'Baseline']
      .forEach((n) => expect(names, n).toContain(n));
    // The transforms that used to be library-only must now be selectable.
    ['Renko', 'Range bars'].forEach((n) => expect(names, n).toContain(n));
    ['Kagi', 'Point & Figure', 'Market profile'].forEach((n) => expect(names, n).toContain(n));
  });

  it('routes Kagi, Point & Figure and market profile to the alternate renderer', async () => {
    wrap(<ChartingPage />);
    const select = await screen.findByLabelText('Chart type');

    fireEvent.change(select, { target: { value: 'kagi' } });
    await waitFor(() => expect(screen.getByRole('img', { name: /Kagi chart/i })).toBeTruthy());

    fireEvent.change(select, { target: { value: 'pnf' } });
    await waitFor(() => expect(screen.getByRole('img', { name: /Point & Figure chart/i })).toBeTruthy());

    fireEvent.change(select, { target: { value: 'mprofile' } });
    await waitFor(() => expect(screen.getByRole('img', { name: /Market profile chart/i })).toBeTruthy());
  });

  it('exposes linear, log and percentage scales', async () => {
    wrap(<ChartingPage />);
    const scale = await screen.findByLabelText('Scale');
    const names = optionNames(scale);
    expect(names).toContain('Linear scale');
    expect(names).toContain('Log scale');
    expect(names).toContain('Percent scale');
  });

  it('offers the overlay and study-panel indicator set', async () => {
    wrap(<ChartingPage />);
    await screen.findByLabelText('Chart type');
    // Overlays are checkboxes.
    ['SMA', 'EMA', 'WMA', 'Bollinger', 'Ichimoku', 'Supertrend'].forEach((label) => {
      expect(screen.getAllByText(label).length, label).toBeGreaterThanOrEqual(1);
    });
    // Studies are a dropdown.
    const studies = optionNames(await screen.findByLabelText('Study panel'));
    ['RSI', 'MACD', 'ATR', 'ADX', 'OBV', 'Stochastic'].forEach((n) => {
      expect(studies.some((s) => s.startsWith(n)), n).toBe(true);
    });
  });

  it('keeps the drawing-tool palette wired up', async () => {
    wrap(<ChartingPage />);
    await screen.findByLabelText('Chart type');
    ['Trend line', 'Ray', 'Horizontal', 'Fibonacci', 'Rectangle', 'Measure']
      .forEach((t) => expect(screen.getByRole('button', { name: t }), t).toBeTruthy());
  });

  it('renders the indicator marketplace with installable presets', async () => {
    wrap(<ChartingPage />);
    await waitFor(() => expect(screen.getByText('Indicator marketplace')).toBeTruthy());
    // The honest scope note must be present, not buried.
    expect(screen.getByText(/local registry, not live popularity/i)).toBeTruthy();
    const installs = screen.getAllByRole('button', { name: /Install/i });
    expect(installs.length).toBeGreaterThanOrEqual(10);
  });

  it('installs a preset and reflects it as installed', async () => {
    wrap(<ChartingPage />);
    const installs = await screen.findAllByRole('button', { name: /Install/i });
    fireEvent.click(installs[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Installed/i }).length).toBeGreaterThanOrEqual(1));
  });

  it('renders the user-created indicator builder with a live preview', async () => {
    wrap(<ChartingPage />);
    await waitFor(() => expect(screen.getByText(/Create your own indicator/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Add to my indicators/i })).toBeTruthy();
    // With candles loaded the preview resolves against real bars.
    await waitFor(() => expect(screen.getByText(/latest/i)).toBeTruthy());
  });
});
