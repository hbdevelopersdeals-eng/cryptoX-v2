#!/usr/bin/env node
/* Prerender the public routes — runs as `postbuild`, after `vite build`.
 *
 *   node scripts/prerender.mjs           write dist/ from dist/index.html
 *   node scripts/prerender.mjs --check   fail if a route's output is stale
 *
 * WHY
 * The bundle is a client-rendered SPA: one index.html answers every URL. Google
 * will render it eventually; GPTBot, OAI-SearchBot, PerplexityBot and ClaudeBot
 * do not render at all, and every answer engine deciding whether to cite this
 * site read an empty `<div id="root">`. The same was true of the <title> and
 * canonical, which therefore described `/` on every URL.
 *
 * WHAT IT DOES
 * For each indexable route in src/lib/routes.js it emits `dist/<path>/index.html`
 * with that route's own title, description, canonical, og/twitter tags, a
 * WebPage JSON-LD block, and the route's static copy inside `#root`. React's
 * createRoot replaces those children on mount, so a browser user gets the app
 * and a non-JS client gets the text.
 *
 * WHAT IT DOES NOT DO
 * It does not fabricate routes (the list is the manifest), does not touch the
 * sitemap (scripts/gen-sitemap.mjs owns that, from the same manifest), and does
 * not silently pass when a route has no copy — a missing entry fails the build,
 * because a prerendered page with an empty body is worse than no prerender.
 *
 * HOST CAVEAT (see audit/seo-geo-plan.md §6): these files only win if the host
 * serves `dist/<path>/index.html` for `/<path>`. The Accio static host serves
 * index.html for unknown paths; whether it prefers a real directory index is
 * verified by the post-publish probe, not assumed here.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_URL } from '../src/lib/seo.js';
import { PUBLIC_ROUTES, SITE_NAME } from '../src/lib/routes.js';
import { PRERENDER_CONTENT, nav } from './prerender-content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');

const BASE_URL = SITE_URL.replace(/\/+$/, '');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Absolute URL for a route path (`/` stays a single slash). */
export function absoluteUrl(path) {
  return path === '/' ? `${BASE_URL}/` : `${BASE_URL}${path}`;
}

/**
 * Replace a tag's attribute value in the base document, appending the tag when
 * it is absent. Kept deliberately narrow: it operates on the handful of tags
 * index.html owns, all of which are single-line.
 */
function setAttr(html, matcher, replacement) {
  if (matcher.test(html)) return html.replace(matcher, replacement);
  return html;
}

/**
 * Build one route's document from the base shell.
 * Pure — exported so scripts/prerender.test.mjs can assert it without a build.
 */
