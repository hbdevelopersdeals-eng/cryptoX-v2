import { describe, it, expect } from 'vitest';

import { PUBLIC_ROUTES } from '../src/lib/routes.js';
import { PRERENDER_CONTENT } from './prerender-content.mjs';
import { renderRoute, renderIndex, outputPath, absoluteUrl } from './prerender.mjs';

/* The prerender step is the only thing standing between an AI crawler and an
 * empty <div id="root">, so its contract is pinned here rather than checked by
 * eye after a deploy. */

const BASE = `<!doctype html><html lang="en"><head>
    <title>CryptoX — Real-time Crypto Market Dashboard</title>
    <meta name="description" content="base description" />
    <link rel="canonical" href="https://cryptox-v2.site.accio.ai/" data-cx="canonical" />
    <meta property="og:url" content="https://cryptox-v2.site.accio.ai/" />
    <meta property="og:title" content="base title" />
    <meta property="og:description" content="base description" />
    <meta name="twitter:title" content="base title" />
    <meta name="twitter:description" content="base description" />
  </head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`;

const route = (path) => PUBLIC_ROUTES.find((r) => r.path === path);

describe('prerender contract', () => {
  it('gives /pricing its own title, canonical and body copy', () => {
    const html = renderRoute(BASE, route('/pricing'), PRERENDER_CONTENT['/pricing']);

    expect(html).toContain('<title>CryptoX Pricing — Free, Pro $9.99/mo, Business $24.99/mo</title>');
    expect(html).toContain('href="https://cryptox-v2.site.accio.ai/pricing" data-cx="canonical"');
    expect(html).toContain('content="https://cryptox-v2.site.accio.ai/pricing"');
    // real text, not an empty shell
    expect(html).toContain('CryptoX plans and pricing');
    expect(html).toContain('$9.99/month or $99.99/year');
    // the app still boots from the same document
    expect(html).toContain('src="/src/main.jsx"');
    // and the copy is flagged so a second run cannot re-wrap it
    expect(html).toContain('data-prerendered="true"');
  });

  it('does not leave two canonicals or a base title behind', () => {
    const html = renderRoute(BASE, route('/status'), PRERENDER_CONTENT['/status']);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).not.toContain('base title');
    expect(html).not.toContain('base description');
  });

  it('emits a WebPage JSON-LD block per route', () => {
    const html = renderRoute(BASE, route('/legal/risk'), PRERENDER_CONTENT['/legal/risk']);
    expect(html).toContain('data-cx-ld="webpage"');
    expect(html).toContain('"@type":"WebPage"');
    expect(html).toContain('https://cryptox-v2.site.accio.ai/legal/risk');
  });

  it('has copy for every indexable route and every route is in the sitemap source', () => {
    const indexable = PUBLIC_ROUTES.filter((r) => r.indexable);
    expect(indexable.length).toBeGreaterThan(0);
    for (const r of indexable) {
      expect(PRERENDER_CONTENT[r.path], `missing copy for ${r.path}`).toBeTruthy();
      expect(PRERENDER_CONTENT[r.path].body.trim().length).toBeGreaterThan(200);
    }
    // /welcome is a redirect now: it must never be prerendered or advertised
    expect(indexable.some((r) => r.path === '/welcome')).toBe(false);
    expect(PRERENDER_CONTENT['/welcome']).toBeUndefined();
  });

  it('maps routes to the expected files on disk', () => {
    expect(outputPath('/tmp/dist', '/')).toMatch(/index\.html$/);
    expect(outputPath('/tmp/dist', '/')).not.toMatch(/tmp[\\/]dist[\\/].+index/);
    expect(outputPath('/tmp/dist', '/legal/privacy')).toMatch(/legal[\\/]privacy[\\/]index\.html$/);
    expect(absoluteUrl('/')).toBe('https://cryptox-v2.site.accio.ai/');
    expect(absoluteUrl('/pricing')).toBe('https://cryptox-v2.site.accio.ai/pricing');
  });

  it('root document carries the copy of every public page', () => {
    // On a host that answers every extensionless path with the root document,
    // this is the only guarantee that /pricing has readable text at all.
    const routes = PUBLIC_ROUTES.filter((r) => r.indexable);
    const html = renderIndex(BASE, routes, PRERENDER_CONTENT);
    for (const r of routes) {
      const h1 = PRERENDER_CONTENT[r.path].h1;
      expect(html, `root is missing the copy of ${r.path}`).toContain(h1);
    }
    expect(html).toContain('data-prerendered="true"');
    expect(html).toContain('https://cryptox-v2.site.accio.ai/legal/privacy');
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('refuses to render a non-indexable route', () => {
    expect(() => renderRoute(BASE, { path: '/strategies', indexable: false }, { h1: 'x', body: 'y' })).toThrow();
  });
});
