begin;

-- Food taxonomy v1: preserve existing category UUIDs and item/pick FKs.
with food as (
  select id from public.categories where slug = 'food'
),
seed(name, slug, sort_order) as (
  values
    ('고기','food-meat',101),
    ('해산물','food-seafood',102),
    ('해조류/건어물','food-seaweed-dried',103),
    ('과일','food-fruit',104),
    ('채소','food-vegetables',105),
    ('쌀/곡물','food-grains',106),
    ('김치/반찬','food-kimchi-sides',107),
    ('간편식','food-convenience',108),
    ('면','food-noodles',109),
    ('과자/디저트','food-snacks-desserts',110),
    ('빵','food-bakery',111),
    ('음료/커피','food-drinks-coffee',112),
    ('소스/양념','food-sauces-seasonings',113)
)
insert into public.categories
  (parent_id, name, slug, status, is_visible, is_pickable, sort_order)
select food.id, seed.name, seed.slug, 'open', true, false, seed.sort_order
from food cross join seed
on conflict (slug) do update
set parent_id = excluded.parent_id,
    name = excluded.name,
    status = 'open',
    is_visible = true,
    is_pickable = false,
    sort_order = excluded.sort_order,
    updated_at = now();

-- Existing pickable category UUIDs are retained; only their parent changes.
update public.categories c
set parent_id = p.id, updated_at = now()
from public.categories p
where
  (c.slug in ('gopchang','lamb','beef') and p.slug = 'food-meat')
  or (c.slug = 'soy-marinated-crab' and p.slug = 'food-seafood')
  or (c.slug = 'seaweed' and p.slug = 'food-seaweed-dried')
  or (c.slug = 'kimchi' and p.slug = 'food-kimchi-sides');

-- Existing top-level food picks also move under the new middle taxonomy.
update public.categories c
set parent_id = p.id, updated_at = now()
from public.categories p
where
  (c.slug = 'ramen' and p.slug = 'food-noodles')
  or (c.slug = 'ice-cream' and p.slug = 'food-snacks-desserts')
  or (c.slug = 'snacks' and p.slug = 'food-snacks-desserts');

-- Shopping mall is no longer a taxonomy axis. Keep the row for compatibility/history.
update public.categories
set status = 'paused',
    is_visible = false,
    is_pickable = false,
    updated_at = now()
where slug = 'shopping-mall';

commit;
