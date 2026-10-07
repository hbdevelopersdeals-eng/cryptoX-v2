#!/usr/bin/env node
/* Static configuration guard.
 * Fails the build on patterns that have previously caused real problems in this
 * project or that violate the front-end policy (external font CDNs, injectable
 * HTML sinks, insecure endpoints, missing CSP). */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const failures = [];
const notes = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (['node_modules', 'dist', '.git', 'coverage', 'scripts', 'docs'].includes(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (['.js', '.jsx', '.css', '.html', '.mjs'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const files = walk(ROOT);

/* Comments are stripped before the code-pattern checks. Without this, a file
 * that merely *documents* a forbidden API (e.g. "we never call eval()") is
 * reported as using it — a false positive that trains people to ignore the
 * guard. Only the real code is inspected. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, '');

/* 1. No external font/CDN hosts (policy: system font stack only) */
const BANNED_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net'];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const host of BANNED_HOSTS) {
    if (src.includes(host)) failures.push(`${file.replace(ROOT, '.')} references banned host ${host}`);
  }
}

/* 2. No raw HTML injection sinks */
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  if (/dangerouslySetInnerHTML/.test(src)) failures.push(`${file.replace(ROOT, '.')} uses dangerouslySetInnerHTML`);
  if (/\beval\s*\(/.test(src)) failures.push(`${file.replace(ROOT, '.')} uses eval()`);
}

/* 3. Plaintext HTTP endpoints in app code */
for (const file of files) {
  if (file.endsWith('.md')) continue;
  const src = readFileSync(file, 'utf8');
  const m = src.match(/https?:\/\/[a-z0-9.-]+/gi) || [];
  for (const url of m) {
    const isNamespace = url.startsWith('http://www.w3.org'); // XML namespace, never fetched
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    if (url.startsWith('http://') && !isNamespace && !isLocal) {
      failures.push(`${file.replace(ROOT, '.')} uses insecure endpoint ${url}`);
    }
  }
}

/* 4. CSP must exist in index.html */
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
if (!/http-equiv="Content-Security-Policy"/.test(indexHtml)) {
  failures.push('index.html is missing the Content-Security-Policy meta tag');
}
if (!/rel="noopener noreferrer"/.test(readFileSync(join(ROOT, 'src', 'pages', 'News.jsx'), 'utf8'))) {
  failures.push('external links in News.jsx must carry rel="noopener noreferrer"');
}

/* 5. Known shadowing footgun: a state setter named setInterval/setTimeout */
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  if (/useState[^\n]*\bsetInterval\b/.test(src)) {
    failures.push(`${file.replace(ROOT, '.')} shadows the global setInterval with a state setter`);
  }
}

notes.push(`scanned ${files.length} source files`);

if (failures.length) {
  console.error('✗ Configuration checks failed:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`✓ Configuration checks passed (${notes.join(', ')})`);
