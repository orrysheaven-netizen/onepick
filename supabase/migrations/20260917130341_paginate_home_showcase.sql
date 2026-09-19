-- Twenty products plus one lookahead row, retaining the public threshold and RLS.
create function public.home_showcase_page(p_before_time timestamptz default null, p_after_id uuid default null)
returns table (minimum_pick_count integer, items jsonb)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.image_path, i.thumbnail_path,
      c.id as category_id, c.name as category_name,
      count(*) as pick_count, max(p.started_at) as last_picked_at
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.status = 'active' and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable))
    group by i.id, c.id
  ), qualified as (
    select t.* from totals t
    where t.pick_count >= (select s.minimum_pick_count from public.home_settings s where s.id)
      and (p_before_time is null or t.last_picked_at < p_before_time
        or (t.last_picked_at = p_before_time and t.id > p_after_id))
    order by t.last_picked_at desc, t.id
    limit 21
  )
  select s.minimum_pick_count, coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id, 'name', q.name, 'category_id', q.category_id,
      'category_name', q.category_name, 'image_path', q.image_path,
      'thumbnail_path', q.thumbnail_path, 'pick_count', q.pick_count,
      'last_picked_at', q.last_picked_at
    ) order by q.last_picked_at desc, q.id)
    from qualified q
  ), '[]'::jsonb)
  from public.home_settings s where s.id;
$$;
revoke all on function public.home_showcase_page(timestamptz, uuid) from public;
grant execute on function public.home_showcase_page(timestamptz, uuid) to anon, authenticated;
