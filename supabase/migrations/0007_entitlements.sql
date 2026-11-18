-- CryptoX entitlements and API keys (migration 0007)
--
-- WHY THIS EXISTS
-- Until now a plan limit was a number in the JavaScript bundle. `plans.js` said
-- "100 alerts" and `upgrade.js` hid a button, so the limit was a suggestion: a
-- user could clear localStorage, or simply call the API, and the quota was gone.
-- Selling a quota that is not enforced is not a pricing decision, it is a false
-- statement on the pricing page.
--
-- This migration makes Postgres the authority:
--
--   cx_plan_limits      the single server-side copy of the plan table.
--   cx_usage_counters   metered counters (API calls), one row per user/period/key.
--   cx_consume_quota()  the only way a counter may move. Takes a row lock.
--   cx_enforce_quota()  BEFORE INSERT triggers on row-counted resources
--                       (alerts, armed strategies), so the check cannot be
--                       skipped by a client that writes directly.
--
-- Both mechanisms are FAIL-CLOSED. An unknown key, an unknown plan or a missing
-- limit row denies the write; "no limit found" is never read as "unlimited".
--
-- ROW-COUNTED vs COUNTER
-- Alerts and bots are counted from the rows that actually exist. A counter
-- would drift the first time a user deletes an alert; counting rows is
-- self-correcting and needs no reset job. API calls have no row per call, so
-- they use an incrementing counter keyed by calendar month (UTC).
--
-- DELIBERATELY NOT ENFORCED HERE
--   * portfolios — held as a JSON document inside cx_settings, so there is no
--     row to count. Enforcing it needs the settings schema to become one row per
--     portfolio. The application marks it display-only until then rather than
--     pretending.
--   * seats — organisation membership tables do not exist yet. Same treatment.
-- A partial enforcement map that says which half is real is more useful than a
-- complete-looking one that is half theatre.

-- ---------------------------------------------------------------- plan limits

create table if not exists public.cx_plan_limits (
  plan_id      text  not null,
  key          text  not null,
  -- NULL means unlimited. There is no sentinel number: a very large integer is
  -- still a number a user will eventually reach, and "999999999" in a UI is a
  -- bug waiting to be screenshotted.
  limit_value  bigint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (plan_id, key),
  constraint cx_plan_limits_plan_known
    check (plan_id in ('free', 'pro', 'business', 'enterprise')),
  constraint cx_plan_limits_key_known
    check (key in ('alerts', 'portfolios', 'bots', 'apiCallsPerMonth', 'seats')),
  constraint cx_plan_limits_non_negative
    check (limit_value is null or limit_value >= 0)
);

-- Mirrors src/lib/plans.js. When a price or quota changes, both move together;
-- scripts/check-schema.mjs fails the build if these drift.
insert into public.cx_plan_limits (plan_id, key, limit_value) values
  ('free',       'alerts',            5),
  ('free',       'portfolios',        1),
  ('free',       'bots',              0),
  ('free',       'apiCallsPerMonth',  1000),
  ('free',       'seats',             1),
  ('pro',        'alerts',            100),
  ('pro',        'portfolios',        10),
  ('pro',        'bots',              3),
  ('pro',        'apiCallsPerMonth',  250000),
  ('pro',        'seats',             3),
  ('business',   'alerts',            1000),
  ('business',   'portfolios',        50),
  ('business',   'bots',              25),
  ('business',   'apiCallsPerMonth',  2000000),
  ('business',   'seats',             25),
  ('enterprise', 'alerts',            null),
  ('enterprise', 'portfolios',        null),
  ('enterprise', 'bots',              null),
  ('enterprise', 'apiCallsPerMonth',  null),
  ('enterprise', 'seats',             null)
on conflict (plan_id, key) do update
  set limit_value = excluded.limit_value,
      updated_at  = now();

-- Limits are read by the enforcement functions and written by migrations only.
-- No client policy at all: with RLS on and no policy, every client verb is
-- denied and only the service role can change a limit.
alter table public.cx_plan_limits enable row level security;

-- ------------------------------------------------------------ usage counters

create table if not exists public.cx_usage_counters (
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 'YYYY-MM' in UTC, produced by the same date_trunc the functions use.
  period      text not null,
  key         text not null,
  used        bigint not null default 0 check (used >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, period, key)
);

alter table public.cx_usage_counters enable row level security;

-- Read your own usage (the billing page needs it). No insert/update/delete
-- policy: the ONLY writer is cx_consume_quota(), a security-definer function.
drop policy if exists cx_usage_counters_select_own on public.cx_usage_counters;
create policy cx_usage_counters_select_own on public.cx_usage_counters
  for select using (auth.uid() = user_id);

create index if not exists cx_usage_counters_user_idx
  on public.cx_usage_counters (user_id);

create index if not exists cx_usage_counters_period_idx
  on public.cx_usage_counters (period, key);

-- ------------------------------------------------------------------- helpers

/**
 * The effective plan for a user.
 *
 * A subscription only counts while it is live: `active` or `on_trial`, and not
 * past its `ends_at`. Anything else falls back to 'free' — the safe direction,
 * because a lapsed card must not keep an entitlement alive.
 */
