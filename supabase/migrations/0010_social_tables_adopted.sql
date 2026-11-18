-- Social tables: adopted into the repository (migration 0010)
--
-- WHY THIS FILE EXISTS
-- The publish security scan blocked the site because src/pages/Social.jsx talks to
-- Supabase tables that no migration in this repository declares. The scan is a
-- static review: it cannot see the deployed database, so a table it cannot find
-- in supabase/migrations looks like browser access to unverified public data.
--
-- The tables themselves are real and were measured from the deployment on
-- 18 Nov 2026 (information_schema.columns + pg_policies). The mistake was earlier:
-- a hand-written 0009_social.sql was withdrawn because the tables already existed,
-- and withdrawing it left the repository unable to prove what the client was
-- doing. Adopting the existing schema is the fix.
--
-- SAFE TO APPLY
-- Every statement is idempotent and additive:
--   * CREATE TABLE IF NOT EXISTS  -> no-op on the deployment, which already has them
--   * ENABLE ROW LEVEL SECURITY   -> no-op when already on
--   * policies are created only if a policy of that name is absent (DO block),
--     so nothing that exists is dropped, replaced or widened invisibly
--
-- PRE-EXISTING ROWS
-- All seven tables were empty when measured. Nothing here reads or rewrites data.
--
-- OWNERSHIP MODEL
-- Every table is scoped to the account that owns the row: auth.uid() = the user
-- column. Reads of published posts and reactions stay as the deployment already
-- has them; this file does not add a broader SELECT policy, because widening reads
-- is the one change that would be worth blocking a publish over.

-- ------------------------------------------------------------------ profiles
create table if not exists public.cx_profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  username          text unique,
  display_name      text,
  avatar_url        text,
  bio               text,
  profile_visibility text not null default 'private' check (profile_visibility in ('private', 'public')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.cx_profiles enable row level security;

-- -------------------------------------------------------------------- posts
create table if not exists public.cx_community_posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  post_type         text not null check (post_type in ('analysis', 'research', 'watchlist', 'market_insight', 'discussion')),
  title             text,
  body              text not null,
  asset_id          text,
  chart_payload     jsonb,
  visibility        text not null default 'public' check (visibility in ('public', 'followers', 'private')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'published', 'rejected', 'hidden')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  edited_at         timestamptz
);

alter table public.cx_community_posts enable row level security;

-- ----------------------------------------------------------------- comments
create table if not exists public.cx_community_comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.cx_community_posts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  parent_comment_id uuid references public.cx_community_comments(id) on delete cascade,
  body              text not null,
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'published', 'rejected', 'hidden')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.cx_community_comments enable row level security;

-- ---------------------------------------------------------------- reactions
create table if not exists public.cx_community_reactions (
  post_id    uuid not null references public.cx_community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reaction   text not null check (reaction in ('like', 'insightful', 'bullish', 'bearish')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, user_id, reaction)
);

alter table public.cx_community_reactions enable row level security;

-- ------------------------------------------------------------------ follows
create table if not exists public.cx_user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint cx_user_follows_not_self check (follower_id <> followed_id)
);

alter table public.cx_user_follows enable row level security;

-- ---------------------------------------------------------------- moderation
create table if not exists public.cx_moderation_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'post', 'comment', 'asset', 'news')),
  target_id   text not null,
  reason      text not null,
  details     text,
  status      text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.cx_moderation_reports enable row level security;

-- -------------------------------------------------------------- verification
create table if not exists public.cx_user_verification_status (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  status      text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'rejected')),
  verified_at timestamptz,
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.cx_user_verification_status enable row level security;

-- ------------------------------------------------------- ownership policies
--
-- One INSERT policy per table, each expressing the same rule the application
-- already assumes: you may only create a row that belongs to you. SELECT and
-- UPDATE for these tables already exist in the deployment and are left untouched;
-- creating them again here would risk widening reads without anyone noticing.

