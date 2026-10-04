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
  ('u6','f1210000-0000-4000-8000-000000000006'),
  ('group','f1211000-0000-4000-8000-000000000001'),
  ('soup','f1211000-0000-4000-8000-000000000011'),
  ('noodle','f1211000-0000-4000-8000-000000000012'),
  ('rice','f1211000-0000-4000-8000-000000000013'),
  ('quiet','f1211000-0000-4000-8000-000000000014'),
  ('shut','f1211000-0000-4000-8000-000000000015'),
  ('dessert','f1211000-0000-4000-8000-000000000016'),
  ('soup_a','f1212000-0000-4000-8000-000000000001'),
  ('soup_b','f1212000-0000-4000-8000-000000000002'),
  ('soup_c','f1212000-0000-4000-8000-000000000003'),
  ('noodle_a','f1212000-0000-4000-8000-000000000004'),
  ('rice_a','f1212000-0000-4000-8000-000000000005'),
  ('quiet_a','f1212000-0000-4000-8000-000000000006'),
  ('shut_a','f1212000-0000-4000-8000-000000000007'),
  ('dessert_a','f1212000-0000-4000-8000-000000000008'),
  ('dessert_b','f1212000-0000-4000-8000-000000000009');
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
  ('quiet','FIR 조용한 메뉴','fir-quiet'),
  ('shut','FIR 닫힌 메뉴','fir-shut'),
  ('dessert','FIR 디저트','fir-dessert')
) v(key,name,slug)
join fir_ids c on c.key=v.key
cross join fir_ids g where g.key='group';

-- Store items (one store's menu). soup_a has no photo; dessert_a is discontinued
-- (still counted) and dessert_b hidden (never counted).
insert into public.items(id,category_id,name,normalized_name,status,thumbnail_path,image_path)
select i.id, c.id, v.name, v.name, v.status, v.thumb, v.thumb
from (values
  ('soup_a','soup','FIR 국집 A',null,'active'),
  ('soup_b','soup','FIR 국집 B','fir/soup-b.jpg','active'),
  ('soup_c','soup','FIR 국집 C','fir/soup-c.jpg','active'),
  ('noodle_a','noodle','FIR 면집 A','fir/noodle-a.jpg','active'),
  ('rice_a','rice','FIR 밥집 A','fir/rice-a.jpg','active'),
  ('quiet_a','quiet','FIR 조용한 집 A','fir/quiet-a.jpg','active'),
  ('shut_a','shut','FIR 닫힌 집 A','fir/shut-a.jpg','active'),
  ('dessert_a','dessert','FIR 단종 디저트집','fir/dessert-a.jpg','discontinued'),
  ('dessert_b','dessert','FIR 숨긴 디저트집','fir/dessert-b.jpg','hidden')
) v(ikey,ckey,name,thumb,status)
join fir_ids i on i.key=v.ikey
join fir_ids c on c.key=v.ckey;

-- Age rows explicitly: now() is constant inside the test transaction.
--   noodle_a: u1, u2, u3 offline → 3 (picks_one_current_per_item: one current Pick per person per item)
--   soup_b:   u1 online (2d), u3 online (6d) → 2 (offline 0)
--   soup_c:   u2 offline (1d); u4 too old (8d); u5 replaced → 1
--   rice_a:   u4 offline (1h) → 1
--   soup_a:   u5 offline, but no photo → left out
--   quiet_a:  only an old Pick → left out
--   rice_a also has u6, who is suspended below → still 1
--   shut_a:   u1 offline, but its menu is closed below → left out
--   dessert_a (discontinued): u2 offline → 1; dessert_b (hidden): u3 → left out
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
  ('u5','quiet_a','offline','active',interval '30 days'),
  ('u6','rice_a','offline','active',interval '2 hours'),
  ('u1','shut_a','offline','active',interval '1 hour'),
  ('u2','dessert_a','offline','active',interval '1 hour'),
  ('u3','dessert_b','offline','active',interval '1 hour')
) as v(ukey,ikey,channel,status,age)
join fir_ids u on u.key=v.ukey
join fir_ids x on x.key=v.ikey
join public.items i on i.id=x.id;

-- Rules shared with food_menu_recent_ranking: suspended users and closed menus never count.
insert into private.user_moderation(user_id, reason)
select id, 'FIR suspended fixture' from fir_ids where key = 'u6';
update public.categories set status = 'closed' where id = (select id from fir_ids where key = 'shut');

-- Isolate the ranking from other data in the database for this transaction only
-- (rolled back below): suspend every other person with a Pick in the last 7 days,
-- so this test's items are the whole top 50 and absolute ranks are stable.
insert into private.user_moderation(user_id, reason)
select distinct p.user_id, 'FIR ranking isolation'
from public.picks p
where p.status = 'active' and p.started_at >= now() - interval '8 days'
  and p.user_id not in (select id from fir_ids)
on conflict (user_id) do nothing;

set local role anon;

select is(
  (select array_agg(item_name || ' ' || category_name || ':' || pick_count || ':' || rank || ':' || is_tied
     order by rank, item_name) from public.food_item_recent_ranking(null, 50)),
  array['FIR 면집 A FIR 면:3:1:false','FIR 국집 B FIR 국:2:2:false',
        'FIR 국집 C FIR 국:1:3:true','FIR 단종 디저트집 FIR 디저트:1:3:true','FIR 밥집 A FIR 밥:1:3:true'],
  'isolated ranking: absolute ranks and ties over exactly this test''s items'
);

select ok(
  (select pick_count from public.food_item_recent_ranking(null, 50) where item_id = (select id from fir_ids where key = 'rice_a')) = 1,
  'a suspended user''s current Pick does not count'
);

select ok(
  not exists (select 1 from public.food_item_recent_ranking(null, 50) where item_id = (select id from fir_ids where key = 'shut_a')),
  'an item under a closed menu is left out'
);

select ok(
  exists (select 1 from public.food_item_recent_ranking(null, 50) where item_id = (select id from fir_ids where key = 'dessert_a'))
  and not exists (select 1 from public.food_item_recent_ranking(null, 50) where item_id = (select id from fir_ids where key = 'dessert_b')),
  'discontinued items are ranked; hidden items are not'
);

select is(
  (select array_agg(item_name || ' ' || category_name || ':' || pick_count order by item_name) from public.food_item_recent_ranking(null, 50) r where r.item_id in (select id from fir_ids) ),
  array['FIR 국집 B FIR 국:2','FIR 국집 C FIR 국:1','FIR 단종 디저트집 FIR 디저트:1','FIR 면집 A FIR 면:3','FIR 밥집 A FIR 밥:1'],
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
  array['FIR 국집 C:1','FIR 단종 디저트집:1','FIR 면집 A:3','FIR 밥집 A:1'],
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
