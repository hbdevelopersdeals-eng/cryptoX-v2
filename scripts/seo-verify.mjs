#!/usr/bin/env node
/* Live SEO/GEO verification — run against a deployed origin.
 *
 *   node scripts/seo-verify.mjs                        # https://cryptox-v2.site.accio.ai
 *   node scripts/seo-verify.mjs --base http://127.0.0.1:4173
 *
 * WHY THIS EXISTS
 * Every SEO defect found in this project was invisible in the build and only
 * visible as a live HTTP response: robots.txt 404, sitemap 404, /pricing
 * answering with the login wall, one canonical on nine URLs, and an empty
 * <div id="root"> for every non-JS crawler. A green build proves none of that.
 * This asks the origin the questions a crawler asks and fails loudly.
 *
 * PASS / WARN / FAIL
 *  - PASS  the invariant holds.
 *  - WARN  the host serves the root "site digest" for this path, so the URL has
 *          the site's content but not its own canonical. Acceptable only on a
 *          host with no directory-index support; reported, not hidden.
 *  - FAIL  content a crawler needs is missing. Exits 1.
 */

import { PUBLIC_ROUTES } from '../src/lib/routes.js';
import { PRERENDER_CONTENT } from './prerender-content.mjs';

const args = process.argv.slice(2);
const baseArg = args.indexOf('--base');
const BASE = (baseArg >= 0 ? args[baseArg + 1] : 'https://cryptox-v2.site.accio.ai').replace(/\/+$/, '');

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot';

const rows = [];
let failures = 0;
let warnings = 0;

const record = (name, state, detail) => {
  rows.push({ name, state, detail });
  if (state === 'FAIL') failures += 1;
  if (state === 'WARN') warnings += 1;
};

const get = async (path, ua = GOOGLEBOT) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': ua, accept: 'text/html,application/xml,text/plain,*/*' },
    redirect: 'follow'
  });
  return { status: res.status, body: await res.text(), type: res.headers.get('content-type') || '' };
};

const match1 = (html, re) => html.match(re)?.[1] ?? null;
const textOf = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* The first ~40 characters of a route's H1, without markup, used as the proof
 * that this URL returned that page's copy and not somebody else's. */
const marker = (path) => PRERENDER_CONTENT[path].h1.replace(/<[^>]+>/g, '').slice(0, 40);

