-- Public follow counts/connections for the approved profile-follow MVP.
-- Keep user_follows itself private: these RPCs expose only sanitized profile data.

create function public.profile_follow_counts(p_profile_id uuid)
returns table(
  following_count bigint,
  follower_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.user_follows f
      join public.profiles connected on connected.id = f.followee_id
      where f.follower_id = p_profile_id
        and not private.user_is_suspended(connected.id)
        and not private.users_blocked((select auth.uid()), connected.id)
    ) as following_count,
    (
      select count(*)
      from public.user_follows f
      join public.profiles connected on connected.id = f.follower_id
      where f.followee_id = p_profile_id
        and not private.user_is_suspended(connected.id)
        and not private.users_blocked((select auth.uid()), connected.id)
    ) as follower_count
  where exists (
    select 1
    from public.profiles target
    where target.id = p_profile_id
      and not private.user_is_suspended(target.id)
      and not private.users_blocked((select auth.uid()), target.id)
  );
$$;

revoke all on function public.profile_follow_counts(uuid) from public;
grant execute on function public.profile_follow_counts(uuid) to anon, authenticated;

comment on function public.profile_follow_counts(uuid) is
  'Public profile follow counts filtered for suspension and the current viewer block graph. Does not expose follow rows.';

create function public.profile_follow_connections_page(
  p_profile_id uuid,
  p_direction text,
  p_after_username text default null,
  p_after_user_id uuid default null,
  p_limit integer default 20
)
returns table(
  user_id uuid,
  username text,
  profile_image_url text,
  bio text,
  viewer_is_following boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := (select auth.uid());
begin
  if p_direction not in ('followers', 'following') then
    raise exception 'INVALID_DIRECTION' using errcode = '22023';
  end if;
  if (p_after_username is null) <> (p_after_user_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'INVALID_PAGE_SIZE' using errcode = '22023';
  end if;

  return query
  with connected_ids as (
    select case
      when p_direction = 'followers' then f.follower_id
      else f.followee_id
    end as connected_user_id
    from public.user_follows f
    where (p_direction = 'followers' and f.followee_id = p_profile_id)
       or (p_direction = 'following' and f.follower_id = p_profile_id)
  )
  select
    connected.id,
    connected.username,
    connected.profile_image_url,
    connected.bio,
    case
      when v_viewer is null or connected.id = v_viewer then false
      else exists (
        select 1
        from public.user_follows vf
        where vf.follower_id = v_viewer
          and vf.followee_id = connected.id
      )
    end as viewer_is_following
  from connected_ids c
  join public.profiles connected on connected.id = c.connected_user_id
  where exists (
      select 1
      from public.profiles target
      where target.id = p_profile_id
        and not private.user_is_suspended(target.id)
        and not private.users_blocked(v_viewer, target.id)
    )
    and not private.user_is_suspended(connected.id)
    and not private.users_blocked(v_viewer, connected.id)
    and (
      p_after_username is null
      or (connected.username, connected.id) > (p_after_username, p_after_user_id)
    )
  order by connected.username asc, connected.id asc
  limit p_limit + 1;
end;
$$;

revoke all on function public.profile_follow_connections_page(uuid,text,text,uuid,integer) from public;
grant execute on function public.profile_follow_connections_page(uuid,text,text,uuid,integer) to anon, authenticated;

comment on function public.profile_follow_connections_page(uuid,text,text,uuid,integer) is
  'Sanitized followers/following page ordered by username + user id. Returns p_limit + 1 rows for lookahead and never exposes follow timestamps.';
