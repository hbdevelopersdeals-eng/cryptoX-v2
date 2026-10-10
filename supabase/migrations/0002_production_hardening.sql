-- CryptoX production hardening (migration 0002)
--
-- Builds on 0001, which already has FKs with explicit ON DELETE, per-user
-- indexes and RLS on every table. This migration closes the gaps it left:
--
--   1. updated_at only had a trigger on 2 of 7 tables, so for the rest the
--      column was decorative — it never changed after insert.
--   2. No UNIQUE constraints at all: the same symbol could be watched twice.
--   3. No soft deletion.
--   4. No audit trail.
--   5. No server-side CHECK constraints, so every validation rule lived only in
--      the browser. The brief is explicit: never rely exclusively on frontend
--      validation. A constraint here is the one the client cannot skip.
--
-- Every statement is idempotent so the migration can be re-run safely.

-- ------------------------------------------------------------------ timestamps

-- The touch triggers below assign updated_at. Four of these tables never had
-- the column, so without this the trigger would fail the first time a row was
-- updated — at runtime, in production, on the customer's first edit rather
-- than on the migration.
alter table public.cx_watchlist_items add column if not exists updated_at timestamptz not null default now();
alter table public.cx_holdings        add column if not exists updated_at timestamptz not null default now();
alter table public.cx_alerts          add column if not exists updated_at timestamptz not null default now();
alter table public.cx_strategy_arms   add column if not exists updated_at timestamptz not null default now();
alter table public.cx_signal_events   add column if not exists updated_at timestamptz not null default now();

-- 0001 created this function but attached it to only two tables.
do $$
declare t text;
begin
  foreach t in array array[
    'cx_watchlist_items', 'cx_holdings', 'cx_alerts', 'cx_strategy_arms', 'cx_signal_events'
  ]
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function public.cx_touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------ unique constraints

-- A natural key that was previously enforced only by hoping the UI prevented it.
create unique index if not exists cx_watchlist_user_symbol_uidx
  on public.cx_watchlist_items (user_id, symbol)
  where deleted_at is null;

-- Two identical alerts are a duplicate, not a second alert.
create unique index if not exists cx_alerts_user_dedupe_uidx
  on public.cx_alerts (user_id, symbol, rule_type)
  where deleted_at is null;

-- ---------------------------------------------------------------- soft deletion

-- Added where a restore is plausible. Deliberately NOT added to cx_signal_events:
-- that table is an append-only event log, and a "deleted" event is a
-- contradiction — retention handles its lifecycle instead.
alter table public.cx_watchlist_items add column if not exists deleted_at timestamptz;
alter table public.cx_holdings        add column if not exists deleted_at timestamptz;
alter table public.cx_alerts          add column if not exists deleted_at timestamptz;
alter table public.cx_strategy_arms   add column if not exists deleted_at timestamptz;

-- Partial indexes so the deleted rows are not carried in the hot path.
create index if not exists cx_watchlist_live_idx
  on public.cx_watchlist_items (user_id) where deleted_at is null;
create index if not exists cx_holdings_live_idx
  on public.cx_holdings (user_id) where deleted_at is null;
create index if not exists cx_alerts_live_idx
  on public.cx_alerts (user_id, symbol) where deleted_at is null;

-- --------------------------------------------------------- alert rule types
--
-- 0001 modelled an alert as a price target only (direction + target_price).
-- The application's model is broader: a rule of { type, value, symbol } with
-- sixteen types (price_above, pct_change, rsi_below, funding_above, formula…).
-- The check constraint and the dedupe index below referenced a rule_type column
-- that no migration ever created, so 0002 aborted on its first constraint and
-- never applied — meaning the server-side validation it promises was never in
-- place at all. Discovered by the schema-contract integration test.
alter table public.cx_alerts add column if not exists rule_type text;

