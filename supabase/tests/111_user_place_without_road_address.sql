begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  admin uuid := gen_random_uuid(); alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  a_item uuid; other_item uuid; a_place uuid; a_catalog uuid; p_a uuid;
  res jsonb; n integer; raised boolean;
  v_item public.items%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[admin,alice,bob]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'upn_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[admin,alice,bob]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'주소없는 국밥','upn-soup-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (menu,grp,'주소없는 순대국','upn-sundae-'||substr(replace(menu::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (menu,'internal',true,true,'no road address fixture');
  insert into storage.objects(bucket_id,name,owner_id,metadata)
  select 'item-photos', u::text||'/'||f.name, u::text, jsonb_build_object('mimetype','image/jpeg','size',f.size)
  from unnest(array[alice,bob]) u cross join (values ('full.jpg',1024),('thumb.jpg',100)) f(name,size);

  -- ------------------------------------------------------------ name + map link only
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'골목순대국','',null);
  exception when others then raised := sqlerrm = 'ITEM_LINK_REQUIRED'; end;
  assert raised, 'A new store still needs its map link';
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'골목순대국','','https://example.com/golmok');
  exception when others then raised := sqlerrm = 'LINK_INVALID'; end;
  assert raised, 'The map link must still be a Naver map link';
  v_item := public.stage_user_place_item(menu,'골목순대국','','https://naver.me/golmok');
  a_item := v_item.id;
  assert v_item.status='pending' and v_item.external_source='onepick_place', 'A store without an address is a pending request';
  assert (public.stage_user_place_item(menu,'골목 순대국',null,'https://naver.me/golmok')).id = a_item,
    'The same normalized name with the same map link is the same store';
  assert (public.stage_user_place_item(menu,'골목순대국','서울 어딘가 1','https://naver.me/golmok')).id = a_item,
    'A legacy address does not split the same name + link';
  other_item := (public.stage_user_place_item(menu,'골목순대국','','https://naver.me/golmok-2')).id;
  assert other_item <> a_item, 'A different map link is a separate request, never a guessed merge';
  -- Revising a link must not give two member stores the same name + link.
  raised := false;
  begin
    perform public.revise_item_request(a_item, p_link_url => 'https://naver.me/golmok-2');
  exception when others then raised := sqlerrm = 'PLACE_ALREADY_REGISTERED'; end;
  assert raised, 'A revised link cannot collide with another store of the same name';
  perform public.revise_item_request(a_item, p_link_url => 'https://naver.me/golmok');
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'골목순대국',repeat('가',301),'https://naver.me/golmok');
  exception when others then raised := sqlerrm = 'PLACE_ADDRESS_INVALID'; end;
  assert raised, 'An address that is sent must still fit';
  res := public.register_item_pick(menu,'offline','국물이 진해요', p_item_id => a_item,
    p_image_path => alice::text||'/full.jpg', p_thumbnail_path => alice::text||'/thumb.jpg');
  p_a := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false, 'The Pick on a submitted store waits';
  reset role;

  assert not exists (select 1 from public.item_places where item_id=a_item), 'No canonical store link before approval';
  assert not exists (select 1 from public.places where map_url='https://naver.me/golmok'), 'No store before approval';
  assert not exists (select 1 from public.place_catalog where name='골목순대국'), 'No catalog before approval';
  assert (select road_address='' and map_url='https://naver.me/golmok' from private.user_place_requests where item_id=a_item),
    'The request alone keeps the name and link';
  raised := false;
  begin
    insert into public.places(name,road_address,place_provider,provider_place_id)
    values('카탈로그집','','upntest','upn-empty');
  exception when check_violation then raised := true; end;
  assert raised, 'Only member-submitted places may have an empty address';

  -- Another member cannot take over the pending store.
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.stage_user_place_item(menu,'골목순대국','','https://naver.me/golmok');
  exception when others then raised := sqlerrm = 'ITEM_ALREADY_PENDING'; end;
  assert raised, 'Another member cannot take over the pending store';
  reset role;

  -- ------------------------------------------------------------ approval, then others pick it from search
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(a_item,'active');
  reset role;
  select ip.place_id into a_place from public.item_places ip where ip.item_id=a_item;
  select pc.id into a_catalog from public.place_catalog pc
    join public.places p on p.place_provider=pc.place_provider and p.provider_place_id=pc.provider_place_id
    where p.id=a_place;
  assert a_place is not null and a_catalog is not null, 'Approval creates store and catalog';
  assert not exists (select 1 from private.user_place_requests where item_id=a_item), 'Approval consumes the request';
  assert (select is_visible from public.places where id=a_place), 'Approval publishes the place';
  assert (select status='active' from public.picks where id=p_a), 'Approval activates the Pick';
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from public.search_store_catalog('골목순대국') s where s.catalog_id=a_catalog and s.map_url='https://naver.me/golmok';
  assert n = 1, 'An approved store without an address is searchable';
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (public.select_place_catalog_item(menu, a_catalog)).id = a_item,
    'Selecting the approved address-less store from search reuses the same product';
  res := public.register_item_pick(menu,'offline','저도 여기', p_catalog_id => a_catalog,
    p_image_path => bob::text||'/full.jpg', p_thumbnail_path => bob::text||'/thumb.jpg');
  assert (res->>'item_id')::uuid = a_item, 'Another member can Pick the approved address-less store';
  reset role;
end;
$flow$;
$test$, 'member-submitted stores without a road address (#593): name + Naver map link, reuse on name + exact link only, no takeover, no link-revision collision, searchable and pickable after approval');
select * from finish();
rollback;
