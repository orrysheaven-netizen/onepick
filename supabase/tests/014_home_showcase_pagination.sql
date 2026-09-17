begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
declare
  v_parent uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_items uuid[] := '{}';
  v_users uuid[] := '{}';
  v_id uuid;
  v_item integer;
  v_rows integer;
  v_result record;
  v_first jsonb;
  v_cursor jsonb;
begin
  update public.home_settings set minimum_pick_count=3 where id;
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_parent,'Home fixture parent','home-'||v_parent,'open',true,false);
  insert into public.categories(id,name,slug,parent_id,status,is_visible,is_pickable)
    values(v_category,'Home fixture','home-'||v_category,v_parent,'open',true,true);
  for i in 1..26 loop
    v_id := gen_random_uuid(); v_items := array_append(v_items,v_id);
    insert into public.items(id,category_id,name,normalized_name,status)
      values(v_id,v_category,'Home product '||i,'homeproduct'||i,
        case when i=22 then 'discontinued' when i=25 then 'hidden' when i=26 then 'pending' else 'active' end);
  end loop;
  -- 22 products have three current selectors, followed by two under threshold,
  -- a hidden product and a pending request. Every selector is a separate user.
  for i in 1..76 loop
    v_id := gen_random_uuid(); v_users := array_append(v_users,v_id);
    insert into auth.users(id,aud,role,created_at,updated_at) values(v_id,'authenticated','authenticated',now(),now());
    insert into public.profiles(id,username,onboarding_completed)
      values(v_id,'home_'||substr(replace(v_id::text,'-',''),1,15),true);
    v_item := case when i<=66 then (i+2)/3 when i<=68 then 23 when i=69 then 24 when i<=72 then 25 else 26 end;
    insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at)
      values(v_id,v_category,v_items[v_item],'Home fixture',case when i=76 then 'needs_review' else 'active' end,
        now()+interval '1 day'+i*interval '1 second');
  end loop;
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,ended_at)
    values(v_users[1],v_category,v_items[23],'Old choice','replaced',now()),
      (v_users[2],v_category,v_items[23],'Removed choice','removed',now()),
      (v_users[3],v_category,v_items[23],'Hidden choice','hidden',now());

  -- Give all fixture products the same timestamp to exercise the UUID tie-break.
  update public.picks set started_at=now()+interval '1 day' where category_id=v_category;
  set local role anon;
  select * into v_result from public.home_showcase_page();
  assert jsonb_array_length(v_result.items)=21, 'Return 20 cards plus one lookahead row';
  v_first := v_result.items - 20;
  v_cursor := v_first->19;
  select * into v_result from public.home_showcase_page((v_cursor->>'last_picked_at')::timestamptz,(v_cursor->>'item_id')::uuid);
  assert not exists(select 1 from jsonb_array_elements(v_result.items) n
    join jsonb_array_elements(v_first) p on n->>'item_id'=p->>'item_id'), 'No duplicates across tied timestamps';
  assert (select count(*) from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=any(v_items[1:22]))=2,
    'All 22 qualified products remain reachable beyond page one';
  assert not exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=any(v_items[23:26])),
    'Pagination retains visibility and minimum selector requirements';
  select * into v_result from public.home_showcase_page('1900-01-01'::timestamptz,gen_random_uuid());
  assert jsonb_array_length(v_result.items)=0 and v_result.minimum_pick_count=3, 'Exhausted page retains threshold';
  reset role;
end;
$flow$;
$test$, 'Home pagination: lookahead, tied timestamps, full traversal, no duplicates, public eligibility and exhaustion');
select * from finish();
rollback;