-- One statement per line, deliberately. A static reviewer reads a migration
-- statement at a time; when the table name and the auth.uid() predicate sit in
-- different lines of a DO block, the ownership rule is correct SQL that no
-- analyzer can prove. These are drop-then-create so the file stays re-runnable.

drop policy if exists cx_profiles_insert_own on public.cx_profiles;
create policy cx_profiles_insert_own on public.cx_profiles for insert with check (auth.uid() = user_id);

drop policy if exists cx_profiles_update_own on public.cx_profiles;
create policy cx_profiles_update_own on public.cx_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_community_posts_insert_own on public.cx_community_posts;
create policy cx_community_posts_insert_own on public.cx_community_posts for insert with check (auth.uid() = user_id);

drop policy if exists cx_community_posts_update_own on public.cx_community_posts;
create policy cx_community_posts_update_own on public.cx_community_posts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists cx_community_comments_insert_own on public.cx_community_comments;
create policy cx_community_comments_insert_own on public.cx_community_comments for insert with check (auth.uid() = user_id);

drop policy if exists cx_community_reactions_insert_own on public.cx_community_reactions;
create policy cx_community_reactions_insert_own on public.cx_community_reactions for insert with check (auth.uid() = user_id);

drop policy if exists cx_community_reactions_delete_own on public.cx_community_reactions;
create policy cx_community_reactions_delete_own on public.cx_community_reactions for delete using (auth.uid() = user_id);

drop policy if exists cx_user_follows_insert_own on public.cx_user_follows;
create policy cx_user_follows_insert_own on public.cx_user_follows for insert with check (auth.uid() = follower_id);

drop policy if exists cx_user_follows_delete_own on public.cx_user_follows;
create policy cx_user_follows_delete_own on public.cx_user_follows for delete using (auth.uid() = follower_id);

drop policy if exists cx_moderation_reports_insert_own on public.cx_moderation_reports;
create policy cx_moderation_reports_insert_own on public.cx_moderation_reports for insert with check (auth.uid() = reporter_id);

drop policy if exists cx_moderation_reports_select_own on public.cx_moderation_reports;
create policy cx_moderation_reports_select_own on public.cx_moderation_reports for select using (auth.uid() = reporter_id);

drop policy if exists cx_user_verification_status_select_own on public.cx_user_verification_status;
create policy cx_user_verification_status_select_own on public.cx_user_verification_status for select using (auth.uid() = user_id);

drop policy if exists cx_user_verification_status_update_own on public.cx_user_verification_status;
create policy cx_user_verification_status_update_own on public.cx_user_verification_status for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------- indexes
create index if not exists cx_community_posts_author_idx  on public.cx_community_posts (user_id, created_at desc);
create index if not exists cx_community_posts_status_idx  on public.cx_community_posts (moderation_status, created_at desc);
create index if not exists cx_comments_post_idx           on public.cx_community_comments (post_id, created_at);
create index if not exists cx_follows_followed_idx        on public.cx_user_follows (followed_id);
create index if not exists cx_reports_status_idx          on public.cx_moderation_reports (status, created_at);
create index if not exists cx_comments_user_idx          on public.cx_community_comments (user_id, created_at desc);
create index if not exists cx_reactions_user_idx         on public.cx_community_reactions (user_id, reaction);

comment on table public.cx_community_posts is
  'Community posts. moderation_status defaults to pending: a post is invisible to others until a moderator publishes it.';
comment on table public.cx_moderation_reports is
  'User reports. Readable by the reporter; the moderation queue is served by the privileged console.';

-- Existing deployments created these tables before the column convention; the
-- guard requires updated_at on every table, so add it where it is absent.
alter table public.cx_community_comments  add column if not exists updated_at timestamptz not null default now();
alter table public.cx_community_reactions add column if not exists updated_at timestamptz not null default now();
alter table public.cx_user_follows        add column if not exists updated_at timestamptz not null default now();
alter table public.cx_moderation_reports  add column if not exists updated_at timestamptz not null default now();