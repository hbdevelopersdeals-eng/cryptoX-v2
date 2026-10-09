#!/usr/bin/env node
/* Responsive and accessibility guard (Sections 16 and 17).
 *
 * Two lessons are baked in:
 *   1. Scan whole JSX ELEMENTS, not single lines. Attributes routinely span
 *      several lines, so a line-based check reported ~150 form controls as
 *      unlabelled when the label was simply on the next line. A guard that
 *      cries wolf gets switched off.
 *   2. Aggregate repeated warnings. 300 identical "tiny text" lines is noise
 *      that hides the one real finding underneath it.
 *
 * What this CANNOT do, and does not claim: verify colour contrast, run a
 * screen reader, or judge whether a label is meaningful. Those need axe-core
 * and human testing. This catches mechanical failures.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SKIP = new Set(['node_modules', 'dist', '.git', 'scripts', 'test']);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.jsx', '.js'].includes(extname(full)) && !/\.test\./.test(full)) out.push(full);
  }
  return out;
};

const errors = [];
const warnings = [];
const err = (file, line, rule, msg) => errors.push({ file: relative(ROOT, file), line, rule, msg });
const warn = (file, line, rule, msg) => warnings.push({ file: relative(ROOT, file), line, rule, msg });

/**
 * Yield every opening tag for the given names, spanning lines and JSX braces.
 * A naive /<tag[^>]*>/ stops at the first '>' inside "=>", so brace depth is
 * tracked explicitly.
 */
function* openingTags(source, names) {
  const re = new RegExp(`<(${names.join('|')})\\b`, 'g');
  let m;
  while ((m = re.exec(source))) {
    const start = m.index;
    let i = re.lastIndex;
    let depth = 0;
    let quote = null;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote && source[i - 1] !== '\\') quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    yield {
      text: source.slice(start, i + 1),
      line: source.slice(0, start).split('\n').length,
      index: start,
      name: m[1]
    };
    re.lastIndex = i + 1;
  }
}

/**
 * Is this position inside a <label> element?
 * A wrapping label provides the accessible name just as aria-label does, so a
 * control inside one is labelled. Nearest-unclosed-<label wins, which is
 * correct for non-nested labels.
 */
const insideLabel = (source, index) => {
  const lastOpen = source.lastIndexOf('<label', index);
  if (lastOpen === -1) return false;
  return lastOpen > source.lastIndexOf('</label>', index);
};

/* ---------------------------------------------------------------- index.html */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
  err(join(ROOT, 'index.html'), 1, 'viewport-meta', 'No viewport meta tag; mobile renders at desktop width.');
} else if (!/width=device-width/.test(html)) {
  err(join(ROOT, 'index.html'), 1, 'viewport-width', 'viewport meta does not set width=device-width.');
}

/* ---------------------------------------------------------- global stylesheet */

const cssFiles = [];
const findCss = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findCss(full);
    else if (extname(full) === '.css') cssFiles.push(full);
  }
};
findCss(SRC);
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const hasReducedMotion = /prefers-reduced-motion/.test(css);
if (!hasReducedMotion) {
  err(cssFiles[0] || SRC, 1, 'reduced-motion', 'No prefers-reduced-motion rule anywhere in the stylesheets.');
}

/* ------------------------------------------------------------------ per file */

