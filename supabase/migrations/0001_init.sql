-- CryptoX initial schema (migration 0001)
-- Every table is owner-scoped: a signed-in user can only ever read or write their own rows.
-- RLS is enabled on every table and no policy grants anonymous access.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- settings
create table if not exists public.cx_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (char_length(display_name) <= 60),
  base_currency text not null default 'USD' check (char_length(base_currency) = 3),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- watchlist
create table if not exists public.cx_watchlist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  coin_id    text not null check (char_length(coin_id) <= 80),
  symbol     text not null check (char_length(symbol) <= 20),
  created_at timestamptz not null default now(),
  unique (user_id, coin_id)
);

-- ---------------------------------------------------------------- portfolio
create table if not exists public.cx_holdings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  coin_id    text not null check (char_length(coin_id) <= 80),
  symbol     text not null check (char_length(symbol) <= 20),
  amount     numeric(30, 12) not null check (amount > 0),
  buy_price  numeric(30, 12) not null check (buy_price >= 0),
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- alerts
create table if not exists public.cx_alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  coin_id      text not null check (char_length(coin_id) <= 80),
  symbol       text not null check (char_length(symbol) <= 20),
  direction    text not null check (direction in ('above', 'below')),
  target_price numeric(30, 12) not null check (target_price > 0),
  triggered_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------- armed strategies
create table if not exists public.cx_strategy_arms (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  preset_id  text not null check (char_length(preset_id) <= 60),
  coin_id    text not null check (char_length(coin_id) <= 80),
  symbol     text not null check (char_length(symbol) <= 20),
  interval   text not null check (interval in ('5m', '15m', '1h', '4h', '1d')),
  params     jsonb not null default '{}'::jsonb,
  active     boolean not null default true,
  last_state text,
  last_reason text,
  last_price numeric(30, 12),
  last_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, preset_id, coin_id, interval)
);

-- ---------------------------------------------------------- signal events
create table if not exists public.cx_signal_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  arm_id     uuid references public.cx_strategy_arms(id) on delete cascade,
  preset_id  text not null check (char_length(preset_id) <= 60),
  coin_id    text not null check (char_length(coin_id) <= 80),
  symbol     text not null check (char_length(symbol) <= 20),
  interval   text not null check (char_length(interval) <= 8),
  side       text not null check (side in ('BUY', 'SELL')),
  price      numeric(30, 12) not null check (price >= 0),
  reason     text check (char_length(reason) <= 300),
  simulated  boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ paper runs
create table if not exists public.cx_paper_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  preset_id    text not null check (char_length(preset_id) <= 60),
  coin_id      text not null check (char_length(coin_id) <= 80),
  symbol       text not null check (char_length(symbol) <= 20),
  interval     text not null check (char_length(interval) <= 8),
  started_cash numeric(30, 12) not null check (started_cash > 0),
  cash         numeric(30, 12) not null check (cash >= 0),
  holdings     jsonb not null default '[]'::jsonb,
  trades       jsonb not null default '[]'::jsonb,
  equity       jsonb not null default '[]'::jsonb,
  running      boolean not null default true,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index if not exists cx_watchlist_user_idx on public.cx_watchlist_items (user_id);
create index if not exists cx_holdings_user_idx  on public.cx_holdings (user_id);
create index if not exists cx_alerts_user_idx    on public.cx_alerts (user_id);
create index if not exists cx_arms_user_idx      on public.cx_strategy_arms (user_id);
create index if not exists cx_paper_user_idx     on public.cx_paper_runs (user_id);
create index if not exists cx_signals_user_time_idx on public.cx_signal_events (user_id, created_at desc);

-- --------------------------------------------------------- updated_at hook
create or replace function public.cx_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cx_settings_touch on public.cx_settings;
create trigger cx_settings_touch
  before update on public.cx_settings
  for each row execute function public.cx_touch_updated_at();

drop trigger if exists cx_paper_touch on public.cx_paper_runs;
create trigger cx_paper_touch
  before update on public.cx_paper_runs
  for each row execute function public.cx_touch_updated_at();

-- -------------------------------------------------------------------- RLS
alter table public.cx_settings        enable row level security;
alter table public.cx_watchlist_items enable row level security;
alter table public.cx_holdings        enable row level security;
alter table public.cx_alerts          enable row level security;
alter table public.cx_strategy_arms   enable row level security;
alter table public.cx_signal_events   enable row level security;
alter table public.cx_paper_runs      enable row level security;

-- Owner-scoped policies. Nothing here allows anonymous access: without a valid
-- auth.uid() the predicates are never true, so the tables return zero rows.

drop policy if exists cx_settings_owner on public.cx_settings;
create policy cx_settings_owner on public.cx_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_watchlist_owner on public.cx_watchlist_items;
create policy cx_watchlist_owner on public.cx_watchlist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_holdings_owner on public.cx_holdings;
create policy cx_holdings_owner on public.cx_holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_alerts_owner on public.cx_alerts;
create policy cx_alerts_owner on public.cx_alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_arms_owner on public.cx_strategy_arms;
create policy cx_arms_owner on public.cx_strategy_arms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Signals are an append-only audit trail: read and insert only, never update/delete.
drop policy if exists cx_signals_select on public.cx_signal_events;
create policy cx_signals_select on public.cx_signal_events
  for select using (auth.uid() = user_id);

drop policy if exists cx_signals_insert on public.cx_signal_events;
create policy cx_signals_insert on public.cx_signal_events
  for insert with check (auth.uid() = user_id);

drop policy if exists cx_paper_owner on public.cx_paper_runs;
create policy cx_paper_owner on public.cx_paper_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
