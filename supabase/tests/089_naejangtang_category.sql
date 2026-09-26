begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
begin
  assert (
    select c.status='open' and c.is_visible and c.is_pickable
       and public.category_is_open_leaf(c.id) and p.slug='food-soups-rice'
    from public.categories c
    join public.categories p on p.id=c.parent_id
    where c.slug='naejangtang'
  ), '내장탕 is an open pickable leaf under 국/탕/찌개/밥';

  assert exists(
    select 1 from public.category_catalog_sources s
    join public.categories c on c.id=s.category_id
    where c.slug='naejangtang' and s.mode='internal' and s.is_enabled and s.place_catalog_enabled
  ), '내장탕 uses the internal catalog with place selection';

  assert public.category_uses_place_catalog((select id from public.categories where slug='naejangtang')),
    '내장탕 is place-backed like the other restaurant leaves';

  assert exists(
    select 1 from public.search_pick_categories('내장탕')
    where name='내장탕'
  ), '내장탕 is discoverable by name';

  assert exists(
    select 1 from public.search_pick_categories('내장국')
    where name='내장탕' and matched_term='내장국' and match_kind='alias'
  ), '내장국 resolves to 내장탕';
end;
$flow$;
$test$, '내장탕 is a searchable place-backed soup category');

select * from finish();
rollback;
