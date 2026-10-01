begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Fixtures: a food leaf with a restaurant, an online seller, an older packaged
-- product without channels and a recipe video; plus a non-food leaf.
create temp table pc_ids(key text primary key, id uuid not null) on commit drop;
insert into pc_ids(key,id) values
  ('member','f9b00000-0000-4000-8000-000000000001'),
  ('other','f9b00000-0000-4000-8000-000000000002'),
  ('group','f9b10000-0000-4000-8000-000000000001'),
  ('soup','f9b10000-0000-4000-8000-000000000002'),
  ('books','f9b10000-0000-4000-8000-000000000003'),
  ('place','f9b20000-0000-4000-8000-000000000001'),
  ('place2','f9b20000-0000-4000-8000-000000000002'),
  ('store','f9b30000-0000-4000-8000-000000000001'),
  ('seller','f9b30000-0000-4000-8000-000000000002'),
  ('packaged','f9b30000-0000-4000-8000-000000000003'),
  ('video','f9b30000-0000-4000-8000-000000000004'),
  ('book','f9b30000-0000-4000-8000-000000000005'),
  ('book2','f9b30000-0000-4000-8000-000000000006'),
  ('request','f9b30000-0000-4000-8000-000000000007');
grant select on pc_ids to anon, authenticated;

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
select id,'authenticated','authenticated',key||'@pick-channel.invalid','',now(),now()
from pc_ids where key in ('member','other');
insert into public.profiles(id,username,onboarding_completed)
select id,'pc_'||key,true from pc_ids where key in ('member','other');

insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
select (select id from pc_ids where key='group'),c.id,'채널 테스트 국','pc-soups','open',true,false
from public.categories c where c.slug='food';
insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
  ((select id from pc_ids where key='soup'),(select id from pc_ids where key='group'),'채널 테스트 미역국','pc-miyeokguk','open',true,true),
  ((select id from pc_ids where key='books'),null,'채널 테스트 책','pc-books','open',true,true);

alter table public.item_places disable trigger item_places_sync_provider;
alter table public.item_places disable trigger item_places_provider_consistency;
insert into public.places(id,name,road_address,region_1,region_2,place_provider,provider_place_id,is_visible)
values
  ((select id from pc_ids where key='place'),'채널식당','서울 중구 채널로 1','서울','중구','pctest','pc-1',true),
  ((select id from pc_ids where key='place2'),'즉석미역국 본점','서울 중구 채널로 2','서울','중구','pctest','pc-2',true);

insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id) values
  ((select id from pc_ids where key='store'),(select id from pc_ids where key='soup'),'채널식당','채널식당','active','onepick_place','pc-store'),
  ((select id from pc_ids where key='seller'),(select id from pc_ids where key='soup'),'채널몰 미역국','채널몰미역국','active',null,null),
  ((select id from pc_ids where key='packaged'),(select id from pc_ids where key='soup'),'즉석 미역국','즉석미역국','active',null,null),
  ((select id from pc_ids where key='video'),(select id from pc_ids where key='soup'),'미역국 끓이는 법','미역국끓이는법','active','youtube_video','pcvideo0001'),
  ((select id from pc_ids where key='book'),(select id from pc_ids where key='books'),'채널 책','채널책','active',null,null),
  ((select id from pc_ids where key='book2'),(select id from pc_ids where key='books'),'채널 책 2','채널책2','active',null,null);
insert into public.item_places(item_id,category_id,place_id) values
  ((select id from pc_ids where key='store'),(select id from pc_ids where key='soup'),(select id from pc_ids where key='place'));
insert into public.item_channels(item_id,channel,is_primary) values
  ((select id from pc_ids where key='store'),'offline',true),
  ((select id from pc_ids where key='seller'),'online',true);

select ok(
  not has_function_privilege('anon','public.change_pick(uuid,uuid,text,text,text,text)','execute'),
  'anonymous callers cannot change Picks'
);
select ok(
  has_function_privilege('authenticated','public.remove_pick(uuid,text)','execute'),
  'members can remove a Pick by category and channel'
);

-- This test exercises a non-photo contract. The product now requires photos for
-- new/replacement Picks, so give eligible fixtures a test-only external image.
update public.items
set image_source_url='https://example.invalid/test-photo.jpg'
where status in ('active','discontinued')
  and image_path is null and thumbnail_path is null and image_source_url is null;

select set_config('request.jwt.claim.sub',(select id::text from pc_ids where key='member'),true);

-- A client that sends no channel gets the item's own channel.
select is(
  (public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='store'),'동네 최고 미역국')).channel,
  'offline',
  'a restaurant Pick without a channel is stored under offline'
);

select is(
  (public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='seller'),'택배로도 맛있어요',null,null,'online')).channel,
  'online',
  'the same dish takes a separate online Pick'
);

select is(
  (select count(*)::int from public.picks
   where user_id=(select id from pc_ids where key='member')
     and category_id=(select id from pc_ids where key='soup')
     and status='active'),
  2,
  'offline and online Picks of one dish are both current'
);

select is(
  (public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='video'),'집에서 끓여요')).channel,
  'recipe',
  'a cooking video is picked under recipe'
);

select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='store'),'이유',null,null,'online')$$,
  'P0001','PICK_CHANNEL_MISMATCH',
  'a restaurant cannot be picked under online'
);

select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='video'),'이유',null,null,'online')$$,
  'P0001','PICK_CHANNEL_MISMATCH',
  'a cooking video cannot be picked under online'
);

select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='packaged'),'이유',null,null,'recipe')$$,
  'P0001','PICK_CHANNEL_MISMATCH',
  'only a cooking video can be picked under recipe'
);

