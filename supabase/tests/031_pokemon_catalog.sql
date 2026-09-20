begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(exists(
  select 1
  from public.categories character
  where character.slug='character'
    and character.name='캐릭터'
    and character.parent_id is null
    and character.status='open'
    and character.is_visible
    and character.is_pickable=false
),'character is an open non-pickable root');

select ok(exists(
  select 1
  from public.categories pokemon
  join public.categories character on character.id=pokemon.parent_id
  where pokemon.slug='pokemon'
    and pokemon.name='포켓몬'
    and pokemon.status='open'
    and pokemon.is_visible
    and pokemon.is_pickable
    and character.slug='character'
),'pokemon is a pickable child of character');

select is((select count(*)::integer from public.categories where slug='character'),1,'character slug remains unique');
select is((select count(*)::integer from public.categories where slug='pokemon'),1,'pokemon slug remains unique');

select ok(not exists(
  select 1 from public.categories child
  where child.parent_id=(select id from public.categories where slug='pokemon')
),'pokemon is a leaf category');

select ok(exists(
  select 1 from public.external_catalog_cache
  where false
) is false,'pokemon reuses the existing server-only external catalog cache');

select ok(has_table_privilege('service_role','public.external_catalog_cache','SELECT')
  and not has_table_privilege('anon','public.external_catalog_cache','SELECT'),
  'provider cache stays service-role-only');

select * from finish();
rollback;
