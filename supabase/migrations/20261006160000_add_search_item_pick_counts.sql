begin;

-- Search-result metadata must not download every active Pick and count it in JS:
-- PostgREST row limits would make popular items under-count as the dataset grows.
-- Public aggregate: suspended users do not count; active/discontinued items remain eligible.
create function public.search_item_pick_counts(p_item_ids uuid[])
returns table(item_id uuid, pick_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.item_id, count(distinct p.user_id)::bigint
  from public.picks p
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  where p.status = 'active'
    and p.item_id = any(coalesce(p_item_ids, array[]::uuid[]))
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
  group by p.item_id;
$$;

revoke all on function public.search_item_pick_counts(uuid[]) from public;
grant execute on function public.search_item_pick_counts(uuid[])
  to anon, authenticated, service_role;

commit;
