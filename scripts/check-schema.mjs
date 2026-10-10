#!/usr/bin/env node
/* Database schema guard (Section 20).
 *
 * Verifies the migrations against the requirements as CODE, not as a comment.
 * The checks that matter most:
 *
 *   - RLS enabled on EVERY table. A table without it is readable by anyone with
 *     the anon key, which in a client-only app is everyone. 0001 got this right;
 *     this guard is what stops a future table from missing it.
 *   - An index for every user_id column, because every query is owner-scoped.
 *   - deleted_at only where a partial index uses it, so soft-deleted rows do
 *     not sit in the hot path.
 *   - Server-side CHECK constraints, since the brief is explicit that frontend
 *     validation alone is not acceptable.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const errors = [];
const notes = [];
const err = (file, rule, msg) => errors.push({ file, rule, msg });

/* ---- migration system: sequential, unique, well named ---- */
const seen = new Map();
for (const f of files) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(f)) err(f, 'migration-name', 'Expected NNNN_snake_case.sql.');
  const prefix = f.slice(0, 4);
  if (seen.has(prefix)) err(f, 'migration-duplicate', `Prefix ${prefix} also used by ${seen.get(prefix)}.`);
  seen.set(prefix, f);
}
notes.push(`migrations: ${files.join(', ')}`);

const all = files.map((f) => ({ file: f, sql: readFileSync(join(DIR, f), 'utf8') }));
const combined = all.map((x) => x.sql).join('\n');

const strip = (sql) => sql.replace(/--[^\n]*/g, ''); // comments must not satisfy a check

/* ---- tables, RLS, timestamps ---- */
const tables = new Set();
for (const { file, sql } of all) {
  const body = strip(sql);
  for (const m of body.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) tables.add(m[1]);
}

const rlsEnabled = new Set(
  [...combined.matchAll(/alter table (?:if exists )?public\.(\w+)\s+enable row level security/gi)].map((m) => m[1])
);

for (const table of tables) {
  if (!rlsEnabled.has(table)) {
    err('*', 'rls-missing', `public.${table} has no "enable row level security". Anyone with the anon key can read it.`);
  }
}

/* ---- per-table structural expectations ---- */

/*
 * Columns arrive from BOTH `create table` and later `alter table ... add column`.
 * Reading only the create block made a column added by a migration invisible,
 * so the guard reported "no updated_at" for a table that had just been given it.
 */
const tableBlocks = new Map();
for (const { sql } of all) {
  const body = strip(sql);
  for (const m of body.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    tableBlocks.set(m[1], `${tableBlocks.get(m[1]) || ''}${m[2]}\n`);
  }
  for (const m of body.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
    tableBlocks.set(m[1], `${tableBlocks.get(m[1]) || ''}${m[2]}\n`);
  }
}

for (const [table, block] of tableBlocks) {
  // The requirement is a creation timestamp, not one exact column name.
  const creationCol = (block.match(/(created_at|\bat\b|started_at|opened_at|submitted_at|received_at)/) || [])[1];
  const hasUpdated = /updated_at/.test(block);
  if (table.startsWith('cx_') && !creationCol) {
    err('*', 'timestamp-created', `public.${table} has no creation timestamp (created_at / at / started_at).`);
  }
  // An append-only event log has no meaningful updated_at, so it is not required.
  const appendOnly = /cx_signal_events|cx_audit_log/.test(table);
  if (!appendOnly && !hasUpdated) err('*', 'timestamp-updated', `public.${table} has no updated_at.`);

  // A primary key is already an index; flagging it is a false positive.
  const userIdIsPk = /user_id\s+uuid\s+primary key/i.test(block);
  if (/user_id/.test(block) && !userIdIsPk) {
    const idx = new RegExp(`on public\\.${table}\\s*\\(user_id`, 'i');
    if (!idx.test(combined)) {
      err('*', 'index-user-id', `public.${table} has user_id but no index starting with it; every query is owner-scoped.`);
    }
  }
  if (/deleted_at/.test(block) && !new RegExp(`on public\\.${table}[^;]*where deleted_at is null`, 'i').test(combined)) {
    err('*', 'soft-delete-index', `public.${table} has deleted_at but no partial index excluding deleted rows.`);
  }
}

