begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table fmr_ids(key text primary key, id uuid not null) on commit drop;
insert into fmr_ids values
  ('u1','f9800000-0000-4000-8000-000000000001'),
  ('u2','f9800000-0000-4000-8000-000000000002'),
  ('u3','f9800000-0000-4000-8000-000000000003'),
  ('u4','f9800000-0000-4000-8000-000000000004'),
  ('u5','f9800000-0000-4000-8000-000000000005'),
  ('group','f9810000-0000-4000-8000-000000000001'),
  ('other_group','f9810000-0000-4000-8000-000000000002'),
  ('soup','f9810000-0000-4000-8000-000000000011'),
  ('noodle','f9810000-0000-4000-8000-000000000012'),
  ('rice','f9810000-0000-4000-8000-000000000013'),
  ('quiet','f9810000-0000-4000-8000-000000000014'),
  ('soup_a','f9820000-0000-4000-8000-000000000001'),
  ('soup_b','f9820000-0000-4000-8000-000000000002'),
  ('soup_c','f9820000-0000-4000-8000-000000000003'),
  ('noodle_a','f9820000-0000-4000-8000-000000000004'),
  ('rice_a','f9820000-0000-4000-8000-000000000005'),
  ('quiet_a','f9820000-0000-4000-8000-000000000006');
grant select on fmr_ids to anon, authenticated;

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@fmr.invalid','',now(),now() from fmr_ids where key like 'u_';
insert into public.profiles(id,username,onboarding_completed)
select id,'fmr_'||key,true from fmr_ids where key like 'u_';

-- Two food groups of our own so other data in the database cannot leak in:
-- group → soup, noodle, quiet; other_group → rice.
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select g.id, food.id, v.name, v.slug, 'open', true, false, 900
from (values ('group','FMR 그룹','fmr-group'),('other_group','FMR 다른 그룹','fmr-other-group')) v(key,name,slug)
join fmr_ids g on g.key=v.key
cross join public.categories food where food.slug='food';
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
select c.id, g.id, v.name, v.slug, 'open', true, true, 900
from (values
  ('soup','group','FMR 국','fmr-soup'),
  ('noodle','group','FMR 면','fmr-noodle'),
  ('quiet','group','FMR 조용한 메뉴','fmr-quiet'),
  ('rice','other_group','FMR 밥','fmr-rice')
) v(key,gkey,name,slug)
join fmr_ids c on c.key=v.key
join fmr_ids g on g.key=v.gkey;

insert into public.items(id,category_id,name,normalized_name,status,thumbnail_path,image_path)
select i.id, c.id, v.name, v.name, 'active', v.thumb, v.thumb
from (values
  ('soup_a','soup','국 가게 A',null),
  ('soup_b','soup','국 가게 B','fmr/soup-b.jpg'),
  ('soup_c','soup','국 가게 C','fmr/soup-c.jpg'),
  ('noodle_a','noodle','면 가게 A','fmr/noodle-a.jpg'),
  ('rice_a','rice','밥 가게 A',null),
  ('quiet_a','quiet','조용한 가게 A','fmr/quiet-a.jpg')
) v(ikey,ckey,name,thumb)
join fmr_ids i on i.key=v.ikey
join fmr_ids c on c.key=v.ckey;

-- Age rows explicitly: now() is constant inside the test transaction.
--   soup:   u1 C offline (1d) + u1 B online (2d) → u1 counted once
--           (items without item_channels accept offline/online; recipe needs a YouTube item)
--           u2 A offline (3d), u3 B online (6d), u4 C offline (8d, too old)
--           u5 C offline replaced within the week (not current)
--   noodle: u1, u2, u3 (all recent) → ties with soup at 3 people
--   rice:   u4 (recent, other group)
--   quiet:  only an old Pick → absent
insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at)
select u.id, i.category_id, i.id, v.channel, 'fmr', v.status, now() - v.age,
  case when v.status = 'active' then null else now() - interval '1 hour' end