select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='store'),'이유',null,null,'delivery')$$,
  'P0001','PICK_CHANNEL_INVALID',
  'unknown channels are rejected'
);

-- Replacing within a channel keeps the other channels.
select is(
  (public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='packaged'),'마트 미역국',null,null,'online')).channel,
  'online',
  'an older product without channels can be picked under online'
);

select is(
  (select status from public.picks
   where user_id=(select id from pc_ids where key='member')
     and item_id=(select id from pc_ids where key='seller')
   order by started_at desc limit 1),
  'replaced',
  'the new online Pick replaces only the previous online Pick'
);

select is(
  (select array_agg(channel order by channel) from public.picks
   where user_id=(select id from pc_ids where key='member')
     and category_id=(select id from pc_ids where key='soup')
     and status='active'),
  array['offline','online','recipe'],
  'one current Pick per channel remains'
);

select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='packaged'),'이유',null,null,'offline')$$,
  'P0001','ITEM_ALREADY_PICKED',
  'the same item cannot be a current Pick under a second channel'
);

-- Other categories keep one Pick per category and no channel.
select throws_ok(
  $$select public.change_pick((select id from pc_ids where key='books'),(select id from pc_ids where key='book'),'이유',null,null,'offline')$$,
  'P0001','PICK_CHANNEL_INVALID',
  'non-food Picks take no channel'
);

select is(
  (public.change_pick((select id from pc_ids where key='books'),(select id from pc_ids where key='book'),'좋은 책')).channel,
  null,
  'non-food Picks store no channel'
);

select lives_ok(
  $$select public.change_pick((select id from pc_ids where key='books'),(select id from pc_ids where key='book2'),'더 좋은 책')$$,
  'a second book replaces the first'
);

select is(
  (select count(*)::int from public.picks
   where user_id=(select id from pc_ids where key='member')
     and category_id=(select id from pc_ids where key='books')
     and status='active'),
  1,
  'non-food categories keep one current Pick'
);

-- remove_pick needs the channel once a dish holds several Picks.
select throws_ok(
  $$select public.remove_pick((select id from pc_ids where key='soup'))$$,
  'P0001','PICK_CHANNEL_REQUIRED',
  'removing without a channel is refused when several channels are picked'
);

select is(
  public.remove_pick((select id from pc_ids where key='soup'),'recipe'),
  true,
  'the recipe Pick can be removed on its own'
);

select is(
  (select array_agg(channel order by channel) from public.picks
   where user_id=(select id from pc_ids where key='member')
     and category_id=(select id from pc_ids where key='soup')
     and status='active'),
  array['offline','online'],
  'removing one channel keeps the others'
);

select is(
  public.remove_pick((select id from pc_ids where key='books')),
  true,
  'non-food Picks are still removed by category alone'
);

-- Home feed channel tabs follow the Pick's channel.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is(
  (select array_agg(f.item_name order by f.item_name) from public.home_pick_feed_page(null,null,'online') f
   where f.category_id=(select id from pc_ids where key='soup')),
  array['즉석 미역국'],
  'the online tab shows the online Pick'
);
select is(
  (select f.channels from public.home_pick_feed_page(null,null,'offline') f
   where f.category_id=(select id from pc_ids where key='soup')),
  array['offline'],
  'feed rows carry the Pick''s channel'
);
reset role;

-- An item linked to a store later moves its Picks to the store channel.
select set_config('request.jwt.claim.sub',(select id::text from pc_ids where key='other'),true);
select is(
  (public.change_pick((select id from pc_ids where key='soup'),(select id from pc_ids where key='packaged'),'이것도 맛있어요')).channel,
  'online',
  'an older product defaults to online'
);
select set_config('request.jwt.claim.sub','',true);
insert into public.item_places(item_id,category_id,place_id) values
  ((select id from pc_ids where key='packaged'),(select id from pc_ids where key='soup'),(select id from pc_ids where key='place2'));
insert into public.item_channels(item_id,channel,is_primary)
values ((select id from pc_ids where key='packaged'),'offline',true);
select is(
  (select channel from public.picks
   where user_id=(select id from pc_ids where key='other')
     and item_id=(select id from pc_ids where key='packaged')
     and status='active'),
  'offline',
  'linking the item to a store moves its current Picks to offline'
);
select is(
  (select channel from public.picks
   where user_id=(select id from pc_ids where key='member')
     and item_id=(select id from pc_ids where key='packaged')
     and status='active'),
  'online',
  'a Pick stays put when the member already holds a Pick in the target channel'
);

-- A product request carries the chosen channel into the Pick made on approval.
select set_config('request.jwt.claim.sub',(select id::text from pc_ids where key='other'),true);
insert into public.items(id,category_id,name,normalized_name,status,created_by)
select (select id from pc_ids where key='request'),c.id,'요청 미역국','요청미역국','pending',(select id from pc_ids where key='other')
from public.categories c where c.slug='pending-product';
select is(
  (public.set_pending_item_pick_review((select id from pc_ids where key='request'),'택배 미역국','online')).channel,
  'online',
  'the request stores the channel chosen with it'
);
select set_config('request.jwt.claim.sub','',true);
update public.items
set category_id=(select id from pc_ids where key='soup'), status='active'
where id=(select id from pc_ids where key='request');
select is(
  (select channel from public.picks
   where user_id=(select id from pc_ids where key='other')
     and item_id=(select id from pc_ids where key='request')
     and status='active'),
  'online',
  'approval creates the Pick under the requested channel'
);
select is(
  (select count(*)::int from public.picks
   where user_id=(select id from pc_ids where key='other')
     and category_id=(select id from pc_ids where key='soup')
     and status='active'),
  2,
  'the approved online Pick sits next to the member''s offline Pick'
);

select * from finish();
rollback;
