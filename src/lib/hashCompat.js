/* One-time adoption of legacy hash URLs.
 *
 * CryptoX routed with HashRouter until path routing landed, so every published
 * link, bookmark, Lemon Squeezy `redirect_url` and support reply looks like
 *   https://cryptox-v2.site.accio.ai/#/pricing
 * Rewriting that to `/pricing` before React mounts keeps all of them working
 * without a server-side redirect rule (the static host has none).
 *
 * Only `#/…` is touched: a genuine in-page anchor (`#faq`) is left alone, and
 * the original query string is preserved.
 */
export function adoptLegacyHash(win = typeof window === 'undefined' ? null : window) {
  if (!win || !win.location || !win.history) return null;
  const { hash, search, pathname } = win.location;
  if (!hash || !hash.startsWith('#/')) return null;

  const target = hash.slice(1).split('?')[0];
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const next = `${target || '/'}${search || ''}${hashQuery}`;

  try {
    win.history.replaceState(null, '', next);
    return next;
  } catch {
    return null;
  }
}
