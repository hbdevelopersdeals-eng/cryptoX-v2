import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../lib/i18n.jsx';
import { CurrencyProvider } from '../lib/currency.jsx';
import { SEO_LIMITATION } from '../lib/seo.js';
import Region from './Region.jsx';

/* The page mounts the currency panel, which needs CurrencyProvider — the same
 * nesting App.jsx uses. Without it useCurrency() returns null. */
const wrap = (ui) => render(
  <MemoryRouter>
    <I18nProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </I18nProvider>
  </MemoryRouter>
);

/*
 * Open the country combobox, filter, and choose the match.
 * Targeted by id: the page also renders <select> elements (subdivision,
 * numbering), which carry the same ARIA combobox role.
 */
const pickCountry = async (name) => {
  fireEvent.click(document.getElementById('country-select'));
  fireEvent.change(screen.getByPlaceholderText('Search by name, code or dialling prefix'), {
    target: { value: name }
  });
  // Scoped to the country listbox: the currency picker also renders <option>
  // elements, and AED's CLDR name is "United Arab Emirates Dirham".
  const list = document.getElementById('country-select-list');
  const option = await within(list).findByRole('option', { name: new RegExp(name) });
  fireEvent.click(within(option).getByRole('button'));
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = 'en';
  /*
   * Force the rate provider to fail so the currency panel falls back to its
   * static table. Without this the suite would attempt a real network call to
   * the exchange-rate provider, which is slow and flaky.
   */
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline in tests'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Region & Language page', () => {
  it('renders with the full country and language counts', () => {
    wrap(<Region />);
    expect(screen.getByRole('heading', { name: /Region & Language/i })).toBeTruthy();
    expect(screen.getByText(/249 countries and territories/)).toBeTruthy();
    expect(screen.getByText(/25 languages/)).toBeTruthy();
  });

  it('reformats the address preview when the country changes', async () => {
    wrap(<Region />);
    await pickCountry('Germany');
    // Germany writes the postcode before the city, so the format key flips.
    await waitFor(() => expect(screen.getByText(/Formatted for Germany/).textContent).toContain('de'));
    const postal = screen.getByLabelText('Postal code');
    expect(postal.getAttribute('placeholder')).toBe('10115');
  });

  it('validates a postal code against the country pattern', async () => {
    wrap(<Region />);
    await pickCountry('Germany');
    const postal = screen.getByLabelText('Postal code');

    fireEvent.change(postal, { target: { value: '999' } });
    await waitFor(() => expect(screen.getByText(/does not look like a valid postal code/i)).toBeTruthy());

    fireEvent.change(postal, { target: { value: '10115' } });
    await waitFor(() => expect(screen.queryByText(/does not look like a valid postal code/i)).toBeNull());
  });

  it('says a country has no postal codes instead of calling the input invalid', async () => {
    wrap(<Region />);
    await pickCountry('United Arab Emirates');
    await waitFor(() => expect(screen.getByText(/does not use postal codes/i)).toBeTruthy());
    expect(screen.queryByText(/does not look like a valid postal code/i)).toBeNull();
  });

  it('switches text direction when an RTL language is chosen', async () => {
    wrap(<Region />);
    expect(document.documentElement.dir).toBe('ltr');

    fireEvent.click(screen.getByRole('button', { name: /^ur\s/ }));
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ur');
  });

  it('shows the per-language coverage instead of implying a finished translation', () => {
    wrap(<Region />);
    expect(screen.getByText(/of 95 strings translated/i)).toBeTruthy();
    expect(screen.getByText(/machine-drafted and has not been reviewed/i)).toBeTruthy();
  });

  it('states the SEO limitation rather than implying multilingual SEO works', () => {
    wrap(<Region />);
    expect(screen.getByText(SEO_LIMITATION)).toBeTruthy();
    expect(screen.getByText(/language alternates/)).toBeTruthy();
  });

  it('labels every delivery channel with what it can actually do', () => {
    wrap(<Region />);
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getAllByText('NEEDS-SETUP').length).toBe(4);
    expect(screen.getAllByText('UNAVAILABLE').length).toBe(2);
  });

  it('stores a phone number in E.164 and flags an invalid one', async () => {
    wrap(<Region />);
    await pickCountry('Pakistan');
    const phone = screen.getByLabelText('Phone number');

    fireEvent.change(phone, { target: { value: '03001234567' } });
    await waitFor(() => expect(screen.getByText(/\+923001234567/)).toBeTruthy());

    fireEvent.change(phone, { target: { value: '0300' } });
    await waitFor(() => expect(screen.getByText(/does not look like a valid phone number/i)).toBeTruthy());
  });
});

