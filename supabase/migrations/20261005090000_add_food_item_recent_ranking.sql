begin;

-- Home "최근 7일 원픽 많은 순" (Figma 30-1, 10-05 decision) shows store + menu
-- cards ("서울집 미역국 원픽 23"), and its 더보기 screen lists the same order.
-- food_menu_recent_ranking counts per menu, so this counts per item (one store's
-- menu) with the same rules:
--   * current (active) Picks started in the last 7 days, active/discontinued items;
--   * suspended users never count, each person counts once per item;
--   * open food menus only, recipe and pending-product excluded;
--   * optional channel scope before counting.
-- Home never shows a photo-less card, so only items with a photo are ranked.
create function public.food_item_recent_ranking(
  p_channel text default null,
  p_limit integer default 20
)
returns table(
  item_id uuid, item_name text, category_id uuid, category_name text,
  pick_count bigint, rank bigint, is_tied boolean,
  thumbnail_path text, image_path text, image_source_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select p.item_id, p.category_id, p.user_id
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    where p.status = 'active'
      and p.started_at >= now() - interval '7 days'
      and (p_channel is null or p.channel = p_channel)
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and coalesce(i.thumbnail_path, i.image_path, i.image_source_url) is not null
  ),
  menus as (
    select c.id, c.name
    from public.categories c
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where c.id in (select r.category_id from recent r)
      and public.category_is_open_leaf(c.id)
      and 'food' in (c.slug, parent.slug, gp.slug)
      and c.slug not in ('recipe', 'pending-product')
  ),
  totals as (
    select r.item_id, m.id as category_id, m.name as category_name, count(distinct r.user_id) as pick_count
    from recent r
    join menus m on m.id = r.category_id
    group by r.item_id, m.id, m.name
  )
  select i.id, i.name, t.category_id, t.category_name, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1,
    i.thumbnail_path, i.image_path, i.image_source_url
  from totals t
  join public.items i on i.id = t.item_id
  order by t.pick_count desc, i.name, i.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.food_item_recent_ranking(text, integer) from public;
grant execute on function public.food_item_recent_ranking(text, integer)
  to anon, authenticated, service_role;

commit;
