/* CryptoX service worker.
 *
 * HISTORY — why this file has a version placeholder.
 * `VERSION` used to be the literal string 'cx-v1' and nothing registered this
 * worker, so it was dead code in two directions: no shell was ever cached, and
 * if it had been, the cache name would never change between releases, so a
 * browser would keep the old shell forever and a shipped fix would never arrive.
 *
 * The fix is built in two halves:
 *   · `__CX_SW_VERSION__` is replaced at build time with the app version and
 *     build stamp (vite.config.js). A new build is a new cache name, so the
 *     activation step below deletes the previous one.
 *   · HTML navigations are NETWORK-FIRST. A cached index.html is a fallback for
 *     being offline, never a substitute for asking the server. Hashed assets
 *     under /assets/ are cache-first, which is safe because their names change
 *     when their content does.
 */

const VERSION = '__CX_SW_VERSION__';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

/* Only files whose name is stable need precaching; /assets/* is content-hashed
 * and cached on first use instead. */
const SHELL_ASSETS = ['./', './favicon.svg', './manifest.webmanifest'];
const DATA_HOSTS = ['api.coingecko.com', 'api.binance.com', 'data-api.binance.vision', 'api.alternative.me'];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
    // No unconditional skipWaiting(): the new worker waits until the page asks
    // for it, so a reload never swaps code underneath a running session.
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** Network-first with a timeout, falling back to the cache, then to `fallback`. */
async function networkFirst(request, cacheName, fallback = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Market data: never serve a stale figure if the network answers.
  if (DATA_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Content-hashed bundles can be served from cache: the name is the hash.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
    return;
  }

  // Documents: network-first. An installed app must not pin an old shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './'));
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
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
      return cached || (await network) || new Response('', { status: 504 });
    })()
  );
});

/* The page asks for the waiting worker when the user has seen the update notice,
 * and is told when the swap finished so it can reload deliberately. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION });
  }
});
