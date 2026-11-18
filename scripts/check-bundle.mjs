#!/usr/bin/env node
/* Bundle size budget.
 *
 * Two budgets, because they measure different things and only one of them is a
 * user-facing constraint:
 *
 *   INITIAL — the chunks index.html loads on first paint. This is what every
 *             visitor actually downloads, so it gets the tight budget.
 *   TOTAL   — every emitted chunk. This grows with code-split content (24 lazy
 *             translation catalogs, per-page chunks) that a given visitor never
 *             all downloads. It is a guard against unbounded growth, not a
 *             first-load limit.
 *
 * Budgeting only the total made adding a lazily-loaded catalog look like a
 * first-load regression, which is the wrong signal to act on.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

const PER_CHUNK_GZIP_BUDGET = 120 * 1024;    // 120 KB gzip per single chunk
const INITIAL_GZIP_BUDGET = 220 * 1024;      // 220 KB gzip for the first load
/*
 * Raised 440 -> 480 KB for the Account and Organization pages, then 480 -> 520
 * KB for Billing and Compliance, then 520 -> 560 KB for Brand Identity &
 * Terminal Showcase assets.
 *
 * This number is a TRIPWIRE, not a limit: its job is to make growth a conscious
 * decision rather than something noticed after the fact. Every raise is
 * deliberate and recorded. The figure that governs user experience is
 * INITIAL_GZIP_BUDGET above - first load is 182 KB against 220 KB, and 104 lazy
 * chunks exist of which a visitor downloads roughly two. If first load ever
 * approaches its budget, that is the signal to act on.
 */
const TOTAL_GZIP_BUDGET = 560 * 1024;        // 560 KB gzip across every chunk

if (!existsSync(ASSETS)) {
  console.error('✗ dist/assets not found — run "npm run build" first');
  process.exit(1);
}

/* Chunks index.html references (plus anything linked from the manifest). */
const initialNames = new Set();
const indexPath = join(DIST, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8');
  for (const m of html.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)) initialNames.add(m[1]);
  for (const m of html.matchAll(/assets\/([A-Za-z0-9_.-]+\.css)/g)) initialNames.add(m[1]);
}

const rows = [];
let total = 0;
let initial = 0;
for (const file of readdirSync(ASSETS).filter((f) => f.endsWith('.js'))) {
  const buf = readFileSync(join(ASSETS, file));
  const gz = gzipSync(buf).length;
  const isInitial = initialNames.has(file);
  total += gz;
  if (isInitial) initial += gz;
  rows.push({ file, raw: buf.length, gz, initial: isInitial });
}
rows.sort((a, b) => b.gz - a.gz);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const show = (list, label) => {
  console.log(`${label}:`);
  for (const r of list) console.log(`  ${kb(r.gz).padStart(9)}  ${r.file}  (raw ${kb(r.raw)})`);
};

show(rows.filter((r) => r.initial), 'First load (referenced by index.html)');
console.log(`  ${kb(initial).padStart(9)}  INITIAL TOTAL`);
console.log('');
show(rows.filter((r) => !r.initial).slice(0, 8), 'Largest lazy chunks');
console.log(`  … ${rows.filter((r) => !r.initial).length} lazy chunks in total`);
console.log(`  ${kb(total).padStart(9)}  ALL CHUNKS`);
console.log('');

let failed = false;

const oversize = rows.filter((r) => r.gz > PER_CHUNK_GZIP_BUDGET);
if (oversize.length) {
  console.error('✗ Chunks over budget:\n' + oversize.map((r) => `  - ${r.file}: ${kb(r.gz)} > ${kb(PER_CHUNK_GZIP_BUDGET)}`).join('\n'));
  failed = true;
}

if (initial > INITIAL_GZIP_BUDGET) {
  console.error(`✗ First load ${kb(initial)} exceeds budget ${kb(INITIAL_GZIP_BUDGET)}`);
  failed = true;
}

if (total > TOTAL_GZIP_BUDGET) {
  console.error(`✗ Total gzip JS ${kb(total)} exceeds budget ${kb(TOTAL_GZIP_BUDGET)}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`✓ Bundle within budget (first load ${kb(initial)}, all chunks ${kb(total)})`);
