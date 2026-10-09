begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); cur_u uuid := gen_random_uuid(); rep_u uuid := gen_random_uuid();
  rem_u uuid := gen_random_uuid(); hid_u uuid := gen_random_uuid(); nr_u uuid := gen_random_uuid();
  susp_u uuid := gen_random_uuid(); blk_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid(); item_y uuid := gen_random_uuid(); pending_item uuid := gen_random_uuid();
  cur_pick uuid := gen_random_uuid(); rep_pick uuid := gen_random_uuid(); rem_pick uuid := gen_random_uuid();
  pending_pick uuid := gen_random_uuid();
  hid_pick uuid := gen_random_uuid(); nr_pick uuid := gen_random_uuid(); susp_pick uuid := gen_random_uuid();
  blk_pick uuid := gen_random_uuid(); rep_now_pick uuid := gen_random_uuid();
  got uuid[]; row_json jsonb; n integer; last_row jsonb; page uuid[]; walked uuid[] := '{}'; guard integer := 0; raised boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,cur_u,rep_u,rem_u,hid_u,nr_u,susp_u,blk_u]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'irp_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,cur_u,rep_u,rem_u,hid_u,nr_u,susp_u,blk_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'IRP 그룹', 'irp-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'IRP 국', 'irp-soup', 'open', true, true, 900);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_x,menu,'IRP 국집 X','irp x','active'),
    (item_y,menu,'IRP 국집 Y','irp y','active');
  insert into public.items(id,category_id,name,normalized_name,status,created_by)
    values(pending_item,menu,'IRP 검수대기 국집','irp pending','pending',nr_u);

  -- Every state a review on item X can be in. Ended rows are inserted directly
  -- (ended_at is required by picks_time_state_consistent).
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at) values
    (cur_pick, cur_u, menu, item_x, 'online', 'current',      'active',       now() - interval '1 day',  null),
    (blk_pick, blk_u, menu, item_x, 'online', 'blocked',      'active',       now() - interval '2 days', null),
    (rem_pick, rem_u, menu, item_x, 'offline','removed',      'removed',      now() - interval '3 days', now() - interval '1 hour'),
    (rep_pick, rep_u, menu, item_x, 'online', 'replaced',     'replaced',     now() - interval '5 days', now() - interval '2 hours'),
    (hid_pick, hid_u, menu, item_x, 'online', 'hidden',       'hidden',       now() - interval '4 days', now() - interval '3 hours'),
    (nr_pick,  nr_u,  menu, item_x, 'online', 'needs review', 'needs_review', now() - interval '2 hours', null),
    (susp_pick,susp_u,menu, item_x, 'offline','suspended',    'active',       now() - interval '6 hours', null),
    (rep_now_pick, rep_u, menu, item_y, 'online', 'replaced by this', 'active', now() - interval '2 hours', null),
    (pending_pick, nr_u, menu, pending_item, 'offline', 'pending owner review', 'needs_review', now() - interval '1 hour', null);
  update public.picks set replaced_by_pick_id = rep_now_pick where id = rep_pick;
  insert into private.user_moderation(user_id,reason,suspended_at) values(susp_u,'IRP fixture',now());

  -- Guests: current first, then ended (removed/replaced) by started_at; hidden,
  -- needs_review and suspended authors are absent. ended_at never leaves the DB.
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got=array[cur_pick,blk_pick,rem_pick,rep_pick], 'Guests see current Picks first, then ended ones, newest first inside each group: '||coalesce(got::text,'null');
  select r into row_json from public.item_review_page(item_x) r where r->>'id'=rep_pick::text;
  assert not (row_json ?| array['status','ended_at','replaced_by_pick_id','updated_at','created_at','purchase_url','purchase_tip']),
    'Ended rows carry no lifecycle status, end/update/creation time or purchase fields: '||row_json::text;
  assert (row_json->>'is_current')::boolean = false, 'An ended Pick is only marked not current';
  assert (row_json->>'is_deleted')::boolean = false and (row_json->>'comment_count')::int = 0
    and (row_json->>'can_comment')::boolean = false and (row_json->>'can_manage')::boolean = false,
    'Guests get the counts and flags: no comments, cannot write or manage';
  assert (select array_agg(k order by k) from jsonb_object_keys(row_json) k)
    = array['can_comment','can_manage','category','category_id','channel','comment_count','id','is_current','is_deleted','item','item_id','one_line_review','profile','started_at','user_id'],
    'Rows are an explicit allowlist: '||row_json::text;
  select r into last_row from public.item_review_page(item_x) r where r->>'id'=rem_pick::text;
  assert (last_row->>'is_current')::boolean = false and not (last_row ? 'status'), 'Replaced and removed Picks look the same';
  select r into row_json from public.item_review_page(item_x) r where r->>'id'=cur_pick::text;
  assert (row_json->>'is_current')::boolean = true and not (row_json ? 'status'), 'A current Pick is marked current';
  assert row_json->'profile'->>'username' like 'irp_%' and (row_json->'item'->>'id')::uuid = item_x
    and (row_json->'category'->>'id')::uuid = menu, 'Rows carry the embedded profile, item and category like the PostgREST select';
  select count(*) into n from public.item_review_page(item_x, p_limit => 1);
  assert n=1, 'p_limit is applied';

  -- Keyset paging: walking one row at a time reaches every review, across the
  -- current -> ended boundary, in the same order as one big page.
  last_row := null;
  loop
    guard := guard + 1;
    assert guard < 10, 'Paging terminates';
    select array_agg((r->>'id')::uuid order by ord), (array_agg(r order by ord desc))[1] into page, row_json
      from public.item_review_page(item_x,
        (last_row->>'is_current')::boolean, (last_row->>'started_at')::timestamptz, (last_row->>'id')::uuid, 1)
      with ordinality as t(r, ord);
    exit when page is null;
    walked := walked || page;
    last_row := row_json;
  end loop;
  assert walked=array[cur_pick,blk_pick,rem_pick,rep_pick], 'One-row pages reach every review in order: '||walked::text;
  -- A page that ends inside the current group continues into the ended group.
  select r into last_row from public.item_review_page(item_x, p_limit => 2) with ordinality as t(r, ord) where ord = 2;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x, (last_row->>'is_current')::boolean, (last_row->>'started_at')::timestamptz, (last_row->>'id')::uuid, 20)
    with ordinality as t(r, ord);
  assert got=array[rem_pick,rep_pick], 'The page after the last current review starts with ended ones: '||coalesce(got::text,'null');
  -- A cursor inside the ended group only returns older ended reviews.
  select r into last_row from public.item_review_page(item_x) r where r->>'id'=rem_pick::text;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x, false, (last_row->>'started_at')::timestamptz, rem_pick, 20)
    with ordinality as t(r, ord);
  assert got=array[rep_pick], 'Paging inside the ended group: '||coalesce(got::text,'null');
  -- Half cursors are rejected.
  raised := false;
  begin
    perform public.item_review_page(item_x, true, null, cur_pick, 20);
  exception when sqlstate '22023' then raised := true;
  end;
  assert raised, 'A cursor without started_at is rejected with 22023';
  raised := false;
  begin
    perform public.item_review_page(item_x, null, now(), cur_pick, 20);
  exception when sqlstate '22023' then raised := true;
  end;
  assert raised, 'A cursor without is_current is rejected with 22023';
  select count(*) into n from public.item_review_page(item_y);
  assert n=1, 'Only Picks of the requested item are returned';
  select count(*) into n from public.item_review_page(pending_item);
  assert n=0, 'Guests cannot see a needs_review Pick whose backing item is pending';
  -- RLS is unchanged: the table itself still hides ended Picks from guests.
  select count(*) into n from public.picks where item_id=item_x and status in ('replaced','removed');
  assert n=0, 'Direct reads of ended Picks stay closed to guests';
  reset role;

  -- A signed-in viewer who blocked blk_u does not see their review.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  set local role authenticated;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    select viewer, blk_u, username from public.profiles where id=blk_u;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got=array[cur_pick,rem_pick,rep_pick], 'Blocked members are left out for the viewer who blocked them: '||coalesce(got::text,'null');
  select count(*) into n from public.item_review_page(pending_item);
  assert n=0, 'Another signed-in member cannot see the owner-only pending review';
  select count(*) into n from public.picks where user_id=rep_u;
  assert n=1, 'The table still shows only rep_u''s active Pick to another member';
  reset role;

  -- The owner of a needs_review Pick sees it (as a current one); nobody else does.
  perform set_config('request.jwt.claim.sub',nr_u::text,true);
  set local role authenticated;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got=array[nr_pick,cur_pick,blk_pick,rem_pick,rep_pick], 'Own needs_review Pick is included in the current group: '||coalesce(got::text,'null');
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(pending_item) with ordinality as t(r, ord);
  assert got=array[pending_pick], 'Owner sees their own needs_review review while the item is still pending: '||coalesce(got::text,'null');
  select r into row_json from public.item_review_page(pending_item) r where r->>'id'=pending_pick::text;
  assert (row_json->>'can_manage')::boolean and not (row_json->>'can_comment')::boolean,
    'Pending owner review stays manageable but comment writes remain closed: '||row_json::text;
  reset role;

  assert (select prosecdef from pg_proc where oid='public.item_review_page(uuid,boolean,timestamptz,uuid,integer)'::regprocedure), 'The reader is security definer (RLS stays closed)';
  assert has_function_privilege('anon','public.item_review_page(uuid,boolean,timestamptz,uuid,integer)','execute'), 'Guests may read item reviews';
  assert not has_function_privilege('anon','private.pick_thread_visible(public.picks,uuid)','execute'), 'The visibility helper is private';
end;
$flow$;
$test$, 'item_review_page: current first, ended kept as is_current=false with allowlisted fields, keyset paging, hidden/needs_review/suspended/blocked excluded, RLS unchanged');
select * from finish();
rollback;
