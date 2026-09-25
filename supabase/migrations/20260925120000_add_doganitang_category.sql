begin;

-- 도가니탕 joins the restaurant-first soup leaves with the same shape as 설렁탕/곰탕:
-- an open pickable leaf, internal catalog, and place-backed selection.

insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,'도가니탕','doganitang','open',true,true,22
from public.categories p
where p.slug='food-soups-rice'
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  sort_order=excluded.sort_order,
  updated_at=now();

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,place_catalog_enabled,notes
)
select c.id,'internal',null,null,null,true,true,
       'Restaurant-first internal taxonomy; online/offline can share the same leaf category.'
from public.categories c
where c.slug='doganitang'
on conflict(category_id) do update set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  place_catalog_enabled=true,
  notes=excluded.notes,
  updated_at=now();

with seed(category_slug,term,kind) as (
  values
  ('doganitang','도가니','tag'),
  ('doganitang','도가니곰탕','alias')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

commit;
