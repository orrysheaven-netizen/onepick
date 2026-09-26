begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  (select c.name || ' @ ' || g.slug from public.categories c
   join public.categories g on g.id=c.parent_id where c.slug='kimchi'),
  '배추김치 @ food-kimchi',
  'the former 김치 leaf is 배추김치 under the new 김치 group'
);

select ok(
  (select not is_pickable and status='open' and is_visible
   from public.categories where slug='food-kimchi')
  and (select p.slug='food' from public.categories g join public.categories p on p.id=g.parent_id where g.slug='food-kimchi'),
  '김치 is an open, non-pickable group under 먹을것'
);

select is(
  (select name from public.categories where slug='food-kimchi-sides'),
  '반찬',
  'the former 김치/반찬 group is 반찬'
);

select is(
  (select array_agg(c.slug order by c.sort_order)
   from public.categories c join public.categories g on g.id=c.parent_id
   where g.slug='food-kimchi'),
  array['kimchi','pa-kimchi','kkakdugi'],
  '김치 holds 배추김치, 파김치 and 깍두기'
);

select ok(
  (select bool_and(g.slug='food-kimchi-sides')
   from public.categories c join public.categories g on g.id=c.parent_id
   where c.slug in ('jangajji','jeotgal','rolled-omelette','japchae')),
  '반찬 holds 장아찌, 젓갈, 계란말이 and 잡채'
);

select is(
  (select count(*)::int
   from public.categories c
   join public.category_catalog_sources s on s.category_id=c.id
   where c.slug in ('kimchi','pa-kimchi','kkakdugi','rolled-omelette','japchae','miyeokguk','sundubu-jjigae','bulgogi')
     and public.category_is_open_leaf(c.id)
     and s.mode='internal' and s.is_enabled and s.place_catalog_enabled),
  8,
  'every dish is an open leaf with a place-backed internal catalog'
);

select is(
  (select array_agg(g.slug order by c.slug)
   from public.categories c join public.categories g on g.id=c.parent_id
   where c.slug in ('miyeokguk','sundubu-jjigae','bulgogi')),
  array['food-meat','food-soups-rice','food-soups-rice'],
  '미역국·순두부찌개 sit under 국/탕/찌개/밥 and 불고기 under 고기'
);

select ok(
  exists (select 1 from public.search_pick_categories('김치볶음밥') r
          join public.categories c on c.id=r.id where c.slug='fried-rice'),
  '김치볶음밥 finds 볶음밥'
);

select ok(
  exists (select 1 from public.search_pick_categories('파김치') r
          join public.categories c on c.id=r.id where c.slug='pa-kimchi')
  and not exists (select 1 from public.search_pick_categories('파김치') r
          join public.categories c on c.id=r.id where c.slug='kimchi'),
  '파김치 finds its own dish, not 배추김치'
);

select ok(
  exists (select 1 from public.search_pick_categories('포기김치') r
          join public.categories c on c.id=r.id where c.slug='kimchi'),
  '배추김치 keeps its older search terms'
);

select ok(
  exists (select 1 from public.search_pick_categories('달걀말이') r
          join public.categories c on c.id=r.id where c.slug='rolled-omelette'),
  '달걀말이 finds 계란말이'
);

select * from finish();
rollback;
