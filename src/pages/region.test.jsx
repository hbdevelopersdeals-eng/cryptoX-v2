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
