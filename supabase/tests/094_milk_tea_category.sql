begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
begin
  assert (
    select c.status='open' and c.is_visible and c.is_pickable
       and public.category_is_open_leaf(c.id) and p.slug='food-drinks-coffee'
    from public.categories c
    join public.categories p on p.id=c.parent_id
    where c.slug='milk-tea'
  ), '밀크티 is an open pickable leaf under 음료/커피';

  assert public.category_uses_place_catalog((select id from public.categories where slug='milk-tea')),
    '밀크티 is place-backed like the other store menus';

  assert not public.category_uses_place_catalog((select id from public.categories where slug='tea')),
    '차 stays a product category';

  assert exists(
    select 1 from public.search_pick_categories('버블티')
    where name='밀크티' and matched_term='버블티' and match_kind='alias'
  ), '버블티 resolves to 밀크티';
end;
$flow$;
$test$, '밀크티 is a searchable place-backed drink category');

select * from finish();
rollback;
