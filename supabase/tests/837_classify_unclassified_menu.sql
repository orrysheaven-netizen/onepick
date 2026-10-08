begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  admin uuid := gen_random_uuid(); alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); waffle uuid := gen_random_uuid(); closed_store uuid := gen_random_uuid();
  pending_id uuid; res jsonb; a_item uuid; a_pick uuid; b_item uuid; c_item uuid; a_place uuid;
  v_item public.items%rowtype; v_pick public.picks%rowtype; raised boolean; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[admin,alice,bob]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'ccr_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[admin,alice,bob]) id;
  insert into private.admin_users(user_id) values(admin);
  select id into pending_id from public.categories where slug='pending-product';

  -- A food menu just created in the admin panel: no catalog source yet.
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'분류 그룹','ccr-grp-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (waffle,grp,'분류 와플','ccr-waffle-'||substr(replace(waffle::text,'-',''),1,8),'open',true,true),
    (closed_store,grp,'매장 꺼진 메뉴','ccr-closed-'||substr(replace(closed_store::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled)
    values (closed_store,'internal',true,false);

  insert into storage.objects(bucket_id,name,owner_id,metadata)
  select 'item-photos', u::text||'/'||f.name, u::text, jsonb_build_object('mimetype','image/jpeg','size',f.size)
  from unnest(array[alice,bob]) u cross join (values ('a.jpg',1024),('a-t.jpg',100),('b.jpg',1024),('b-t.jpg',100)) f(name,size);

  -- ------------------------------------------------ requests
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  res := public.register_unclassified_menu_pick('와플','바삭해요',p_place_name => '분류와플집', p_map_url => 'https://naver.me/ccr1',
    p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg');
  a_item := (res->>'item_id')::uuid; a_pick := (res->>'pick_id')::uuid;
  res := public.register_unclassified_menu_pick('크로플','쫀득해요',p_place_name => '분류와플집', p_map_url => 'https://naver.me/ccr1',
    p_image_path => alice::text||'/b.jpg', p_thumbnail_path => alice::text||'/b-t.jpg');
  c_item := (res->>'item_id')::uuid;
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  res := public.register_unclassified_menu_pick('와플','밥도 와플',p_place_name => '분류와플집', p_map_url => 'https://naver.me/ccr1',
    p_image_path => bob::text||'/a.jpg', p_thumbnail_path => bob::text||'/a-t.jpg');
  b_item := (res->>'item_id')::uuid;
  reset role;
  assert not exists(select 1 from public.places where name='분류와플집'), 'No store is materialized before approval';

  -- Removed requests retain history but cannot be published without re-registration.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  perform public.remove_pick_by_id(a_pick);
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_review_pending_item(a_item,'active',waffle);
  exception when others then raised := sqlerrm = 'PICK_NOT_FOUND'; end;
  assert raised, 'Removed request cannot be published by an admin';
  reset role;
  assert (select status from public.items where id=a_item)='pending', 'Removed request remains private';
  assert not exists(select 1 from public.item_places where item_id=a_item), 'No public store/menu link after removal';
  assert (select status from public.picks where id=a_pick)='removed', 'Approval cannot revive the removed Pick';
  -- Re-registration must respect the existing Pick cooldown; age only the fixture.
  update public.picks set started_at=now()-interval '8 days', ended_at=now()-interval '7 days'
  where id=a_pick;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  res := public.register_unclassified_menu_pick('와플','다시 등록해요',p_place_name => '분류와플집', p_map_url => 'https://naver.me/ccr1');
  assert (res->>'item_id')::uuid=a_item, 'Explicit re-registration reuses the private request';
  a_pick := (res->>'pick_id')::uuid;
  reset role;

  -- ------------------------------------------------ admin
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;

  raised := false;
  begin
    perform public.admin_review_pending_item(a_item,'active',closed_store);
  exception when others then raised := sqlerrm = 'PLACE_CATEGORY_REQUIRED'; end;
  assert raised, 'A menu whose store catalog was turned off is not overridden';

  raised := false;
  begin
    perform public.admin_review_pending_item(a_item,'active',pending_id);
  exception when others then raised := sqlerrm = 'CATEGORY_NOT_PICKABLE'; end;
  assert raised, 'A request cannot be approved into the staging category';

  v_item := public.admin_review_pending_item(a_item,'active',waffle);
  assert v_item.status='active' and v_item.category_id=waffle, 'Approval classifies and publishes the request';
  reset role;

  select place_id into a_place from public.item_places where item_id=a_item;
  assert not exists(select 1 from private.user_place_requests where item_id=a_item), 'Approval consumes the store request';
  assert exists(select 1 from public.item_places where item_id=a_item and category_id=waffle and place_id=a_place),
    'The request becomes the store × menu item';
  assert exists(select 1 from public.item_channels where item_id=a_item and channel='offline'), 'Offline channel';
  assert public.category_uses_place_catalog(waffle), 'Classifying into a new food menu makes it a store menu';
  assert not exists(select 1 from private.unclassified_menu_places where item_id=a_item), 'The request row is consumed';
  select * into v_pick from public.picks where id=a_pick;
  assert v_pick.status='active' and v_pick.category_id=waffle and v_pick.channel='offline', 'Approval publishes the member''s Pick';
  assert (select is_visible from public.places where id=a_place), 'Approval publishes the store';
  select count(*) into n from public.picks where user_id=alice and category_id=pending_id and status='needs_review';
  assert n=1, 'Alice''s other request keeps waiting';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.admin_review_pending_item(b_item,'active',waffle);
  exception when others then raised := sqlerrm = 'PLACE_ALREADY_LINKED'; end;
  assert raised, 'The store already has this menu: the second request is rejected instead';

  raised := false;
  begin
    perform public.admin_review_pending_item(c_item,'active',waffle);
  exception when others then raised := sqlerrm = 'PICK_CONFLICT'; end;
  assert raised, 'Another request cannot replace the member current Pick';

  v_item := public.admin_review_pending_item(b_item,'rejected',null,'이미 등록된 메뉴예요');
  assert v_item.status='rejected', 'Rejecting a request works as before';
  reset role;

  -- Members cannot classify.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform private.classify_unclassified_menu(c_item, waffle);
  exception when others then raised := sqlerrm = 'ADMIN_REQUIRED'; end;
  assert raised, 'Only an AAL2 admin classifies a request';
  reset role;
end;
$flow$;
$test$, 'Category requests are classified by the existing admin approval: store item + Pick move to the real menu, conflicts rejected');
select * from finish();
rollback;

