/* Route integrity (Sections 45 and 31).
 *
 * A user journey breaks in two ways that unit tests usually miss:
 *   1. A sidebar link points at a path the router does not serve — the link is
 *      clickable and lands on the 404 page. This was real: 18 of 36 rail links
 *      were unreachable because the rail could not scroll.
 *   2. A lazy import points at a file that no longer exists. The build catches
 *      this, but only after a full bundle, and only for imports that are still
 *      referenced somewhere.
 *
 * Both are cheap to check statically and expensive to discover by clicking, so
 * they are checked here on every test run. This is the automated half of "walk
 * the app as a user": it cannot see a clipped sidebar, but it can see a link that
 * leads nowhere.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PUBLIC_ROUTES } from './routes.js';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

const appSource = read('App.jsx');
const shellSource = read('components/Shell.jsx');

/** Every `path="..."` in the router, excluding the wildcard. */
const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

/** Every `to: '/...'` in the sidebar navigation. */
const navPaths = [...shellSource.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]);

/** Every lazy page import. */
const lazyImports = [...appSource.matchAll(/import\('\.\/([^']+)'\)/g)].map((m) => m[1]);

describe('router', () => {
  it('declares routes', () => {
    expect(routePaths.length).toBeGreaterThan(20);
  });

  it('has no duplicate private route path', () => {
    /* A public page may legitimately be declared twice: once reachable signed out
       and once inside the authenticated shell. Two PRIVATE declarations of the same
       path is the bug — the second one is unreachable and silently dead. */
    const publicPaths = new Set(PUBLIC_ROUTES.map((r) => r.path));
    const seen = new Map();
    for (const p of routePaths) seen.set(p, (seen.get(p) || 0) + 1);
    const dupes = [...seen.entries()]
      .filter(([p, n]) => n > 1 && !publicPaths.has(p))
      .map(([p]) => p);
    expect(dupes).toEqual([]);
  });

  it('always has a catch-all so a bad URL lands on 404 rather than a blank shell', () => {
    expect(routePaths).toContain('*');
  });

  it('keeps every lazy import pointing at a real file', () => {
    const missing = lazyImports.filter((rel) => !existsSync(join(SRC, rel)));
    expect(missing).toEqual([]);
  });
});

describe('navigation', () => {
  it('renders a substantial sidebar', () => {
    expect(navPaths.length).toBeGreaterThan(25);
  });

  it('resolves every sidebar link to a served route', () => {
    /* A nav entry is legitimate when the router serves that exact path, when it
     * is a parameterised route (the link would then be built from a record), or
     * when the entry is '/' itself. */
    const served = new Set(routePaths);
    const dead = navPaths.filter((p) => {
      if (served.has(p)) return false;
      const isParameterised = routePaths.some((r) => {
        if (!r.includes(':')) return false;
        const prefix = r.split('/:')[0];
        return prefix && (p === prefix || p.startsWith(`${prefix}/`));
      });
      return !isParameterised;
    });
    expect(dead).toEqual([]);
  });

  it('has no duplicate nav entry', () => {
    expect(new Set(navPaths).size).toBe(navPaths.length);
  });

  it('gives every nav target a page title, so the header is never blank', () => {
    const titles = read('components/Shell.jsx');
    const untitled = navPaths.filter((p) => !titles.includes(`'${p}':`));
    /* Routes rendered by a redirect (e.g. /welcome) are allowed to omit a title. */
    const tolerated = ['/welcome'];
    expect(untitled.filter((p) => !tolerated.includes(p))).toEqual([]);
  });
});

describe('SEO surface', () => {
  const routes = read('lib/routes.js');

  it('marks the homepage as the indexable canonical entry', () => {
    /* / is the landing page for a visitor and the dashboard for a session, and
       it is the URL people cite. Before this it answered crawlers with the login
       wall — a soft 404 on the one page that matters. */
    const rootBlock = routes.slice(routes.indexOf("path: '/'"));
    expect(rootBlock.slice(0, 200)).toContain('indexable: true');
  });

  it('keeps the legacy /welcome redirect out of the index', () => {
    const legacy = routes.slice(routes.indexOf("path: '/welcome'"));
    expect(legacy.slice(0, 120)).toContain('indexable: false');
  });

  it('never advertises a route the signed-out visitor cannot load', () => {
    /* A crawler that follows an indexable route into RequireAuth sees a login
       wall: a soft 404 and a coverage error in Search Console. */
    const indexable = [...routes.matchAll(/path: '([^']+)',\s*\n?\s*indexable: true/g)].map((m) => m[1]);
    expect(indexable).not.toContain('/dashboard');
    expect(indexable).not.toContain('/portfolio');
    expect(indexable).not.toContain('/admin');
    expect(indexable.length).toBeGreaterThan(2);
  });
});