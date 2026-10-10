import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  AuthProvider, useAuth, validateEmail, validatePassword,
  hashPassword, verifyPassword, PBKDF2_ITERATIONS
} from './auth.jsx';

function Probe({ expose }) {
  expose.current = useAuth();
  return null;
}

function mountAuth() {
  const expose = { current: null };
  render(
    <AuthProvider>
      <Probe expose={expose} />
    </AuthProvider>
  );
  return expose;
}

const EMAIL = 'trader@example.com';
const PASSWORD = 'Passw0rd1';

beforeEach(() => {
  localStorage.clear();
});

describe('validateEmail', () => {
  it('accepts normal addresses and normalises case', () => {
    const res = validateEmail('  Trader@Example.COM ');
    expect(res.ok).toBe(true);
    expect(res.email).toBe('trader@example.com');
  });
  it('rejects malformed addresses', () => {
    ['', 'a@b', 'no-at-sign', 'a b@c.com', 'x@y.z'].forEach((bad) => {
      expect(validateEmail(bad).ok).toBe(false);
    });
  });
});

describe('validatePassword', () => {
  it('enforces length, letters, digits and a weak-password blocklist', () => {
    expect(validatePassword('short1').ok).toBe(false);
    expect(validatePassword('alllettersonly').ok).toBe(false);
    expect(validatePassword('1234567890').ok).toBe(false);
    expect(validatePassword('password').ok).toBe(false);
    expect(validatePassword('cryptox123').ok).toBe(false);
    expect(validatePassword(PASSWORD).ok).toBe(true);
  });
});

describe('password hashing', () => {
  it('never stores the plaintext and verifies correctly', async () => {
    const rec = await hashPassword(PASSWORD);
    expect(rec.alg).toBe('PBKDF2-SHA256');
    expect(rec.iter).toBe(PBKDF2_ITERATIONS);
    expect(JSON.stringify(rec)).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, rec)).toBe(true);
    expect(await verifyPassword('wrong-password1', rec)).toBe(false);
  });

  it('uses a unique salt per credential', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects malformed records instead of throwing', async () => {
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
    expect(await verifyPassword(PASSWORD, { salt: 'x' })).toBe(false);
  });
});

describe('AuthProvider lifecycle', () => {
  it('registers, requires verification, then signs the user in', async () => {
    const expose = mountAuth();
    let res;
    await act(async () => {
      res = await expose.current.register(EMAIL, PASSWORD);
    });
    expect(res.ok).toBe(true);
    expect(res.needVerify).toBe(true);
    expect(expose.current.session).toBeNull();
    expect(expose.current.inbox?.email).toBe(EMAIL);

    const code = expose.current.inbox.code;
    await act(async () => {
      res = await expose.current.verifyEmail(EMAIL, code);
    });
    expect(res.ok).toBe(true);
    expect(expose.current.session?.email).toBe(EMAIL);
  });

  it('rejects a wrong verification code', async () => {
    const expose = mountAuth();
    await act(async () => {
      await expose.current.register(EMAIL, PASSWORD);
    });
    let res;
    await act(async () => {
      res = await expose.current.verifyEmail(EMAIL, '000000');
    });
    expect(res.ok).toBe(false);
  });

  it('signs out, then refuses a bad password and accepts a good one', async () => {
    const expose = mountAuth();
    await act(async () => { await expose.current.register(EMAIL, PASSWORD); });
    await act(async () => { await expose.current.verifyEmail(EMAIL, expose.current.inbox.code); });
    await act(async () => { expose.current.logout(); });
    expect(expose.current.session).toBeNull();

    let res;
    await act(async () => { res = await expose.current.login(EMAIL, 'WrongPass1'); });
    expect(res.ok).toBe(false);

    await act(async () => { res = await expose.current.login(EMAIL, PASSWORD); });
    expect(res.ok).toBe(true);
    expect(expose.current.session?.email).toBe(EMAIL);
  });

  it('locks the account after repeated failures', async () => {
    const expose = mountAuth();
    await act(async () => { await expose.current.register(EMAIL, PASSWORD); });
    await act(async () => { await expose.current.verifyEmail(EMAIL, expose.current.inbox.code); });
    await act(async () => { expose.current.logout(); });

    let last;
    for (let i = 0; i < 5; i++) {
      await act(async () => { last = await expose.current.login(EMAIL, 'WrongPass1'); });
    }
    expect(last.ok).toBe(false);

    let locked;
    await act(async () => { locked = await expose.current.login(EMAIL, PASSWORD); });
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/Too many failed attempts/i);
    // This test performs ~7 PBKDF2 verifications at 210,000 iterations each —
    // roughly 1.7M iterations of real work. That legitimately exceeds the 5s
    // default under load, and a timeout here also cascades into the next test,
    // which then gets a null hook. The assertion is right; the budget was not.
  }, 45_000);

  it('does not reveal whether an email exists', async () => {
    const expose = mountAuth();
    let res;
    await act(async () => { res = await expose.current.login('nobody@example.com', PASSWORD); });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid email or password');
  });
});
