begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  admin uuid := gen_random_uuid(); alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); menu2 uuid := gen_random_uuid(); second_request uuid;
  request_item uuid; saved_pick uuid; saved_photo text;
  res jsonb; raised boolean; v_item public.items%rowtype;
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


  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
  values(menu2,grp,'추가만두','approval840-extra-'||menu2::text,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled)
  values(menu2,'internal',true,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  v_item := public.stage_user_place_item(menu,'승인후생성만두','','https://naver.me/approval840');
  request_item := v_item.id;
  res := public.register_item_pick(menu,'offline','만두가 맛있어요',p_item_id=>request_item,
    p_image_path=>alice::text||'/full.jpg',p_thumbnail_path=>alice::text||'/thumb.jpg');
  saved_pick := (res->>'pick_id')::uuid;
  raised := false;
  begin perform public.admin_review_pending_item(request_item,'active');
  exception when others then raised := sqlerrm='ADMIN_REQUIRED'; end;
  assert raised, 'Member cannot approve their own store';
  reset role;
  assert not exists(select 1 from public.places where map_url='https://naver.me/approval840'), 'Submission and denied approval create no place';
  assert not exists(select 1 from public.providers where name='승인후생성만두'), 'Submission creates no provider';
  assert not exists(select 1 from public.place_catalog where name='승인후생성만두'), 'Submission creates no catalog';
  assert not exists(select 1 from public.item_places where item_id=request_item), 'Submission creates no place link';
  assert exists(select 1 from private.user_place_requests where item_id=request_item), 'Submission is a separate request';
  assert not has_table_privilege('authenticated','private.user_place_requests','select'), 'Request table is not directly exposed to members';
  assert not has_table_privilege('anon','private.user_place_requests','select'), 'Guests cannot read requests';
  assert not has_function_privilege('authenticated','private.materialize_user_place_request(uuid)','execute'), 'Members cannot call materialization directly';
  assert (select status='needs_review' from public.picks where id=saved_pick), 'Pick stays needs_review';
  saved_photo := (select image_path from public.items where id=request_item);

  -- Direct SQL activation must not leave an approved item without a store.
  raised := false;
  begin update public.items set status='active' where id=request_item;
  exception when others then raised := sqlerrm='USER_PLACE_REVIEW_REQUIRED'; end;
  assert raised, 'Status updates cannot bypass the review path';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  set local role authenticated;
  raised := false;
  begin perform public.admin_review_pending_item(request_item,'active');
  exception when others then raised := sqlerrm='ADMIN_REQUIRED'; end;
  assert raised, 'An administrator without MFA cannot approve';
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform public.admin_review_pending_item(request_item,'rejected',p_reject_reason=>'링크를 확인해주세요');
  reset role;
  assert exists(select 1 from private.user_place_requests where item_id=request_item), 'Rejection preserves request';
  assert not exists(select 1 from public.places where map_url='https://naver.me/approval840'), 'Rejection creates no store';

  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  perform public.revise_item_request(request_item,p_link_url=>'https://naver.me/approval840-fixed');
  second_request := (public.stage_user_place_item(menu2,'승인후생성만두','','https://naver.me/approval840-fixed')).id;
  reset role;
  assert (select map_url='https://naver.me/approval840-fixed' from private.user_place_requests where item_id=request_item), 'Correction changes the request link';
  assert not exists(select 1 from public.places where map_url='https://naver.me/approval840-fixed'), 'Correction still creates no store';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  raised := false;
  begin perform public.admin_review_pending_item(request_item,'active',p_category_id=>grp);
  exception when others then raised := true; end;
  assert raised, 'Invalid classification does not approve';
  reset role;
  assert not exists(select 1 from public.places where map_url='https://naver.me/approval840-fixed'), 'Failed review does not leak a store';
  set local role authenticated;
  perform public.admin_review_pending_item(request_item,'active');
  raised := false;
  begin perform public.admin_review_pending_item(request_item,'active');
  exception when others then raised := sqlerrm='SOURCE_ITEM_NOT_PENDING'; end;
  assert raised, 'Repeated approval cannot duplicate a store';
  reset role;
  assert (select count(*) from public.places where map_url='https://naver.me/approval840-fixed')=1, 'Approval creates exactly one canonical store';
  assert (select count(*) from public.place_catalog where name='승인후생성만두' and business_status='open')=1, 'Approval opens exactly one catalog entry';
  assert (select count(*) from public.item_places where item_id=request_item)=1, 'Approval attaches the same item';
  assert not exists(select 1 from private.user_place_requests where item_id=request_item), 'Approved request is consumed';
  assert (select image_path=saved_photo from public.items where id=request_item), 'Approval keeps the photo';
  assert (select item_id=request_item and status='active' and one_line_review='만두가 맛있어요' from public.picks where id=saved_pick), 'Approval preserves and publishes the same Pick and review';
  -- Another menu request must remain reusable after the first approval creates
  -- the shared canonical store. Otherwise a retry silently stages a new item.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (public.stage_user_place_item(menu2,'승인후생성만두','','https://naver.me/approval840-fixed')).id=second_request,
    'Retry reuses the existing request even after another menu materializes the store';
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(second_request,'active');
  reset role;
  assert (select count(*) from public.places where map_url='https://naver.me/approval840-fixed')=1,
    'Approving a second menu reuses the same canonical store';

end;
$flow$;
$test$, '#840 stores are materialized only on MFA admin approval; request correction, privacy, rollback and Pick/photo preservation');
select * from finish();
rollback;
