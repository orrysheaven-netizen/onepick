begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table dpp_ids(key text primary key, id uuid not null) on commit drop;
insert into dpp_ids values
  ('u1','f9f00000-0000-4000-8000-000000000001'),
  ('u2','f9f00000-0000-4000-8000-000000000002'),
  ('u3','f9f00000-0000-4000-8000-000000000003'),
  ('store','f9f30000-0000-4000-8000-000000000001'),
  ('seller','f9f30000-0000-4000-8000-000000000002'),
  ('other','f9f30000-0000-4000-8000-000000000003');
grant select on dpp_ids to anon, authenticated;

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@dpp.invalid','',now(),now() from dpp_ids where key like 'u%';
insert into public.profiles(id,username,onboarding_completed)
select id,'dpp_'||key,true from dpp_ids where key like 'u%';

-- 김치찌개 is a food dish from the migrations; 'other' sits in a different open leaf.
insert into public.items(id,category_id,name,normalized_name,status)
select d.id,c.id,v.name,v.normalized,'active'
from (values ('store','김치찌개 명가','김치찌개명가'),('seller','김치찌개 밀키트몰','김치찌개밀키트몰')) as v(key,name,normalized)
join dpp_ids d on d.key=v.key
cross join public.categories c
where c.slug='kimchi-jjigae';
insert into public.items(id,category_id,name,normalized_name,status)
select d.id,c.id,'다른 메뉴 가게','다른메뉴가게','active'
from dpp_ids d
cross join lateral (
  select c.id from public.categories c
  where c.slug<>'kimchi-jjigae' and public.category_is_open_leaf(c.id)
  order by c.slug limit 1
) c
where d.key='other';

-- Age rows explicitly: now() is constant inside the test transaction.
insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
select u.id, i.category_id, i.id, v.channel, v.review, 'active', now() - v.age
from (values
  ('u1','store','offline','u1 매장',interval '3 hours'),
  ('u2','store','offline','u2 매장',interval '2 hours'),
  ('u3','seller','online','u3 온라인',interval '1 hour'),
  ('u2','other','offline','다른 메뉴',interval '10 minutes')
) as v(ukey,ikey,channel,review,age)
join dpp_ids u on u.key=v.ukey
join dpp_ids x on x.key=v.ikey
join public.items i on i.id=x.id;
insert into public.item_channels(item_id,channel,is_primary)
select id,'offline',true from dpp_ids where key in ('store','other')
union all select id,'online',true from dpp_ids where key='seller';

set local role anon;

select is(
  (select array_agg(f.one_line_review order by f.started_at desc)
   from public.home_pick_feed_page(p_category_id => (select id from public.categories where slug='kimchi-jjigae')) f
   where f.user_id in (select id from dpp_ids)),
  array['u3 온라인','u2 매장','u1 매장'],
  'a dish lists everyone''s Pick for it, newest first, and nothing from other dishes'
);

select is(
  (select array_agg(f.one_line_review order by f.started_at desc)
   from public.home_pick_feed_page(p_channel => 'offline', p_category_id => (select id from public.categories where slug='kimchi-jjigae')) f
   where f.user_id in (select id from dpp_ids)),
  array['u2 매장','u1 매장'],
  'the channel filter narrows a dish to one channel'
);

select ok(
  (select count(*) from public.home_pick_feed_page() f where f.item_id=(select id from dpp_ids where key='other')) = 1,
  'without a dish the feed still has every category'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select id from dpp_ids where key='u1'), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int
   from public.home_pick_feed_page(p_category_id => (select id from public.categories where slug='kimchi-jjigae')) f
   where f.user_id=(select id from dpp_ids where key='u1')),
  0,
  'the viewer''s own Pick is left out, as on Home'
);

reset role;

select * from finish();
rollback;
