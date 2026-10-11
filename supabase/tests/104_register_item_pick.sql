begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid();
  existing uuid := gen_random_uuid(); existing2 uuid := gen_random_uuid(); named uuid := gen_random_uuid();
  v_provider uuid; v_official text;
  r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  res jsonb; again jsonb; place_item uuid; online_item uuid; p1 uuid; p2 uuid; p3 uuid; bob_pick uuid;
  v_item public.items%rowtype; v_pick public.picks%rowtype;
  n integer; raised boolean; detail_text text;
begin
  assert not has_function_privilege('anon','public.register_item_pick(uuid,text,text,uuid,uuid,uuid,text,text,text,text,uuid,uuid)','execute'), 'Guests cannot register';
  assert not has_function_privilege('anon','public.revise_item_request(uuid,text,text,text,text,boolean,text)','execute'), 'Guests cannot revise requests';

  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'rip_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,admin]) id;
  insert into private.admin_users(user_id) values(admin);

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable)
    select grp,c.id,'즉시등록 국수','rip-noodles-'||substr(replace(grp::text,'-',''),1,8),'open',true,false
    from public.categories c where c.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (menu,grp,'즉시등록 평양냉면','rip-naengmyeon-'||substr(replace(menu::text,'-',''),1,8),'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes) values
    (menu,'internal',true,true,'register fixture');
  insert into public.place_catalog(id,place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,address,region_1,region_2,provider_category,business_status,source_updated_at,closed_at)
  values
    (catalog,'riptest','rip-1','즉시등록을밀대',private.normalize_place_name('즉시등록을밀대'),null,
     '서울 마포구 숭문길 24','서울 마포구 염리동','서울','마포구','국수/칼국수','open',now(),null);
  select provider_id into v_provider from private.resolve_online_provider('즉시등록 곰탕몰','official_site','https://gomtang-rip.example.com/');
  select official_url into v_official from public.online_stores s join public.providers p on p.online_store_id=s.id where p.id=v_provider;

  -- Two published products with photos and no channel rows (pickable under any
  -- channel but recipe, like older packaged products).
  insert into public.items(id,category_id,name,normalized_name,status,image_source_url) values
    (existing, menu,'즉시등록 기존집','즉시등록기존집','active','https://img.example.com/a.jpg'),
    (existing2,menu,'즉시등록 기존집 둘','즉시등록기존집둘','active','https://img.example.com/b.jpg');
  -- A name-only request without a photo, by alice (the merge case below).
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (named,menu,'즉시등록 이름집','즉시등록이름집','pending',alice);
  -- alice's uploads: one pair per product (a photo belongs to one product).
  insert into storage.objects(bucket_id,name,owner_id,metadata)
  select 'item-photos', alice::text||'/'||f.name, alice::text, jsonb_build_object('mimetype','image/jpeg','size',f.size)
  from (values ('full.jpg',1024),('thumb.jpg',100),('full2.jpg',1024),('thumb2.jpg',100),('full3.jpg',1024),('thumb3.jpg',100)) f(name,size);

  -- ------------------------------------------------------------ validation
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.register_item_pick(menu,'delivery','x');
  exception when others then raised := sqlerrm = 'PICK_CHANNEL_INVALID'; end;
  assert raised, 'Unknown channels are refused';
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','x');
  exception when others then raised := sqlerrm = 'ITEM_SELECTION_REQUIRED'; end;
  assert raised, 'A product must be named: item, place or seller';
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','', p_catalog_id => catalog);
  exception when others then raised := sqlerrm = 'REVIEW_INVALID'; end;
  assert raised, 'The review is required';
  -- A new place has no photo yet: the photo is required, and the failed call
  -- leaves nothing behind.
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','국물이 좋아요', p_catalog_id => catalog);
  exception when others then raised := sqlerrm = 'PHOTO_REQUIRED'; end;
  assert raised, 'A new product needs a photo';
  reset role;
  select count(*) into n from public.items where category_id=menu and external_source='onepick_place';
  assert n = 0, 'A refused registration creates no product';

  -- ------------------------------------------------------------ new place, offline
  set local role authenticated;
  res := public.register_item_pick(menu,'offline','국물이 좋아요',
    p_catalog_id => catalog,
    p_image_path => alice::text||'/full.jpg', p_thumbnail_path => alice::text||'/thumb.jpg',
    p_expected_previous_pick_id => null, p_request_id => r1);
  place_item := (res->>'item_id')::uuid; p1 := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false and res->>'replaced_pick_id' is null and (res->>'retried')::boolean = false,
    'A new product is saved unpublished: '||res::text;
  -- Retry: the same answer, nothing new.
  again := public.register_item_pick(menu,'offline','국물이 좋아요', p_catalog_id => catalog,
    p_image_path => alice::text||'/full.jpg', p_thumbnail_path => alice::text||'/thumb.jpg', p_request_id => r1);
  assert (again->>'pick_id')::uuid = p1 and (again->>'item_id')::uuid = place_item and (again->>'retried')::boolean,
    'A retry with the same request id returns the saved Pick: '||again::text;
  -- Only alice sees the request and her Pick.
  assert (select count(*) from public.items where id=place_item) = 1, 'The requester reads her pending product';
  assert (select count(*) from public.picks where id=p1) = 1, 'The requester reads her waiting Pick';
  reset role;
  select * into v_item from public.items where id=place_item;
  assert v_item.status='pending' and v_item.created_by=alice and v_item.image_path=alice::text||'/full.jpg',
    'The product is a pending request with the photo';
  select * into v_pick from public.picks where id=p1;
  assert v_pick.status='needs_review' and v_pick.channel='offline' and v_pick.client_request_id=r1 and v_pick.one_line_review='국물이 좋아요',
    'The Pick waits with the review';
  assert (select count(*) from public.picks where user_id=alice and category_id=menu) = 1, 'One Pick after the retry';
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  assert (select count(*) from public.items where id=place_item) = 0, 'Others do not see the pending product';
  assert (select count(*) from public.picks where id=p1) = 0, 'Others do not see the waiting Pick';
  assert (select count(*) from public.item_review_page(place_item)) = 0, 'The item page shows nothing before approval';
  -- The place is taken while alice's request waits.
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','나도', p_catalog_id => catalog);
  exception when others then raised := sqlerrm = 'ITEM_ALREADY_PENDING'; end;
  assert raised, 'Another member cannot register the same pending place';
  reset role;

  -- ------------------------------------------------------------ new seller, online
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.register_item_pick(menu,'online','택배도 맛있어요', p_provider_id => v_provider,
      p_image_path => alice::text||'/full2.jpg', p_thumbnail_path => alice::text||'/thumb2.jpg');
  exception when others then raised := sqlerrm = 'ITEM_LINK_REQUIRED'; end;
  assert raised, 'A new online product needs its own purchase link';
  raised := false;
  begin
    perform public.register_item_pick(menu,'online','택배도 맛있어요', p_provider_id => v_provider, p_link_url => 'http://gomtang-rip.example.com/p/1',
      p_image_path => alice::text||'/full2.jpg', p_thumbnail_path => alice::text||'/thumb2.jpg');
  exception when others then raised := sqlerrm = 'LINK_INVALID'; end;
  assert raised, 'The purchase link must be https';
  res := public.register_item_pick(menu,'online','택배도 맛있어요', p_provider_id => v_provider,
    p_link_url => 'https://gomtang-rip.example.com/p/1',
    p_image_path => alice::text||'/full2.jpg', p_thumbnail_path => alice::text||'/thumb2.jpg', p_request_id => r2);
  online_item := (res->>'item_id')::uuid; p2 := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false, 'The seller product is a pending request too';
  reset role;
  assert (select target_url from public.item_channels where item_id=online_item and channel='online') = 'https://gomtang-rip.example.com/p/1',
    'The product carries its own purchase link';
  assert (select official_url from public.online_stores s join public.providers p on p.online_store_id=s.id where p.id=v_provider) = v_official,
    'The seller''s home page is untouched';
  assert (select status='pending' and external_source='onepick_provider' from public.items where id=online_item), 'Online request is pending';
  assert (select status='needs_review' and channel='online' from public.picks where id=p2), 'The online Pick waits in its own channel';

  -- ------------------------------------------------------------ concurrency (bob, existing product)
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  res := public.register_item_pick(menu,'offline','기존집 최고', p_item_id => existing);
  bob_pick := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean and res->>'replaced_pick_id' is null, 'A published product gives an active Pick at once: '||res::text;
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','둘도 좋아', p_item_id => existing2, p_expected_previous_pick_id => null);
  exception when others then
    raised := sqlerrm = 'PICK_CHANGED_ELSEWHERE';
    get stacked diagnostics detail_text = pg_exception_detail;
  end;
  assert raised and detail_text = bob_pick::text, 'A change against a stale view is refused and names the current Pick: '||coalesce(detail_text,'null');
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','둘도 좋아', p_item_id => existing2, p_expected_previous_pick_id => gen_random_uuid());
  exception when others then raised := sqlerrm = 'PICK_CHANGED_ELSEWHERE'; end;
  assert raised, 'A wrong previous Pick is refused';
  -- Same product again: the review is updated, the Pick stays.
  res := public.register_item_pick(menu,'offline','기존집 여전히 최고', p_item_id => existing, p_expected_previous_pick_id => bob_pick);
  assert (res->>'pick_id')::uuid = bob_pick, 'Re-registering the same product keeps the Pick';
  assert (select one_line_review from public.picks where id=bob_pick) = '기존집 여전히 최고', 'The review is updated';
  -- Another product with the right previous Pick: replaced.
  res := public.register_item_pick(menu,'offline','둘도 좋아', p_item_id => existing2, p_expected_previous_pick_id => bob_pick);
  assert (res->>'replaced_pick_id')::uuid = bob_pick and (res->>'published')::boolean, 'The confirmed change replaces the previous Pick: '||res::text;
  reset role;
  assert (select status='replaced' and replaced_by_pick_id=(res->>'pick_id')::uuid from public.picks where id=bob_pick), 'The previous Pick is ended and linked';

  -- ------------------------------------------------------------ approval publishes the Pick
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(place_item,'active');
  reset role;
  assert (select status='active' from public.picks where id=p1), 'Approval activates the waiting Pick';
  assert (select count(*) from public.picks where user_id=alice and item_id=place_item) = 1, 'Approval creates no second Pick';
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (select count(*) from public.item_review_page(place_item) r where (r->>'id')::uuid=p1 and (r->>'is_current')::boolean) = 1,
    'After approval everyone sees the review as a current Pick';
  reset role;

  -- ------------------------------------------------------------ rejection: fix and ask again
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(online_item,'rejected',null,'상품 링크가 아니에요');
  reset role;
  assert (select status='needs_review' from public.picks where id=p2), 'A rejected request keeps the member''s waiting Pick';
  assert (select outcome='rejected' and reason='상품 링크가 아니에요' from public.item_review_notifications where item_id=online_item and recipient_id=alice),
    'The member is told what to fix';
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.revise_item_request(online_item, p_link_url => 'https://gomtang-rip.example.com/p/2');
  exception when others then raised := sqlerrm = 'ITEM_NOT_FOUND'; end;
  assert raised, 'Only the requester revises a request';
  reset role;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.revise_item_request(online_item, p_link_url => 'ftp://x');
  exception when others then raised := sqlerrm = 'LINK_INVALID'; end;
  assert raised, 'A revised link is validated';
  v_item := public.revise_item_request(online_item, p_link_url => 'https://gomtang-rip.example.com/p/2');
  assert v_item.status='pending', 'Revising puts the request back in the queue';
  reset role;
  assert (select target_url from public.item_channels where item_id=online_item and channel='online') = 'https://gomtang-rip.example.com/p/2', 'The link is replaced';
  assert (select status='needs_review' from public.picks where id=p2), 'The waiting Pick is unchanged by the revision';

  -- ------------------------------------------------------------ merge moves the Pick onto the target
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  res := public.register_item_pick(menu,'offline','이름집이 더 좋아', p_item_id => named,
    p_image_path => alice::text||'/full3.jpg', p_thumbnail_path => alice::text||'/thumb3.jpg',
    p_expected_previous_pick_id => p1);
  p3 := (res->>'pick_id')::uuid;
  assert (res->>'published')::boolean = false and (res->>'replaced_pick_id')::uuid = p1, 'A request replaces the current Pick in the slot: '||res::text;
  reset role;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_merge_pending_item(named, existing);
  reset role;
  select * into v_pick from public.picks where id=p3;
  assert v_pick.item_id=existing and v_pick.status='active' and v_pick.channel='offline' and v_pick.one_line_review='이름집이 더 좋아',
    'A merge moves the waiting Pick onto the target and publishes it: '||v_pick.status||' '||v_pick.item_id::text;
  assert (select count(*) from public.picks where user_id=alice and category_id=menu and channel='offline' and status in ('active','needs_review')) = 1,
    'One current Pick per menu and channel after the merge (the online request is its own slot)';

  -- ------------------------------------------------------------ suspended
  insert into private.user_moderation(user_id,reason,suspended_at) values(bob,'RIP fixture',now());
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  raised := false;
  begin
    perform public.register_item_pick(menu,'offline','정지 중', p_item_id => existing, p_expected_previous_pick_id => (res->>'pick_id')::uuid);
  exception when sqlstate '42501' then raised := true; end;
  assert raised, 'Suspended members cannot register';
  reset role;
end;
$flow$;
$test$, 'register_item_pick: one atomic call for product + photo + review + current Pick, requests stay private until approval, stale-view and retry safety, rejection revise, merge follows the target');
select * from finish();
rollback;
