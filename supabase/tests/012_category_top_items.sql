-- Isolated fixtures: all accounts, categories and choices are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_parent uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_user uuid;
  v_items uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  v_result jsonb;
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (v_parent,'Ranking parent','rank-'||v_parent,'open',true,false),
    (v_other,'Other category','rank-'||v_other,'open',true,true);
  insert into public.categories(id,name,slug,parent_id,status,is_visible,is_pickable)
    values(v_category,'Ranking category','rank-'||v_category,v_parent,'open',true,true);
  for i in 1..7 loop
    insert into public.items(id,category_id,name,normalized_name,status)
      values(v_items[i],v_category,'Rank '||i,'rank'||i,
        case when i=5 then 'hidden' when i=6 then 'pending' when i=3 then 'discontinued' else 'active' end);
  end loop;
  for i in 1..112 loop
    v_user := gen_random_uuid();
    insert into auth.users(id,aud,role,created_at,updated_at)
      values(v_user,'authenticated','authenticated',now(),now());
    insert into public.profiles(id,username,onboarding_completed)
      values(v_user,'rank_'||substr(replace(v_user::text,'-',''),1,15),true);
    insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at,ended_at)
      values(v_user,v_category,v_items[case when i<=101 then 1 when i<=103 then 2 when i<=105 then 3 when i=106 then 4 when i=107 then 5 when i=108 then 6 else 7 end],
        'Ranking fixture',case i when 109 then 'replaced' when 110 then 'removed' when 111 then 'hidden' when 112 then 'needs_review' else 'active' end,
        now() - interval '1 day' * (113-i),case when i between 109 and 111 then now() end);
  end loop;

  set local role anon;
  select jsonb_agg(to_jsonb(r)) into v_result from public.category_top_items(v_category) r;
  assert jsonb_array_length(v_result)=3, 'Return at most three chosen products';
  assert (v_result->0->>'item_id')::uuid=v_items[1] and (v_result->0->>'pick_count')::int=101,
    'Count every current choice, including choices outside the latest 100 rows';
  assert (v_result->0->>'rank')::int=1 and not (v_result->0->>'is_tied')::boolean;
  assert (v_result->1->>'item_id')::uuid=v_items[2] and (v_result->2->>'item_id')::uuid=v_items[3],
    'Ties use stable product ordering and include discontinued public products';
  assert (v_result->1->>'rank')::int=2 and (v_result->2->>'rank')::int=2
    and (v_result->1->>'is_tied')::boolean and (v_result->2->>'is_tied')::boolean, 'Equal counts have joint rank';
  assert (select count(*)=0 from public.category_top_items(v_other)), 'Category isolation and empty result';
  assert (select count(*)=0 from public.category_top_items(v_parent)), 'Non-pickable parents have no ranking';

  reset role;
  -- With the leaders removed, only the fourth product qualifies. Private items
  -- and replaced/removed/hidden/needs-review choices must never fill empty ranks.
  update public.picks set status='removed',ended_at=now()
    where category_id=v_category and item_id=any(v_items[1:3]) and status='active';
  set local role anon;
  select jsonb_agg(to_jsonb(r)) into v_result from public.category_top_items(v_category) r;
  assert jsonb_array_length(v_result)=1 and (v_result->0->>'item_id')::uuid=v_items[4]
    and (v_result->0->>'rank')::int=1 and (v_result->0->>'pick_count')::int=1, 'Removal recomputes the ranking';
  reset role;
  update public.categories set is_visible=false where id=v_parent;
  set local role anon;
  assert (select count(*)=0 from public.category_top_items(v_category)), 'A hidden parent hides its child ranking';
  reset role;
  update public.categories set is_visible=true where id=v_parent;
  update public.categories set status='paused' where id=v_category;
  set local role anon;
  assert (select count(*)=0 from public.category_top_items(v_category)), 'Paused categories have no ranking';
  reset role;
end;
$flow$;
$test$, 'Category top products: full public totals, ties, eligibility, category scope and removal');

select * from finish();
rollback;
