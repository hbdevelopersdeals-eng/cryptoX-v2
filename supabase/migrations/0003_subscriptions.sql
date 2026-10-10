-- CryptoX AI subscriptions (migration 0003)
--
-- Two tables, both deliberately write-only-by-service-role:
--
--   cx_subscriptions   the authoritative record of who is entitled to what.
--                      Entitlement is derived from THIS, never from a redirect.
--   cx_webhook_events  the idempotency ledger. The provider retries, so the
--                      same event WILL arrive more than once; the primary key
--                      on the event key is what makes a replay a no-op rather
--                      than a second subscription.
--
-- RLS: a user may SELECT only their own subscription. There is deliberately NO
-- insert, update or delete policy for any user, so entitlement cannot be
-- granted from the client at all — only the service role (the webhook function)
-- can write. That is the whole point of the design: a client that can write its
-- own entitlement row has no entitlement model.
--
-- Only plan ids that exist in the application are accepted, and only statuses
-- the entitlement rules already understand.

create table if not exists public.cx_subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  plan_id                   text not null,
  billing_cycle             text not null,
  status                    text not null,
  provider                  text not null default 'lemonsqueezy',
  provider_subscription_id  text,
  provider_customer_id      text,
  provider_order_id         text,
  variant_id                text,
  product_id                text,
  test_mode                 boolean not null default false,
  renews_at                 timestamptz,
  ends_at                   timestamptz,
  trial_ends_at             timestamptz,
  cancelled                 boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint cx_subscriptions_plan_known
    check (plan_id in ('pro', 'business', 'enterprise')),
  constraint cx_subscriptions_cycle_known
    check (billing_cycle in ('monthly', 'annual')),
  constraint cx_subscriptions_status_known
    check (status in ('on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired')),
  -- A test-mode row must never be mistakable for a live one.
  constraint cx_subscriptions_test_flag
    check (test_mode in (true, false))
);

-- One row per provider subscription. The partial index lets a row exist before
-- the provider id is known, while still refusing a duplicate once it is.
create unique index if not exists cx_subscriptions_provider_uidx
  on public.cx_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists cx_subscriptions_user_idx
  on public.cx_subscriptions (user_id);

alter table public.cx_subscriptions enable row level security;

-- A user can read their own subscription and nothing else.
drop policy if exists cx_subscriptions_select_own on public.cx_subscriptions;
create policy cx_subscriptions_select_own on public.cx_subscriptions
  for select using (auth.uid() = user_id);

-- NOTE: no insert/update/delete policy exists, on purpose. With RLS enabled and
-- no policy, those verbs are denied for every client role, so only the service
-- role can write. Do not add one without a very good reason.

-- --------------------------------------------------------------- webhook ledger

create table if not exists public.cx_webhook_events (
  -- The provider's event key: an explicit event id when the payload carries
  -- one, otherwise a digest of the raw body. Either way a retry collides.
  id            text primary key,
  provider      text not null default 'lemonsqueezy',
  event_name    text not null,
  test_mode     boolean not null default false,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text,
  attempts      integer not null default 0
);

alter table public.cx_webhook_events enable row level security;
-- No policies at all: this is an internal ledger. Not readable by any client.

create index if not exists cx_webhook_events_received_idx
  on public.cx_webhook_events (received_at);

-- --------------------------------------------------------------- updated_at

create or replace function public.cx_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cx_subscriptions_touch on public.cx_subscriptions;
create trigger cx_subscriptions_touch
  before update on public.cx_subscriptions
  for each row execute function public.cx_touch_updated_at();
