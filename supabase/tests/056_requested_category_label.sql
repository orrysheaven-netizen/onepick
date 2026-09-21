-- Free-text category hints on unclassified requests: only the requester can
-- write one, only while the request is pending, and the administrator reads it
-- during review. The hint never changes the staged category itself.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_alice constant uuid := 'f8700000-0000-4000-8000-000000000001';
  v_bob constant uuid := 'f8700000-0000-4000-8000-000000000002';
  v_admin constant uuid := 'f8700000-0000-4000-8000-000000000003';
  v_category constant uuid := 'f8800000-0000-4000-8000-000000000001';
  v_bucket uuid;
  v_item public.items%rowtype;
  v_updated public.items%rowtype;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
    (v_alice,'authenticated','authenticated','hint-alice@example.invalid','',now(),now()),
    (v_bob,'authenticated','authenticated','hint-bob@example.invalid','',now(),now()),
    (v_admin,'authenticated','authenticated','hint-admin@example.invalid','',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_alice,'hint_alice',true),(v_bob,'hint_bob',true),(v_admin,'hint_admin',true);
  insert into private.admin_users(user_id) values(v_admin);

  select id into v_bucket from public.categories where slug='pending-product';
  assert v_bucket is not null, 'Unclassified requests need the staging category';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_category,'힌트 검증 카테고리','qa-category-hint','open',true,true);

  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  v_item := public.submit_unclassified_item('힌트 텀블러');
  assert v_item.status='pending' and v_item.category_id=v_bucket, 'Fixture request is staged without a category';
  assert v_item.requested_category_label is null, 'A fresh request has no hint';

  begin
    perform public.set_pending_item_category_hint(v_item.id,repeat('가',61));
    assert false, 'A hint longer than 60 characters must be rejected';
  exception when sqlstate 'P0001' then
    assert sqlerrm='CATEGORY_LABEL_INVALID', 'Expected long-hint rejection';
  end;

  v_updated := public.set_pending_item_category_hint(v_item.id,'  텀블러 /  보온병 ');
  assert v_updated.requested_category_label='텀블러 / 보온병', 'The hint is stored with collapsed whitespace';
  assert v_updated.category_id=v_bucket and v_updated.status='pending', 'A hint never changes the staged category or status';
  assert (select count(*)=0 from public.search_items('힌트 텀블러')), 'A hinted request stays out of search';

  v_updated := public.set_pending_item_category_hint(v_item.id,'   ');
  assert v_updated.requested_category_label is null, 'Blank text clears the hint';
  v_updated := public.set_pending_item_category_hint(v_item.id,'텀블러');
  assert v_updated.requested_category_label='텀블러', 'The hint can be rewritten while pending';

  perform set_config('request.jwt.claim.sub',v_bob::text,true);
  begin
    perform public.set_pending_item_category_hint(v_item.id,'남의 힌트');
    assert false, 'Another user must not write a hint on a private request';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_FOUND', 'Expected foreign-request rejection';
  end;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  assert (select requested_category_label='텀블러' from public.items where id=v_item.id),
    'The administrator reads the hint during review';
  begin
    perform public.admin_review_pending_item(v_item.id,'active');
    assert false, 'A hint alone does not satisfy approval';
  exception when sqlstate 'P0001' then
    assert sqlerrm='CATEGORY_NOT_PICKABLE', 'Expected approval to require a real category';
  end;
  v_updated := public.admin_review_pending_item(v_item.id,'active',v_category);
  assert v_updated.status='active' and v_updated.category_id=v_category, 'Approval assigns the real category';
  assert v_updated.requested_category_label='텀블러', 'The hint is kept for later taxonomy review';
  assert (select count(*)=1 from public.search_items('힌트 텀블러')), 'The approved item becomes searchable';

  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  begin
    perform public.set_pending_item_category_hint(v_item.id,'승인 후 수정');
    assert false, 'Hints are frozen once the request leaves pending';
  exception when sqlstate 'P0001' then
    assert sqlerrm='ITEM_NOT_ELIGIBLE', 'Expected post-approval rejection';
  end;

  reset role;
end;
$flow$;
$test$, 'Requester-only category hints on pending requests, read by the administrator during review');

select * from finish();
rollback;
