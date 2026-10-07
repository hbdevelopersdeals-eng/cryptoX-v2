#!/usr/bin/env node
/* Translation usage guard.
 *
 * Every t('key') in the source must exist in the English source catalog.
 * Without this, a renamed or mistyped key renders as the raw key at runtime —
 * "nav.markets" on screen instead of "Markets" — and nothing else catches it,
 * because a missing key is not an error, it is a silent fallback.
 *
 * Also reports keys that are defined but never used, which is how stale entries
 * quietly accumulate.
 *
 * Usage: node scripts/check-i18n-usage.mjs [--list-unused]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'locales') continue;
      walk(p, out);
    } else if (['.js', '.jsx'].includes(extname(entry)) && !entry.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
};

const files = walk(SRC);
const used = new Map(); // key -> [files]

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Match t('key') / t("key") but not t(`…`) — dynamic keys cannot be checked.
  for (const m of src.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_.]+)\1/g)) {
    const key = m[2];
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(file.replace(ROOT, '.'));
  }
}

const en = (await import(`${pathToFileURL(join(SRC, 'locales', 'en.js')).href}?t=${Date.now()}`)).default;
const defined = new Set(Object.keys(en));

const missing = [...used.keys()].filter((k) => !defined.has(k)).sort();
const unused = [...defined].filter((k) => !used.has(k)).sort();

if (missing.length) {
  console.error(`✗ ${missing.length} t() key(s) are not in the English catalog:`);
  missing.forEach((k) => console.error(`  - ${k}  ← ${[...used.get(k)].join(', ')}`));
  process.exit(1);
}

const dynamic = files.filter((f) => /\bt\(\s*`/.test(readFileSync(f, 'utf8'))).length;
console.log(`✓ All ${used.size} literal t() keys resolve against ${defined.size} catalog keys`);
if (dynamic) console.log(`  note: ${dynamic} file(s) use a template-literal key, which cannot be checked statically`);
if (process.argv.includes('--list-unused')) {
  console.log(`  ${unused.length} defined-but-unused key(s): ${unused.join(', ') || 'none'}`);
}
