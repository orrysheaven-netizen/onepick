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

  set local role anon;
  select * into v_result from public.home_showcase();
  assert v_result.minimum_pick_count=3 and jsonb_array_length(v_result.items)=20, 'Default threshold and hard result cap';
  assert (v_result.items->0->>'item_id')::uuid=v_items[22] and (v_result.items->0->>'pick_count')::int=3, 'Newest qualifying product first, including public discontinued products';
  assert (v_result.items->19->>'item_id')::uuid=v_items[3], 'One card per product, selected after grouping all choices';
  assert not exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=any(v_items[23:26])),
    'One/two selectors, former choices, hidden products and pending requests cannot appear';
  begin
    update public.home_settings set minimum_pick_count=1 where id;
    assert false, 'Anonymous settings updates must fail';
  exception when insufficient_privilege then null; end;

  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_users[1]::text,true);
  update public.home_settings set minimum_pick_count=1 where id;
  get diagnostics v_rows=row_count;
  assert v_rows=0, 'Ordinary signed-in users cannot change the threshold';
  reset role;
  insert into private.admin_users(user_id) values(v_users[1]);
  set local role authenticated;
  -- Real administrator data access now also requires AAL2; model a stepped-up session.
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  update public.home_settings set minimum_pick_count=4 where id;
  get diagnostics v_rows=row_count;
  assert v_rows=1, 'Allowlisted admin with AAL2 can change the threshold';
  begin
    update public.home_settings set minimum_pick_count=0 where id;
    assert false, 'Invalid threshold must be rejected';
  exception when check_violation then null; end;
  set local role anon;
  select * into v_result from public.home_showcase();
  assert v_result.minimum_pick_count=4;
  assert not exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=any(v_items)),
    'The public showcase immediately uses the saved threshold';

  reset role;
  update public.home_settings set minimum_pick_count=3 where id;
  update public.picks set item_id=v_items[21] where user_id=v_users[66] and category_id=v_category and status='active';
  set local role anon;
  select * into v_result from public.home_showcase();
  assert not exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=v_items[22]),
    'Changing a pick drops the former product below the threshold';
  assert exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=v_items[21] and (j->>'pick_count')::int=4),
    'The newly chosen product receives the selector exactly once';
  reset role;
  update public.categories set is_visible=false where id=v_parent;
  set local role anon;
  select * into v_result from public.home_showcase();
  assert not exists(select 1 from jsonb_array_elements(v_result.items) j where (j->>'item_id')::uuid=any(v_items)),
    'A hidden parent excludes all its products';
  reset role;
end;
$flow$;
$test$, 'Home showcase: threshold, public eligibility, grouping, ordering, cap, pick changes and admin-only configuration');
select * from finish();
rollback;
