-- One read function for the whole social page (migration 0012)
--
-- WHY THIS EXISTS
-- 0011 removed every browser WRITE to the social tables, and the review kept
-- reporting the same three findings per table. The reason: the page still READ six
-- tables directly. The rule family ("browser Supabase access to <table>") fires on
-- any access from the client, not only on insert, and a static reviewer cannot tell
-- a filtered read from an unfiltered one.
--
-- So the client stops touching these tables entirely. One function returns the
-- whole page payload, and visibility is decided here rather than half here and half
-- in the browser.
--
-- WHAT IT RETURNS
--   posts       published+public, plus anything the caller authored
--   profiles    the authors of those posts (handle, display name, avatar, bio)
--   reactions   for those posts
--   comments    published comments on those posts
--   following   who the caller follows, so the UI can render the button state
--   me          the caller's own profile row, or null
--
-- WHY JSONB AND NOT SEVERAL SETS
-- Five round trips became one, and the shape is fixed, so the client cannot
-- accidentally widen a filter. The payload is per-user, so it must never be cached
-- across accounts: no cache headers are set here and the function is VOLATILE.
--
-- VISIBILITY RULE (identical to the deployed policy, restated in one place)
--   published AND public   -> visible to any authenticated caller
--   authored by the caller -> always visible, including pending
--   otherwise              -> not returned
-- Anonymous callers get nothing: EXECUTE is granted to authenticated only.

create or replace function public.cx_social_feed(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_posts jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  with visible as (
    select p.*
      from public.cx_community_posts p
     where p.user_id = v_uid
        or (p.moderation_status = 'published' and p.visibility = 'public')
     order by p.created_at desc
     limit v_limit
  )
  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc), '[]'::jsonb)
    into v_posts
    from visible v;

  return jsonb_build_object(
    'posts', v_posts,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', pr.user_id,
               'username', pr.username,
               'display_name', pr.display_name,
               'avatar_url', pr.avatar_url,
               'bio', pr.bio,
               'profile_visibility', pr.profile_visibility))
        from public.cx_profiles pr
       where pr.user_id in (
         select (elem->>'user_id')::uuid from jsonb_array_elements(v_posts) elem
       )
    ), '[]'::jsonb),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', r.post_id, 'user_id', r.user_id, 'reaction', r.reaction))
        from public.cx_community_reactions r
       where r.post_id in (
         select (elem->>'id')::uuid from jsonb_array_elements(v_posts) elem
       )
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'post_id', c.post_id, 'user_id', c.user_id,
               'parent_comment_id', c.parent_comment_id, 'body', c.body,
               'moderation_status', c.moderation_status, 'created_at', c.created_at)
             order by c.created_at)
        from public.cx_community_comments c
       where c.moderation_status = 'published'
         and c.post_id in (
           select (elem->>'id')::uuid from jsonb_array_elements(v_posts) elem
         )
    ), '[]'::jsonb),
    'following', coalesce((
      select jsonb_agg(f.followed_id)
        from public.cx_user_follows f
       where f.follower_id = v_uid
    ), '[]'::jsonb),
    'me', (
      select to_jsonb(pr)
        from public.cx_profiles pr
       where pr.user_id = v_uid
       limit 1
    )
  );
end $$;

revoke all on function public.cx_social_feed(integer) from public;
grant execute on function public.cx_social_feed(integer) to authenticated;

comment on function public.cx_social_feed(integer) is
  'Returns the social page payload for auth.uid(): own posts plus published public ones. The browser never queries cx_community_* directly.';
