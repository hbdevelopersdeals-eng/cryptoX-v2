#!/usr/bin/env node
/* Bundle size budget. Reads the production build and fails if any chunk
 * exceeds its gzip budget, or if the total gzip payload grows beyond budget. */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(process.cwd(), 'dist', 'assets');
const PER_CHUNK_GZIP_BUDGET = 120 * 1024;   // 120 KB gzip per chunk
const TOTAL_GZIP_BUDGET = 400 * 1024;       // 400 KB gzip across all JS

if (!existsSync(DIST)) {
  console.error('✗ dist/assets not found — run "npm run build" first');
  process.exit(1);
}

const rows = [];
let total = 0;
for (const file of readdirSync(DIST).filter((f) => f.endsWith('.js'))) {
  const buf = readFileSync(join(DIST, file));
  const gz = gzipSync(buf).length;
  total += gz;
  rows.push({ file, raw: buf.length, gz });
}
rows.sort((a, b) => b.gz - a.gz);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('Bundle report (gzip):');
for (const r of rows) console.log(`  ${kb(r.gz).padStart(9)}  ${r.file}  (raw ${kb(r.raw)})`);
console.log(`  ${kb(total).padStart(9)}  TOTAL`);

const oversize = rows.filter((r) => r.gz > PER_CHUNK_GZIP_BUDGET);
let failed = false;
if (oversize.length) {
  console.error('✗ Chunks over budget:\n' + oversize.map((r) => `  - ${r.file}: ${kb(r.gz)} > ${kb(PER_CHUNK_GZIP_BUDGET)}`).join('\n'));
  failed = true;
}
if (total > TOTAL_GZIP_BUDGET) {
  console.error(`✗ Total gzip JS ${kb(total)} exceeds budget ${kb(TOTAL_GZIP_BUDGET)}`);
  failed = true;
}
if (failed) process.exit(1);
console.log('✓ Bundle within budget');
