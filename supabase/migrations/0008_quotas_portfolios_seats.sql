-- Portfolios and seats: the last two quotas that were only a number in the bundle
-- (migration 0008)
--
-- WHY THIS EXISTS
-- 0007 made alerts, bots and API calls real: a BEFORE INSERT trigger refuses the
-- row, so editing localStorage or calling the API directly cannot exceed the plan.
-- Two quotas were left out for a structural reason rather than an oversight:
--
--   portfolios  stored as a JSON array inside cx_settings, so no row existed to
--               count. There was nothing for a trigger to guard.
--   seats       no organisation tables existed at all, so there was no membership
--               to count either.
--
-- `src/lib/entitlements.js` reported both as `server: false` and the pricing page
-- said so in the disclosure block. That was honest but still a gap between what a
-- plan sells and what the database enforces. This migration closes it:
--
--   · cx_settings.portfolios becomes an explicit jsonb array with a CHECK, and a
--     trigger refuses an array longer than the plan allows. Counting the array is
--     self-correcting — deleting a portfolio frees a slot with no reset job.
--   · cx_organizations + cx_org_members give seats something to count. The limit
--     comes from the ORGANISATION OWNER's plan, because seats are bought by the
--     owner, not by the person being invited.
--
-- BOTH ARE FAIL-CLOSED. An unknown plan, a missing limit row or a missing owner
-- raises, exactly as 0007 does; "no limit found" is never read as unlimited.
--
-- ORDER OF OPERATIONS: apply 0007 first (it defines cx_plan_for, cx_plan_limit
-- and the cx_*_quota triggers this file extends). Then flip `ENFORCEMENT` in
-- src/lib/entitlements.js for portfolios and seats to `server: true` and redeploy;
-- the pricing disclosure disappears by itself once the code agrees with the
-- database, which is the point of deriving it instead of writing it.

-- ------------------------------------------------------- portfolios (json array)

alter table public.cx_settings
  add column if not exists portfolios jsonb;

update public.cx_settings set portfolios = '[]'::jsonb where portfolios is null;

alter table public.cx_settings alter column portfolios set default '[]'::jsonb;
alter table public.cx_settings alter column portfolios set not null;

-- A CHECK is added by name only when absent: `add constraint` is not idempotent,
-- and migrations are re-run on a fresh database as well as an existing one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cx_settings_portfolios_is_array'
       and conrelid = 'public.cx_settings'::regclass
  ) then
    alter table public.cx_settings
      add constraint cx_settings_portfolios_is_array
      check (jsonb_typeof(portfolios) = 'array');
  end if;
end $$;

comment on column public.cx_settings.portfolios is
  'User portfolios as a JSON array. Length is quota-enforced by cx_settings_portfolios_quota; replacing the whole array is the only write path.';

/**
 * Refuses a settings write that would hold more portfolios than the plan allows.
 *
 * Counting the array rather than storing a counter is deliberate: a counter
 * drifts the first time a user deletes a portfolio, and a drift is
 * indistinguishable from a lie about what the customer bought.
 */
create or replace function public.cx_enforce_portfolio_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  text;
  v_limit bigint;
  v_count integer;
begin
  v_plan  := public.cx_plan_for(new.user_id);
  v_limit := public.cx_plan_limit(v_plan, 'portfolios');
  v_count := coalesce(jsonb_array_length(new.portfolios), 0);

  -- Unknown plan/key: deny, never allow.
  if v_limit is null then
    raise exception 'quota_unavailable:portfolios'
      using errcode = 'check_violation',
            hint = 'The plan has no limit configured for portfolios.';
  end if;

  -- -1 is unlimited (see cx_plan_limit).
  if v_limit = -1 then
    return new;
  end if;

  if v_count > v_limit then
    raise exception 'quota_exceeded:portfolios:%', v_limit
      using errcode = 'check_violation',
            hint = 'Remove a portfolio or upgrade the plan.';
  end if;

  return new;
end $$;

drop trigger if exists cx_settings_portfolios_quota on public.cx_settings;
create trigger cx_settings_portfolios_quota
  before insert or update of portfolios on public.cx_settings
  for each row execute function public.cx_enforce_portfolio_quota();

-- ------------------------------------------------------ organisations and seats

create table if not exists public.cx_organizations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cx_organizations_user_idx  on public.cx_organizations (user_id);

alter table public.cx_organizations enable row level security;

drop policy if exists cx_organizations_owner_all on public.cx_organizations;
create policy cx_organizations_owner_all on public.cx_organizations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

/* Membership. `user_id` (not `member_id`) so the schema guard's owner-index rule
   applies and every query that lists "my organisations" is indexed. */
create table if not exists public.cx_org_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.cx_organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member'
                    check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists cx_org_members_user_idx on public.cx_org_members (user_id);
create index if not exists cx_org_members_org_idx  on public.cx_org_members (organization_id);

alter table public.cx_org_members enable row level security;

