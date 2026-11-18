/* Service-worker registration and update handling.
 *
 * WHY THIS EXISTS. `public/sw.js` was shipped for months and never registered —
 * so the app had no offline shell, and the staleness risk in
 * `docs/LAUNCH-READINESS.md` (P1-3) could not even be exercised. Registration is
 * also where the update decision belongs: the worker waits, the page notices,
 * and the user reloads when they choose. Swapping code underneath a live session
 * is how an unsaved portfolio edit disappears.
 *
 * Three deliberate constraints:
 *   1. Production only. In `npm run dev`, Vite serves unbundled modules from
 *      /src; caching those behind a worker produces "my change did not apply"
 *      and is not worth the debugging time.
 *   2. No automatic reload. `onUpdate` is called so the shell can offer a
 *      reload; nothing navigates on its own.
 *   3. Failure is silent and non-fatal. A blocked or unsupported worker must
 *      never break the app — the site works without it.
 */

export const SW_URL = '/sw.js';

/** True when this browser can register a worker at all. */
export function canRegister(nav = typeof navigator === 'undefined' ? null : navigator) {
  return Boolean(nav && 'serviceWorker' in nav && typeof nav.serviceWorker?.register === 'function');
}

/**
 * Cache version stamped into the worker.
 *
 * The build replaces `__CX_SW_VERSION__` in dist/sw.js with this same string, so
 * the page and the worker cannot disagree about which release they are on.
 */
export function swVersion({ version = 'dev', stamp = 'unknown' } = {}) {
  const clean = (value) => String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '') || 'x';
  return `cx-${clean(version)}-${clean(stamp)}`;
}

/**
 * Register the worker and report an update when one is waiting.
 *
 * Returns `{ status }` where status is one of:
 *   'unsupported' | 'skipped' | 'registered' | 'failed'
 * and, when registered, `{ registration, updateWaiting }`.
 */
export async function registerServiceWorker({
  nav = typeof navigator === 'undefined' ? null : navigator,
  url = SW_URL,
  enabled = true,
  onUpdate = null
} = {}) {
  if (!enabled) return { status: 'skipped' };
  if (!canRegister(nav)) return { status: 'unsupported' };

  try {
    const registration = await nav.serviceWorker.register(url, { scope: '/' });

    const notifyIfWaiting = () => {
      if (!registration.waiting) return false;
      try {
        onUpdate?.(registration);
      } catch {
        /* a listener throwing must not break registration */
      }
      return true;
    };

    notifyIfWaiting();

    registration.addEventListener?.('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener?.('statechange', () => {
        if (installing.state === 'installed' && registration.waiting) notifyIfWaiting();
      });
    });

    return { status: 'registered', registration, updateWaiting: Boolean(registration.waiting) };
  } catch {
    // A registration failure is not a reason to show the user an error: the app
    // works without a worker, it just will not open offline.
    return { status: 'failed' };
  }
}

/** Ask the waiting worker to take over. The caller decides when to reload. */
export function activateUpdate(registration) {
  const waiting = registration?.waiting;
  // `true` means a message was actually posted. Optional chaining alone would
  // report success for a registration with nothing waiting, and the caller would
  // promise a reload that never comes.
  if (!waiting || typeof waiting.postMessage !== 'function') return false;
  try {
    waiting.postMessage('skip-waiting');
    return true;
  } catch {
    return false;
  }
}
