-- Ledger timestamps (migration 0005)
--
-- The schema guard requires every table to record when a row last changed, and
-- it is right to: without it a mutated row is indistinguishable from one that
-- never changed. Both of these tables were created without it.
--
-- Each already carries a domain-meaningful mutation timestamp — `processed_at`
-- for a delivery, `consumed_at` for a nonce — but neither is a substitute, for
-- the same reason in both cases: they record a FIRST transition, not the last
-- write. A retried delivery increments `attempts` after `processed_at` is set,
-- and a nonce is updated by whichever code path touches it last. An exemption
-- would have kept the guard strict for everyone else while quietly relying on
-- that reasoning holding for ever; adding the column costs one timestamp and
-- removes the argument.

alter table public.cx_webhook_events
  add column if not exists updated_at timestamptz not null default now();

alter table public.cx_checkout_nonces
  add column if not exists updated_at timestamptz not null default now();

-- The same trigger function migration 0003 defines, reused rather than copied.
drop trigger if exists cx_webhook_events_touch on public.cx_webhook_events;
create trigger cx_webhook_events_touch
  before update on public.cx_webhook_events
  for each row execute function public.cx_touch_updated_at();

drop trigger if exists cx_checkout_nonces_touch on public.cx_checkout_nonces;
create trigger cx_checkout_nonces_touch
  before update on public.cx_checkout_nonces
  for each row execute function public.cx_touch_updated_at();