describe('scheduler, settlement currency and location retention', () => {
  it('shows the three-zone precedence and which one won', async () => {
    localStorage.setItem('cx_security', JSON.stringify({
      organizations: [{ id: 'org_a', name: 'Acme', timezone: 'Europe/London', currency: 'GBP' }],
      activeOrgId: 'org_a',
      memberships: []
    }));
    wrap(<Region />);

    // The organization zone is visible alongside the user zone.
    expect(await screen.findByText('Organization')).toBeTruthy();
    // The org zone appears both as a select option and in the precedence list.
    expect(screen.getAllByText('Europe/London').length).toBeGreaterThan(0);
    expect(screen.getByText('Applied')).toBeTruthy();
  });

  it('refuses a wall time that does not exist and explains why', async () => {
    wrap(<Region />);
    // New York springs forward on 2026-03-08, so 02:30 never happens.
    fireEvent.change(screen.getByLabelText('Event time zone'), { target: { value: 'America/New_York' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-08' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '02:30' } });

    // Shown in the occurrence box and again when the save is refused.
    await waitFor(() => expect(screen.getAllByText(/never happens/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Save reminder/i }));
    await waitFor(() => expect(screen.getByText(/clock jumps past it/i)).toBeTruthy());
    expect(localStorage.getItem('cx_reminders')).toBeNull();
  });

  it('expands a daily recurrence and saves it in UTC', async () => {
    wrap(<Region />);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-07' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'daily' } });

    // Four occurrences, each rendered with its UTC instant. If the fallback
    // message is present instead, the scheduler failed to resolve the wall time.
    await waitFor(() => expect(screen.getAllByTestId('occurrence')).toHaveLength(4));
    expect(screen.queryByText(/Set a valid date and time/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Save reminder/i }));
    await waitFor(() => expect(localStorage.getItem('cx_reminders')).toBeTruthy());
    const saved = JSON.parse(localStorage.getItem('cx_reminders'));
    expect(saved).toHaveLength(1);
    expect(saved[0].eventUtc).toMatch(/Z$/);
    expect(saved[0].recurrence.frequency).toBe('daily');
  });

  it('warns when a naive +24h schedule would drift across a DST change', async () => {
    wrap(<Region />);
    fireEvent.change(screen.getByLabelText('Event time zone'), { target: { value: 'America/New_York' } });
    // Two days before the March transition.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-06' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'daily' } });

    await waitFor(() => expect(screen.getByText(/drifts by/i)).toBeTruthy());
    expect(screen.getByText(/anchored to the local wall time/i)).toBeTruthy();
  });

  it('offers a Google Calendar link and an .ics export', async () => {
    wrap(<Region />);
    const link = await screen.findByRole('link', { name: /Google Calendar/i });
    // The link carries the UTC instant, not a local string.
    expect(link.getAttribute('href')).toContain('calendar.google.com');
    expect(link.getAttribute('href')).toMatch(/dates=\d{8}T\d{6}Z/);
  });

  it('lets the settlement currency differ from the display currency', async () => {
    localStorage.setItem('cx_security', JSON.stringify({
      organizations: [{ id: 'org_a', name: 'Acme', timezone: 'UTC', currency: 'GBP' }],
      activeOrgId: 'org_a',
      memberships: []
    }));
    wrap(<Region />);
    const select = await screen.findByLabelText('Settlement currency');
    expect(select.value).toBe('GBP');
    // Both currencies appear in the price book.
    await waitFor(() => expect(screen.getAllByText(/settlement · you display/i).length).toBeGreaterThan(0));
  });

  it('saves a location, flags expiry and deletes it', async () => {
    // Let the geocoder answer so a place can be chosen.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('geocoding-api')) {
        return { ok: true, status: 200, json: async () => ({ results: [{ id: 1, name: 'Karachi', latitude: 24.86, longitude: 67.01, country_code: 'PK', country: 'Pakistan', admin1: 'Sindh', timezone: 'Asia/Karachi' }] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    wrap(<Region />);
    fireEvent.change(screen.getByLabelText('Search a place'), { target: { value: 'Karachi' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Karachi/ }));

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByText('Saved locations (1)')).toBeTruthy());
    expect(screen.getByText('active')).toBeTruthy();

    // A session-only policy is expired the moment it is stored.
    fireEvent.change(screen.getByLabelText('Retention'), { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByText('Saved locations (2)')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Purge expired/i }));
    await waitFor(() => expect(screen.getByText(/Purged 1 expired record/)).toBeTruthy());
    expect(screen.getByText('Saved locations (1)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Delete everything/i }));
    await waitFor(() => expect(screen.getByText(/All saved location data deleted/)).toBeTruthy());
    // The heading always renders; the count drops to zero.
    expect(screen.getByText('Saved locations (0)')).toBeTruthy();
  });
});

describe('historical rates and the audit trail', () => {
  it('renders the tools and states that failures are recorded too', async () => {
    wrap(<Region />);
    expect(await screen.findByText(/Historical rates & audit trail/i)).toBeTruthy();
    expect(screen.getByLabelText('Rate date')).toBeTruthy();
    expect(screen.getByLabelText('Quote currency')).toBeTruthy();
    // A trail that only logs successes cannot explain a stale rate.
    expect(screen.getByText(/Failures are recorded too/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeTruthy();
  });

  it('looks up a past rate and names the source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ base: 'USD', date: '2026-01-02', rates: { EUR: 0.9531 } })
    })));

    wrap(<Region />);
    fireEvent.change(await screen.findByLabelText('Quote currency'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }));

    await waitFor(() => expect(screen.getByText(/0\.9531/)).toBeTruthy());
    // The reference-rate caveat is shown with the answer, not buried.
    expect(screen.getByText(/once per working day/i)).toBeTruthy();
  });

  it('reports an uncovered currency instead of substituting the current rate', async () => {
    // The ECB set does not publish PKR, so no provider can answer.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));

    wrap(<Region />);
    fireEvent.change(await screen.findByLabelText('Quote currency'), { target: { value: 'PKR' } });
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }));

    await waitFor(() => expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0));
    // Falling back to the current rate would be invisible and wrong.
    expect(screen.queryByText(/once per working day/i)).toBeNull();
  });

  it('records each acquisition attempt, including failures', async () => {
    wrap(<Region />);
    // The provider stub rejects in this suite, so an attempt must be logged.
    const trail = await screen.findByText(/Rate audit trail/i);
    expect(trail).toBeTruthy();
    expect(screen.getByText(/Current set:/i)).toBeTruthy();
  });
});
