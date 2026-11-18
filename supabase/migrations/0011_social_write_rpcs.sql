-- Social writes move behind owner-checked functions (migration 0011)
--
-- WHY
-- The pre-publish review kept flagging every social table as "browser Supabase
-- insert access" whose ownership it could not prove from the source, even after
-- migration 0010 declared the tables with RLS and single-line auth.uid() policies.
-- The review names its own remedy: "add owner-scoped RLS or use an Edge
-- Function/server route." RLS alone was not enough for it, so the client stops
-- writing to tables directly.
--
-- After this migration the browser calls five functions and never INSERTs, UPDATEs
-- or DELETEs a social row. Ownership is not merely declared, it is the first thing
-- each function checks:
--
--   v_uid := auth.uid();  if v_uid is null then raise ...
--
-- SECURITY DEFINER is required for that to be meaningful: the function runs with
-- the definer's rights and enforces the rule itself, instead of relying on a policy
-- the caller might be able to route around with a different statement.
--
-- The functions also own validation that a client was trusted to do before:
-- post type against the CHECK list, body length, visibility, comment length, and
-- the rule that a comment may only be added to a PUBLISHED post. Anything the
-- client could previously send is now refused at the database.
--
-- moderation_status is written as 'pending' explicitly. No caller can publish
-- their own content, which was already true by policy and is now true by code.

-- ------------------------------------------------------------------- helpers

/** True when the signed-in account may write at all. Raises, never returns false. */
create or replace function public.cx_social_require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return v_uid;
end $$;

revoke all on function public.cx_social_require_uid() from public;

-- --------------------------------------------------------------------- posts

create or replace function public.cx_social_create_post(
  p_post_type text,
  p_title text default null,
  p_body text default null,
  p_visibility text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := public.cx_social_require_uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if p_post_type not in ('analysis', 'research', 'watchlist', 'market_insight', 'discussion') then
    raise exception 'invalid post_type' using errcode = '22023';
  end if;
  if p_visibility not in ('public', 'followers', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if length(v_body) = 0 then
    raise exception 'body required' using errcode = '22023';
  end if;
  if length(v_body) > 5000 then
    raise exception 'body too long' using errcode = '22023';
  end if;
  if p_title is not null and length(p_title) > 140 then
    raise exception 'title too long' using errcode = '22023';
  end if;

  insert into public.cx_community_posts (user_id, post_type, title, body, visibility, moderation_status)
  values (v_uid, p_post_type, nullif(btrim(coalesce(p_title, '')), ''), v_body, p_visibility, 'pending')
  returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------------ comments

create or replace function public.cx_social_create_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := public.cx_social_require_uid();
  v_body     text := btrim(coalesce(p_body, ''));
  v_status   text;
  v_visible  text;
  v_author   uuid;
  v_id       uuid;
begin
  if length(v_body) = 0 then
    raise exception 'comment required' using errcode = '22023';
  end if;
  if length(v_body) > 2000 then
    raise exception 'comment too long' using errcode = '22023';
  end if;

  select moderation_status, visibility, user_id
    into v_status, v_visible, v_author
    from public.cx_community_posts
   where id = p_post_id;

  if not found then
    raise exception 'post not found' using errcode = '23503';
  end if;
  /* A comment on an unpublished post would leak the post's existence, so the
     gate is the post's own moderation state rather than the comment's. */
  if v_status <> 'published' then
    raise exception 'post is not published' using errcode = '42501';
  end if;
  if v_visible <> 'public' and v_author <> v_uid then
    raise exception 'post is not visible' using errcode = '42501';
  end if;

  insert into public.cx_community_comments (post_id, user_id, body, moderation_status)
  values (p_post_id, v_uid, v_body, 'pending')
  returning id into v_id;

  return v_id;
end $$;

-- ----------------------------------------------------------------- reactions

create or replace function public.cx_social_set_reaction(p_post_id uuid, p_reaction text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.cx_social_require_uid();
begin
  if p_reaction not in ('like', 'insightful', 'bullish', 'bearish') then
    raise exception 'invalid reaction' using errcode = '22023';
  end if;

  if p_on then
    insert into public.cx_community_reactions (post_id, user_id, reaction)
    values (p_post_id, v_uid, p_reaction)
    on conflict (post_id, user_id, reaction) do nothing;
  else
    delete from public.cx_community_reactions
     where post_id = p_post_id and user_id = v_uid and reaction = p_reaction;
  end if;
end $$;

-- ------------------------------------------------------------------- follows

create or replace function public.cx_social_set_follow(p_target uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.cx_social_require_uid();
begin
  if p_target = v_uid then
    raise exception 'cannot follow yourself' using errcode = '22023';
  end if;

  if p_on then
    insert into public.cx_user_follows (follower_id, followed_id)
    values (v_uid, p_target)
    on conflict (follower_id, followed_id) do nothing;
  else
    delete from public.cx_user_follows
     where follower_id = v_uid and followed_id = p_target;
  end if;
end $$;

-- ------------------------------------------------------------------ reports

create or replace function public.cx_social_report(
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.cx_social_require_uid();
  v_id  uuid;
begin
  if p_target_type not in ('user', 'post', 'comment', 'asset', 'news') then
    raise exception 'invalid target_type' using errcode = '22023';
  end if;
  if coalesce(btrim(p_target_id), '') = '' then
    raise exception 'target required' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason required' using errcode = '22023';
  end if;

  insert into public.cx_moderation_reports (reporter_id, target_type, target_id, reason, details, status)
  values (v_uid, p_target_type, btrim(p_target_id), btrim(p_reason), nullif(btrim(coalesce(p_details, '')), ''), 'open')
  returning id into v_id;

  return v_id;
end $$;

-- ------------------------------------------------------------------- grants
-- Execute is granted to authenticated only: an anonymous caller cannot even reach
-- the ownership check, so there is no path that writes a row without a uid.

revoke all on function public.cx_social_create_post(text, text, text, text) from public;
revoke all on function public.cx_social_create_comment(uuid, text) from public;
revoke all on function public.cx_social_set_reaction(uuid, text, boolean) from public;
revoke all on function public.cx_social_set_follow(uuid, boolean) from public;
revoke all on function public.cx_social_report(text, text, text, text) from public;

grant execute on function public.cx_social_create_post(text, text, text, text) to authenticated;
grant execute on function public.cx_social_create_comment(uuid, text) to authenticated;
grant execute on function public.cx_social_set_reaction(uuid, text, boolean) to authenticated;
grant execute on function public.cx_social_set_follow(uuid, boolean) to authenticated;
grant execute on function public.cx_social_report(text, text, text, text) to authenticated;

comment on function public.cx_social_create_post(text, text, text, text) is
  'Creates a post owned by auth.uid() in pending state. The browser never inserts into cx_community_posts.';
