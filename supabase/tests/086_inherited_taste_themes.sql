begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Every open, visible, pickable category resolves to a theme through itself or an ancestor.
select is((
  with recursive ancestry(leaf_id, category_id, parent_id, depth) as (
    select c.id, c.id, c.parent_id, 0
    from public.categories c
    where c.status = 'open' and c.is_visible and c.is_pickable
    union all
    select a.leaf_id, parent.id, parent.parent_id, a.depth + 1
    from ancestry a
    join public.categories parent on parent.id = a.parent_id
    where a.depth < 10
  )
  select coalesce(string_agg(c.slug, ',' order by c.slug), '')
  from public.categories c
  where c.status = 'open' and c.is_visible and c.is_pickable
    and not exists (
      select 1
      from ancestry a
      join public.category_taste_dimensions td on td.category_id = a.category_id and td.is_primary
      where a.leaf_id = c.id
    )
), '', 'every pickable category inherits a taste theme');

select is(
  (select td.dimension_code from public.category_taste_dimensions td join public.categories c on c.id = td.category_id where c.slug = 'alcohol' and td.is_primary),
  'food', 'alcohol belongs to FOOD');
select is(
  (select td.dimension_code from public.category_taste_dimensions td join public.categories c on c.id = td.category_id where c.slug = 'content' and td.is_primary),
  'culture', 'content belongs to CULTURE & ART');

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('a1111111-1111-1111-1111-111111111186','authenticated','authenticated','theme-a@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('a1111111-1111-1111-1111-111111111186','theme_a',true);

-- An unmapped leaf under a mapped root (like a new food-* category) inherits the root's theme.
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select 'd4444444-4444-4444-4444-444444444486', c.id, 'Theme Test Noodle', 'theme-test-noodle', 'open', true, true, 9999
from public.categories c where c.slug = 'food' and c.parent_id is null;

insert into public.items(id,category_id,name,normalized_name,status) values
('e5555555-5555-5555-5555-555555555586','d4444444-4444-4444-4444-444444444486','Theme Noodle','themenoodle','active'),
('e5555555-5555-5555-5555-555555555587',(select id from public.categories where slug='soju'),'Theme Soju','themesoju','active'),
('e5555555-5555-5555-5555-555555555588',(select id from public.categories where slug='movie'),'Theme Movie','thememovie','active');

insert into public.picks(user_id,category_id,item_id,one_line_review,status)
select 'a1111111-1111-1111-1111-111111111186', i.category_id, i.id, 'theme', 'active'
from public.items i
where i.id in ('e5555555-5555-5555-5555-555555555586','e5555555-5555-5555-5555-555555555587','e5555555-5555-5555-5555-555555555588');

select is(
  (public.profile_taste_composition('a1111111-1111-1111-1111-111111111186')->>'unmapped_pick_count')::int,
  0, 'no Pick is left without a theme');
select is((
  select (d->>'pick_count')::int
  from jsonb_array_elements(public.profile_taste_composition('a1111111-1111-1111-1111-111111111186')->'dimensions') d
  where d->>'code' = 'food'
), 2, 'the inherited noodle and the soju Picks count as FOOD');
select is((
  select (d->>'pick_count')::int
  from jsonb_array_elements(public.profile_taste_composition('a1111111-1111-1111-1111-111111111186')->'dimensions') d
  where d->>'code' = 'culture'
), 1, 'the movie Pick keeps its own CULTURE mapping');

-- A leaf's own mapping wins over its ancestor's.
insert into public.category_taste_dimensions(category_id,dimension_code,weight,is_primary) values
('d4444444-4444-4444-4444-444444444486','culture',100,true);
select is((
  select (d->>'pick_count')::int
  from jsonb_array_elements(public.profile_taste_composition('a1111111-1111-1111-1111-111111111186')->'dimensions') d
  where d->>'code' = 'culture'
), 2, 'an explicit leaf mapping overrides the inherited theme');

select * from finish();
rollback;
