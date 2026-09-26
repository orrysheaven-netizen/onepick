-- MVP Explore lists places (매장/온라인 판매처) only: items with at least one
-- public.item_channels row. Filtered on the server so 20-row pages stay full.
--
-- explore_recent_items_page gains p_stores_only (default false = every item).
-- Earlier arguments keep their names/positions, so existing calls still work.

begin;

drop function if exists public.explore_recent_items_page(uuid[], timestamptz, uuid);

create function public.explore_recent_items_page(
  p_category_ids uuid[] default null,
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_stores_only boolean default false
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
      and (
        not coalesce(p_stores_only, false)
        or exists (select 1 from public.item_channels ch where ch.item_id = i.id)
      )
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

revoke all on function public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean) from public;
grant execute on function public.explore_recent_items_page(uuid[],timestamptz,uuid,boolean) to anon, authenticated, service_role;

commit;
