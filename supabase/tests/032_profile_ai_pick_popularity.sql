-- Isolated fixtures: all accounts, categories and picks are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_category_a uuid := gen_random_uuid();
  v_category_b uuid := gen_random_uuid();
  v_item_a1 uuid := gen_random_uuid();
  v_item_a2 uuid := gen_random_uuid();
  v_item_b1 uuid := gen_random_uuid();
  v_untouched_item uuid := gen_random_uuid();
  v_user uuid;
  v_result jsonb;
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,ranking_min_sample) values
    (v_category_a,'Popularity A','pop-a-'||v_category_a,'open',true,true,3),
    (v_category_b,'Popularity B','pop-b-'||v_category_b,'open',true,true,3);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (v_item_a1,v_category_a,'A1','a1','active'),
    (v_item_a2,v_category_a,'A2','a2','active'),
    (v_item_b1,v_category_b,'B1','b1','active'),
    (v_untouched_item,v_category_a,'A3 untouched','a3-untouched','active');

  -- 5 active picks in category A: 3 on item A1, 2 on item A2.
  for i in 1..5 loop
    v_user := gen_random_uuid();
    insert into auth.users(id,aud,role,created_at,updated_at)
      values(v_user,'authenticated','authenticated',now(),now());
    insert into public.profiles(id,username,onboarding_completed)
      values(v_user,'pop_a_'||substr(replace(v_user::text,'-',''),1,14),true);
    insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at)
      values(v_user,v_category_a,case when i<=3 then v_item_a1 else v_item_a2 end,
        'Popularity fixture','active',now());
  end loop;

  -- A retired pick on A1 must not count.
  v_user := gen_random_uuid();
  insert into auth.users(id,aud,role,created_at,updated_at)
    values(v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
    values(v_user,'pop_a_retired',true);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at,ended_at)
    values(v_user,v_category_a,v_item_a1,'Retired','removed',now()-interval '1 day',now());

  -- One active pick in the unrelated category B, on item B1.
  v_user := gen_random_uuid();
  insert into auth.users(id,aud,role,created_at,updated_at)
    values(v_user,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed)
    values(v_user,'pop_b',true);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at)
    values(v_user,v_category_b,v_item_b1,'Other category','active',now());

  set local role anon;

  select jsonb_agg(to_jsonb(r)) into v_result
  from public.profile_ai_pick_popularity(array[v_item_a1,v_item_a2,v_item_b1]) r;

  assert jsonb_array_length(v_result)=3, 'Returns one row per requested, known item id';

  assert exists(
    select 1 from jsonb_array_elements(v_result) r
    where (r->>'item_id')::uuid=v_item_a1
      and (r->>'category_id')::uuid=v_category_a
      and (r->>'item_pick_count')::int=3
      and (r->>'category_pick_count')::int=5
      and (r->>'ranking_min_sample')::int=3
  ), 'Item A1: 3 active picks, the retired pick excluded, category total is 5';

  assert exists(
    select 1 from jsonb_array_elements(v_result) r
    where (r->>'item_id')::uuid=v_item_a2
      and (r->>'item_pick_count')::int=2
      and (r->>'category_pick_count')::int=5
  ), 'Item A2 shares category A''s total with item A1';

  assert exists(
    select 1 from jsonb_array_elements(v_result) r
    where (r->>'item_id')::uuid=v_item_b1
      and (r->>'category_id')::uuid=v_category_b
      and (r->>'item_pick_count')::int=1
      and (r->>'category_pick_count')::int=1
  ), 'Item B1 counts are scoped to category B, unaffected by category A activity';

  -- An item nobody picked yet still reports its category total.
  select jsonb_agg(to_jsonb(r)) into v_result
  from public.profile_ai_pick_popularity(array[v_untouched_item]) r;
  assert (v_result->0->>'item_pick_count')::int=0 and (v_result->0->>'category_pick_count')::int=5,
    'An unpicked item reports zero for itself but the real category total';

  assert (select count(*)=0 from public.profile_ai_pick_popularity(array[gen_random_uuid()])),
    'An item id that does not exist returns no row';
  assert (select count(*)=0 from public.profile_ai_pick_popularity(array[]::uuid[])),
    'An empty array returns no rows';

  reset role;
end;
$flow$;
$test$, 'Profile AI pick popularity: per-item and per-category active counts, isolation, and ranking_min_sample passthrough');

select * from finish();
rollback;