/**
 * Owner check as a SECURITY DEFINER helper.
 *
 * A policy on cx_org_members that sub-selects cx_organizations would recurse into
 * the other table's policy for every row; the helper runs with definer rights and
 * breaks the cycle. It returns false for an anonymous caller.
 */
create or replace function public.cx_is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.cx_organizations o
     where o.id = p_org and o.user_id = auth.uid()
  );
$$;

revoke all on function public.cx_is_org_owner(uuid) from public;
grant execute on function public.cx_is_org_owner(uuid) to authenticated;

drop policy if exists cx_org_members_select on public.cx_org_members;
create policy cx_org_members_select on public.cx_org_members
  for select using (user_id = auth.uid() or public.cx_is_org_owner(organization_id));

drop policy if exists cx_org_members_insert on public.cx_org_members;
create policy cx_org_members_insert on public.cx_org_members
  /* The helper does the real check; the explicit `auth.uid() is not null` states
   * the intent (an anonymous caller can never add a member) and keeps every
   * policy in this schema auditable by the same rule. */
  for insert with check (auth.uid() is not null and public.cx_is_org_owner(organization_id));

drop policy if exists cx_org_members_delete on public.cx_org_members;
create policy cx_org_members_delete on public.cx_org_members
  for delete using (auth.uid() is not null and public.cx_is_org_owner(organization_id));

/* No UPDATE policy: a member cannot re-scope their own role, so privilege
   escalation needs the service role and leaves an audit trail. */

/**
 * Refuses a membership row that would exceed the OWNER's plan seats.
 *
 * The owner is billed for seats, so the owner's plan — not the invitee's — is the
 * limit. A free owner (1 seat) therefore cannot invite anybody, which is what the
 * pricing page sells.
 */
create or replace function public.cx_enforce_seat_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_plan  text;
  v_limit bigint;
  v_used  integer;
begin
  select o.user_id into v_owner
    from public.cx_organizations o
   where o.id = new.organization_id;

  if v_owner is null then
    raise exception 'quota_unavailable:seats'
      using errcode = 'check_violation',
            hint = 'The organisation does not exist or has no owner.';
  end if;

  v_plan  := public.cx_plan_for(v_owner);
  v_limit := public.cx_plan_limit(v_plan, 'seats');

  if v_limit is null then
    raise exception 'quota_unavailable:seats'
      using errcode = 'check_violation',
            hint = 'The plan has no limit configured for seats.';
  end if;

  if v_limit = -1 then
    return new;
  end if;

  select count(*) into v_used
    from public.cx_org_members m
   where m.organization_id = new.organization_id;

  if v_used >= v_limit then
    raise exception 'quota_exceeded:seats:%', v_limit
      using errcode = 'check_violation',
            hint = 'Upgrade the plan or remove a member.';
  end if;

  return new;
end $$;

drop trigger if exists cx_org_members_quota on public.cx_org_members;
create trigger cx_org_members_quota
  before insert on public.cx_org_members
  for each row execute function public.cx_enforce_seat_quota();

drop trigger if exists cx_organizations_touch on public.cx_organizations;
create trigger cx_organizations_touch
  before update on public.cx_organizations
  for each row execute function public.cx_touch_updated_at();

drop trigger if exists cx_org_members_touch on public.cx_org_members;
create trigger cx_org_members_touch
  before update on public.cx_org_members
  for each row execute function public.cx_touch_updated_at();

-- ------------------------------------------- quota gate: the two new key shapes

/**
 * 0007's gate, extended with the two keys that are not simple counters.
 *
 * Kept as a full `create or replace` because a SQL function cannot be patched —
 * and because the alternative (a second function) would mean two definitions of
 * "how many does this user have", which is how the pricing table went wrong in
 * the first place.
 *
 *   alerts, bots   row-counted (existing)
 *   portfolios     jsonb array length in cx_settings
 *   seats          membership count in the caller's owned organisations
 *   everything else  monthly counter
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

  elsif p_key = 'portfolios' then
    select coalesce(jsonb_array_length(s.portfolios), 0) into v_used
      from public.cx_settings s
     where s.user_id = v_uid;
    v_used := coalesce(v_used, 0);

  elsif p_key = 'seats' then
    select count(*) into v_used
      from public.cx_org_members m
      join public.cx_organizations o on o.id = m.organization_id
     where o.user_id = v_uid;

  else
    insert into public.cx_usage_counters as c (user_id, period, key, used)
    values (v_uid, v_period, p_key, v_amount)
    on conflict (user_id, period, key) do update
      set used = c.used + v_amount,
          updated_at = now()
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

comment on table  public.cx_organizations is 'Organisation owned by one user; seats are billed to the owner.';
comment on table  public.cx_org_members   is 'Membership. Insert is quota-checked against the owner plan; no UPDATE policy.';
comment on function public.cx_enforce_portfolio_quota() is 'Refuses a cx_settings write holding more portfolios than the plan allows.';
comment on function public.cx_enforce_seat_quota() is 'Refuses an invite past the owner plan seat count.';
