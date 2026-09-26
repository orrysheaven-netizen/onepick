-- A requester hears back when their pending item is approved or merged, so
-- they can pick it; nothing is sent for rejections, for requests with no
-- requester, or when the requester already picks the resulting product.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  cat uuid := gen_random_uuid();
  existing uuid := gen_random_uuid(); picked uuid := gen_random_uuid();
  approved uuid := gen_random_uuid(); merged uuid := gen_random_uuid(); already uuid := gen_random_uuid();
  rejected uuid := gen_random_uuid(); orphan uuid := gen_random_uuid();
  n integer; r record; ids uuid[];
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'review_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Review notify','review-notify-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (existing,cat,'Existing product','existingproduct','active'),
    (picked,cat,'Picked product','pickedproduct','active');
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (approved,cat,'Approved request','approvedrequest','pending',alice),
    (merged,cat,'Merged request','mergedrequest','pending',alice),
    (already,cat,'Already picked request','alreadypickedrequest','pending',alice),
    (rejected,cat,'Rejected request','rejectedrequest','pending',alice);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (orphan,cat,'Orphan request','orphanrequest','pending');

  assert not exists(select 1 from pg_policies where tablename='item_review_notifications' and cmd in ('INSERT','DELETE','ALL')),
    'Clients cannot write review notifications directly';
  assert not has_table_privilege('authenticated','public.item_review_notifications','insert'), 'No client inserts';

  -- Alice already picks the product her last request will be merged into.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  insert into public.picks(user_id,category_id,item_id,one_line_review,status,started_at)
    values(alice,cat,picked,'Already mine','active',now());

  -- Admin resolves every request through the real review functions.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform public.admin_review_pending_item(approved,'active');
  perform public.admin_review_pending_item(rejected,'rejected');
  perform public.admin_review_pending_item(orphan,'active');
  perform public.admin_merge_pending_item(merged,existing);
  perform public.admin_merge_pending_item(already,picked);
  reset role;

  select * into r from public.item_review_notifications where item_id=approved;
  assert found and r.recipient_id=alice and r.outcome='approved' and r.target_item_id=approved and r.read_at is null,
    'Approval notifies the requester with the approved product';
  select * into r from public.item_review_notifications where item_id=merged;
  assert found and r.recipient_id=alice and r.outcome='merged' and r.target_item_id=existing,
    'A merge points the requester at the existing product';
  assert not exists(select 1 from public.item_review_notifications where item_id=rejected), 'Rejections are not notified';
  assert not exists(select 1 from public.item_review_notifications where item_id=orphan), 'No requester, no notification';
  assert not exists(select 1 from public.item_review_notifications where item_id=already),
    'No nudge when the requester already picks the resulting product';

  -- Re-resolving the same request never duplicates its notification.
  update public.items set status='pending' where id=approved;
  update public.items set status='active' where id=approved;
  select count(*) into n from public.item_review_notifications where item_id=approved;
  assert n=1, 'One notification per request';

  -- Alice's inbox: both results, newest first, pick_id null and item_id to pick.
  update public.item_review_notifications set created_at=now()-interval '2 minutes' where item_id=approved;
  update public.item_review_notifications set created_at=now()-interval '1 minute' where item_id=merged;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  assert (select public.notification_count())=2, 'Unread count includes review results';
  select array_agg(p.item_id order by p.created_at desc, p.id desc) into ids
    from public.notification_page() p where p.kind='item_review';
  assert ids=array[existing,approved], 'Review results are listed newest first with the product to pick';
  select * into r from public.notification_page() p where p.kind='item_review' and p.id=merged;
  assert r.pick_id is null and r.username is null and r.outcome='merged' and r.item_name='Existing product',
    'Merged rows name the product the request was merged into';

  -- Read marks are per row and only the recipient can set them.
  update public.item_review_notifications set read_at=now() where item_id=approved;
  assert (select public.notification_count())=1, 'Read review results leave the unread count';
  select count(*) into n from public.notification_page() where kind='item_review';
  assert n=2, 'Read rows stay listed';
  reset role;

  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  select count(*) into n from public.item_review_notifications;
  assert n=0, 'Review results are private to the requester';
  assert (select public.notification_count())=0, 'Other users count nothing';
  update public.item_review_notifications set read_at=now() where item_id=merged;
  reset role;
  assert (select read_at is null from public.item_review_notifications where item_id=merged),
    'Other users cannot mark someone else''s result read';

  -- If the product stops being pickable, the nudge disappears.
  update public.items set status='hidden' where id=existing;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  set local role authenticated;
  select count(*) into n from public.notification_page() where kind='item_review';
  assert n=1, 'Results for a hidden product are not shown';
  assert (select public.notification_count())=0, 'Hidden products leave the unread count';
  reset role;
end;
$flow$;
$test$, 'Item review notifications: approval and merge results, exclusions, inbox and privacy');
select * from finish();
rollback;
