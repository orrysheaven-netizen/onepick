-- Speed the people home feed without changing its visibility or cursor contract.
-- The partial index matches the active-pick order used by the 20 + lookahead query.
create index if not exists picks_active_started_id_idx
  on public.picks(started_at desc, id desc)
  where status = 'active';

-- Evaluate category lineage once per category instead of once per candidate Pick.
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
  with open_leaf_categories as materialized (
    select c.id, c.name
    from public.categories c
    where public.category_is_open_leaf(c.id)
  )
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
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
  with open_leaf_categories as materialized (
    select c.id, c.name
    from public.categories c
    where public.category_is_open_leaf(c.id)
  )
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url,
    i.official_url, i.market_availability_status, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join open_leaf_categories c on c.id = p.category_id
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