export function renderRoute(baseHtml, route, content) {
  if (!route?.indexable) throw new Error(`renderRoute: ${route?.path} is not indexable`);
  if (!content?.h1 || !content?.body) throw new Error(`prerender copy missing for ${route.path}`);

  const url = absoluteUrl(route.path);
  let html = baseHtml;

  html = setAttr(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(route.title)}</title>`);
  html = setAttr(
    html,
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${esc(route.description)}" />`
  );
  html = setAttr(
    html,
    /<link rel="canonical" href="[^"]*" data-cx="canonical" \/>/,
    `<link rel="canonical" href="${url}" data-cx="canonical" />`
  );
  html = setAttr(
    html,
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${url}" />`
  );
  html = setAttr(
    html,
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${esc(route.title)}" />`
  );
  html = setAttr(
    html,
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${esc(route.description)}" />`
  );
  html = setAttr(
    html,
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${esc(route.title)}" />`
  );
  html = setAttr(
    html,
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${esc(route.description)}" />`
  );

  const webpageLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: route.title,
    description: route.description,
    url,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${BASE_URL}/` },
    inLanguage: 'en'
  });

  /* Self-contained styles, not Tailwind classes: the app's stylesheet is
   * imported from JS, so before the bundle executes there is no CSS at all.
   * Utilities in this block would therefore be missing or unstyled, and the
   * first paint would flash white-on-black with default blue links. Inline
   * rules scoped to `.cx-pre` render correctly with zero CSS loaded, and
   * disappear with the node when React mounts. */
  const preStyle = `<style data-cx-pre>
      .cx-pre{background:#09090C;color:#F0F2F5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.65;min-height:100dvh;padding:40px 20px;box-sizing:border-box}
      .cx-pre .cx-wrap{max-width:720px;margin:0 auto}
      .cx-pre h1{font-size:1.9rem;line-height:1.25;margin:.4em 0 .6em}
      .cx-pre h2{font-size:1.2rem;margin:1.4em 0 .4em}
      .cx-pre p,.cx-pre li{color:#B9C0CC;font-size:.98rem}
      .cx-pre strong{color:#F0F2F5}
      .cx-pre ul{padding-left:1.1em}
      .cx-pre a{color:#2DD4BF;text-decoration:none}
      .cx-pre a:hover{text-decoration:underline}
      .cx-pre nav{font-size:.85rem;color:#8A93A3;margin:10px 0 0}
      .cx-pre header{margin-bottom:26px}
      .cx-pre footer{margin-top:38px;border-top:1px solid #23262E;padding-top:16px;font-size:.82rem;color:#8A93A3}
    </style>`;

  const body = `<div id="root" data-prerendered="true"><div class="cx-pre"><div class="cx-wrap">
      <header><strong>${SITE_NAME}</strong>${nav()}</header>
      <main>
        <h1>${esc(content.h1)}</h1>
        ${content.body.trim()}
        ${content.extra ? content.extra.trim() : ''}
      </main>
      <footer><p>CryptoX is research and simulation software. No orders are placed and nothing
      here is investment advice.</p>${nav()}</footer>
    </div></div></div>`;

  return finishRoute(html, body, route, webpageLd, preStyle);
}

/** Assemble the final document from a body block. */
function finishRoute(html, body, route, webpageLd, preStyle) {
  let out = html;
  out = setAttr(out, /<div id="root"><\/div>/, body);
  out = setAttr(
    out,
    /<\/head>/,
    `  ${preStyle}\n  <script type="application/ld+json" data-cx-ld="webpage">${webpageLd}</script>\n  </head>`
  );
  return out;
}

/**
 * The root document — and, on this host, the document every extensionless URL
 * resolves to.
 *
 * The published origin answers `/pricing` with the root document (a `.txt` or
 * `.xml` under a missing key returns a storage 404, so the rule is
 * "extensionless → index.html", not a directory index). Per-route files are
 * therefore a best case, not a guarantee: if the host ignores them, every
 * public URL still serves this document. So this document carries the text of
 * every public page, each in its own anchored section, and a crawler that
 * lands on any URL of the site can read all of it.
 *
 * Cost of that choice: on a fallback host the other URLs look like duplicates
 * of `/` and the canonical consolidates them there. That is a ranking
 * compromise; an empty `<div id="root">` is a citation compromise. Verified
 * behaviour decides which one applies — see audit/seo-geo-plan.md §6.
 */
export function renderIndex(baseHtml, routes, contents) {
  const preStyle = STYLE;
  const sections = routes
    .map((route) => {
      const content = contents[route.path];
      if (!content) throw new Error(`prerender copy missing for ${route.path}`);
      const href = route.path === '/' ? '#top' : route.path;
      return `
      <section id="cx-${route.path === '/' ? 'home' : route.path.replace(/^\//, '').replace(/\//g, '-')}">
        <h2>${esc(content.h1)}</h2>
        ${content.body.trim()}
        ${content.extra ? content.extra.trim() : ''}
        ${route.path === '/' ? '' : `<p><a href="${href}">Open ${escapeText(route.title.split('—')[0].trim())}</a> · <a href="${absoluteUrl(route.path)}">${absoluteUrl(route.path)}</a></p>`}
      </section>`;
    })
    .join('\n');

  const home = contents['/'];
  const body = `<div id="root" data-prerendered="true"><div class="cx-pre"><div class="cx-wrap" id="top">
      <header><strong>${SITE_NAME}</strong>${nav()}</header>
      <main>
        <h1>${esc(home.h1)}</h1>
        ${home.body.trim()}
        <h2>Every public page, in full</h2>
        <p>This document is the whole public site. Each section below is also its own page at the
        listed URL.</p>
        ${sections}
      </main>
      <footer><p>CryptoX is research and simulation software. No orders are placed and nothing
      here is investment advice.</p>${nav()}</footer>
    </div></div></div>`;

  const webpageLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: routes[0].title,
    description: routes[0].description,
    url: `${BASE_URL}/`,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${BASE_URL}/` },
    inLanguage: 'en'
  });

  return finishRoute(baseHtml, body, routes[0], webpageLd, preStyle);
}

const escapeText = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE = `<style data-cx-pre>
      .cx-pre{background:#09090C;color:#F0F2F5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.65;min-height:100dvh;padding:40px 20px;box-sizing:border-box}
      .cx-pre .cx-wrap{max-width:720px;margin:0 auto}
      .cx-pre h1{font-size:1.9rem;line-height:1.25;margin:.4em 0 .6em}
      .cx-pre h2{font-size:1.2rem;margin:1.6em 0 .4em}
      .cx-pre p,.cx-pre li{color:#B9C0CC;font-size:.98rem}
      .cx-pre strong{color:#F0F2F5}
      .cx-pre ul{padding-left:1.1em}
      .cx-pre a{color:#2DD4BF;text-decoration:none;word-break:break-word}
      .cx-pre a:hover{text-decoration:underline}
      .cx-pre nav{font-size:.85rem;color:#8A93A3;margin:10px 0 0}
      .cx-pre header{margin-bottom:26px}
      .cx-pre section{border-top:1px solid #23262E;padding-top:6px;margin-top:26px}
      .cx-pre footer{margin-top:38px;border-top:1px solid #23262E;padding-top:16px;font-size:.82rem;color:#8A93A3}
    </style>`;

/** Output path for a route. `/` keeps the root document. */
export function outputPath(distDir, path) {
  if (path === '/') return join(distDir, 'index.html');
  return join(distDir, path.replace(/^\/+/, ''), 'index.html');
}

/* `dist/index.html` is both the build output and the `/` output, so a second run
 * would render from an already-rendered document and nest the copy. Keep the
 * pristine shell beside the build (not inside dist, which is published). */
const SHELL = join(ROOT, '.prerender-shell.html');

function readBase() {
  const fresh = readFileSync(join(DIST, 'index.html'), 'utf8');
  if (!fresh.includes('data-prerendered="true"')) {
    writeFileSync(SHELL, fresh, 'utf8');
    return fresh;
  }
  if (existsSync(SHELL)) return readFileSync(SHELL, 'utf8');
  throw new Error('dist/index.html is already prerendered and no pristine shell was saved; re-run `vite build` first.');
}

/* Search-engine ownership verification.
 *
 * These have to be build-time tags on the document itself: Google and Bing
 * check the served HTML, and neither will accept a tag injected by JavaScript.
 * Empty or absent values simply emit nothing, so a local build stays clean.
 * Tokens are public (they are visible in the page source by design) and belong
 * in the deploy environment, not in this repository. */
const VERIFY_TAGS = [
  ['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION],
  ['msvalidate.01', process.env.BING_SITE_VERIFICATION]
].filter(([, value]) => value && value.trim());

export function withVerification(html) {
  if (!VERIFY_TAGS.length) return html;
  const tags = VERIFY_TAGS.map(([name, value]) => `<meta name="${name}" content="${esc(value.trim())}" />`).join('\n    ');
  return html.replace(/<\/head>/, `    ${tags}\n  </head>`);
}

function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/index.html not found — run `vite build` first.');
    process.exit(1);
  }

  const base = withVerification(readBase());
  const routes = PUBLIC_ROUTES.filter((r) => r.indexable);

  const missing = routes.filter((r) => !PRERENDER_CONTENT[r.path]).map((r) => r.path);
  if (missing.length) {
    console.error(`No prerender copy for: ${missing.join(', ')} — add it to scripts/prerender-content.mjs`);
    process.exit(1);
  }

  let stale = 0;
  for (const route of routes) {
    // `/` is the whole-site document (see renderIndex); the rest are single pages.
    const html =
      route.path === '/'
        ? renderIndex(base, routes, PRERENDER_CONTENT)
        : renderRoute(base, route, PRERENDER_CONTENT[route.path]);
    const out = outputPath(DIST, route.path);
    const current = existsSync(out) ? readFileSync(out, 'utf8') : null;
    if (CHECK) {
      if (current !== html) {
        console.error(`stale prerender: ${out}`);
        stale += 1;
      }
      continue;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html, 'utf8');
  }

  if (CHECK) {
    if (stale) process.exit(1);
    console.log(`Prerender check: ${routes.length} route(s) up to date.`);
  } else {
    console.log(`Prerendered ${routes.length} route(s) under ${BASE_URL}`);
  }
}

// Only run when invoked directly; the test imports the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