/* ---- required constructs across the schema ---- */
const require = (pattern, rule, msg) => { if (!pattern.test(combined)) err('*', rule, msg); };
require(/\bcreate index|create unique index/i, 'indexes', 'No indexes defined anywhere.');
require(/\breferences\b/i, 'foreign-keys', 'No foreign keys defined anywhere; referential integrity is unenforced.');
require(/\bunique\b/i, 'unique-constraints', 'No unique constraint or unique index; duplicates are unprevented.');
require(/check\s*\(/i, 'server-validation', 'No CHECK constraints; every validation rule would live only in the browser.');
require(/\b(uuid|ulid)\b/i, 'identifiers', 'No uuid column found.');
require(/timestamptz|timestamp with time zone/i, 'utc-timestamps', 'No timestamptz column; naive timestamps break across zones.');
require(/now\(\)|gen_random_uuid\(\)/i, 'defaults', 'No server-side defaults found.');

/* ---- destructive statements ---- */
for (const { file, sql } of all) {
  const body = strip(sql);
  for (const m of body.matchAll(/\b(drop table|truncate|drop schema)\b/gi)) {
    err(file, 'destructive', `"${m[0]}" in a migration. Destructive changes need their own reviewed migration.`);
  }
}

/* ---- every referenced column must exist ----
 *
 * The guard above checks PRESENCE (an index exists, RLS is on). This checks
 * REFERENCE: every column named in a constraint, index or trigger must be a
 * column the same table actually has.
 *
 * This is not hypothetical. Migration 0002 added `check (quantity > 0)` to
 * cx_holdings, which has `amount`, and indexed cx_alerts(rule_type) before any
 * migration created that column. Postgres aborts the whole migration on the
 * first such statement, so the server-side validation it promised had never
 * been applied — while every presence check above still passed. A schema that
 * cannot be applied is worse than one that is merely incomplete, because it
 * fails at deploy time rather than at review time.
 */
const COLUMN_TYPES = 'uuid|text|numeric|boolean|jsonb|timestamptz|bigint|integer|double precision';
const columnsOf = new Map();
for (const { sql } of all) {
  const body = strip(sql);
  for (const m of body.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    const set = columnsOf.get(m[1]) || new Set();
    for (const lineText of m[2].split('\n')) {
      const col = lineText.trim().match(new RegExp(`^([a-z_][a-z0-9_]*)\\s+(${COLUMN_TYPES})`, 'i'));
      if (col) set.add(col[1]);
    }
    columnsOf.set(m[1], set);
  }
  for (const m of body.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
    const set = columnsOf.get(m[1]) || new Set();
    set.add(m[2]);
    columnsOf.set(m[1], set);
  }
}

// Keywords, literals and function names are not column references.
const SQL_WORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'case', 'when',
  'then', 'else', 'end', 'true', 'false', 'check', 'constraint', 'alter', 'table',
  'add', 'if', 'exists', 'coalesce', 'char_length', 'now', 'current_user', 'auth',
  'uid', 'public', 'array', 'default', 'unique', 'index', 'create', 'on', 'using',
  'text', 'uuid', 'bigint', 'jsonb', 'numeric', 'boolean', 'timestamptz', 'primary',
  'key', 'references', 'cascade', 'delete', 'set', 'identity', 'always', 'as',
  'generated', 'by', 'partition', 'range', 'like', 'interval', 'extract', 'epoch',
  'date', 'lower', 'upper', 'length', 'substring', 'desc', 'asc'
]);
const referenced = (expr) => [...new Set(
  (String(expr).replace(/'[^']*'/g, ' ').match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [])
    .filter((w) => !SQL_WORDS.has(w.toLowerCase()))
)];

for (const { file, sql } of all) {
  const body = strip(sql);

  for (const m of body.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add constraint (\w+)\s+check \(([\s\S]*?)\);/gi)) {
    const cols = columnsOf.get(m[1]);
    if (!cols) { err(file, 'constraint-unknown-table', `${m[2]} constrains public.${m[1]}, which no migration creates.`); continue; }
    for (const id of referenced(m[3])) {
      if (!cols.has(id)) err(file, 'constraint-missing-column', `${m[2]} references ${m[1]}.${id}, which does not exist. Postgres aborts the migration here.`);
    }
  }

  for (const m of body.matchAll(/create (?:unique )?index (?:if not exists )?(\w+)\s+on public\.(\w+)\s*\(([^)]*)\)([\s\S]*?);/gi)) {
    const cols = columnsOf.get(m[2]);
    if (!cols) { err(file, 'index-unknown-table', `${m[1]} indexes public.${m[2]}, which no migration creates.`); continue; }
    for (const raw of m[3].split(',')) {
      const col = raw.trim().split(/\s+/)[0];
      if (col && !cols.has(col)) err(file, 'index-missing-column', `${m[1]} indexes ${m[2]}.${col}, which does not exist.`);
    }
    for (const id of referenced(m[4])) {
      if (!cols.has(id)) err(file, 'index-missing-column', `${m[1]} filters on ${m[2]}.${id}, which does not exist.`);
    }
  }

  for (const m of body.matchAll(/create trigger (\w+)\s+(?:before|after)\s+\w+\s+on public\.(\w+)/gi)) {
    const cols = columnsOf.get(m[2]);
    if (cols && /_touch$/.test(m[1]) && !cols.has('updated_at')) {
      err(file, 'trigger-missing-column', `${m[1]} assigns updated_at on public.${m[2]}, which has no such column.`);
    }
  }
}

notes.push(`columns checked on ${columnsOf.size} table(s), ${[...columnsOf.values()].reduce((a, s) => a + s.size, 0)} column(s)`);

/* ---- append-only guarantee ---- */
if (/cx_audit_log/.test(combined)) {
  const hasNoUpdate = /on update to public\.cx_audit_log do instead nothing/i.test(combined);
  const hasNoDelete = /on delete to public\.cx_audit_log do instead nothing/i.test(combined);
  if (!hasNoUpdate || !hasNoDelete) {
    err('*', 'audit-immutable', 'cx_audit_log lacks a rule blocking UPDATE/DELETE; absence of a policy is not the same as prevention.');
  }
}

/* ---- reporting ---- */
console.log(`Schema guard: ${files.length} migration(s), ${tables.size} table(s), ${rlsEnabled.size} with RLS.`);
for (const n of notes) console.log(`  ${n}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  [${e.rule}] ${e.file}: ${e.msg}`);
  console.log('\nFAILED');
  process.exit(1);
}
console.log('\nPASSED');
