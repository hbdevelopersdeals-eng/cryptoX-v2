-- Checkout nonces (migration 0004)
--
-- This table is what makes attribution trustworthy, and it is the reason a
-- checkout URL carries an opaque nonce instead of a user id.
--
-- The flow:
--   1. The server mints a random nonce and writes a row here, bound to the
--      authenticated user and the exact plan and cycle they chose.
--   2. The app builds the checkout URL with checkout[custom][nonce]=<nonce>.
--   3. Lemon Squeezy echoes that back on the webhook as meta.custom_data.nonce.
--   4. The webhook resolves the nonce HERE to find the user.
--
-- A checkout URL is user-visible and user-editable, so it must carry something
-- worthless to forge. A forged nonce has no row, so it resolves to nobody and
-- nothing is granted. A consumed nonce is refused, so replaying a captured
-- webhook cannot re-activate a cancelled subscription.
--
-- RLS: no client policy at all. Clients never read or write nonces — they are
-- created by the checkout function (service role) and read by the webhook
-- (service role). A client that could insert a nonce could mint itself a
-- subscription.

create table if not exists public.cx_checkout_nonces (
  nonce        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  plan_id      text not null,
  billing_cycle text not null,
  variant_id   text not null,
  test_mode    boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,

  constraint cx_checkout_nonces_plan_known
    check (plan_id in ('pro', 'business', 'enterprise')),
  constraint cx_checkout_nonces_cycle_known
    check (billing_cycle in ('monthly', 'annual'))
);

create index if not exists cx_checkout_nonces_user_idx
  on public.cx_checkout_nonces (user_id);

-- Expired rows are cheap to keep and useful as an audit trail, but they must
-- never be resolvable, so the lookup filters on expires_at rather than relying
-- on cleanup having run.
create index if not exists cx_checkout_nonces_live_idx
  on public.cx_checkout_nonces (nonce) where consumed_at is null;

alter table public.cx_checkout_nonces enable row level security;

-- NOTE: no policy is created, deliberately. With RLS enabled and no policy,
-- every client verb is denied. Only the service role can touch this table.