-- Backfill from the price-target model so existing rows keep their meaning:
-- a 'below' alert is a price_below rule, anything else a price_above rule.
update public.cx_alerts
   set rule_type = case when direction = 'below' then 'price_below' else 'price_above' end
 where rule_type is null;

alter table public.cx_alerts alter column rule_type set not null;

-- --------------------------------------------------- server-side validation

-- These mirror the client validators. Duplicating a rule is the point: the
-- client copy exists for fast feedback, this one exists because the client
-- cannot be trusted to run at all.
--
-- The column names must match the tables as actually created above; an
-- earlier revision of this migration named columns that did not exist
-- (quantity / cost_basis), so the migration failed rather than validating.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cx_holdings_qty_positive') then
    alter table public.cx_holdings
      add constraint cx_holdings_qty_positive check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cx_holdings_cost_nonneg') then
    alter table public.cx_holdings
      add constraint cx_holdings_cost_nonneg check (buy_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cx_alerts_rule_type_known') then
    alter table public.cx_alerts
      add constraint cx_alerts_rule_type_known check (rule_type in (
        'price_above','price_below','pct_change','volume_spike','rsi_above','rsi_below',
        'ma_cross','macd_cross','breakout','portfolio_value_above','portfolio_value_below',
        'funding_above','funding_below','oi_change','liquidation_spike','formula'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cx_alerts_symbol_shape') then
    alter table public.cx_alerts
      add constraint cx_alerts_symbol_shape check (symbol ~ '^[A-Z0-9._-]{2,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cx_settings_currency_shape') then
    alter table public.cx_settings
      add constraint cx_settings_currency_shape check (base_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

-- ------------------------------------------------------------------- audit trail

-- Append-only by construction: RLS allows SELECT and INSERT, and there is
-- deliberately no UPDATE or DELETE policy, so the API cannot rewrite history
-- even with a valid token.
create table if not exists public.cx_audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  organization_id uuid,
  metadata      jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

create index if not exists cx_audit_actor_time_idx on public.cx_audit_log (actor_id, at desc);
create index if not exists cx_audit_action_idx     on public.cx_audit_log (action, at desc);
create index if not exists cx_audit_org_time_idx   on public.cx_audit_log (organization_id, at desc)
  where organization_id is not null;

alter table public.cx_audit_log enable row level security;

drop policy if exists cx_audit_select_own on public.cx_audit_log;
create policy cx_audit_select_own on public.cx_audit_log
  for select using (auth.uid() = actor_id);

drop policy if exists cx_audit_insert_own on public.cx_audit_log;
create policy cx_audit_insert_own on public.cx_audit_log
  for insert with check (auth.uid() = actor_id);

-- An audit row must not be rewritable. Enforced at the table level as well as
-- by the absence of a policy, so a future migration cannot quietly add one.
create or replace rule cx_audit_no_update as on update to public.cx_audit_log do instead nothing;
create or replace rule cx_audit_no_delete as on delete to public.cx_audit_log do instead nothing;

-- --------------------------------------------------------------- query support

-- Composite index for the most common read: this user's live rows, newest first.
create index if not exists cx_holdings_user_created_idx
  on public.cx_holdings (user_id, created_at desc) where deleted_at is null;
create index if not exists cx_arms_user_created_idx
  on public.cx_strategy_arms (user_id, created_at desc) where deleted_at is null;

-- --------------------------------------------------------- provider-side items
--
-- These are NOT expressible in a migration and are configured at the provider:
--   * point-in-time recovery and automated backups (Supabase: daily + PITR)
--   * encryption at rest (provider-managed; pgcrypto covers column-level needs)
--   * connection pooling (Supavisor / pgbouncer)
--   * query monitoring (pg_stat_statements + the provider's slow-query log)
--   * read replicas and multi-region failover
-- Recorded in src/lib/infrastructure.js as declarations with their status,
-- because a comment here cannot enforce them and pretending otherwise is how a
-- gap survives an audit.
