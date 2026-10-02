begin;

-- Home "최근 7일 많이 고른 메뉴" must use the same channel scope as the
-- public MVP feed. Keep the existing two positional arguments stable and add
-- the optional channel as the third argument so existing SQL callers continue
-- to work unchanged.
drop function if exists public.food_menu_recent_ranking(uuid, integer);

create function public.food_menu_recent_ranking(
  p_group_category_id uuid default null,
  p_limit integer default 20,
  p_channel text default null
)
returns table(
  category_id uuid, category_name text, group_category_id uuid,
  pick_count bigint, rank bigint, is_tied boolean,
  cover_item_id uuid, thumbnail_path text, image_path text, image_source_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select p.category_id, p.item_id, p.user_id
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.status = 'active'
      and p.started_at >= now() - interval '7 days'
      and (p_channel is null or p.channel = p_channel)
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
  ),
  menus as (
    select c.id, c.name, c.parent_id
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where c.id in (select r.category_id from recent r)
      and public.category_is_open_leaf(c.id)
      and 'food' in (c.slug, parent.slug, gp.slug)
      and c.slug not in ('recipe', 'pending-product')
      and (p_group_category_id is null or p_group_category_id in (c.parent_id, parent.parent_id))
  ),
  totals as (
    select m.id, m.name, m.parent_id, count(distinct r.user_id) as pick_count
    from menus m
    join recent r on r.category_id = m.id
    group by m.id, m.name, m.parent_id
  ),
  covers as (
    select distinct on (r.category_id)
      r.category_id, i.id, i.thumbnail_path, i.image_path, i.image_source_url
    from recent r
    join totals t on t.id = r.category_id
    join public.items i on i.id = r.item_id
    where coalesce(i.thumbnail_path, i.image_path, i.image_source_url) is not null
    group by r.category_id, i.id
    order by r.category_id, count(distinct r.user_id) desc, i.name, i.id
  )
  select t.id, t.name, t.parent_id, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1,
    c.id, c.thumbnail_path, c.image_path, c.image_source_url
  from totals t
  left join covers c on c.category_id = t.id
  order by t.pick_count desc, t.name, t.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.food_menu_recent_ranking(uuid, integer, text) from public;
grant execute on function public.food_menu_recent_ranking(uuid, integer, text)
  to anon, authenticated, service_role;

commit;