const files = walk(SRC);
for (const file of files) {
  const source = readFileSync(file, 'utf8');

  for (const tag of openingTags(source, ['input', 'select', 'textarea'])) {
    // A spread may carry the label, so it cannot be judged statically.
    if (/\{\.\.\./.test(tag.text)) continue;
    const labelled = /aria-label=|aria-labelledby=|\bid=/.test(tag.text) || insideLabel(source, tag.index);
    if (!labelled) {
      err(file, tag.line, 'control-label', `<${tag.name}> with no aria-label / aria-labelledby / id and no wrapping <label>.`);
    }
  }

  for (const tag of openingTags(source, ['img'])) {
    if (!/\balt=/.test(tag.text)) err(file, tag.line, 'img-alt', 'img without alt. Use alt="" if decorative.');
  }

  for (const tag of openingTags(source, ['button'])) {
    const iconOnly = /^<button\b[^>]*>\s*<[A-Z]\w*\s[^>]*\/>\s*<\/button>$/s.test(tag.text)
      || /^<button\b[^>]*>\s*<\/button>$/.test(tag.text);
    if (iconOnly && !/aria-label=/.test(tag.text)) {
      err(file, tag.line, 'icon-button-label', 'Icon-only button with no aria-label.');
    }
  }

  for (const tag of openingTags(source, ['div', 'span'])) {
    const defensive = /onClick=\{\(?\w*\)?\s*=>\s*\{?\s*\w+\.stopPropagation\(\)/.test(tag.text);
    if (/onClick=/.test(tag.text) && !defensive && !/role=/.test(tag.text) && !/aria-hidden/.test(tag.text)) {
      err(file, tag.line, 'clickable-div', `${tag.name} with onClick and no role — unreachable by keyboard. Use a button.`);
    }
  }

  // --- class-list checks: search the source, report precise lines ---
  source.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    if (/(?<![\w-])h-screen\b/.test(line)) {
      err(file, i + 1, 'h-screen', 'h-screen/min-h-screen uses the large viewport; use dvh so the bottom is not behind the iOS URL bar.');
    }
    /*
     * A bare `w-[Npx]` is the problem; `max-w-[Npx]`, `min-w-[Npx]` and
     * `sm:w-[Npx]` are the FIX. The word boundary fires after the hyphen, so the
     * lookbehind is what stops this flagging the very thing it recommends.
     */
    for (const m of line.matchAll(/(?<![-\w.[\]])w-\[(\d{3,})px\]/g)) {
      if (Number(m[1]) > 420) err(file, i + 1, 'fixed-width', `w-[${m[1]}px] exceeds small-phone width with no max-w.`);
    }
    const tab = line.match(/tabIndex=\{?["']?([1-9]\d*)/);
    if (tab) err(file, i + 1, 'positive-tabindex', `Positive tabIndex (${tab[1]}) breaks natural focus order.`);

    // focus-within counts: a wrapper that draws the ring on behalf of its input
    // is a legitimate replacement for the input's own outline.
    if (/\boutline-none\b/.test(line) && !/focus-visible|focus-within|focus:/.test(source)) {
      err(file, i + 1, 'focus-visible', 'outline-none with no focus-visible / focus-within style in this file.');
    }

    // --- aggregated warnings ---
    if (/text-\[(9|10)px\]/.test(line)) warn(file, i + 1, 'tiny-text', 'text below 11px');
    const grid = line.match(/\bgrid-cols-(\d)\b/);
    if (grid && !/(sm|md|lg|xl|2xl):grid-cols/.test(line)) warn(file, i + 1, 'grid-no-breakpoint', `grid-cols-${grid[1]} with no responsive variant`);
  });
}

/* ---------------------------------------------------------------- reporting */

const summarise = (list) => {
  const byRule = new Map();
  for (const item of list) {
    if (!byRule.has(item.rule)) byRule.set(item.rule, []);
    byRule.get(item.rule).push(item);
  }
  const out = [];
  for (const [rule, items] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`  [${rule}] ${items.length} occurrence(s)`);
    for (const item of items.slice(0, 6)) out.push(`      ${item.file}:${item.line} — ${item.msg}`);
    if (items.length > 6) out.push(`      … and ${items.length - 6} more`);
  }
  return out.join('\n');
};

/*
 * Known outstanding defects.
 *
 * This is a RATCHET, not an exemption. The count may not grow: a new unlabelled
 * control fails the build. The existing ones are printed on every run with
 * their number, so they stay visible rather than being buried by a blanket
 * downgrade to "warning" - which is what a guard does when it wants to pass
 * more than it wants to be true.
 *
 * These are all one defect: a control whose label is a neighbouring <span> or
 * <p> rather than a real <label> or aria-label, so a screen reader announces it
 * unnamed. The fix is mechanical and outstanding, not disputed.
 */
const KNOWN_GAPS = { 'control-label': 71 };

console.log(`Checked ${files.length} source files. Reduced-motion rule present: ${hasReducedMotion}.`);
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n${summarise(warnings)}`);

const counts = {};
for (const e of errors) counts[e.rule] = (counts[e.rule] || 0) + 1;
const grown = Object.entries(counts).filter(([rule, n]) => n > (KNOWN_GAPS[rule] || 0));
const withinBaseline = Object.entries(counts).filter(([rule, n]) => (KNOWN_GAPS[rule] || 0) >= n);

if (grown.length) {
  console.log(`\n${errors.length} error(s):\n${summarise(errors)}`);
  for (const [rule, n] of grown) {
    console.log(`  RATCHET EXCEEDED: [${rule}] ${n} > baseline ${KNOWN_GAPS[rule] || 0}`);
  }
  console.log('\nFAILED');
  process.exit(1);
}

if (withinBaseline.length) {
  console.log('\nKnown outstanding defects (ratcheted - count may not grow):');
  for (const [rule, n] of withinBaseline) {
    console.log(`  [${rule}] ${n} occurrence(s), baseline ${KNOWN_GAPS[rule]}`);
  }
}
console.log('\nPASSED (no NEW responsive/accessibility errors)');
