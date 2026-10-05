begin;

create function public.food_menu_pick_counts(
  p_channel text default null
)
returns table(category_id uuid, pick_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
    select p.category_id, p.user_id
    from public.picks p
    join public.items i on i.id = p.item_id and i.category_id = p.category_id
    join public.categories c on c.id = p.category_id
    left join public.categories parent on parent.id = c.parent_id
    left join public.categories gp on gp.id = parent.parent_id
    where p.status = 'active'
      and (p_channel is null or p.channel = p_channel)
      and not private.user_is_suspended(p.user_id)
      and i.status in ('active', 'discontinued')
      and public.category_is_open_leaf(c.id)
      and 'food' in (c.slug, parent.slug, gp.slug)
      and c.slug not in ('recipe', 'pending-product')
    group by p.category_id, p.user_id
  )
  select e.category_id, count(*)::bigint
  from eligible e
  group by e.category_id;
$$;

revoke all on function public.food_menu_pick_counts(text) from public;
grant execute on function public.food_menu_pick_counts(text)
  to anon, authenticated, service_role;

commit;
