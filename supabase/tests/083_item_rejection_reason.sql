-- Rejecting a product request requires a 1-500 character reason, trimmed and
-- sent to the requester; approval ignores a passed reason. Every review is
-- logged privately with the reviewing admin. The items table keeps its shape.
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
  approved uuid := gen_random_uuid(); rejected uuid := gen_random_uuid(); reopened uuid := gen_random_uuid();
  approved_manual uuid := gen_random_uuid();
  r record; n integer; failed boolean;
  bad text;
begin
  assert to_regprocedure('public.admin_review_pending_item(uuid,text,uuid)') is null,
    'The three-argument review endpoint is gone';
  assert to_regprocedure('private.admin_review_pending_item_impl(uuid,text,uuid)') is null,
    'The three-argument implementation is gone';
  assert to_regprocedure('public.admin_review_pending_item(uuid,text,uuid,text)') is not null,
    'The review endpoint takes a rejection reason';
  assert not (select prosecdef from pg_proc where oid='public.admin_review_pending_item(uuid,text,uuid,text)'::regprocedure),
    'The public review endpoint stays SECURITY INVOKER';
  assert not has_table_privilege('authenticated','private.item_review_log','select'), 'The review log is private';
  assert not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='items' and column_name in ('rejection_reason','reviewed_at','reviewed_by')),
    'public.items keeps its shape (functions return it with explicit column lists)';

  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'reject_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Reject reason','reject-reason-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (approved,cat,'Approved request','approvedrequest','pending',alice),
    (rejected,cat,'Rejected request','rejectedrequest','pending',alice),
    (reopened,cat,'Reopened request','reopenedrequest','pending',alice);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  begin
    perform public.admin_review_pending_item(rejected,'rejected',null,'사유');
    failed := false;
  exception when others then
    failed := sqlerrm = 'ADMIN_REQUIRED';
  end;
  assert failed, 'Only admins can reject';

  perform set_config('request.jwt.claim.sub',admin::text,true);
  foreach bad in array array[null, '', '   ', repeat('가',501)] loop
    begin
      perform public.admin_review_pending_item(rejected,'rejected',null,bad);
      failed := false;
    exception when others then
      failed := sqlerrm = 'REJECT_REASON_INVALID';
    end;
    assert failed, format('Reason %L is refused', left(coalesce(bad,'<null>'),10));
  end loop;
  reset role;
  assert (select status='pending' from public.items where id=rejected), 'Refused rejections leave the request pending';
  assert not exists(select 1 from private.item_review_log where item_id=rejected), 'Refused rejections are not logged';

  set local role authenticated;
  perform public.admin_review_pending_item(approved,'active',null,'무시될 사유');
  perform public.admin_review_pending_item(rejected,'rejected',null,'  '||repeat('가',498)||'  ');
  perform public.admin_review_pending_item(reopened,'rejected',null,'정보 부족');
  reset role;

  select * into r from public.items where id=approved;
  assert r.status='active', 'Approval ignores a passed reason';
  select * into r from public.item_review_notifications where item_id=approved;
  assert r.outcome='approved' and r.reason is null, 'An approval notification carries no reason';
  assert (select status='rejected' from public.items where id=rejected), 'The request is rejected';

  select count(*) into n from private.item_review_log
    where item_id=approved and status='active' and rejection_reason is null
      and reviewed_by=admin and reviewed_at is not null;
  assert n=1, 'Approval is logged with the admin and time';
  select count(*) into n from private.item_review_log
    where item_id=rejected and status='rejected' and rejection_reason=repeat('가',498)
      and reviewed_by=admin and reviewed_at is not null;
  assert n=1, 'Rejection is logged with the admin, reason and time';

  select * into r from public.item_review_notifications where item_id=rejected;
  assert found and r.recipient_id=alice and r.outcome='rejected' and r.target_item_id=rejected
    and r.reason=repeat('가',498) and r.read_at is null,
    'The requester is notified of the rejection with the trimmed reason';
  assert not exists(select 1 from public.picks where item_id in (approved,rejected,reopened)),
    'Reviews never create picks';

  -- The requester reads the reason; nobody else sees the rejected request.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  select * into r from public.notification_page() p where p.kind='item_review' and p.id=reopened;
  assert found and r.outcome='rejected' and r.body='정보 부족' and r.item_name='Reopened request',
    'The inbox shows the rejection reason';
  reset role;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  set local role authenticated;
  assert not exists(select 1 from public.items where id=rejected), 'Other users cannot read a rejected request';
  assert not exists(select 1 from public.notification_page() where id=rejected), 'Other users get no notification';
  reset role;

  -- Reopened and then approved: one row, now the approval, unread again.
  update public.item_review_notifications set read_at=now() where item_id=reopened;
  update public.items set status='pending' where id=reopened;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(reopened,'active');
  reset role;
  select count(*) into n from public.item_review_notifications where item_id=reopened;
  assert n=1, 'Still one notification per request';
  select * into r from public.item_review_notifications where item_id=reopened;
  assert r.outcome='approved' and r.read_at is null, 'A new result replaces the old one and is unread';
  assert r.reason is null, 'Approval clears the stale reason';

  -- Rejections made outside the review endpoint have no reason and send nothing.
  insert into public.items(id,category_id,name,normalized_name,status,created_by)
    values(approved_manual,cat,'Manual request','manualrequest','pending',alice);
  update public.items set status='rejected' where id=approved_manual;
  assert not exists(select 1 from public.item_review_notifications where item_id=approved_manual),
    'Direct status rejections are not notified';
end;
$flow$;
$test$, 'Item rejection: reason validation, storage, review log and requester notification');
select * from finish();
rollback;
