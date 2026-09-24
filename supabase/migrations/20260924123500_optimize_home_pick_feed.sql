-- Refs #270 — reduce work in the people-first home feed.
-- Keep caller RLS in force; this only improves candidate ordering and category filtering.

create index if not exists picks_home_feed_active_started_idx
  on public.picks (started_at desc, id desc)
  where status = 'active';

create or replace function public.home_pick_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz
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
  with recursive open_tree as (
    select
      c.id,
      c.parent_id,
      c.is_pickable,
      1 as depth
    from public.categories c
    where c.parent_id is null
      and c.status = 'open'
      and c.is_visible

    union all

    select
      c.id,
      c.parent_id,
      c.is_pickable,
      t.depth + 1
    from public.categories c
    join open_tree t on t.id = c.parent_id
    where t.depth < 3
      and not t.is_pickable
      and c.status = 'open'
      and c.is_visible
  ),
  open_categories as materialized (
    select t.id
    from open_tree t
    where t.is_pickable
      and not exists (
        select 1
        from public.categories child
        where child.parent_id = t.id
      )
  )
  select
    p.id,
    p.user_id,
    pr.username,
    pr.profile_image_url,
    i.id,
    i.name,
    c.id,
    c.name,
    p.one_line_review,
    i.thumbnail_path,
    i.image_path,
    i.image_source_url,
    p.started_at
  from public.picks p
  join open_categories oc on oc.id = p.category_id
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (
      p_before_time is null
      or (p.started_at, p.id) < (p_before_time, p_before_id)
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page(timestamptz,uuid) from public;
grant execute on function public.home_pick_feed_page(timestamptz,uuid)
  to anon, authenticated, service_role;
comment on function public.home_pick_feed_page(timestamptz,uuid) is
  'Person-first home: current public picks, no self or popularity threshold, caller RLS, precomputed open leaf categories, indexed 20 rows + lookahead.';

create or replace function public.home_pick_feed_page_v2(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, official_url text, market_availability_status text,
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
  with recursive open_tree as (
    select
      c.id,
      c.parent_id,
      c.is_pickable,
      1 as depth
    from public.categories c
    where c.parent_id is null
      and c.status = 'open'
      and c.is_visible

    union all

    select
      c.id,
      c.parent_id,
      c.is_pickable,
      t.depth + 1
    from public.categories c
    join open_tree t on t.id = c.parent_id
    where t.depth < 3
      and not t.is_pickable
      and c.status = 'open'
      and c.is_visible
  ),
  open_categories as materialized (
    select t.id
    from open_tree t
    where t.is_pickable
      and not exists (
        select 1
        from public.categories child
        where child.parent_id = t.id
      )
  )
  select
    p.id,
    p.user_id,
    pr.username,
    pr.profile_image_url,
    i.id,
    i.name,
    c.id,
    c.name,
    p.one_line_review,
    i.thumbnail_path,
    i.image_path,
    i.image_source_url,
    i.official_url,
    i.market_availability_status,
    p.started_at
  from public.picks p
  join open_categories oc on oc.id = p.category_id
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and p.user_id is distinct from (select auth.uid())
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and (
      p_before_time is null
      or (p.started_at, p.id) < (p_before_time, p_before_id)
    )
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;

revoke all on function public.home_pick_feed_page_v2(timestamptz,uuid) from public;
grant execute on function public.home_pick_feed_page_v2(timestamptz,uuid)
  to anon, authenticated, service_role;
