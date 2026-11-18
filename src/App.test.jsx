import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import { lsSet } from './lib/storage.js';

/* Integrated render smoke test: mounts the REAL app tree (providers, router,
 * shell, lazy pages) against a mocked market feed. This is the automated
 * equivalent of the manual "does the published build actually render" check,
 * and it catches the class of bug that previously reached production
 * (a render crash on the coin page). */

const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

const MARKETS = [
  {
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://assets.example/btc.png', market_cap_rank: 1,
    current_price: 60000, price_change_percentage_24h_in_currency: 1.5, price_change_percentage_7d_in_currency: 3.2,
    market_cap: 1.2e12, total_volume: 3.1e10, sparkline_in_7d: { price: [58000, 59000, 60000] }
  },
  {
    id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://assets.example/eth.png', market_cap_rank: 2,
    current_price: 2500, price_change_percentage_24h_in_currency: -0.8, price_change_percentage_7d_in_currency: 1.1,
    market_cap: 3e11, total_volume: 1.4e10, sparkline_in_7d: { price: [2450, 2480, 2500] }
  },
  {
    id: 'solana', symbol: 'sol', name: 'Solana', image: 'https://assets.example/sol.png', market_cap_rank: 5,
    current_price: 150, price_change_percentage_24h_in_currency: 4.4, price_change_percentage_7d_in_currency: 9.9,
    market_cap: 7e10, total_volume: 4e9, sparkline_in_7d: { price: [140, 145, 150] }
  }
];

const KLINES = Array.from({ length: 120 }, (_, i) => {
  const base = 60000 + i * 25;
  return [Date.UTC(2026, 0, 1) + i * 3600e3, String(base), String(base * 1.004), String(base * 0.996), String(base * 1.002), '12.5'];
});

let originalFetch;

function mockFeed() {
  global.fetch = (url) => {
    const u = String(url);
    if (u.includes('coins/markets')) return json(MARKETS);
    if (u.includes('/global')) return json({ data: { total_market_cap: { usd: 2.3e12 }, total_volume: { usd: 8e10 }, market_cap_percentage: { btc: 52.5 } } });
    if (u.includes('klines')) return json(KLINES);
    if (u.includes('alternative.me')) return json({ data: [{ value: '61', value_classification: 'Greed', timestamp: '1789000000' }] });
    if (u.includes('status_updates')) return json({ status_updates: [] });
    return json({});
  };
}

beforeEach(() => {
  originalFetch = global.fetch;
  localStorage.clear();
  mockFeed();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('App integration', () => {
  it('serves the marketing page — not the login wall — to a signed-out visitor at "/"', async () => {
    render(<App />);
    // "/" is the URL a crawler and an AI answer are most likely to open, so it
    // has to carry the product story. Regression guard: it used to be a redirect
    // to /login, which made the homepage a soft 404.
    // The auth provider resolves its session asynchronously, so the first paint
    // is the "Loading…" fallback. The default 1s findBy timeout is tight when
    // the whole suite is running on a loaded machine.
    expect(await screen.findByRole('heading', { name: /every number shows its source/i }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /log in/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull(); // no error boundary
    /* 15s, because this test renders the WHOLE app tree and waits on the
     * provider's async session resolution. The 8s `findByRole` above is larger
     * than vitest's 5s default, so under load the test timed out waiting for a
     * query that had not finished — a red gate that measured the machine, not
     * the code. The timeout lives on the test, not on the assertion, so a real
     * regression still fails; it just gets 15s to do it. */
  }, 15000);

  it('still sends a signed-out deep link to the login screen', async () => {
    window.history.pushState({}, '', '/strategies');
    render(<App />);
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log in/i })).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it('renders the market dashboard for a signed-in user with live data', async () => {
    lsSet('cx_session_v2', { email: 'qa@cryptox.app', at: Date.now(), exp: Date.now() + 3600e3, last: Date.now() });
    render(<App />);

    // "Crypto Market" appears in both the page heading and the shell topbar
    await waitFor(
      () => expect(screen.getAllByRole('heading', { name: /Crypto Market/i }).length).toBeGreaterThan(0),
      { timeout: 8000 }
    );
    ['Market Cap', 'BTC Dominance', '24h Volume'].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });

    // rows render from the mocked feed (names repeat across table/movers/marquee)
    await waitFor(() => expect(screen.getAllByText('Bitcoin').length).toBeGreaterThan(0), { timeout: 8000 });
    expect(screen.getAllByText('Ethereum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Top Gainers').length).toBeGreaterThan(0);

    // no render error escaped to the boundary
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('serves the legal documents publicly', async () => {
    // Path routing, not the old `#/legal/privacy` hash: that hash used to match
    // the consent banner's "privacy notice" text and pass for the wrong reason.
    window.history.pushState({}, '', '/legal/privacy');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /Privacy Notice/i })).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });
});