async function main() {
  console.log(`SEO/GEO verification against ${BASE}\n`);

  const robots = await get('/robots.txt');
  record('robots.txt responds 200', robots.status === 200 ? 'PASS' : 'FAIL', `status ${robots.status}`);
  record(
    'robots.txt declares a sitemap',
    /Sitemap:\s*https?:\/\/\S+/i.test(robots.body) ? 'PASS' : 'FAIL',
    robots.body.split('\n').find((l) => /^Sitemap:/i.test(l))?.trim() || 'no Sitemap line'
  );
  record(
    'robots.txt admits AI crawlers',
    /User-agent:\s*GPTBot/i.test(robots.body) && /User-agent:\s*PerplexityBot/i.test(robots.body) ? 'PASS' : 'FAIL',
    'GPTBot / PerplexityBot must be explicitly allowed'
  );

  const indexable = PUBLIC_ROUTES.filter((r) => r.indexable);
  const sitemap = await get('/sitemap.xml');
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  record('sitemap.xml responds 200', sitemap.status === 200 ? 'PASS' : 'FAIL', `status ${sitemap.status}`);
  record(
    'sitemap lists every indexable route',
    locs.length === indexable.length ? 'PASS' : 'FAIL',
    `${locs.length} loc(s), expected ${indexable.length}`
  );
  record(
    'sitemap does not advertise the /welcome alias',
    locs.some((l) => l.endsWith('/welcome')) ? 'FAIL' : 'PASS',
    'legacy alias must stay out of the sitemap'
  );

  const llms = await get('/llms.txt');
  record('llms.txt responds 200', llms.status === 200 && llms.body.length > 200 ? 'PASS' : 'FAIL', `${llms.status}, ${llms.body.length} bytes`);

  const og = await fetch(`${BASE}/og-image.png`);
  record(
    'og-image.png is a real PNG',
    og.status === 200 && (og.headers.get('content-type') || '').includes('image/png') ? 'PASS' : 'FAIL',
    `${og.status}, ${og.headers.get('content-type')}`
  );

  const titles = new Map();
  for (const route of indexable) {
    const page = await get(route.path);
    const canonical = match1(page.body, /<link rel="canonical" href="([^"]+)"/);
    const title = match1(page.body, /<title>([^<]+)<\/title>/);
    const expected = route.path === '/' ? `${BASE}/` : `${BASE}${route.path}`;
    const text = textOf(page.body);
    const hasOwnCopy = text.includes(marker(route.path));
    const isLoginWall = /Welcome back/i.test(page.body) && /Log in to your account/i.test(page.body);

    record(`${route.path} responds 200`, page.status === 200 ? 'PASS' : 'FAIL', `status ${page.status}`);
    record(
      `${route.path} has crawlable text`,
      text.length > 600 ? 'PASS' : 'FAIL',
      `${text.length} characters of text`
    );
    record(
      `${route.path} returns its own copy without JS`,
      hasOwnCopy && !isLoginWall ? 'PASS' : 'FAIL',
      isLoginWall ? 'served the login wall' : hasOwnCopy ? `matched "${marker(route.path)}…"` : 'page copy not found in the document'
    );

    if (canonical === expected) {
      record(`${route.path} canonical self-references`, 'PASS', canonical);
    } else if (hasOwnCopy) {
      record(`${route.path} canonical self-references`, 'WARN', `canonical ${canonical || 'missing'} (host served the site digest)`);
    } else {
      record(`${route.path} canonical self-references`, 'FAIL', `canonical ${canonical || 'missing'}`);
    }

    if (!title) record(`${route.path} has a title`, 'FAIL', 'missing <title>');
    else if (titles.has(title)) {
      record(`${route.path} has a unique title`, hasOwnCopy ? 'WARN' : 'FAIL', `same title as ${titles.get(title)}`);
    } else {
      titles.set(title, route.path);
      record(`${route.path} has a unique title`, 'PASS', title.slice(0, 60));
    }
  }

  // Private surface: either the URL is disallowed for crawlers, or it answers
  // noindex. Serving the indexable digest for a private URL is not acceptable.
  const privatePath = '/strategies';
  const priv = await get(privatePath);
  const privRobots = match1(priv.body, /<meta name="robots" content="([^"]+)"/);
  const disallowed = new RegExp(`Disallow:\\s*${privatePath}\\s*$`, 'im').test(robots.body);
  record(
    `${privatePath} is not advertised to crawlers`,
    disallowed ? 'PASS' : /noindex/i.test(privRobots || '') ? 'PASS' : 'FAIL',
    disallowed ? 'disallowed in robots.txt' : `robots meta ${privRobots || 'none'}`
  );

  for (const path of ['/', '/pricing']) {
    const asGpt = await get(path, GPTBOT);
    const asGoogle = await get(path, GOOGLEBOT);
    record(
      `${path} serves the same document to GPTBot and Googlebot`,
      asGpt.status === asGoogle.status && asGpt.body.length === asGoogle.body.length ? 'PASS' : 'FAIL',
      `GPTBot ${asGpt.status}/${asGpt.body.length}B vs Googlebot ${asGoogle.status}/${asGoogle.body.length}B`
    );
  }

  const pad = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.state.padEnd(4)}  ${r.name.padEnd(pad)}  ${r.detail}`);

  const passed = rows.filter((r) => r.state === 'PASS').length;
  console.log(`\n${passed} passed, ${warnings} warning(s), ${failures} failed — ${BASE}`);
  if (warnings) {
    console.log('\nWARN = this host answers the path with the root document. Content is crawlable,');
    console.log('but the URL has no canonical of its own. See audit/seo-geo-plan.md §6.');
  }
  if (failures) {
    console.log('\nFAIL means a crawler cannot get what this URL should provide, even if the build is green.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Verification could not run: ${err.message}`);
  process.exit(2);
});
