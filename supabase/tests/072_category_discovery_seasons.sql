begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_jeoneo uuid;
  v_yellowtail uuid;
  v_food uuid;
  i integer;
begin
  select id into v_jeoneo from public.categories where slug='jeoneo-sashimi';
  select id into v_yellowtail from public.categories where slug='yellowtail-sashimi';
  select id into v_food from public.categories where slug='food';

  assert v_jeoneo is not null and v_yellowtail is not null and v_food is not null,
    'Fine seasonal leaves are seeded';

  assert public.category_is_open_leaf(v_jeoneo),
    'Fine seasonal leaf remains a valid Pick category';

  assert exists(
    select 1 from public.search_pick_categories('전어회')
    where id=v_jeoneo
  ), 'Fine leaf is searchable before it graduates into broad browsing';

  assert not public.category_is_discoverable(v_jeoneo),
    'Sparse fine leaf starts hidden from broad category browsing';

  assert not exists(
    select 1 from public.browse_categories() where id=v_jeoneo
  ), 'Sparse fine leaf is absent from browse categories';

  -- Existing broad leaves remain intact: no data migration or FK rewrite occurs.
  assert exists(select 1 from public.categories where slug='sashimi'),
    'Existing broad 회 category is preserved for compatibility';
  -- Three active catalog items are enough to graduate the leaf.
  for i in 1..3 loop
    insert into public.items(category_id,name,normalized_name,status)
    values(
      v_jeoneo,
      '전어회 발견 테스트 '||i,
      '전어회발견테스트'||i,
      'active'
    );
  end loop;

  assert public.category_is_discoverable(v_jeoneo),
    'Fine leaf graduates after the configured item threshold';

  assert exists(
    select 1 from public.browse_categories() where id=v_jeoneo
  ), 'Graduated fine leaf appears in browse categories';

  assert exists(
    select 1 from public.browse_categories() where id=v_food
  ), 'Ancestors are included when a discoverable child is present';

  assert exists(
    select 1
    from public.seasonal_category_recommendations(date '2026-09-23',8)
    where category_id=v_jeoneo and season_label='가을 제철'
  ), 'September seasonal recommendations include graduated 전어회';

  assert not exists(
    select 1
    from public.seasonal_category_recommendations(date '2026-05-01',8)
    where category_id=v_jeoneo
  ), 'Out-of-season dates exclude 전어회';

  -- Verify a wrap-around season without making it globally discoverable forever.
  update public.category_discovery_rules
  set mode='always', min_item_count=null, min_active_pick_count=null
  where category_id=v_yellowtail;

  assert exists(
    select 1
    from public.seasonal_category_recommendations(date '2027-01-15',8)
    where category_id=v_yellowtail and season_label='겨울 제철'
  ), 'Winter season windows can wrap across December and January';

  assert has_table_privilege('anon','public.category_discovery_rules','select'),
    'Anonymous clients may read public discovery metadata';
  assert not has_table_privilege('anon','public.category_discovery_rules','insert'),
    'Anonymous clients cannot edit discovery metadata';
  assert has_table_privilege('authenticated','public.category_seasons','select'),
    'Signed-in clients may read public season metadata';
  assert not has_table_privilege('authenticated','public.category_seasons','update'),
    'Signed-in clients cannot edit season metadata';

  assert has_function_privilege('anon','public.browse_categories()','execute'),
    'Anonymous clients can fetch browse-safe category trees';
  assert has_function_privilege('authenticated','public.seasonal_category_recommendations(date,integer)','execute'),
    'Signed-in clients can fetch seasonal category recommendations';
end;
$flow$;
$test$, 'Fine food discovery stays sparse-safe and seasonal recommendations are data-gated');

select * from finish();
rollback;
