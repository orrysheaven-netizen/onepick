begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  alice uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  cat uuid := gen_random_uuid();
  legacy_approve uuid := gen_random_uuid();
  legacy_merge uuid := gen_random_uuid();
  merge_target uuid := gen_random_uuid();
  modern_item uuid := gen_random_uuid();
  modern_pick uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at) values
    (alice,'authenticated','authenticated',now(),now()),
    (admin,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (alice,'noauto_'||substr(replace(alice::text,'-',''),1,8),true),
    (admin,'noauto_'||substr(replace(admin::text,'-',''),1,8),true);
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
  values(cat,'No approval auto pick','no-auto-pick-'||substr(replace(cat::text,'-',''),1,8),'open',true,true,1);

  insert into public.items(
    id,category_id,name,normalized_name,status,created_by,image_source_url
  ) values
    (legacy_approve,cat,'Legacy approve','legacyapprove','pending',alice,'https://example.com/legacy-approve.jpg'),
    (legacy_merge,cat,'Legacy merge','legacymerge','pending',alice,'https://example.com/legacy-merge.jpg'),
    (modern_item,cat,'Modern waiting','modernwaiting','pending',alice,'https://example.com/modern.jpg');
  insert into public.items(
    id,category_id,name,normalized_name,status,image_source_url
  ) values
    (merge_target,cat,'Merge target','mergetarget','active','https://example.com/target.jpg');

  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
  perform public.set_pending_item_pick_review(legacy_approve,'승인 뒤 자동 선택 안 함');
  perform public.set_pending_item_pick_review(legacy_merge,'병합 뒤 자동 선택 안 함');
  reset role;

  -- Modern flow already has a waiting Pick before review. It may be published,
  -- because approval does not create a new Pick here.
  insert into public.picks(
    id,user_id,category_id,item_id,channel,one_line_review,status,started_at
  ) values (
    modern_pick,alice,cat,modern_item,null,'이미 저장된 원픽','needs_review',now()
  );

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated','aal','aal2')::text,true);
  set local role authenticated;
  perform public.admin_review_pending_item(legacy_approve,'active');
  perform public.admin_merge_pending_item(legacy_merge,merge_target);
  perform public.admin_review_pending_item(modern_item,'active');
  reset role;

  assert not exists(
    select 1 from public.picks
    where user_id=alice
      and item_id in (legacy_approve,merge_target)
      and id <> modern_pick
      and status in ('active','needs_review')
  ), 'legacy request intents create no Pick after approval or merge';

  assert not exists(
    select 1 from public.pending_item_picks
    where item_id in (legacy_approve,legacy_merge)
  ), 'resolved legacy request intents are deleted';

  assert not exists(
    select 1 from public.item_review_notifications
    where item_id in (legacy_approve,legacy_merge,modern_item)
      and outcome in ('approved','merged')
  ), 'approval/merge creates no review notification';

  assert (
    select status='active' and item_id=modern_item
    from public.picks
    where id=modern_pick
  ), 'an already-existing needs_review Pick is activated rather than recreated';
end;
$flow$;
$test$, 'approval/merge never creates a Pick from legacy intent while preserving an existing needs_review Pick');

select ok(
  (select prosecdef from pg_proc where oid='private.notify_requester_on_item_review()'::regprocedure),
  'review trigger remains SECURITY DEFINER'
);
select ok(
  (select 'search_path=""'=any(proconfig)
   from pg_proc where oid='private.notify_requester_on_item_review()'::regprocedure),
  'review trigger keeps empty search_path'
);
select ok(
  not has_function_privilege('anon','private.notify_requester_on_item_review()','execute'),
  'anon cannot execute the private review trigger'
);
select ok(
  position('insert into public.picks' in lower(pg_get_functiondef('private.notify_requester_on_item_review()'::regprocedure))) = 0,
  'review trigger contains no Pick creation path'
);
select ok(
  position('insert into public.item_review_notifications' in lower(pg_get_functiondef('private.notify_requester_on_item_review()'::regprocedure))) = 0,
  'review trigger contains no approval/merge notification insertion'
);

select * from finish();
rollback;