from (values
  ('u1','soup_c','offline','active',interval '1 day'),
  ('u1','soup_b','online','active',interval '2 days'),
  ('u2','soup_a','offline','active',interval '3 days'),
  ('u3','soup_b','online','active',interval '6 days'),
  ('u4','soup_c','offline','active',interval '8 days'),
  ('u5','soup_c','offline','replaced',interval '2 days'),
  ('u1','noodle_a','offline','active',interval '1 hour'),
  ('u2','noodle_a','offline','active',interval '2 hours'),
  ('u3','noodle_a','offline','active',interval '3 hours'),
  ('u4','rice_a','offline','active',interval '1 hour'),
  ('u5','quiet_a','offline','active',interval '30 days')
) as v(ukey,ikey,channel,status,age)
join fmr_ids u on u.key=v.ukey
join fmr_ids x on x.key=v.ikey
join public.items i on i.id=x.id;

set local role anon;

select is(
  (select array_agg(category_name || ':' || pick_count || ':' || rank || ':' || is_tied order by category_name) from public.food_menu_recent_ranking((select id from fmr_ids where key='group'))),
  array['FMR 국:3:1:true','FMR 면:3:1:true'],
  'counts people with a current Pick from the last 7 days; old, replaced and double-channel Picks do not add'
);

select ok(
  not exists (select 1 from public.food_menu_recent_ranking((select id from fmr_ids where key='group')) where category_id = (select id from fmr_ids where key='quiet')),
  'a menu with no Pick in the last 7 days is left out'
);

select ok(
  not exists (select 1 from public.food_menu_recent_ranking((select id from fmr_ids where key='group')) where category_id = (select id from fmr_ids where key='rice')),
  'the group filter keeps menus of other groups out'
);

select is(
  (select cover_item_id from public.food_menu_recent_ranking((select id from fmr_ids where key='group')) where category_id = (select id from fmr_ids where key='soup')),
  (select id from fmr_ids where key='soup_b'),
  'the cover is the most chosen item of the week that has an image (A has more people but no image)'
);

select is(
  (select array_agg(category_name || ':' || pick_count || ':' || rank || ':' || is_tied order by category_name)
   from public.food_menu_recent_ranking(
     (select id from fmr_ids where key='group'),
     20,
     'offline'
   )),
  array['FMR 국:2:2:false','FMR 면:3:1:false'],
  'channel scope counts only current Picks in the requested channel'
);

select is(
  (select cover_item_id
   from public.food_menu_recent_ranking(
     (select id from fmr_ids where key='group'),
     20,
     'offline'
   )
   where category_id = (select id from fmr_ids where key='soup')),
  (select id from fmr_ids where key='soup_c'),
  'channel scope chooses the cover only from Picks in that channel'
);

select is(
  (select count(*)::int from public.food_menu_recent_ranking(p_limit => 50)
   where category_id in (select id from fmr_ids)),
  3,
  'without a group every food menu with a recent Pick is ranked'
);

select is(
  (select count(*)::int from public.food_menu_recent_ranking((select id from fmr_ids where key='group'), 1)),
  1,
  'the limit is applied'
);

reset role;

select ok(
  to_regprocedure('public.food_menu_recent_ranking(uuid,integer)') is null,
  'the old two-argument overload is gone'
);

select ok(
  to_regprocedure('public.food_menu_recent_ranking(uuid,integer,text)') is not null,
  'the channel-scoped function has one unambiguous three-argument identity'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.food_menu_recent_ranking(uuid,integer,text)'::regprocedure),
  'recent menu ranking remains SECURITY INVOKER'
);

select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='public.food_menu_recent_ranking(uuid,integer,text)'::regprocedure),
  'recent menu ranking keeps an empty search_path'
);

select ok(
  has_function_privilege('anon','public.food_menu_recent_ranking(uuid,integer,text)','execute'),
  'anon keeps execute on recent menu ranking'
);

select ok(
  has_function_privilege('authenticated','public.food_menu_recent_ranking(uuid,integer,text)','execute'),
  'authenticated keeps execute on recent menu ranking'
);

select ok(
  has_function_privilege('service_role','public.food_menu_recent_ranking(uuid,integer,text)','execute'),
  'service_role keeps execute on recent menu ranking'
);

select * from finish();
rollback;
