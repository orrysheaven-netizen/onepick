create or replace function public.search_pick_categories(p_query text)
returns table(id uuid,name text,path text,matched_term text,match_kind text)
language sql stable set search_path to ''
as $$
with q as (select btrim(p_query) v),
matches as (
 select c.id,c.name,public.category_path(c.id) path,null::text matched_term,'name'::text match_kind,0 priority
 from public.categories c,q
 where q.v<>'' and public.category_is_open_leaf(c.id) and c.name ilike '%'||q.v||'%'
 union all
 select c.id,c.name,public.category_path(c.id),t.term,t.kind,case when t.kind='alias' then 1 else 2 end
 from public.category_search_terms t join public.categories c on c.id=t.category_id,q
 where q.v<>'' and public.category_is_open_leaf(c.id) and t.term ilike '%'||q.v||'%'
)
select distinct on(id) id,name,path,matched_term,match_kind
from matches order by id,priority,name limit 20;
$$;
grant execute on function public.search_pick_categories(text) to anon,authenticated;
