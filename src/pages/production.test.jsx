import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* The production pages read market and session state but never own it. */
const market = vi.hoisted(() => ({
  rows: [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 64000, mcap: 1.2e12, source: 'coingecko' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, price: 3200, mcap: 3.8e11, source: 'coingecko' }
  ],
  byId: {},
  conn: { ws: 'live', cg: 'live', stale: false, lastTickAt: Date.now() },
  feed: { simulated: false, level: 'live' }
}));

vi.mock('../lib/market.jsx', () => ({ useMarket: () => market }));
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: { id: 'u_test', email: 'test@example.com' } }) }));
vi.mock('../lib/sources.js', () => ({ SUPPORTED_VENUES: ['binance', 'kraken'], fetchAllVenues: () => Promise.resolve([]) }));

import SearchPage from './Search.jsx';
import CopyTradingPage from './CopyTrading.jsx';
import LaunchpadPage from './Launchpad.jsx';
import AcademyPage from './Academy.jsx';
import ReferralPage from './Referral.jsx';
import AdminPage from './Admin.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
});

describe('Search page', () => {
  it('states how much of the index is populated', () => {
    wrap(<SearchPage />);
    expect(screen.getByText(/Indexed \d+ records across 5 of 15 categories/i)).toBeInTheDocument();
  });

  it('finds a coin by symbol and reports no match honestly', () => {
    wrap(<SearchPage />);
    const input = screen.getByLabelText(/Search coins, exchanges/i);
    fireEvent.change(input, { target: { value: 'BTC' } });
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zzzzzz' } });
    expect(screen.getByText(/Nothing in the index matches that/i)).toBeInTheDocument();
  });
});

describe('Copy trading page', () => {
  it('turns percentages into absolute caps', () => {
    wrap(<CopyTradingPage />);
    // 10,000 equity × 20% = 2,000 allocated; 25% of that is the 500 loss cap.
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });

  it('refuses an allocation above equity', () => {
    wrap(<CopyTradingPage />);
    fireEvent.change(screen.getByLabelText(/Percentage of equity allocated/i), { target: { value: '150' } });
    expect(screen.getByText(/Plan refused/i)).toBeInTheDocument();
  });

  it('labels a self-reported record as unverified with reasons', () => {
    wrap(<CopyTradingPage />);
    expect(screen.getByText(/Self-reported — not verified/i)).toBeInTheDocument();
    expect(screen.getByText(/not reconcilable by CryptoX/i)).toBeInTheDocument();
  });
});

describe('Launchpad page', () => {
  it('reports missing required fields rather than silently accepting', () => {
    wrap(<LaunchpadPage />);
    expect(screen.getByText(/field\(s\) need attention/i)).toBeInTheDocument();
  });

  it('sums the default tokenomics to 100%', () => {
    wrap(<LaunchpadPage />);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('pro-rates an oversubscribed round and reports the remainder', () => {
    wrap(<LaunchpadPage />);
    // Default cap 500,000 against 700,000 requested: oversubscribed at 71.4%.
    expect(screen.getByText(/Oversubscribed — filled at 71\.4%/i)).toBeInTheDocument();
  });
});

describe('Academy page', () => {
  it('lists the catalogue and a quiz', () => {
    wrap(<AcademyPage />);
    expect(screen.getByText('Five tracks, each lesson linked to the screen where you practise it. Quizzes are graded in the browser and the certificate says exactly what that means.')).toBeInTheDocument();
    expect(screen.getByText(/80% to pass/)).toBeInTheDocument();
  });

  it('grades a wrong answer set as below the pass mark', () => {
    wrap(<AcademyPage />);
    fireEvent.click(screen.getByText('Submit answers'));
    expect(screen.getByText(/below the pass mark/i)).toBeInTheDocument();
  });
});

describe('Referral page', () => {
  it('derives a code and a registration link from the session', () => {
    wrap(<ReferralPage />);
    const link = screen.getByLabelText(/Your referral link/i);
    expect(link.value).toContain('/register?ref=CX');
  });

  it('shows every tier', () => {
    wrap(<ReferralPage />);
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });
});

describe('Admin page', () => {
  it('reports live feed health from the market engine', () => {
    wrap(<AdminPage />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('names the sections it cannot read without a service role', () => {
    wrap(<AdminPage />);
    expect(screen.getByText(/Sections this session cannot read/i)).toBeInTheDocument();
    expect(screen.getByText(/Revenue & fees:/)).toBeInTheDocument();
  });

  it('refuses to record a change without a reason', () => {
    wrap(<AdminPage />);
    fireEvent.change(screen.getByLabelText(/Taker fee \(bps\)/i), { target: { value: '12' } });
    const button = screen.getByRole('button', { name: /Record change/i });
    expect(button).toBeDisabled();
  });
});
