-- Expose per-Pick purchase destination and buying tip in the Home feeds.
-- The visibility, pagination, ordering, suspension and category rules are copied
-- from the current definitions; only two additive return columns are introduced.
--
-- PostgreSQL cannot change OUT columns with CREATE OR REPLACE, so both functions
-- are dropped and recreated. Preserve the existing grants explicitly.
drop function if exists public.home_pick_feed_page(timestamptz, uuid);
drop function if exists public.home_following_feed_page(timestamptz, uuid);

create function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, purchase_url text, purchase_tip text,
  started_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;

  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url,
    p.purchase_url, p.purchase_tip, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

create function public.home_following_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, purchase_url text, purchase_tip text,
  started_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;

  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url,
    p.purchase_url, p.purchase_tip, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and exists (
      select 1
      from public.user_follows f
      where f.follower_id = (select auth.uid())
        and f.followee_id = p.user_id
    )
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz, uuid) from public;
revoke all on function public.home_following_feed_page(timestamptz, uuid) from public, anon;

grant execute on function public.home_pick_feed_page(timestamptz, uuid)
  to anon, authenticated, service_role;
grant execute on function public.home_following_feed_page(timestamptz, uuid)
  to authenticated;

comment on function public.home_pick_feed_page(timestamptz, uuid) is
  'Person-first home: current public picks, no self or popularity threshold, caller RLS, 20 rows + lookahead; includes optional purchase link/tip.';
comment on function public.home_following_feed_page(timestamptz, uuid) is
  'Home following feed: current public picks by followed people, caller RLS, 20 rows + lookahead; includes optional purchase link/tip.';