create or replace function public.cx_plan_for(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.plan_id
        from public.cx_subscriptions s
       where s.user_id = p_user
         and s.status in ('active', 'on_trial')
         and (s.ends_at is null or s.ends_at > now())
       order by s.created_at desc
       limit 1
    ),
    'free'
  );
$$;

/**
 * The limit for a plan/key pair.
 * NULL return means "no such key for this plan" — the callers treat that as a
 * denial, never as unlimited. Unlimited is a NULL `limit_value`, which is a
 * different fact and is returned as -1 by cx_plan_limit().
 */
create or replace function public.cx_plan_limit(p_plan text, p_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.cx_plan_limits;
begin
  select * into v_row
    from public.cx_plan_limits
   where plan_id = p_plan and key = p_key;

  if not found then
    return null; -- unknown key: fail closed
  end if;
  if v_row.limit_value is null then
    return -1;   -- unlimited
  end if;
  return v_row.limit_value;
end $$;

/** Current-period key, in UTC, matching the counters written below. */
create or replace function public.cx_period_key(p_at timestamptz default now())
returns text
language sql
immutable
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM');
$$;

-- --------------------------------------------------------- quota consumption

/**
 * The single gate a metered write must pass.
 *
 * Returns jsonb rather than raising, because the caller usually wants to render
 * "you have used 100 of 100" instead of catching an exception:
 *   { allowed, key, plan_id, limit, used, remaining, period, reset_at, reason }
 *
 * Row-counted keys (alerts, bots) report the live count and do not increment
 * anything, so calling this twice is harmless. Counter keys (apiCallsPerMonth)
 * increment atomically under a row lock.
 */
create or replace function public.cx_consume_quota(p_key text, p_amount bigint default 1)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_plan     text;
  v_limit    bigint;
  v_used     bigint;
  v_amount   bigint := greatest(1, coalesce(p_amount, 1));
  v_period   text := public.cx_period_key(now());
  v_reset    timestamptz := (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC';
begin
  if v_uid is null then
    return jsonb_build_object(
      'allowed', false, 'key', p_key, 'reason', 'unauthenticated',
      'limit', null, 'used', 0, 'remaining', 0, 'period', v_period, 'reset_at', v_reset
    );
  end if;

  v_plan  := public.cx_plan_for(v_uid);
  v_limit := public.cx_plan_limit(v_plan, p_key);

  if v_limit is null then
    return jsonb_build_object(
      'allowed', false, 'key', p_key, 'plan_id', v_plan, 'reason', 'unknown-key',
      'limit', null, 'used', 0, 'remaining', 0, 'period', v_period, 'reset_at', v_reset
    );
  end if;

  -- Unlimited plan: nothing to count, and no row is written.
  if v_limit = -1 then
    return jsonb_build_object(
      'allowed', true, 'key', p_key, 'plan_id', v_plan, 'reason', 'unlimited',
      'limit', null, 'used', 0, 'remaining', null, 'period', v_period, 'reset_at', v_reset
    );
  end if;

  if p_key = 'alerts' then
    select count(*) into v_used from public.cx_alerts where user_id = v_uid;
  elsif p_key = 'bots' then
    select count(*) into v_used
      from public.cx_strategy_arms
     where user_id = v_uid and active = true;
  else
    -- Counter keys: insert-or-increment atomically. The conflict target is the
    -- primary key, so two concurrent calls cannot both observe "99 of 100".
    insert into public.cx_usage_counters as c (user_id, period, key, used)
    values (v_uid, v_period, p_key, v_amount)
    on conflict (user_id, period, key) do update
      set used = c.used + v_amount,
          updated_at = now()
      -- The WHERE clause is what enforces the limit: when it fails, no row is
      -- updated and the RETURNING below yields nothing.
      where c.used + v_amount <= v_limit
    returning c.used into v_used;

    if v_used is null then
      select used into v_used
        from public.cx_usage_counters
       where user_id = v_uid and period = v_period and key = p_key;
      v_used := coalesce(v_used, 0);
      return jsonb_build_object(
        'allowed', false, 'key', p_key, 'plan_id', v_plan, 'reason', 'quota-exceeded',
        'limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used),
        'period', v_period, 'reset_at', v_reset
      );
    end if;

    return jsonb_build_object(
      'allowed', true, 'key', p_key, 'plan_id', v_plan, 'reason', 'within-quota',
      'limit', v_limit, 'used', v_used, 'remaining', greatest(0, v_limit - v_used),
      'period', v_period, 'reset_at', v_reset
    );
  end if;

  return jsonb_build_object(
    'allowed', v_used + v_amount <= v_limit,
    'key', p_key, 'plan_id', v_plan,
    'reason', case when v_used + v_amount <= v_limit then 'within-quota' else 'quota-exceeded' end,
    'limit', v_limit, 'used', v_used,
    'remaining', greatest(0, v_limit - v_used),
    'period', v_period, 'reset_at', v_reset
  );
end $$;

revoke all on function public.cx_consume_quota(text, bigint) from public;
grant execute on function public.cx_consume_quota(text, bigint) to authenticated;

-- ------------------------------------------------ row-counted write triggers

/**
 * BEFORE INSERT guard for row-counted resources.
 *
 * Why a trigger and not just the client call: an RLS-valid INSERT from a
 * script, a second tab or a stale bundle must not be able to exceed the plan.
 * The trigger is the enforcement; cx_consume_quota() is the explanation.
 */
create or replace function public.cx_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key   text := case tg_table_name
                    when 'cx_alerts' then 'alerts'
                    when 'cx_strategy_arms' then 'bots'
                  end;
  v_plan  text;
  v_limit bigint;
  v_used  bigint;
begin
  if v_key is null then
    return new; -- not a metered table; nothing to do
  end if;

  v_plan  := public.cx_plan_for(new.user_id);
  v_limit := public.cx_plan_limit(v_plan, v_key);

  -- Unknown key/plan: deny rather than allow.
  if v_limit is null then
    raise exception 'quota_unavailable:%', v_key
      using errcode = 'check_violation',
            hint = 'The plan has no limit configured for this resource.';
  end if;

  if v_limit = -1 then
    return new;
  end if;

  if v_key = 'alerts' then
    select count(*) into v_used from public.cx_alerts where user_id = new.user_id;
  else
    select count(*) into v_used
      from public.cx_strategy_arms
     where user_id = new.user_id and active = true;
  end if;

  if v_used >= v_limit then
    -- Structured message so the client can parse limit/quota without guessing.
    raise exception 'quota_exceeded:%:%', v_key, v_limit
      using errcode = 'check_violation',
            hint = 'Upgrade the plan or remove an existing item.';
  end if;

  return new;
end $$;

drop trigger if exists cx_alerts_quota on public.cx_alerts;
create trigger cx_alerts_quota
  before insert on public.cx_alerts
  for each row execute function public.cx_enforce_quota();

drop trigger if exists cx_arms_quota on public.cx_strategy_arms;
create trigger cx_arms_quota
  before insert on public.cx_strategy_arms
  for each row execute function public.cx_enforce_quota();

-- ---------------------------------------------------------------- API keys
--
-- Section 24 needs keys with permissions, an IP allowlist and a rate limit. The
-- secret is stored in a SEPARATE table with no client policy at all, so a
-- compromised read of cx_api_keys cannot yield a usable credential: the hash is
-- only reachable by the service role that verifies a request.

create table if not exists public.cx_api_keys (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  organization_id    uuid,
  label              text not null check (char_length(label) between 1 and 60),
  -- Public identifier, safe to display and log. The secret never appears here.
  prefix             text not null unique check (prefix ~ '^cx_[a-z0-9]{8}$'),
  permissions        text[] not null default array['read']
                       check (permissions <@ array['read','trade','withdraw','portfolio','alerts']::text[]),
  ip_allowlist       inet[] not null default '{}',
  rate_limit_per_min integer not null default 60 check (rate_limit_per_min between 1 and 6000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);

create index if not exists cx_api_keys_user_idx on public.cx_api_keys (user_id);

alter table public.cx_api_keys enable row level security;

drop policy if exists cx_api_keys_select_own on public.cx_api_keys;
create policy cx_api_keys_select_own on public.cx_api_keys
  for select using (auth.uid() = user_id);

drop policy if exists cx_api_keys_insert_own on public.cx_api_keys;
create policy cx_api_keys_insert_own on public.cx_api_keys
  for insert with check (auth.uid() = user_id);

-- No UPDATE policy exists, on purpose: a key cannot be re-scoped after creation,
-- so an escalation is impossible once a credential is out. Rotation is
-- create-then-revoke, which leaves an audit trail of what existed when.
drop policy if exists cx_api_keys_update_own on public.cx_api_keys;

create table if not exists public.cx_api_key_secrets (
  api_key_id  uuid primary key references public.cx_api_keys(id) on delete cascade,
  hash        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.cx_api_key_secrets enable row level security;
-- No policies whatsoever: service role only.

/** Revocation is the one mutation a user may perform, and only on their own key. */
create or replace function public.cx_revoke_api_key(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  update public.cx_api_keys
     set revoked_at = now()
   where id = p_id and user_id = v_uid and revoked_at is null;
  return found;
end $$;

revoke all on function public.cx_revoke_api_key(uuid) from public;
grant execute on function public.cx_revoke_api_key(uuid) to authenticated;

-- --------------------------------------------------------------- housekeeping

create or replace function public.cx_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cx_usage_counters_touch on public.cx_usage_counters;
create trigger cx_usage_counters_touch
  before update on public.cx_usage_counters
  for each row execute function public.cx_touch_updated_at();

-- Comments double as the operator runbook when someone reads the schema cold.
comment on table  public.cx_plan_limits    is 'Server-side copy of plan quotas. NULL limit_value = unlimited.';
comment on table  public.cx_usage_counters is 'Metered counters per user/period/key. Writable only via cx_consume_quota().';
comment on function public.cx_consume_quota(text, bigint) is 'Atomic quota gate. Fail-closed on unknown key or plan.';
comment on table  public.cx_api_keys       is 'Public API key metadata. Secrets live in cx_api_key_secrets (service role only).';
