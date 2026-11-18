import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* No database in tests: supabaseConfigured is false under `isTest`, so the page
   must degrade to an explanation rather than a composer that writes nowhere. */
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: null }) }));

import SocialPage from './Social.jsx';

const renderPage = () => render(<MemoryRouter><SocialPage /></MemoryRouter>);

describe('Social page', () => {
  it('states the schema findings it was built against', () => {
    renderPage();
    expect(screen.getByText(/Schema findings/i)).toBeInTheDocument();
  });

  it('names the followers-only defect rather than offering a control that lies', () => {
    renderPage();
    expect(screen.getByText(/Followers-only posts are readable by the author alone/i)).toBeInTheDocument();
    expect(screen.getByText(/never consults cx_user_follows/i)).toBeInTheDocument();
  });

  it('explains the missing database instead of showing an empty feed that looks like zero posts', () => {
    renderPage();
    expect(screen.getByText(/No database configured in this build/i)).toBeInTheDocument();
  });

  it('does not render a composer without a database', () => {
    renderPage();
    expect(screen.queryByLabelText(/Post body/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Submit for review/i })).toBeNull();
  });
});
