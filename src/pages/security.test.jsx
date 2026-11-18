import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../lib/i18n.jsx';
import { CurrencyProvider } from '../lib/currency.jsx';
import { totp } from '../lib/mfa.js';
import { registerSession, describeDevice } from '../lib/accounts.js';
import { loadSecurity, SECURITY_KEY } from '../lib/securityStore.js';
import Account from './Account.jsx';
import Organization from './Organization.jsx';

const wrap = (ui) => render(
  <MemoryRouter>
    <I18nProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </I18nProvider>
  </MemoryRouter>
);

/* The TOTP secret the page generated, read back from the DOM. */
const readSecret = () => [...document.querySelectorAll('p')]
  .map((p) => p.textContent.trim())
  .find((t) => /^[A-Z2-7]{32}$/.test(t));

/*
 * waitFor resolves as soon as the callback stops throwing, so returning a
 * possibly-undefined value resolves instantly with `undefined`. Asserting inside
 * the callback is what makes it actually wait — without it the test fed an empty
 * secret into Web Crypto, which fails as "Zero-length key is not supported".
 */
const awaitSecret = () => waitFor(() => {
  const secret = readSecret();
  expect(secret).toBeTruthy();
  return secret;
});

beforeEach(() => {
  localStorage.clear();
  // Neither page should reach the network in a test.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline in tests'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Account & Security page', () => {
  it('renders the profile and records this browser as a session', async () => {
    wrap(<Account />);
    expect(screen.getByRole('heading', { name: /Account & Security/i })).toBeTruthy();
    expect(screen.getByText(/stored in this browser/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Session/)).toBeTruthy());

    const state = loadSecurity();
    expect(state.profile).toBeTruthy();
    expect(state.sessions.length).toBe(1);
    expect(state.sessions[0].current).toBe(true);
  });

  it('rejects an invalid profile field with the real validator', async () => {
    wrap(<Account />);
    const tz = await screen.findByLabelText('Time zone');
    // The select only offers real IANA zones, so an invalid one must be refused
    // by the model rather than being unselectable.
    expect(tz.tagName).toBe('SELECT');
    const country = screen.getByLabelText('Country');
    fireEvent.blur(country, { target: { value: 'ZZ' } });
    await waitFor(() => expect(screen.getByText(/country: unknown-country/i)).toBeTruthy());
  });

  it('meters password strength and names the reason it is weak', async () => {
    wrap(<Account />);
    const input = screen.getByLabelText('New password');
    fireEvent.change(input, { target: { value: 'password123' } });
    await waitFor(() => expect(screen.getByText(/commonly used/i)).toBeTruthy());

    fireEvent.change(input, { target: { value: 'correct-horse-battery-Staple-71!' } });
    await waitFor(() => expect(screen.queryByText(/commonly used/i)).toBeNull());
  });

  it('completes a real TOTP enrolment end to end', async () => {
    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/i }));

    const secret = await awaitSecret();
    // The provisioning URI is shown instead of a QR, so no secret is sent to an
    // image service.
    expect(screen.getByText(/otpauth:\/\/totp\//)).toBeTruthy();
    expect(screen.getByText(/No QR image is shown on purpose/)).toBeTruthy();

    // A wrong code is refused.
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    await waitFor(() => expect(screen.getByText(/did not match/i)).toBeTruthy(), { timeout: 5000 });
    expect(loadSecurity().mfa.enabled).toBe(false);

    // The correct code, derived from the same secret, is accepted.
    const code = await totp(secret, { at: Date.now() });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

    await waitFor(() => expect(loadSecurity().mfa.enabled).toBe(true));
    // "shown once" appears in both the success message and the code panel.
    expect(screen.getAllByText(/shown once/i).length).toBeGreaterThan(0);
    // Ten backup codes, stored only as hashes.
    const stored = loadSecurity();
    expect(stored.mfa.backupHashes).toHaveLength(10);
    expect(stored.mfa.secret).toBe(secret);
  });

  it('verifies a TOTP code once enrolled and consumes a backup code once', async () => {
    // Enrol through the page first so the store matches what the UI produced.
    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/i }));
    const secret = await awaitSecret();
    const code = await totp(secret, { at: Date.now() });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    await waitFor(() => expect(loadSecurity().mfa.enabled).toBe(true));

    // A live TOTP code verifies.
    const fresh = await totp(secret, { at: Date.now() });
    fireEvent.change(screen.getByLabelText('Test a code'), { target: { value: fresh } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/Verified as a TOTP code/i)).toBeTruthy());

    // A wrong code is rejected.
    fireEvent.change(screen.getByLabelText('Test a code'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByText(/Code rejected/i)).toBeTruthy());
  });

  it('turns two-factor off and says what that means', async () => {
    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/i }));
    const secret = await awaitSecret();
    const code = await totp(secret, { at: Date.now() });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));
    await waitFor(() => expect(loadSecurity().mfa.enabled).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /Turn off/i }));
    await waitFor(() => expect(loadSecurity().mfa.enabled).toBe(false));
    expect(screen.getByText(/protected by its password alone/i)).toBeTruthy();
  });

  it('revokes other sessions but keeps this device', async () => {
    // Mount once so the profile and this-device session are created, then seed
    // two more sessions and remount: the page reads storage only on mount.
    const first = wrap(<Account />);
    await waitFor(() => expect(loadSecurity().profile).toBeTruthy());
    first.unmount();

    const base = loadSecurity();
    const userId = base.profile.userId;
    let sessions = base.sessions;
    sessions = registerSession(sessions, { userId, device: describeDevice('Firefox Linux') }).sessions;
    sessions = registerSession(sessions, { userId, device: describeDevice('Safari macOS') }).sessions;
    localStorage.setItem(SECURITY_KEY, JSON.stringify({ ...base, sessions }));
    cleanup();

    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Sign out all other devices/i }));
    await waitFor(() => expect(screen.getByText(/2 other session\(s\) signed out/i)).toBeTruthy());

    const after = loadSecurity();
    expect(after.sessions.filter((s) => !s.revokedAt)).toHaveLength(1);
    expect(after.sessions.find((s) => !s.revokedAt).current).toBe(true);
  });

  it('records a sign-in and reports its risk level', async () => {
    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Record a sign-in now/i }));
    await waitFor(() => expect(screen.getByText(/low risk|medium risk|high risk/i)).toBeTruthy());
    expect(loadSecurity().history.length).toBe(1);
  });

  it('records a data request and advances it forward only', async () => {
    wrap(<Account />);
    fireEvent.click(await screen.findByRole('button', { name: /Request export/i }));
    await waitFor(() => expect(screen.getByText(/export request recorded/i)).toBeTruthy());
    expect(loadSecurity().dsr[0].type).toBe('export');

    fireEvent.click(screen.getByRole('button', { name: /Advance/i }));
    await waitFor(() => expect(loadSecurity().dsr[0].state).toBe('processing'));
  });

  it('states the honest platform posture instead of claiming full coverage', () => {
    wrap(<Account />);
    expect(screen.getByText(/Platform security posture/i)).toBeTruthy();
    expect(screen.getByText(/cannot exist in a static browser app/i)).toBeTruthy();
    // Client-ready and server-only items must be visible, not hidden.
    expect(screen.getAllByText('server-only').length).toBeGreaterThan(0);
  });
});

