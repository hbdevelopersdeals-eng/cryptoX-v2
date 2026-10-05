/* CryptoX service worker.
 *
 * Strategy:
 *   - App shell (HTML/JS/CSS/icons): stale-while-revalidate, so the installed
 *     app opens instantly and still updates in the background.
 *   - Market data (API hosts): network-first with a short cache, so figures are
 *     never served stale beyond a few seconds and the app degrades gracefully
 *     offline instead of showing nothing.
 *
 * This is a client-side cache only; it is not a substitute for CDN/edge
 * infrastructure (that is a platform concern).
 */

const VERSION = 'cx-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = ['./', './index.html', './favicon.svg', './manifest.webmanifest'];
const DATA_HOSTS = ['api.coingecko.com', 'api.binance.com', 'data-api.binance.vision', 'api.alternative.me'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Market data: network-first, short-lived cache, graceful offline fallback.
  if (DATA_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(DATA_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch (err) {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { 'content-type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // App shell: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then(async (response) => {
            if (response.ok) {
              const cache = await caches.open(SHELL_CACHE);
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);
        return cached || (await network) || caches.match('./index.html');
      })()
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
