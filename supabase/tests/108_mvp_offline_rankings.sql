begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  food_group uuid := gen_random_uuid();
  food_leaf uuid := gen_random_uuid();
  other_root uuid := gen_random_uuid();
  other_leaf uuid := gen_random_uuid();
  offline_item uuid := gen_random_uuid();
  online_item uuid := gen_random_uuid();
  other_item uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  got uuid[];
  food_slug text := 'mvp-rank-food-' || replace(food_leaf::text,'-','');
  other_slug text := 'mvp-rank-other-' || replace(other_leaf::text,'-','');
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[u1,u2,u3]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'mr_'||substr(replace(id::text,'-',''),1,15),true from unnest(array[u1,u2,u3]) id;

  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'MVP rank group', 'mvp-rank-group-'||replace(food_group::text,'-',''), 'open', true, false, 998
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(food_leaf,food_group,'MVP rank food',food_slug,'open',true,true,1);

  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
    values(other_root,'MVP rank other root','mvp-rank-other-root-'||replace(other_root::text,'-',''),'open',true,false,998);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(other_leaf,other_root,'MVP rank other',other_slug,'open',true,true,1);

  insert into public.items(id,category_id,name,normalized_name,status) values
    (offline_item,food_leaf,'Offline winner','offline winner','active'),
    (online_item,food_leaf,'Online winner','online winner','active'),
    (other_item,other_leaf,'Other winner','other winner','active');

  -- Explicit channels first; attach item-channel metadata afterwards so the
  -- fixture does not depend on provider/place setup.
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at) values
    (u1,food_leaf,offline_item,'offline','offline 1','active',now()),
    (u2,food_leaf,offline_item,'offline','offline 2','active',now()),
    (u1,food_leaf,online_item,'online','online 1','active',now()),
    (u2,food_leaf,online_item,'online','online 2','active',now()),
    (u3,food_leaf,online_item,'online','online 3','active',now()),
    (u1,other_leaf,other_item,null,'other','active',now());
  insert into public.item_channels(item_id,channel,is_primary) values
    (offline_item,'offline',true),
    (online_item,'online',true);

  set local role anon;

  select array_agg(item_id order by rank, item_id) into got
    from public.category_top_items(food_leaf,'offline');
  assert got=array[offline_item], 'Explore TOP 3 offline scope excludes online-only items';
  assert (select pick_count from public.category_top_items(food_leaf,'offline') where item_id=offline_item)=2,
    'Offline TOP 3 counts only offline picks';
  assert (select item_id from public.category_top_items(food_leaf) order by rank limit 1)=online_item,
    'Default TOP 3 still exposes the full internal aggregate';

  select array_agg(item_id order by rank, item_id) into got
    from public.category_ranking(food_slug,20,'offline','food');
  assert got=array[offline_item], 'Public ranking is offline + food only';
  assert (select pick_count from public.category_ranking(food_slug,20,'offline','food') where item_id=offline_item)=2,
    'Public ranking count excludes online picks';
  assert (select item_id from public.category_ranking(food_slug) order by rank limit 1)=online_item,
    'Default ranking remains full-channel for later rollout';

  assert not exists(select 1 from public.category_ranking(other_slug,20,'offline','food')),
    'Food root scope blocks a directly requested non-food ranking';
  assert exists(select 1 from public.ranking_categories('food') where category_id=food_leaf),
    'Food ranking list contains the food leaf';
  assert not exists(select 1 from public.ranking_categories('food') where category_id=other_leaf),
    'Food ranking list hides non-food leaves';
  assert exists(select 1 from public.ranking_categories() where category_id=other_leaf),
    'Default ranking list preserves the full internal catalogue';

  begin
    perform * from public.category_top_items(food_leaf,'bad');
    assert false, 'Invalid TOP 3 channel must fail';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform * from public.category_ranking(food_slug,20,'bad','food');
    assert false, 'Invalid ranking channel must fail';
  exception when sqlstate '22023' then null;
  end;

  assert not (select prosecdef from pg_proc where oid='public.category_top_items(uuid,text)'::regprocedure),
    'TOP 3 remains SECURITY INVOKER';
  assert not (select prosecdef from pg_proc where oid='public.category_ranking(text,integer,text,text)'::regprocedure),
    'Ranking remains SECURITY INVOKER';
  assert not (select prosecdef from pg_proc where oid='public.ranking_categories(text)'::regprocedure),
    'Ranking categories remain SECURITY INVOKER';
  assert has_function_privilege('anon','public.category_top_items(uuid,text)','execute'),
    'TOP 3 stays public';
  assert has_function_privilege('anon','public.category_ranking(text,integer,text,text)','execute'),
    'Ranking stays public';
  assert has_function_privilege('anon','public.ranking_categories(text)','execute'),
    'Ranking category list stays public';

  reset role;
end;
$flow$;
$test$, 'MVP rankings scope offline food without deleting full internal aggregates');

select * from finish();
rollback;