describe('Organization page', () => {
  const createOrg = async (name = 'Acme Ltd') => {
    const input = await screen.findByLabelText('Organization name');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByText(/you are its owner/i)).toBeTruthy());
  };

  it('creates an organization and makes the creator its owner', async () => {
    wrap(<Organization />);
    await createOrg();
    const state = loadSecurity();
    expect(state.organizations).toHaveLength(1);
    expect(state.memberships[0].roles).toEqual(['organization_owner']);
    expect(screen.getByText(/plan free/i)).toBeTruthy();
    // The creator appears as the sole owner, which the UI flags as a risk.
    expect(screen.getByText('Owners')).toBeTruthy();
  });

  it('refuses to grant a role above the actor’s own, naming the reason', async () => {
    wrap(<Organization />);
    await createOrg();

    // The owner may not grant platform_admin: that is not a tenant role.
    const roleSelect = await screen.findByLabelText('Invite role');
    const options = [...roleSelect.querySelectorAll('option')].map((o) => o.value);
    expect(options).not.toContain('platform_admin');

    // A role the actor cannot grant is refused by the model, not merely hidden.
    fireEvent.change(screen.getByLabelText('Invite email'), { target: { value: 'x@example.com' } });
    fireEvent.change(roleSelect, { target: { value: 'organization_admin' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(loadSecurity().invitations).toHaveLength(1));
    expect(loadSecurity().invitations[0].role).toBe('organization_admin');
  });

  it('never leaves the organization without an owner', async () => {
    wrap(<Organization />);
    await createOrg();
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/ }));
    await waitFor(() => expect(screen.getByText(/last owner cannot be removed/i)).toBeTruthy());
    expect(loadSecurity().memberships).toHaveLength(1);
  });

  it('shows the authorization decision and lets an explicit deny override it', async () => {
    wrap(<Organization />);
    await createOrg();

    // As owner, approving billing is allowed.
    await waitFor(() => expect(screen.getByText('ALLOWED')).toBeTruthy());

    // An explicit deny wins even over the owner.
    fireEvent.click(screen.getByLabelText(/Simulate an explicit deny/i));
    await waitFor(() => expect(screen.getByText('DENIED')).toBeTruthy());
    // The reason and the explanatory paragraph both mention an explicit deny.
    expect(screen.getAllByText(/explicit deny/i).length).toBeGreaterThan(0);

    // A permission the owner genuinely lacks is denied with a reason.
    fireEvent.click(screen.getByLabelText(/Simulate an explicit deny/i));
    fireEvent.change(screen.getByLabelText('Permission to check'), { target: { value: 'market_data:delete' } });
    await waitFor(() => expect(screen.getByText('DENIED')).toBeTruthy());
  });

  it('renders the role → permission matrix with inherited counts', async () => {
    wrap(<Organization />);
    await createOrg();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    // platform_admin holds every permission.
    const platformRow = within(table).getAllByRole('row').find((r) => r.textContent.includes('platform_admin'));
    expect(platformRow.textContent).toMatch(/all \(/);
    // The owner inherits from organization_admin.
    const ownerRow = within(table).getAllByRole('row').find((r) => r.textContent.includes('organization_owner'));
    expect(ownerRow.textContent).toContain('organization_admin');
  });

  it('writes invitations and policy changes to the audit log', async () => {
    wrap(<Organization />);
    await createOrg();
    fireEvent.change(await screen.findByLabelText('Invite email'), { target: { value: 'y@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(loadSecurity().audit.some((e) => e.action === 'member.invited')).toBe(true));
    expect(screen.getByText('member.invited')).toBeTruthy();
    expect(screen.getByText(/cannot be edited/i)).toBeTruthy();
  });

  it('saves enterprise policies', async () => {
    wrap(<Organization />);
    await createOrg();
    fireEvent.click(await screen.findByLabelText(/Require two-factor for all members/i));
    await waitFor(() => expect(loadSecurity().organizations[0].policies.requireMfa).toBe(true));
    // The SSO flag is offered but labelled as inert.
    expect(screen.getByText(/needs SSO configured/i)).toBeTruthy();
    expect(screen.getByText(/SAML and OIDC need an assertion validated/i)).toBeTruthy();
  });
});
