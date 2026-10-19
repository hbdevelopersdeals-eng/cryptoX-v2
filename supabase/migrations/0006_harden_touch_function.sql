-- Harden the updated_at trigger (migration 0006)
--
-- The security advisor flags cx_touch_updated_at because it runs with a mutable
-- search_path. That is a real (if small) hole: a role that can create objects in
-- a schema earlier on the path could shadow a function the trigger calls.
--
-- Pinning the path to pg_catalog is enough. The trigger body only needs now(),
-- and pg_catalog is always searched implicitly, so nothing else has to resolve.

alter function public.cx_touch_updated_at() set search_path = pg_catalog;
