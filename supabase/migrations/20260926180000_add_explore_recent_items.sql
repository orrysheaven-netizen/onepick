-- Explore lists places/products (not people) by the latest visible active Pick.
-- One row per item; the viewer's session RLS decides which Picks count, so
-- blocked people's Picks never bump an item. Same visibility rules as the home feed.
create or replace function public.explore_recent_items_page(
  p_category_ids uuid[] default null,
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  item_id uuid, item_name text, category_id uuid, category_name text,
  thumbnail_path text, image_path text, image_source_url text,
  last_picked_at timestamptz
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
  if p_category_ids is not null and cardinality(p_category_ids) > 500 then
    raise exception 'TOO_MANY_CATEGORIES' using errcode = '22023';
  end if;

  return query
  with open_leaf_categories as materialized (
    select c.id, c.name
    from public.categories c
    where (p_category_ids is null or c.id = any(p_category_ids))
      and public.category_is_open_leaf(c.id)
  ),
  latest as (
    select p.item_id, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join open_leaf_categories c on c.id = p.category_id
    where p.status = 'active'
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
    group by p.item_id
  )
  select i.id, i.name, c.id, c.name,
    i.thumbnail_path, i.image_path, i.image_source_url, l.last_picked_at
  from latest l
  join public.items i on i.id = l.item_id
  join open_leaf_categories c on c.id = i.category_id
  where (
      p_before_time is null
      or (l.last_picked_at, i.id) < (p_before_time, p_before_id)
    )
  order by l.last_picked_at desc, i.id desc
  limit 21;
end;
$$;

revoke all on function public.explore_recent_items_page(uuid[],timestamptz,uuid) from public;
grant execute on function public.explore_recent_items_page(uuid[],timestamptz,uuid) to anon, authenticated, service_role;
