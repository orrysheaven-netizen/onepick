begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  viewer uuid := gen_random_uuid(); owner_u uuid := gen_random_uuid(); cur_u uuid := gen_random_uuid(); susp_u uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); menu2 uuid := gen_random_uuid();
  item_x uuid := gen_random_uuid(); item_z uuid := gen_random_uuid(); item_old uuid := gen_random_uuid();
  x_pick uuid := gen_random_uuid(); z_pick uuid := gen_random_uuid(); old_pick uuid := gen_random_uuid();
  cur_pick uuid := gen_random_uuid(); susp_pick uuid := gen_random_uuid();
  c_cur uuid := gen_random_uuid();
  base timestamptz := now() - interval '1 day';
  got uuid[]; n integer; row_json jsonb; res jsonb; raised boolean; new_pick public.picks%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[viewer,owner_u,cur_u,susp_u]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'dpr_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[viewer,owner_u,cur_u,susp_u]) id;
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'DPR 그룹', 'dpr-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order) values
    (menu, food_group, 'DPR 국', 'dpr-soup', 'open', true, true, 900),
    (menu2, food_group, 'DPR 면', 'dpr-noodle', 'open', true, true, 901);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_x,menu,'DPR 국집 X','dpr x','active'),
    (item_old,menu,'DPR 국집 옛집','dpr old','active'),
    (item_z,menu2,'DPR 면집 Z','dpr z','active');

  -- owner_u: current X (online, commented by cur_u), current Z (no comments),
  -- and an old replaced review of 옛집 (no comments).
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at,purchase_url) values
    (old_pick, owner_u, menu,  item_old, 'online', 'old review',  'replaced', base - interval '3 days', base, null),
    (x_pick,   owner_u, menu,  item_x,   'online', 'X review',    'active',   base, null, 'https://example.com/x'),
    (z_pick,   owner_u, menu2, item_z,   'online', 'Z review',    'active',   base, null, null),
    (cur_pick, cur_u,   menu,  item_x,   'online', 'X for me',    'active',   base, null, null),
    (susp_pick,susp_u,  menu,  item_x,   'online', 'susp review', 'active',   base - interval '1 hour', null, null);
  update public.picks set replaced_by_pick_id = x_pick where id = old_pick;
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  insert into public.comments(id,pick_id,user_id,body,created_at) values(c_cur, x_pick, cur_u, 'good choice', base + interval '1 minute');
  reset role;

  -- Flags on live rows.
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  select r into row_json from public.item_review_page(item_x) r where r->>'id' = x_pick::text;
  assert (row_json->>'can_manage')::boolean and (row_json->>'can_comment')::boolean and (row_json->>'comment_count')::int = 1
    and (row_json->>'is_deleted')::boolean = false, 'The author manages and may write under their review: '||row_json::text;
  reset role;
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  select r into row_json from public.item_review_page(item_x) r where r->>'id' = x_pick::text;
  assert (row_json->>'can_manage')::boolean = false and (row_json->>'can_comment')::boolean,
    'A holder of the same item may write but not manage: '||row_json::text;
  reset role;

  -- Others cannot delete; guests cannot call.
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  raised := false;
  begin
    perform public.delete_pick_review(x_pick);
  exception when others then raised := sqlerrm = 'PICK_NOT_FOUND';
  end;
  assert raised, 'Only the author deletes a review';
  reset role;
  assert not has_function_privilege('anon','public.delete_pick_review(uuid)','execute'), 'Guests cannot delete reviews';

  -- Deleting the current, commented review: the Pick ends and a tombstone stays.
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  res := public.delete_pick_review(x_pick);
  assert res->>'outcome' = 'tombstoned' and (res->>'was_current')::boolean and (res->>'item_id')::uuid = item_x,
    'A commented current review is tombstoned and the Pick ended: '||res::text;
  select count(*) into n from public.picks where user_id = owner_u and category_id = menu and status = 'active';
  assert n = 0, 'The member no longer holds a current Pick in that category/channel';
  raised := false;
  begin
    perform public.delete_pick_review(x_pick);
  exception when others then raised := sqlerrm = 'PICK_NOT_FOUND';
  end;
  assert raised, 'A deleted review cannot be deleted again';
  -- The same item can be picked again afterwards (a fresh row).
  new_pick := public.change_pick(menu, item_x, 'back to X', null, null, 'online');
  assert new_pick.id <> x_pick and new_pick.status = 'active', 'Re-picking after deletion creates a new current Pick';
  res := public.delete_pick_review(new_pick.id);
  assert res->>'outcome' = 'removed', 'The fresh, uncommented review is removed outright: '||res::text;
  reset role;

  assert (select status = 'removed' and ended_at is not null and review_deleted_at is not null
                 and one_line_review = '' and purchase_url is null and replaced_by_pick_id is null
          from public.picks where id = x_pick), 'The deleted review row is ended, emptied and unlinked';

  -- Item page: the tombstone is there for the conversation, without author or
  -- text, and nobody may write under it any more.
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select r into row_json from public.item_review_page(item_x) r where r->>'id' = x_pick::text;
  assert (row_json->>'is_deleted')::boolean and row_json->>'user_id' is null and row_json->>'one_line_review' is null
    and row_json->'profile' = 'null'::jsonb and (row_json->>'is_current')::boolean = false
    and (row_json->>'comment_count')::int = 1 and (row_json->>'can_comment')::boolean = false
    and not (row_json ?| array['status','ended_at','review_deleted_at','replaced_by_pick_id']),
    'A deleted review with comments is a tombstone: '||row_json::text;
  select array_agg((r->>'id')::uuid order by ord) into got from public.item_review_page(item_x) with ordinality as t(r, ord);
  assert got = array[cur_pick, susp_pick, x_pick], 'Tombstones sort with ended reviews: '||coalesce(got::text,'null');
  select count(*) into n from public.pick_comment_page(x_pick);
  assert n = 1, 'The conversation under a deleted review stays readable';
  assert public.comment_locate(c_cur) is not null and (public.comment_locate(c_cur)->>'review_is_deleted')::boolean,
    'Deep links into the conversation still resolve and say the review is deleted';
  reset role;
  perform set_config('request.jwt.claim.sub',cur_u::text,true);
  set local role authenticated;
  assert not public.can_comment_on_pick(x_pick), 'A deleted review is read-only even for a holder';
  raised := false;
  begin
    insert into public.comments(pick_id,user_id,body) values(x_pick, cur_u, 'late');
  exception when others then raised := sqlerrm like '%row-level security%';
  end;
  assert raised, 'No new comments under a deleted review';
  select r into row_json from public.my_comment_page() r limit 1;
  assert (row_json->'pick'->>'is_deleted')::boolean and row_json->'pick'->>'one_line_review' is null
    and row_json->'pick'->'profile' = 'null'::jsonb and (row_json->>'thread_visible')::boolean,
    'My comment on a deleted review still lists, with the review masked: '||row_json::text;
  -- The last comment goes: the tombstone leaves the item page.
  perform public.delete_comment(c_cur);
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.item_review_page(item_x) r where r->>'id' = x_pick::text;
  assert n = 0, 'A deleted review without comments leaves the item page';
  select count(*) into n from public.pick_comment_page(x_pick);
  assert n = 0, 'Its thread returns nothing';
  reset role;

  -- Deleting an uncommented current review: removed outright; an ended one keeps its status.
  perform set_config('request.jwt.claim.sub',owner_u::text,true);
  set local role authenticated;
  res := public.delete_pick_review(z_pick);
  assert res->>'outcome' = 'removed' and (res->>'was_current')::boolean, 'An uncommented current review is removed: '||res::text;
  res := public.delete_pick_review(old_pick);
  assert res->>'outcome' = 'removed' and (res->>'was_current')::boolean = false, 'An ended review can be deleted too: '||res::text;
  reset role;
  assert (select status = 'removed' from public.picks where id = z_pick), 'The current Pick ended with its review';
  assert (select status = 'replaced' and review_deleted_at is not null from public.picks where id = old_pick), 'An ended Pick keeps its lifecycle status';
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.item_review_page(item_z);
  assert n = 0, 'A removed review is not on the item page';
  reset role;

  -- Tombstone rows can never be current.
  raised := false;
  begin
    update public.picks set review_deleted_at = now(), one_line_review = '' where id = cur_pick;
  exception when check_violation then raised := true;
  end;
  assert raised, 'A current Pick cannot carry a deleted review';
end;
$flow$;
$test$, 'delete_pick_review: own reviews only, current Picks end with the review, tombstone while comments exist and pruned after, read-only afterwards, re-pick allowed');
select * from finish();
rollback;
