begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  me uuid := gen_random_uuid();
  food_group uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  item_a uuid := gen_random_uuid(); item_b uuid := gen_random_uuid(); item_c uuid := gen_random_uuid(); item_d uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
  raised boolean; msg text; det text; ended timestamptz;
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values(me,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values(me,'rpc_'||substr(replace(me::text,'-',''),1,12),true);
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    select food_group, food.id, 'RPC 그룹', 'rpc-group', 'open', true, false, 900
    from public.categories food where food.slug='food';
  insert into public.categories(id,parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(menu, food_group, 'RPC 국', 'rpc-soup', 'open', true, true, 900);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (item_a,menu,'RPC 국집 A','rpc a','active'),
    (item_b,menu,'RPC 국집 B','rpc b','active'),
    (item_c,menu,'RPC 국집 C','rpc c','active'),
    (item_d,menu,'RPC 국집 D','rpc d','active');

  -- A Pick of A that ended an hour ago; a Pick of D hidden by moderation.
  ended := now() - interval '1 hour';
  insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at,ended_at) values
    (a1, me, menu, item_a, 'offline', 'first', 'removed', now() - interval '3 days', ended),
    (d1, me, menu, item_d, 'offline', 'moderated', 'hidden', now() - interval '3 days', now() - interval '1 hour');

  perform set_config('request.jwt.claim.sub', me::text, true);

  -- Same item within 24 hours: refused with the time it opens again.
  raised := false;
  begin
    insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
      values(me, menu, item_a, 'offline', 'again', 'active', now());
  exception when sqlstate 'P0001' then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    raised := msg = 'PICK_COOLDOWN';
  end;
  assert raised, 'Re-picking the same item within 24 hours is refused: '||coalesce(msg,'none');
  assert det::timestamptz between ended + interval '24 hours' - interval '1 second' and ended + interval '24 hours' + interval '1 second',
    'DETAIL says when the item can be picked again: '||coalesce(det,'null');

  -- A pending (needs_review) Pick of the same item is refused too.
  raised := false;
  begin
    insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
      values(me, menu, item_a, 'offline', 'again', 'needs_review', now());
  exception when sqlstate 'P0001' then raised := sqlerrm = 'PICK_COOLDOWN';
  end;
  assert raised, 'A pending Pick of the same item waits as well';

  -- Another item right away is fine.
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values(me, menu, item_b, 'offline', 'other place', 'active', now());

  -- A hidden (moderated) Pick does not start a cooldown.
  update public.picks set status='replaced', ended_at=now() where user_id=me and item_id=item_b and status='active';
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values(me, menu, item_d, 'offline', 'after moderation', 'active', now());

  -- Rows written without the member's session (admin, seed, migration) are not checked.
  update public.picks set status='removed', ended_at=now() where user_id=me and item_id=item_d and status='active';
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values(me, menu, item_d, 'offline', 'seeded', 'active', now());
  update public.picks set status='removed', ended_at=now() where user_id=me and item_id=item_d and status='active';
  perform set_config('request.jwt.claim.sub', me::text, true);

  -- Once 24 hours have passed, the same item can be picked again.
  update public.picks set started_at = started_at - interval '1 day', ended_at = ended_at - interval '1 day' where id = a1;
  insert into public.picks(user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values(me, menu, item_a, 'offline', 'back after a day', 'active', now());

  assert not has_function_privilege('authenticated','private.enforce_same_item_repick_cooldown()','execute'),
    'The trigger function is not callable by members';
end;
$flow$;
$test$, 'same-item re-pick cooldown: 24 hours after a Pick of the item ended (replaced/removed), pending too; other items, hidden Picks and seeded rows unaffected');
select * from finish();
rollback;
