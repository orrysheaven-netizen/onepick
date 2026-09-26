begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  users uuid[] := array(select gen_random_uuid() from generate_series(1,3));
  food_root uuid := gen_random_uuid(); soups uuid := gen_random_uuid(); soup_leaf uuid := gen_random_uuid();
  snack_leaf uuid := gen_random_uuid(); culture_root uuid := gen_random_uuid(); movie_leaf uuid := gen_random_uuid();
  soup_item uuid := gen_random_uuid(); snack_item uuid := gen_random_uuid(); movie_item uuid := gen_random_uuid();
  soup_pick uuid := gen_random_uuid(); snack_pick uuid := gen_random_uuid(); movie_pick uuid := gen_random_uuid();
  root_slug text := 'rootf-'||substr(replace(gen_random_uuid()::text,'-',''),1,10);
  stamp timestamptz := now() + interval '3 days';
  got uuid[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(users) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'root_'||substr(replace(id::text,'-',''),1,12),true from unnest(users) id;
  -- A three-level food tree, a two-level food leaf and another root.
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (food_root,'테스트 먹을것',root_slug,'open',true,false),
    (culture_root,'테스트 문화','rootc-'||substr(replace(culture_root::text,'-',''),1,10),'open',true,false);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (soups,food_root,'테스트 국','rs-'||substr(replace(soups::text,'-',''),1,10),'open',true,false),
    (snack_leaf,food_root,'테스트 과자','rk-'||substr(replace(snack_leaf::text,'-',''),1,10),'open',true,true),
    (movie_leaf,culture_root,'테스트 영화','rm-'||substr(replace(movie_leaf::text,'-',''),1,10),'open',true,true);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable) values
    (soup_leaf,soups,'테스트 곰탕','rg-'||substr(replace(soup_leaf::text,'-',''),1,10),'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (soup_item,soup_leaf,'곰탕집','곰탕집','active'),
    (snack_item,snack_leaf,'과자','과자','active'),
    (movie_item,movie_leaf,'영화','영화','active');
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at) values
    (soup_pick,users[1],soup_leaf,soup_item,'국','active',stamp+interval '3 seconds'),
    (movie_pick,users[2],movie_leaf,movie_item,'영화','active',stamp+interval '2 seconds'),
    (snack_pick,users[3],snack_leaf,snack_item,'과자','active',stamp+interval '1 second');

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page() f where f.pick_id in (soup_pick,movie_pick,snack_pick);
  assert got=array[soup_pick,movie_pick,snack_pick], 'Without a root the feed keeps every category';

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page(null,null,null,root_slug) f where f.pick_id in (soup_pick,movie_pick,snack_pick);
  assert got=array[soup_pick,snack_pick], 'The root filter keeps 2- and 3-level food leaves and drops other roots';

  select array_agg(f.pick_id order by f.started_at desc) into got
    from public.home_pick_feed_page(stamp+interval '3 seconds',soup_pick,null,root_slug) f where f.pick_id in (soup_pick,movie_pick,snack_pick);
  assert got=array[snack_pick], 'The root filter keeps the cursor contract';

  reset role;
end;
$flow$;
$test$, 'Home feed root filter: food-only MVP feed resolved from the category lineage on the server');
select * from finish();
rollback;
