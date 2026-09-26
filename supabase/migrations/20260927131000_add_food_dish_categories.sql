begin;

-- Dishes that can be picked as a restaurant, an online product or a recipe.
--
-- 김치/반찬 splits into two groups so 김치 can hold its kinds while staying
-- within three levels: 먹을것 › 김치 › 배추김치·파김치·깍두기 and
-- 먹을것 › 반찬 › 장아찌·젓갈·계란말이·잡채. The former 김치 leaf becomes
-- 배추김치 in place (same id and slug), so its items and Picks stay attached.
-- 김치볶음밥 is found under the existing 볶음밥 leaf.

-- 김치 group next to 반찬.
insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select food.id,'김치','food-kimchi','open',true,false,106
from public.categories food
where food.slug='food'
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=false,
  sort_order=excluded.sort_order,
  updated_at=now();

update public.categories
set name='반찬', updated_at=now()
where slug='food-kimchi-sides';

-- The former 김치 leaf (slug kimchi) becomes 배추김치: an existing row keeps its
-- id, so its items and Picks move with it; a database without it gets one.
with seed(parent_slug,name,slug,sort_order) as (
  values
  ('food-kimchi','배추김치','kimchi',1),
  ('food-kimchi','파김치','pa-kimchi',2),
  ('food-kimchi','깍두기','kkakdugi',3),
  ('food-kimchi-sides','계란말이','rolled-omelette',10),
  ('food-kimchi-sides','잡채','japchae',11),
  ('food-soups-rice','미역국','miyeokguk',23),
  ('food-soups-rice','순두부찌개','sundubu-jjigae',24),
  ('food-meat','불고기','bulgogi',30)
)
insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select p.id,s.name,s.slug,'open',true,true,s.sort_order
from seed s
join public.categories p on p.slug=s.parent_slug
on conflict(slug) do update set
  parent_id=excluded.parent_id,
  name=excluded.name,
  status='open',
  is_visible=true,
  is_pickable=true,
  sort_order=excluded.sort_order,
  updated_at=now();

-- New dishes use the restaurant-first internal catalog. The pre-existing
-- kimchi leaf may already have an operator-configured catalog source in the
-- hosted DB, so do not overwrite its mode/provider/external source.
insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,place_catalog_enabled,notes
)
select c.id,'internal',null,null,null,true,true,
       'Restaurant-first internal taxonomy; online/offline can share the same leaf category.'
from public.categories c
where c.slug in ('pa-kimchi','kkakdugi','rolled-omelette','japchae','miyeokguk','sundubu-jjigae','bulgogi')
on conflict(category_id) do update set
  mode='internal',
  provider=null,
  edge_function_slug=null,
  external_source=null,
  is_enabled=true,
  place_catalog_enabled=true,
  notes=excluded.notes,
  updated_at=now();

insert into public.category_catalog_sources(
  category_id,mode,provider,edge_function_slug,external_source,is_enabled,place_catalog_enabled,notes
)
select c.id,'internal',null,null,null,true,true,
       'Restaurant-first dish; preserve any existing catalog provider configuration.'
from public.categories c
where c.slug='kimchi'
on conflict(category_id) do update set
  is_enabled=true,
  place_catalog_enabled=true,
  notes=excluded.notes,
  updated_at=now();

-- 파김치 is its own dish now; a search for it should not land on 배추김치.
delete from public.category_search_terms t
using public.categories c
where t.category_id=c.id and c.slug='kimchi' and lower(t.term) in ('파김치','깍두기','배추김치');

with seed(category_slug,term,kind) as (
  values
  ('kimchi','김치','tag'),
  ('kimchi','포기김치','alias'),
  ('pa-kimchi','쪽파김치','alias'),
  ('kkakdugi','깍뚜기','alias'),
  ('kkakdugi','무김치','tag'),
  ('rolled-omelette','달걀말이','alias'),
  ('japchae','잡채밥','tag'),
  ('miyeokguk','소고기미역국','tag'),
  ('miyeokguk','미역국밥','tag'),
  ('sundubu-jjigae','순두부','alias'),
  ('bulgogi','소불고기','tag'),
  ('bulgogi','돼지불고기','tag'),
  ('fried-rice','김치볶음밥','tag')
)
insert into public.category_search_terms(category_id,term,kind)
select c.id,s.term,s.kind
from seed s
join public.categories c on c.slug=s.category_slug
on conflict(category_id,lower(term)) do update set kind=excluded.kind;

commit;
