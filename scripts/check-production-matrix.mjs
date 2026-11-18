#!/usr/bin/env node
/* Coverage guard for docs/PRODUCTION-READINESS-MATRIX.md.
 *
 * The matrix is only worth having if it covers the checklist. A hand-written
 * audit silently loses rows: a section gets renumbered, a table is pasted over
 * another, and the missing item is the one that mattered. This script compares
 * the document against the extracted checklist and fails when a section has
 * fewer rows than it has items.
 *
 * It deliberately does NOT compare item TEXT. The matrix paraphrases headings
 * where the source wording is marketing ("Ultra-low-latency deterministic
 * matching engine"); the fidelity that matters is per-section coverage, not
 * string equality. Counting rows catches the real failure mode.
 *
 * It also validates the status vocabulary, because an audit with ad-hoc
 * statuses cannot be totalled, and a total nobody can compute is a claim.
 *
 * Usage:
 *   node scripts/check-production-matrix.mjs            # verify, human output
 *   node scripts/check-production-matrix.mjs --markdown # summary table for the doc
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKLIST = join(ROOT, 'docs', 'production-checklist.json');
const MATRIX = join(ROOT, 'docs', 'PRODUCTION-READINESS-MATRIX.md');
const MD = process.argv.includes('--markdown');

const STATUSES = ['CODE', 'SIM', 'PART', 'EXT', 'GAP'];
const STATUS_SET = new Set(STATUSES);

if (!existsSync(CHECKLIST) || !existsSync(MATRIX)) {
  console.error('Missing docs/production-checklist.json or docs/PRODUCTION-READINESS-MATRIX.md');
  process.exit(1);
}

const checklist = JSON.parse(readFileSync(CHECKLIST, 'utf8'));
const matrix = readFileSync(MATRIX, 'utf8');

/** Section heading -> item count, from the checklist. */
const expected = new Map();
for (const row of checklist) {
  const key = row.section.replace(/&amp;/g, '&').trim();
  expected.set(key, (expected.get(key) || 0) + 1);
}

/** Parse the matrix: `## <n>. <title>` blocks, then table rows. */
const sections = new Map();
let current = null;
const problems = [];

for (const line of matrix.split('\n')) {
  const heading = line.match(/^##\s+(.+?)\s*$/);
  if (heading) {
    current = heading[1].trim();
    if (!sections.has(current)) sections.set(current, []);
    continue;
  }
  if (!current || !line.startsWith('|')) continue;

  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 4) continue;
  const num = cells[1];
  if (!/^\d+$/.test(num)) continue; // header and separator rows
  const rawStatus = cells[3].replace(/\*/g, '');
  const status = rawStatus.split(/\s/)[0];

  if (!STATUS_SET.has(status)) {
    problems.push(`Unknown status "${rawStatus}" in "${current}" row ${num}`);
  }
  sections.get(current).push(status);
}

/* Map matrix headings to checklist headings. The checklist numbers sections
   0..48; the six unnumbered principles that follow are attributed to 48. */
const norm = (s) => s.replace(/^\d+\.\s*/, '').replace(/&amp;/g, '&').trim().toLowerCase();

const ALIASES = new Map([['core production principles', norm('48. Production Release Gate')]]);

const byNorm = new Map();
for (const [name, statuses] of sections) {
  const key = ALIASES.get(norm(name)) || norm(name);
  if (!byNorm.has(key)) byNorm.set(key, { name, statuses: [] });
  byNorm.get(key).statuses.push(...statuses);
}

const totals = Object.fromEntries(STATUSES.map((s) => [s, 0]));
let covered = 0;
const lines = [];

for (const [sectionName, count] of expected) {
  const match = byNorm.get(norm(sectionName));
  const statuses = match?.statuses || [];
  for (const s of statuses) totals[s] += 1;
  covered += statuses.length;

  const row = { section: sectionName, expected: count, rows: statuses.length };
  for (const s of STATUSES) row[s] = statuses.filter((x) => x === s).length;
  lines.push(row);

  if (statuses.length !== count) {
    problems.push(`"${sectionName}": ${statuses.length} row(s) for ${count} checklist item(s)`);
  }
}

lines.sort((a, b) => {
  const na = Number(a.section.match(/^(\d+)/)?.[1] ?? 99);
  const nb = Number(b.section.match(/^(\d+)/)?.[1] ?? 99);
  return na - nb;
});

const totalItems = [...expected.values()].reduce((a, b) => a + b, 0);

if (MD) {
  console.log('| Section | Items | CODE | SIM | PART | EXT | GAP |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of lines) {
    console.log(`| ${r.section} | ${r.expected} | ${r.CODE} | ${r.SIM} | ${r.PART} | ${r.EXT} | ${r.GAP} |`);
  }
  console.log(`| **Total** | **${totalItems}** | **${totals.CODE}** | **${totals.SIM}** | **${totals.PART}** | **${totals.EXT}** | **${totals.GAP}** |`);
} else {
  console.log('Section coverage');
  console.log('─'.repeat(78));
  for (const r of lines) {
    const flag = r.rows === r.expected ? ' ' : '!';
    console.log(
      `${flag} ${r.section.padEnd(34).slice(0, 34)} ${String(r.expected).padStart(3)} items  ` +
      `CODE ${String(r.CODE).padStart(3)}  SIM ${String(r.SIM).padStart(2)}  PART ${String(r.PART).padStart(3)}  ` +
      `EXT ${String(r.EXT).padStart(3)}  GAP ${String(r.GAP).padStart(3)}`
    );
  }
  console.log('─'.repeat(78));
  console.log(`Checklist items: ${totalItems}   Matrix rows: ${covered}`);
  console.log(STATUSES.map((s) => `${s} ${totals[s]}`).join('  '));
  console.log(`Unresolved: ${totals.EXT} external, ${totals.GAP} not implemented`);
}

if (problems.length) {
  console.error(`\n${problems.length} coverage problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

if (!MD) console.log('\n✓ Every checklist section is fully represented');
