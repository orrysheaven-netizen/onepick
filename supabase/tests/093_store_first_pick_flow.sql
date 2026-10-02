-- Store-first pick registration: store search without a menu, seller search,
-- seller × menu selection by users, and reviewed Naver map link suggestions.
begin;
-- Keep this legacy fixture focused on its original contract after the
-- photo-required Pick invariant. Rolled back with this pgTAP transaction.
alter table public.items alter column image_source_url
  set default 'https://example.test/onepick-test-item.png'; -- test fixture default for the photo-required Pick invariant
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  member uuid := gen_random_uuid(); other uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); menu2 uuid := gen_random_uuid(); books uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid(); closed uuid := gen_random_uuid();
  v_provider uuid; v_inactive uuid;
  v_item public.items%rowtype; v_again public.items%rowtype; v_menu2 public.items%rowtype;
  v_pending uuid := gen_random_uuid();
  v_sugg public.item_link_suggestions%rowtype; v_other_sugg public.item_link_suggestions%rowtype;
  v_place uuid; n integer; r record;
begin
  assert has_function_privilege('anon','public.search_store_catalog(text,integer)','execute'), 'Guests can search stores';
  assert has_function_privilege('anon','public.search_online_sellers(text,integer)','execute'), 'Guests can search sellers';
  assert not has_function_privilege('anon','public.select_online_provider_item(uuid,uuid)','execute'), 'Guests cannot create seller items';
  assert not has_function_privilege('anon','public.suggest_item_map_link(uuid,text)','execute'), 'Guests cannot suggest links';
  assert not has_table_privilege('authenticated','public.item_link_suggestions','insert'), 'No direct link writes';

  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[member,other,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'sf_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[member,other,admin]) id;
  insert into private.admin_users(user_id) values(admin);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'매장먼저 국수','sf-noodles-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (menu,grp,'매장먼저 평양냉면','sf-naengmyeon-'||substr(replace(menu::text,'-',''),1,8),'open',true,true),
    (menu2,grp,'매장먼저 수육','sf-suyuk-'||substr(replace(menu2::text,'-',''),1,8),'open',true,true),
    (books,null,'매장먼저 책','sf-books-'||substr(replace(books::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (menu,'internal',true,true,'store-first fixture'),
    (menu2,'internal',true,true,'store-first fixture'),
    (books,'internal',true,false,'store-first fixture');

  insert into public.place_catalog(id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,address,region_1,region_2,provider_category,business_status,source_updated_at,closed_at)
  values
    (catalog,'sftest','sf-1','매장먼저을밀대',private.normalize_place_name('매장먼저을밀대'),null,
     '서울 마포구 숭문길 24','서울 마포구 염리동','서울','마포구','국수/칼국수','open',now(),null),
    (closed,'sftest','sf-2','매장먼저을밀대 폐업',private.normalize_place_name('매장먼저을밀대 폐업'),null,
     null,null,'서울','중구','국수/칼국수','closed',now(),now());

  assert (select place_enabled from public.store_menu_options() where category_id=menu), 'Menu options list place-enabled food menus';
  assert not exists(select 1 from public.store_menu_options() where category_id in (books,grp)), 'Non-food leaves and groups are not menu options';

  -- 1. Store search needs no menu and hides closed stores.
  set local role anon;
  select count(*) into n from public.search_store_catalog('매장먼저을밀대');
  assert n=1, 'Store search finds open stores by name without a menu: '||n;
  assert (select count(*) from public.search_store_catalog('매'))=0, 'One character is too short';
  reset role;

  -- 2. Online sellers: search active ones, create seller × menu items on use.
  select provider_id into v_provider from private.resolve_online_provider('매장먼저 곰탕몰','official_site','https://gomtang-sf.example.com/');
  select provider_id into v_inactive from private.resolve_online_provider('매장먼저 숨김몰','official_site','https://hidden-sf.example.com/');
  update public.providers set status='hidden' where id=v_inactive;
  set local role anon;
  select * into r from public.search_online_sellers('곰탕몰');
  assert r.provider_id=v_provider and r.official_url='https://gomtang-sf.example.com/', 'Seller search returns the active seller and its link';
  assert (select count(*) from public.search_online_sellers('숨김몰'))=0, 'Hidden sellers are not offered';
  reset role;

  perform set_config('request.jwt.claim.sub',member::text,true);
  set local role authenticated;
  v_item := public.select_online_provider_item(menu,v_provider);
  v_again := public.select_online_provider_item(menu,v_provider);
  assert v_item.id=v_again.id and v_item.external_source='onepick_provider', 'Seller × menu item is created once';
  begin
    perform public.select_online_provider_item(books,v_provider);
    assert false, 'Non-food categories are refused';
  exception when sqlstate 'P0001' then assert sqlerrm='CATEGORY_NOT_PICKABLE', sqlerrm; end;
  begin
    perform public.select_online_provider_item(grp,v_provider);
    assert false, 'Groups are refused';
  exception when sqlstate 'P0001' then assert sqlerrm='CATEGORY_NOT_PICKABLE', sqlerrm; end;
  begin
    perform public.select_online_provider_item(menu,v_inactive);
    assert false, 'Hidden sellers are refused';
  exception when sqlstate 'P0001' then assert sqlerrm='PROVIDER_NOT_FOUND', sqlerrm; end;
  reset role;
  assert (select target_url='https://gomtang-sf.example.com/' and is_primary from public.item_channels
          where item_id=v_item.id and channel='online'), 'The seller item opens the seller link';
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform public.change_pick(menu,v_item.id,'국물이 진해요',null,null,'online');
  assert exists(select 1 from public.picks where user_id=member and item_id=v_item.id and status='active' and channel='online'),
    'The seller item can be picked on the online channel';

  -- 3. Link suggestions on a store item.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',member::text,true);
  v_item := public.select_place_catalog_item(menu,catalog);
  v_menu2 := public.select_place_catalog_item(menu2,catalog);
  -- New catalog places start as pending requests (096_review_new_catalog_places);
  -- approve them so another member can suggest a link as on any existing store.
  reset role;
  update public.items set status='active' where id in (v_item.id,v_menu2.id);
  set local role authenticated;
  begin
    perform public.suggest_item_map_link(v_item.id,'https://example.com/map');
    assert false, 'Only Naver map links are accepted';
  exception when sqlstate 'P0001' then assert sqlerrm='LINK_INVALID', sqlerrm; end;
  begin
    perform public.suggest_item_map_link(v_item.id,'http://naver.me/abc');
    assert false, 'https only';
  exception when sqlstate 'P0001' then assert sqlerrm='LINK_INVALID', sqlerrm; end;
  v_sugg := public.suggest_item_map_link(v_item.id,'https://naver.me/first');
  v_sugg := public.suggest_item_map_link(v_item.id,' https://naver.me/abcd ');
  assert v_sugg.url='https://naver.me/abcd' and v_sugg.status='pending', 'Resubmitting updates the one pending suggestion';
  assert (select count(*) from public.item_link_suggestions where item_id=v_item.id)=1, 'One pending suggestion per user and item';

  perform set_config('request.jwt.claim.sub',other::text,true);
  v_other_sugg := public.suggest_item_map_link(v_menu2.id,'https://map.naver.com/p/entry/place/123');
  assert (select count(*) from public.item_link_suggestions)=1, 'Users see only their own suggestions';

  -- A pending request from someone else cannot receive links; the requester's own can.
  reset role;
  insert into public.items(id,category_id,name,normalized_name,status,created_by)
    values(v_pending,menu,'매장먼저 새가게','매장먼저새가게','pending',member);
  set local role authenticated;
  begin
    perform public.suggest_item_map_link(v_pending,'https://naver.me/x');
    assert false, 'Another user''s pending request is not visible';
  exception when sqlstate 'P0001' then assert sqlerrm='ITEM_NOT_FOUND', sqlerrm; end;
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform public.suggest_item_map_link(v_pending,'https://naver.me/newstore');

  -- 4. Admin review.
  begin
    perform public.admin_pending_item_link_suggestions(50);
    assert false, 'Members cannot list suggestions';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  select count(*) into n from public.admin_pending_item_link_suggestions(50);
  assert n=3, 'Admin sees all pending suggestions: '||n;
  begin
    perform public.admin_review_item_link_suggestion(
      (select id from public.item_link_suggestions where item_id=v_pending),true);
    assert false, 'A request without a place cannot be approved yet';
  exception when sqlstate 'P0001' then assert sqlerrm='LINK_ITEM_NOT_PLACE', sqlerrm; end;
  perform public.admin_review_item_link_suggestion(v_sugg.id,true);
  reset role;

  select place_id into v_place from public.item_places where item_id=v_item.id;
  assert (select map_url from public.places where id=v_place)='https://naver.me/abcd', 'Approval sets the store map link';
  assert (select count(*) from public.item_channels ic join public.item_places ip on ip.item_id=ic.item_id
          where ip.place_id=v_place and ic.channel='offline' and ic.target_url='https://naver.me/abcd')=2,
    'Every menu item of the store opens the approved link';
  assert (select status from public.item_link_suggestions where id=v_other_sugg.id)='rejected',
    'Other pending links for the same store are settled';
  assert (select status from public.item_link_suggestions where item_id=v_pending)='pending', 'Unrelated requests stay pending';

  set local role authenticated;
  begin
    perform public.admin_review_item_link_suggestion(v_sugg.id,false);
    assert false, 'A settled suggestion cannot be reviewed again';
  exception when sqlstate 'P0001' then assert sqlerrm='LINK_SUGGESTION_NOT_PENDING', sqlerrm; end;
  reset role;
end;
$flow$;
$test$, 'Store-first pick flow: store and seller search, seller items, map link suggestions and review');
select * from finish();
rollback;
