begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  users uuid[] := array(select gen_random_uuid() from generate_series(1,26));
  pick_ids uuid[] := array(select gen_random_uuid() from generate_series(1,26));
  cat uuid := gen_random_uuid(); hidden_cat uuid := gen_random_uuid();
  parent_cat uuid := gen_random_uuid(); child_cat uuid := gen_random_uuid();
  product uuid := gen_random_uuid(); hidden_product uuid := gen_random_uuid();
  closed_product uuid := gen_random_uuid(); child_product uuid := gen_random_uuid();
  stamp timestamptz := now() + interval '1 day';
  poster text := 'https://image.tmdb.org/t/p/w342/people-feed-test.jpg';
  expected uuid[]; first_page uuid[]; second_page uuid[];
  cursor_id uuid; cursor_time timestamptz; viewer uuid; blocked uuid; incoming uuid; suspended uuid;
  n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(users) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'feed_'||substr(replace(id::text,'-',''),1,12),true from unnest(users) id;
  -- Register legal Picks first, then simulate categories being hidden later.
  -- The existing category-write guard must not be disabled to manufacture fixtures.
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (cat,'People feed','feed-'||cat,'open',true,true),
    (hidden_cat,'Hidden feed','feed-'||hidden_cat,'open',true,true),
    (parent_cat,'Hidden parent','feed-'||parent_cat,'open',true,false);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,parent_id)
    values(child_cat,'Child of hidden parent','feed-'||child_cat,'open',true,true,parent_cat);
  insert into public.items(id,category_id,name,normalized_name,status,image_source_url) values
    (product,cat,'Shared product','shared product','active',poster),
    (hidden_product,cat,'Hidden product','hidden product','hidden',null),
    (closed_product,hidden_cat,'Hidden category product','hidden category product','active',null),
    (child_product,child_cat,'Hidden parent product','hidden parent product','active',null);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    select pick_ids[i],users[i],cat,product,'Different reason '||i,'active',stamp
    from generate_series(1,22) i;
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (pick_ids[23],users[23],cat,product,'Private review','needs_review',stamp+interval '1 second'),
    (pick_ids[24],users[24],cat,hidden_product,'Hidden item review','active',stamp+interval '1 second'),
    (pick_ids[25],users[25],hidden_cat,closed_product,'Hidden category review','active',stamp+interval '1 second'),
    (pick_ids[26],users[26],child_cat,child_product,'Hidden parent review','active',stamp+interval '1 second');
  update public.categories set is_visible=false where id in (hidden_cat,parent_cat);
  select array_agg(id order by id desc) into expected from unnest(pick_ids[1:22]) id;
  update public.home_settings set minimum_pick_count=100000 where id;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into first_page
    from public.home_pick_feed_page() f;
  assert first_page=expected[1:21], 'Only visible current Picks fill the lookahead, irrespective of popularity threshold';
  select count(distinct f.user_id) into n from public.home_pick_feed_page() f where f.item_id=product;
  assert n=21, 'Different people choosing the same product are not collapsed';
  select count(*) into n from public.home_pick_feed_page() f
    where f.image_source_url=poster and f.username like 'feed_%' and f.one_line_review like 'Different reason %';
  assert n=21, 'Actual author, opinion and catalog photo metadata reach every card';
  select f.pick_id,f.started_at into cursor_id,cursor_time from public.home_pick_feed_page() f
    order by f.started_at desc,f.pick_id desc offset 19 limit 1;
  assert cursor_id=expected[20] and cursor_time=stamp, 'Cursor comes from last displayed row, not lookahead';
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into second_page
    from public.home_pick_feed_page(cursor_time,cursor_id) f where f.category_id=cat;
  assert second_page=expected[21:22], 'Dense equal timestamps traverse without skipping or duplicating people';
  begin
    perform public.home_pick_feed_page(null,cursor_id);
    raise exception 'Half cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.home_pick_feed_page(cursor_time,null);
    raise exception 'Half cursor must be rejected';
  exception when sqlstate '22023' then null;
  end;
  reset role;
  delete from public.picks where id=cursor_id;
  set local role anon;
  select array_agg(f.pick_id order by f.started_at desc,f.pick_id desc) into second_page
    from public.home_pick_feed_page(cursor_time,cursor_id) f where f.category_id=cat;
  assert second_page=expected[21:22], 'Deleting the cursor row does not shift the following page';
  reset role;
  select user_id into viewer from public.picks where id=expected[1];
  select user_id into blocked from public.picks where id=expected[2];
  select user_id into incoming from public.picks where id=expected[3];
  select user_id into suspended from public.picks where id=expected[4];
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.home_pick_feed_page() f where f.user_id=viewer;
  assert n=0, 'Authenticated caller never sees their own Pick as another person';
  select count(*) into n from public.home_pick_feed_page() f where f.category_id=cat;
  assert n=20, 'Signed-in browsing excludes only self before blocking';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(viewer,blocked,'feed_test');
  select count(*) into n from public.home_pick_feed_page() f where f.user_id=blocked;
  assert n=0, 'Session RLS hides the person the viewer blocked';
  reset role;
  perform set_config('request.jwt.claim.sub',incoming::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(incoming,viewer,'feed_test');
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  insert into private.user_moderation(user_id,reason) values(suspended,'Synthetic people feed test');
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  select count(*) into n from public.home_pick_feed_page() f where f.user_id in (viewer,blocked,incoming,suspended);
  assert n=0, 'Self, two-way blocks and suspended accounts cannot leak through the feed';
  select count(*) into n from public.home_pick_feed_page() f where f.category_id=cat;
  assert n=17, 'Visibility filters run before lookahead and leave other people available';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.home_pick_feed_page() f where f.user_id=suspended;
  assert n=0, 'Suspended people also remain hidden from guests';
  reset role;
  assert not (select prosecdef from pg_proc where oid='public.home_pick_feed_page(timestamptz,uuid,text,text)'::regprocedure), 'No security-definer RLS bypass';
  assert has_function_privilege('anon','public.home_pick_feed_page(timestamptz,uuid,text,text)','execute'), 'Guests may browse';
  assert has_function_privilege('authenticated','public.home_pick_feed_page(timestamptz,uuid,text,text)','execute'), 'Members may browse';
end;
$flow$;
$test$, 'People home: author identity, no popularity gate, stable pagination, caller isolation and existing visibility rules');
select * from finish();
rollback;
