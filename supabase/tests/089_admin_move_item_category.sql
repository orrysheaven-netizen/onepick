begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
set local plpgsql.check_asserts = on;

create temporary table mic_ids(key text primary key, id uuid not null) on commit drop;
grant select on mic_ids to authenticated, anon;

do $fixtures$
declare
  v_admin uuid := gen_random_uuid();
  v_alice uuid := gen_random_uuid();
  v_bob uuid := gen_random_uuid();
  v_carol uuid := gen_random_uuid();
  v_root uuid := gen_random_uuid();
  v_soups uuid := gen_random_uuid();
  v_wrong uuid := gen_random_uuid();
  v_right uuid := gen_random_uuid();
  v_noplace uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_twin uuid := gen_random_uuid();
  v_movie uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_catalog uuid := gen_random_uuid();
  v_bob_right uuid := gen_random_uuid();
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (v_admin,'authenticated','authenticated',now(),now()),
    (v_alice,'authenticated','authenticated',now(),now()),
    (v_bob,'authenticated','authenticated',now(),now()),
    (v_carol,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_admin,'mic_admin_'||substr(v_suffix,1,8),true),
    (v_alice,'mic_alice_'||substr(v_suffix,1,8),true),
    (v_bob,'mic_bob_'||substr(v_suffix,1,8),true),
    (v_carol,'mic_carol_'||substr(v_suffix,1,8),true);
  insert into private.admin_users(user_id) values(v_admin);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_root,'이동 테스트 먹을것','microot-'||v_suffix,'open',true,false);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (v_soups,v_root,'이동 테스트 국','micsoup-'||v_suffix,'open',true,false),
    (v_noplace,v_root,'이동 테스트 간식','micsnack-'||v_suffix,'open',true,true);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (v_wrong,v_soups,'이동 테스트 도가니탕','micwrong-'||v_suffix,'open',true,true),
    (v_right,v_soups,'이동 테스트 해장국','micright-'||v_suffix,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (v_wrong,'internal',true,true,'move test'),
    (v_right,'internal',true,true,'move test'),
    (v_noplace,'internal',true,false,'move test');

  insert into public.place_catalog(id,place_provider,provider_place_id,name,normalized_name,road_address,region_1,region_2)
    values(v_catalog,'mictest','mic-'||v_suffix,'이동중앙해장','이동중앙해장','서울 강남구 영동대로 1','서울','강남구');

  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (v_item,v_wrong,'이동해장집','이동해장집','active',v_alice),
    (v_twin,v_right,'이동쌍둥이','이동쌍둥이','active',v_alice),
    (v_store,v_wrong,'이동중앙해장','이동중앙해장','active',v_alice);
  insert into public.items(id,category_id,name,normalized_name,status,external_source,external_id)
    values(v_movie,v_wrong,'이동외부영화','이동외부영화','active','tmdb','mic-'||v_suffix);

  -- Alice's current and past Picks of the item; Bob also picked it and already
  -- has a current Pick in the target category.
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at,ended_at) values
    (v_alice,v_wrong,v_item,'예전 선택','replaced',now()-interval '2 days',now()-interval '1 day');
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at) values
    (v_alice,v_wrong,v_item,'해장은 여기','active',now()-interval '1 day'),
    (v_bob,v_wrong,v_item,'나도 여기','active',now()-interval '1 day'),
    (v_carol,v_wrong,v_store,'중앙해장 최고','active',now()-interval '1 day' + interval '1 second');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (v_bob_right,v_bob,v_right,v_twin,'해장국은 이거','active',now()-interval '1 day');

  insert into mic_ids values ('admin',v_admin),('alice',v_alice),('bob',v_bob),('soups',v_soups),
    ('wrong',v_wrong),('right',v_right),('noplace',v_noplace),('item',v_item),('twin',v_twin),
    ('movie',v_movie),('store',v_store),('catalog',v_catalog),('bob_right',v_bob_right);
end;
$fixtures$;

-- Non-admins can neither preview nor move.
select set_config('request.jwt.claim.sub',(select id::text from mic_ids where key='alice'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
select throws_ok(
  $$select public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))$$,
  '42501', null, 'A normal user cannot preview a category move'
);
select throws_ok(
  $$select public.admin_move_item_category((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))$$,
  '42501', null, 'A normal user cannot move an item'
);
reset role;

