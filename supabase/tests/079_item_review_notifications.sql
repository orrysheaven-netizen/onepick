-- Only "수정 필요" (rejected) is a user-facing request-review event.
-- Approval/merge publishes or resolves the item without creating an approval
-- notification. Legacy request review intents never create a Pick.
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
  n integer; r record;
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
  perform public.admin_review_pending_item(rejected,'rejected',null,'중복 상품');
  perform public.admin_review_pending_item(orphan,'active');
  perform public.admin_merge_pending_item(merged,existing);
  perform public.admin_merge_pending_item(already,picked);
  reset role;

  assert not exists(select 1 from public.item_review_notifications where item_id=approved),
    'Approval creates no user-facing review notification';
  assert not exists(select 1 from public.item_review_notifications where item_id=merged),
    'Merge creates no user-facing review notification';
  select * into r from public.item_review_notifications where item_id=rejected;
  assert found and r.recipient_id=alice and r.outcome='rejected' and r.target_item_id=rejected
    and r.reason='중복 상품',
    'Rejection notifies the requester about the request and reason';
  assert not exists(select 1 from public.item_review_notifications where item_id=orphan),
    'No requester, no notification';
  assert not exists(select 1 from public.item_review_notifications where item_id=already),
    'No approval/merge nudge when the requester already picks the result';

  -- Re-resolving the same approved request still creates no notification.
  update public.items set status='pending' where id=approved;
  update public.items set status='active' where id=approved;
  assert not exists(select 1 from public.item_review_notifications where item_id=approved),
    'Repeated approval remains silent';

  -- The legacy row-level inbox may remain for compatibility, but with current
  -- writes only the rejected/fix-needed event exists.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  assert (select public.notification_count())=1, 'Only the fix-needed result is unread';
  select * into r from public.notification_page() p where p.kind='item_review';
  assert found and r.id=rejected and r.outcome='rejected' and r.body='중복 상품'
    and r.item_name='Rejected request',
    'The row-level compatibility inbox exposes only the rejection from this flow';

  update public.item_review_notifications set read_at=now() where item_id=rejected;
  assert (select public.notification_count())=0, 'Reading the fix-needed result clears the unread count';
  select count(*) into n from public.notification_page() where kind='item_review';
  assert n=1, 'Read fix-needed rows stay listed in the compatibility inbox';
  reset role;

  -- RLS keeps request-review rows private to their recipient.
  update public.item_review_notifications set read_at=null where item_id=rejected;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  select count(*) into n from public.item_review_notifications;
  assert n=0, 'Review results are private to the requester';
  assert (select public.notification_count())=0, 'Other users count nothing';
  update public.item_review_notifications set read_at=now() where item_id=rejected;
  reset role;
  assert (select read_at is null from public.item_review_notifications where item_id=rejected),
    'Other users cannot mark someone else''s result read';
end;
$flow$;
$test$, 'Item review notifications: only fix-needed rejection is user-facing; approval/merge stay silent');
select * from finish();
rollback;
