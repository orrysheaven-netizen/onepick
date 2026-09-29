begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); again_u uuid := gen_random_uuid(); twice_u uuid := gen_random_uuid();
  del_u uuid := gen_random_uuid(); pend_u uuid := gen_random_uuid(); hidden_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); item_x uuid := gen_random_uuid();
  again_old uuid := gen_random_uuid(); again_now uuid := gen_random_uuid();
  twice_old uuid := gen_random_uuid(); twice_new uuid := gen_random_uuid();
  del_old uuid := gen_random_uuid(); del_new uuid := gen_random_uuid();
  pend_old uuid := gen_random_uuid(); pend_new uuid := gen_random_uuid();
  hidden_old uuid := gen_random_uuid(); hidden_new uuid := gen_random_uuid();
  got uuid[]; walked uuid[] := '{}'; page uuid[]; row_json jsonb; last_row jsonb; guard integer := 0;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,again_u,twice_u,del_u,pend_u,hidden_u]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'orp_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,again_u,twice_u,del_u,pend_u,hidden_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'ORP 그룹', 'orp-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'ORP 국', 'orp-soup', 'open', true, true, 900);
  insert into public.items(id,category_id,name,normalized_name,status)
    values(item_x,menu,'ORP 국집 X','orp x','active');

  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at,review_deleted_at) values
    -- Ended, then picked the same item again: only the current review shows.
    (again_old, again_u, menu, item_x, 'offline', 'first time',  'removed',      now() - interval '9 days', now() - interval '8 days', null),
    (again_now, again_u, menu, item_x, 'offline', 'second time', 'active',       now() - interval '1 day',  null, null),
    -- Two ended reviews: only the newer one shows.
    (twice_old, twice_u, menu, item_x, 'offline', 'older',       'removed',      now() - interval '7 days', now() - interval '6 days', null),
    (twice_new, twice_u, menu, item_x, 'offline', 'newer',       'replaced',     now() - interval '5 days', now() - interval '4 days', null),
    -- Two deleted reviews both have live comments. Only the newest tombstone
    -- may appear in the item list.
    (del_old,   del_u,   menu, item_x, 'offline', '',            'removed',      now() - interval '8 days', now() - interval '7 days', now() - interval '7 days'),
    (del_new,   del_u,   menu, item_x, 'offline', '',            'removed',      now() - interval '3 days', now() - interval '2 days', now() - interval '2 days'),
    -- A newer review still waiting for review is the owner's only; others keep
    -- seeing the older one.
    (pend_old,  pend_u,  menu, item_x, 'offline', 'visible',     'removed',      now() - interval '6 days', now() - interval '5 days', null),
    (pend_new,  pend_u,  menu, item_x, 'offline', 'pending',     'needs_review', now() - interval '2 hours', null, null),
    -- A hidden newest review suppresses the member's older ended review instead
    -- of leaking past state back onto the item page.
    (hidden_old, hidden_u, menu, item_x, 'offline', 'older visible', 'removed',  now() - interval '4 days', now() - interval '3 days', null),
    (hidden_new, hidden_u, menu, item_x, 'offline', 'moderated',     'hidden',   now() - interval '1 day',  now() - interval '12 hours', null);
  -- Comment writes are rate-limited per signed-in member; the fixture writes as
  -- viewer without RLS so it can also comment under the ended/deleted reviews.
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  insert into public.comments(pick_id,user_id,body) values
    (del_new, viewer, 'on the deleted review'),
    (del_old, viewer, 'on the older review');

  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got=array[again_now,del_new,twice_new,pend_old],
    'Guests see at most one winner per member; multiple tombstones dedupe and hidden latest suppresses older: '||coalesce(got::text,'null');
  select r into row_json from public.item_review_page(item_x) r where r->>'id'=del_new::text;
  assert (row_json->>'is_deleted')::boolean and row_json->>'user_id' is null and row_json->'profile' = 'null'::jsonb,
    'The tombstone still carries no author: '||row_json::text;

  -- One-row pages walk the same deduplicated list.
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
  assert walked=array[again_now,del_new,twice_new,pend_old], 'One-row pages reach the same deduplicated winners: '||walked::text;
  reset role;

  -- The owner of the pending review sees it instead of their older one.
  perform set_config('request.jwt.claim.sub',pend_u::text,true);
  set local role authenticated;
  select array_agg((r->>'id')::uuid order by ord) into got
    from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got=array[pend_new,again_now,del_new,twice_new],
    'The owner sees their pending review as their one review: '||coalesce(got::text,'null');
  reset role;

  -- Older reviews are not deleted: their rows and comments are still there.
  assert (select count(*) from public.picks where item_id=item_x) = 10, 'No review rows were removed';
  assert (select count(*) from public.comments where pick_id=del_old) = 1, 'Comments on an older review are kept';
end;
$flow$;
$test$, 'item_review_page: one winner per member (multiple tombstones dedupe; deleted/hidden newest do not resurface older; pending only for owner), paging unchanged');
select * from finish();
rollback;