select set_config('request.jwt.claim.sub',(select id::text from mic_ids where key='admin'),true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;

-- Link the store item to a place so the 매장 identity has to move along.
select lives_ok($$
  select public.admin_link_item_to_place((select id from mic_ids where key='store'),(select id from mic_ids where key='catalog'))
$$, 'Fixture: the store item gets a 매장 identity');

select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))
    - 'item_id' - 'from_category_id' - 'to_category_id',
  '{"active_pick_count":2,"pick_count":3,"conflict_count":1,"blocked_reason":"PICK_CONFLICT"}'::jsonb,
  'The preview counts current and past Picks and the user who already has a Pick in the target'
);
select throws_ok(
  $$select public.admin_move_item_category((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))$$,
  'P0001', 'PICK_CONFLICT', 'The move refuses instead of replacing anyone''s Pick'
);
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='wrong'))->>'blocked_reason',
  'CATEGORY_UNCHANGED', 'Moving to the same category is refused'
);
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='soups'))->>'blocked_reason',
  'CATEGORY_NOT_PICKABLE', 'Only open leaf categories can receive an item'
);
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='movie'),(select id from mic_ids where key='right'))->>'blocked_reason',
  'ITEM_CATEGORY_LOCKED', 'External catalog items keep the catalog''s category'
);
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='store'),(select id from mic_ids where key='noplace'))->>'blocked_reason',
  'PLACE_CATEGORY_REQUIRED', 'A 매장 item only moves to a category with the place catalog'
);
reset role;

-- Bob drops his target-category Pick, and a same-name item appears in the target.
update public.picks set status='removed', ended_at=now() where id=(select id from mic_ids where key='bob_right');
update public.items set name='이동해장집', normalized_name='이동해장집' where id=(select id from mic_ids where key='twin');

set local role authenticated;
select throws_ok(
  $$select public.admin_move_item_category((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))$$,
  'P0001', 'ITEM_DUPLICATE', 'A same-name item in the target must be merged instead'
);
reset role;
update public.items set name='이동쌍둥이', normalized_name='이동쌍둥이' where id=(select id from mic_ids where key='twin');

-- Search aliases follow the same per-category uniqueness as names.
insert into public.item_aliases(item_id,alias) values((select id from mic_ids where key='twin'),'이동해장집');
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))->>'blocked_reason',
  'ALIAS_CONFLICT', 'A target alias equal to the item''s name blocks the move'
);
delete from public.item_aliases where item_id=(select id from mic_ids where key='twin');
insert into public.item_aliases(item_id,alias) values
  ((select id from mic_ids where key='item'),'이동별칭'),
  ((select id from mic_ids where key='twin'),'이동별칭');
select is(
  public.admin_preview_item_category_move((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))->>'blocked_reason',
  'ALIAS_CONFLICT', 'The item''s alias colliding with a target alias blocks the move'
);
delete from public.item_aliases where item_id in ((select id from mic_ids where key='item'),(select id from mic_ids where key='twin'));

set local role authenticated;
select lives_ok(
  $$select public.admin_move_item_category((select id from mic_ids where key='item'),(select id from mic_ids where key='right'))$$,
  'An AAL2 admin moves the item once nothing conflicts'
);
select lives_ok(
  $$select public.admin_move_item_category((select id from mic_ids where key='store'),(select id from mic_ids where key='right'))$$,
  'A 매장 item moves between place-catalog categories'
);
select lives_ok($$set constraints all immediate$$, 'Moved rows satisfy every deferred invariant');
reset role;

select is(
  (select array_agg(p.status||':'||(p.category_id=(select id from mic_ids where key='right')) order by p.status, p.user_id)
     from public.picks p where p.item_id=(select id from mic_ids where key='item')),
  array['active:true','active:true','replaced:true'],
  'Current and past Picks follow the item'
);
select is(
  (select i.category_id from public.items i where i.id=(select id from mic_ids where key='item')),
  (select id from mic_ids where key='right'), 'The item is in the new category'
);
select ok(
  (select ip.category_id=(select id from mic_ids where key='right')
      and ipr.category_id=ip.category_id
      and i.external_id=ip.place_id::text||':'||ip.category_id::text
      and p.category_id=ip.category_id
     from public.items i
     join public.item_places ip on ip.item_id=i.id
     join public.item_providers ipr on ipr.item_id=i.id
     join public.picks p on p.item_id=i.id
    where i.id=(select id from mic_ids where key='store')),
  'The place mapping, provider mapping, external identity and Pick move together'
);

-- Outside the RPC the keys are still checked immediately.
select throws_ok(
  $$update public.items set category_id=(select id from mic_ids where key='wrong') where id=(select id from mic_ids where key='item')$$,
  '23503', null, 'A direct category update on a picked item is still rejected'
);

select * from finish();
rollback;
