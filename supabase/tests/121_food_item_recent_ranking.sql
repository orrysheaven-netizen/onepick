begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table fir_ids(key text primary key, id uuid not null) on commit drop;
insert into fir_ids values
  ('u1','f1210000-0000-4000-8000-000000000001'),
  ('u2','f1210000-0000-4000-8000-000000000002'),
  ('u3','f1210000-0000-4000-8000-000000000003'),
  ('u4','f1210000-0000-4000-8000-000000000004'),
  ('u5','f1210000-0000-4000-8000-000000000005'),
  ('group','f1211000-0000-4000-8000-000000000001'),
  ('soup','f1211000-0000-4000-8000-000000000011'),
  ('noodle','f1211000-0000-4000-8000-000000000012'),
  ('rice','f1211000-0000-4000-8000-000000000013'),
  ('quiet','f1211000-0000-4000-8000-000000000014'),
  ('soup_a','f1212000-0000-4000-8000-000000000001'),
  ('soup_b','f1212000-0000-4000-8000-000000000002'),
  ('soup_c','f1212000-0000-4000-8000-000000000003'),
  ('noodle_a','f1212000-0000-4000-8000-000000000004'),
  ('rice_a','f1212000-0000-4000-8000-000000000005'),
  ('quiet_a','f1212000-0000-4000-8000-000000000006');
grant select on fir_ids to anon, authenticated;

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@fir.invalid','',now(),now() from fir_ids where key like 'u_';
insert into public.profiles(id,username,onboarding_completed)
select id,'fir_'||key,true from fir_ids where key like 'u_';

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select g.id, food.id, 'FIR 그룹', 'fir-group', 'open', true, false, 900
from fir_ids g cross join public.categories food
where g.key='group' and food.slug='food';
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select c.id, g.id, v.name, v.slug, 'open', true, true, 900
from (values
  ('soup','FIR 국','fir-soup'),
  ('noodle','FIR 면','fir-noodle'),
  ('rice','FIR 밥','fir-rice'),
  ('quiet','FIR 조용한 메뉴','fir-quiet')
) v(key,name,slug)
join fir_ids c on c.key=v.key
cross join fir_ids g where g.key='group';

-- Store items (one store's menu). soup_a has no photo.
insert into public.items(id,category_id,name,normalized_name,status,thumbnail_path,image_path)
select i.id, c.id, v.name, v.name, 'active', v.thumb, v.thumb
from (values
  ('soup_a','soup','FIR 국집 A',null),
  ('soup_b','soup','FIR 국집 B','fir/soup-b.jpg'),
  ('soup_c','soup','FIR 국집 C','fir/soup-c.jpg'),
  ('noodle_a','noodle','FIR 면집 A','fir/noodle-a.jpg'),
  ('rice_a','rice','FIR 밥집 A','fir/rice-a.jpg'),
  ('quiet_a','quiet','FIR 조용한 집 A','fir/quiet-a.jpg')
) v(ikey,ckey,name,thumb)
join fir_ids i on i.key=v.ikey
join fir_ids c on c.key=v.ckey;

-- Age rows explicitly: now() is constant inside the test transaction.
--   noodle_a: u1, u2, u3 offline → 3 (picks_one_current_per_item: one current Pick per person per item)
--   soup_b:   u1 online (2d), u3 online (6d) → 2 (offline 0)
--   soup_c:   u2 offline (1d); u4 too old (8d); u5 replaced → 1
--   rice_a:   u4 offline (1h) → 1
--   soup_a:   u5 offline, but no photo → left out
--   quiet_a:  only an old Pick → left out
insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at)
select u.id, i.category_id, i.id, v.channel, 'fir', v.status, now() - v.age,
  case when v.status = 'active' then null else now() - interval '1 hour' end
from (values
  ('u1','noodle_a','offline','active',interval '1 hour'),
  ('u2','noodle_a','offline','active',interval '3 hours'),
  ('u3','noodle_a','offline','active',interval '4 hours'),
  ('u1','soup_b','online','active',interval '2 days'),
  ('u3','soup_b','online','active',interval '6 days'),
  ('u2','soup_c','offline','active',interval '1 day'),
  ('u4','soup_c','offline','active',interval '8 days'),
  ('u5','soup_c','offline','replaced',interval '2 days'),
  ('u4','rice_a','offline','active',interval '1 hour'),
  ('u5','soup_a','offline','active',interval '1 hour'),
  ('u5','quiet_a','offline','active',interval '30 days')
) as v(ukey,ikey,channel,status,age)
join fir_ids u on u.key=v.ukey
join fir_ids x on x.key=v.ikey
join public.items i on i.id=x.id;

set local role anon;

-- Other data in the database can share the ranking, so check counts and relative
-- order of this test's items rather than absolute rank numbers.
select is(
  (select array_agg(item_name || ' ' || category_name || ':' || pick_count order by item_name) from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) ),
  array['FIR 국집 B FIR 국:2','FIR 국집 C FIR 국:1','FIR 면집 A FIR 면:3','FIR 밥집 A FIR 밥:1'],
  'each store menu counts people with a current Pick from the last 7 days; old, replaced and photo-less Picks do not add'
);

select ok(
  (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 면집 A') < (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 국집 B')
  and (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 국집 B') < (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 국집 C'),
  'more people rank higher'
);

select ok(
  (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 국집 C') = (select rank from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 밥집 A')
  and (select bool_and(is_tied) from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and pick_count = 1),
  'equal counts share a rank and are marked tied'
);

select is(
  (select array_agg(item_name || ':' || pick_count order by item_name) from public.food_item_recent_ranking('offline', 50) r where r.item_id in (select id from fir_ids) ),
  array['FIR 국집 C:1','FIR 면집 A:3','FIR 밥집 A:1'],
  'channel scope counts only current Picks in the requested channel'
);

select is(
  (select image_path from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) and item_name = 'FIR 면집 A'),
  'fir/noodle-a.jpg',
  'the item photo comes with the row'
);

select is(
  (select count(*)::int from public.food_item_recent_ranking(null, 1)),
  1,
  'the limit is applied'
);

select is(
  (select count(*)::int from public.food_item_recent_ranking(null, 500)) <= 50,
  true,
  'the limit is capped at 50'
);

reset role;

select ok(
  not (select prosecdef from pg_proc where oid='public.food_item_recent_ranking(text,integer)'::regprocedure),
  'recent item ranking is SECURITY INVOKER'
);

select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='public.food_item_recent_ranking(text,integer)'::regprocedure),
  'recent item ranking keeps an empty search_path'
);

select ok(
  has_function_privilege('anon','public.food_item_recent_ranking(text,integer)','execute')
  and has_function_privilege('authenticated','public.food_item_recent_ranking(text,integer)','execute')
  and has_function_privilege('service_role','public.food_item_recent_ranking(text,integer)','execute'),
  'anon, authenticated and service_role can execute recent item ranking'
);

select * from finish();
rollback;
