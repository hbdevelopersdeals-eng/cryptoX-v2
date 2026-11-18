import { describe, it, expect, vi } from 'vitest';
import { canRegister, swVersion, registerServiceWorker, activateUpdate } from './pwa.js';

/* The worker is only useful if three things hold: it is registered at all, its
 * cache name changes with the build, and an update waits for the user instead of
 * reloading under them. Each is a test here because each has been wrong before.
 */

/** A fake registration good enough for the registration flow. */
function fakeNav({ waiting = null, fail = false } = {}) {
  const registration = {
    waiting,
    installing: null,
    addEventListener: vi.fn()
  };
  return {
    registration,
    serviceWorker: {
      register: vi.fn(async () => {
        if (fail) throw new Error('blocked');
        return registration;
      })
    }
  };
}

describe('swVersion', () => {
  it('changes when either the version or the stamp changes', () => {
    const a = swVersion({ version: '1.0.0', stamp: 'abc' });
    const b = swVersion({ version: '1.0.0', stamp: 'def' });
    const c = swVersion({ version: '1.0.1', stamp: 'abc' });
    expect(a).toBe('cx-1.0.0-abc');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('strips characters that would break a cache key', () => {
    expect(swVersion({ version: '1.0.0 (local)', stamp: 'a/b c' })).toBe('cx-1.0.0local-abc');
  });

  it('never returns an empty segment', () => {
    expect(swVersion({ version: '', stamp: '' })).toBe('cx-x-x');
  });
});

describe('canRegister', () => {
  it('requires a serviceWorker API with register()', () => {
    expect(canRegister(null)).toBe(false);
    expect(canRegister({})).toBe(false);
    expect(canRegister({ serviceWorker: {} })).toBe(false);
    expect(canRegister({ serviceWorker: { register: () => {} } })).toBe(true);
  });
});

describe('registerServiceWorker', () => {
  it('does not register when disabled, which is the dev default', async () => {
    const nav = fakeNav();
    const result = await registerServiceWorker({ nav, enabled: false });
    expect(result.status).toBe('skipped');
    expect(nav.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('reports unsupported instead of throwing', async () => {
    expect((await registerServiceWorker({ nav: {} })).status).toBe('unsupported');
  });

  it('registers at root scope and reports success', async () => {
    const nav = fakeNav();
    const result = await registerServiceWorker({ nav });
    expect(nav.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(result.status).toBe('registered');
    expect(result.updateWaiting).toBe(false);
  });

  it('calls onUpdate when a worker is already waiting, but never reloads', async () => {
    const waiting = { postMessage: vi.fn() };
    const nav = fakeNav({ waiting });
    const onUpdate = vi.fn();
    const result = await registerServiceWorker({ nav, onUpdate });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(result.updateWaiting).toBe(true);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('survives a blocked registration', async () => {
    const result = await registerServiceWorker({ nav: fakeNav({ fail: true }) });
    expect(result.status).toBe('failed');
  });

  it('does not let a throwing listener break registration', async () => {
    const nav = fakeNav({ waiting: { postMessage: vi.fn() } });
    const result = await registerServiceWorker({
      nav,
      onUpdate: () => {
        throw new Error('listener bug');
      }
    });
    expect(result.status).toBe('registered');
  });
});

describe('activateUpdate', () => {
  it('posts skip-waiting to the waiting worker only', () => {
    const waiting = { postMessage: vi.fn() };
    expect(activateUpdate({ waiting })).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith('skip-waiting');
    expect(activateUpdate(null)).toBe(false);
  });
});
