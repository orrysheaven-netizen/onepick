-- Public product totals, independent of the recent-pick feed's page size.
-- Existing unique current-pick and item/category constraints ensure one person
-- contributes at most one active choice to a category.
create function public.category_top_items(p_category_id uuid)
returns table (
  item_id uuid,
  name text,
  thumbnail_path text,
  pick_count bigint,
  rank bigint,
  is_tied boolean
)
language sql stable security invoker set search_path = ''
as $$
  with totals as (
    select i.id, i.name, i.thumbnail_path, count(*) as pick_count
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    where p.category_id = p_category_id and p.status = 'active'
      and i.status in ('active', 'discontinued')
      and c.status = 'open' and c.is_visible and c.is_pickable
      and not exists (select 1 from public.categories child where child.parent_id = c.id)
      and (c.parent_id is null or (
        parent.parent_id is null and parent.status = 'open'
        and parent.is_visible and not parent.is_pickable
      ))
    group by i.id
  )
  select t.id, t.name, t.thumbnail_path, t.pick_count,
    rank() over (order by t.pick_count desc),
    count(*) over (partition by t.pick_count) > 1
  from totals t
  order by t.pick_count desc, t.name, t.id
  limit 3;
$$;

revoke all on function public.category_top_items(uuid) from public;
grant execute on function public.category_top_items(uuid) to anon, authenticated;
