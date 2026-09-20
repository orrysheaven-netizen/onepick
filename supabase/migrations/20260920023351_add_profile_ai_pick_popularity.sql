-- Real-time popularity signal for the AI taste profile: for a caller-owned
-- set of item ids, report how many active picks exist for that exact item
-- and for its whole category right now. ranking_min_sample is returned so
-- the caller can suppress the figure for categories too small to be a
-- meaningful (or de-anonymizing) percentage.
create function public.profile_ai_pick_popularity(p_item_ids uuid[])
returns table (
  item_id uuid,
  category_id uuid,
  item_pick_count bigint,
  category_pick_count bigint,
  ranking_min_sample integer
)
language sql stable security invoker set search_path = ''
as $$
  with target_items as (
    select i.id as item_id, i.category_id, c.ranking_min_sample
    from public.items i
    join public.categories c on c.id = i.category_id
    where i.id = any(p_item_ids)
  ),
  item_counts as (
    select p.item_id, count(*) as item_pick_count
    from public.picks p
    where p.status = 'active' and p.item_id = any(p_item_ids)
    group by p.item_id
  ),
  category_counts as (
    select p.category_id, count(*) as category_pick_count
    from public.picks p
    where p.status = 'active'
      and p.category_id in (select category_id from target_items)
    group by p.category_id
  )
  select ti.item_id, ti.category_id,
    coalesce(ic.item_pick_count, 0) as item_pick_count,
    coalesce(cc.category_pick_count, 0) as category_pick_count,
    ti.ranking_min_sample
  from target_items ti
  left join item_counts ic on ic.item_id = ti.item_id
  left join category_counts cc on cc.category_id = ti.category_id;
$$;

revoke all on function public.profile_ai_pick_popularity(uuid[]) from public;
grant execute on function public.profile_ai_pick_popularity(uuid[]) to anon, authenticated;
