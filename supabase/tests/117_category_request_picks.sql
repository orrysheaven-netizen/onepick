begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); suspended uuid := gen_random_uuid();
  admin uuid := gen_random_uuid(); catalog_id uuid := gen_random_uuid();
  pending_id uuid; req uuid := gen_random_uuid();
  res jsonb; res2 jsonb; first_pick uuid; first_item uuid;
  v_item public.items%rowtype; v_pick public.picks%rowtype;
  n integer; raised boolean; v_text text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,suspended,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'cr_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,suspended,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into private.user_moderation(user_id,reason,suspended_by) values(suspended,'category request fixture',admin);
  select id into pending_id from public.categories where slug='pending-product';
  assert pending_id is not null, 'The pending-product staging category exists';

  insert into public.place_catalog(
    id, place_provider, provider_place_id, name, normalized_name, road_address, business_status, source_updated_at
  ) values (
    catalog_id, 'test', 'cr-'||substr(replace(catalog_id::text,'-',''),1,12), '카탈로그 빙수집',
    private.normalize_place_name('카탈로그 빙수집'), '서울 성동구 테스트로 1', 'open', now()
  );

  insert into storage.objects(bucket_id,name,owner_id,metadata,created_at)
  select 'item-photos', u.id::text||'/'||f.name, u.id::text,
         jsonb_build_object('mimetype','image/jpeg','size',f.size), now()-interval '2 days'
  from unnest(array[alice,bob,suspended]) u(id)
  cross join (values ('a.jpg',1024),('a-t.jpg',100),('b.jpg',1024),('b-t.jpg',100),
                     ('c.jpg',1024),('c-t.jpg',100),('d.jpg',1024),('d-t.jpg',100)) f(name,size);

  assert not has_function_privilege('anon','public.register_category_request_pick(text,text,uuid,text,text,text,text,text,uuid)','execute'),
    'Guests cannot register a category request';

  select indexdef into v_text from pg_indexes
  where schemaname='public' and indexname='picks_one_current_per_category_channel';
  assert v_text like '%category_id <> %'||pending_id::text||'%', 'Only the pending-product slot is exempt from one current Pick';

  -- ------------------------------------------------ alice
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;

  raised := false;
  begin
    perform public.register_category_request_pick('와플','맛있어요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1');
  exception when others then raised := sqlerrm = 'PHOTO_REQUIRED'; end;
  assert raised, 'A category request is a new product and needs a photo';

  raised := false;
  begin
    perform public.register_category_request_pick('   ','맛있어요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
      p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg');
  exception when others then raised := sqlerrm = 'CATEGORY_LABEL_INVALID'; end;
  assert raised, 'The typed category must not be empty';

  raised := false;
  begin
    perform public.register_category_request_pick('와플','맛있어요',p_place_name => '큐와플집', p_map_url => 'https://example.com/x',
      p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg');
  exception when others then raised := sqlerrm = 'LINK_INVALID'; end;
  assert raised, 'A new store still needs a Naver map link';

  raised := false;
  begin
    perform public.register_category_request_pick('와플','맛있어요');
  exception when others then raised := sqlerrm = 'ITEM_SELECTION_REQUIRED'; end;
  assert raised, 'A store is required';

  -- New store + typed category.
  res := public.register_category_request_pick('  와플 ','바삭해요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
    p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg', p_request_id => req);
  assert (res->>'published')::boolean is false and (res->>'retried')::boolean is false, 'The request Pick is not published';
  first_pick := (res->>'pick_id')::uuid; first_item := (res->>'item_id')::uuid;
  select * into v_item from public.items where id=first_item;
  assert v_item.category_id=pending_id and v_item.status='pending' and v_item.created_by=alice, 'A pending-product request item';
  assert v_item.requested_category_label='와플', 'The typed category is kept, trimmed';
  assert v_item.name='큐와플집', 'The request is named after the store';
  reset role;
  assert exists(select 1 from private.category_request_places r join public.places pl on pl.id=r.place_id
                where r.item_id=first_item and pl.map_url='https://naver.me/cr1'), 'The store is kept with the request';
  set local role authenticated;
  assert v_item.image_path=alice::text||'/a.jpg', 'The photo is part of the request';
  select count(*) into n from public.item_places where item_id=first_item;
  assert n=0, 'No place × category row until an admin classifies it';
  select * into v_pick from public.picks where id=first_pick;
  assert v_pick.status='needs_review' and v_pick.channel is null and v_pick.category_id=pending_id, 'The Pick waits, owner-only';

  -- Retrying the same call returns the same Pick.
  res2 := public.register_category_request_pick('와플','바삭해요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
    p_image_path => alice::text||'/a.jpg', p_thumbnail_path => alice::text||'/a-t.jpg', p_request_id => req);
  assert (res2->>'retried')::boolean and (res2->>'pick_id')::uuid=first_pick, 'Retries are idempotent';

  -- Another menu at the same store does not replace the first request.
  res := public.register_category_request_pick('빙수','시원해요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
    p_image_path => alice::text||'/b.jpg', p_thumbnail_path => alice::text||'/b-t.jpg');
  assert (res->>'item_id')::uuid <> first_item, 'A different typed category is a separate request';

  -- A catalog store works too, and does not replace the others.
  res := public.register_category_request_pick('와플','카탈로그',p_catalog_id => catalog_id,
    p_image_path => alice::text||'/c.jpg', p_thumbnail_path => alice::text||'/c-t.jpg');
  select * into v_item from public.items where id=(res->>'item_id')::uuid;
  assert v_item.name='카탈로그 빙수집' and v_item.requested_category_label='와플', 'Catalog store request';

  select count(*) into n from public.picks
  where user_id=alice and category_id=pending_id and status='needs_review';
  assert n=3, 'Requests on different stores/menus coexist';

  -- The same store + category again only updates the review (no new item, no photo needed).
  res := public.register_category_request_pick('와플','다시 써요',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1');
  assert (res->>'pick_id')::uuid=first_pick and (res->>'item_id')::uuid=first_item, 'Same request reuses its Pick';
  select one_line_review into v_text from public.picks where id=first_pick;
  assert v_text='다시 써요', 'Repeating the request updates the review';
  select count(*) into n from public.items where created_by=alice and category_id=pending_id;
  assert n=3, 'No duplicate request item';
  reset role;

  -- ------------------------------------------------ bob cannot see alice's request
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',bob,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  select count(*) into n from public.picks where user_id=alice;
  assert n=0, 'Another member cannot see the waiting Picks';
  select count(*) into n from public.items where created_by=alice;
  assert n=0, 'Another member cannot see the request items';
  -- Bob can request the same store and category independently.
  res := public.register_category_request_pick('와플','밥의 와플',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
    p_image_path => bob::text||'/a.jpg', p_thumbnail_path => bob::text||'/a-t.jpg');
  assert (res->>'item_id')::uuid <> first_item, 'Another member gets their own request on the same store';
  reset role;

  -- ------------------------------------------------ suspended members cannot request
  perform set_config('request.jwt.claim.sub',suspended::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',suspended,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.register_category_request_pick('와플','정지',p_place_name => '큐와플집', p_map_url => 'https://naver.me/cr1',
      p_image_path => suspended::text||'/a.jpg', p_thumbnail_path => suspended::text||'/a-t.jpg');
  exception when others then raised := sqlerrm = 'USER_SUSPENDED'; end;
  assert raised, 'Suspended members cannot request';
  reset role;
end;
$flow$;
$test$, 'Category request Picks: typed category saved as owner-only pending-product request; different menus/stores coexist; same request reuses; retries idempotent');
select * from finish();
rollback;
