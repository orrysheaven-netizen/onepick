-- 화장품 joins 스타일 beside 향수. Both are categories where people are actually asked
-- "뭐 써?", which is the entry point docs/early-user-acquisition.md builds on; the seeding
-- list in docs/content-seeding.md follows.
--
-- 향수 already exists as a pickable 스타일 child (20260919153415) and needs no change here.
-- Only 화장품 is new. sort_order stays at its default so the 스타일 children keep the order
-- they have today.

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select gen_random_uuid(), p.id, x.name, x.slug, 'open', true, true
from (
  values
    ('style','화장품','cosmetics')
) as x(parent_slug,name,slug)
join public.categories p on p.slug=x.parent_slug
on conflict (slug) do update
set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  updated_at=now();

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,notes
)
select c.id,'internal',null,null,null,true,
       'Curated OnePick internal master catalog; user-uploaded photos preferred.'
from public.categories c
where c.slug='cosmetics'
on conflict (category_id) do update
set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  notes=excluded.notes,
  updated_at=now();

insert into public.category_taste_dimensions(
  category_id,dimension_code,weight,is_primary
)
select c.id,'style',100,true
from public.categories c
where c.slug='cosmetics'
on conflict (category_id,dimension_code) do update
set
  weight=excluded.weight,
  is_primary=true,
  updated_at=now();
