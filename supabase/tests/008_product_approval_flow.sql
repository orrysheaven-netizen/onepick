-- An isolated, rollback-only lifecycle with real authenticated RLS roles.
-- Never uses or modifies an existing account, category, product or Pick.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  v_alice constant uuid := 'f8100000-0000-4000-8000-000000000001';
  v_bob constant uuid := 'f8100000-0000-4000-8000-000000000002';
  v_admin constant uuid := 'f8100000-0000-4000-8000-000000000003';
  v_category constant uuid := 'f8200000-0000-4000-8000-000000000001';
  v_product public.products%rowtype;
  v_duplicate public.products%rowtype;
  v_rejected public.products%rowtype;
  v_retry public.products%rowtype;
  v_rows integer;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
    (v_alice,'authenticated','authenticated','approval-alice@example.invalid','',now(),now()),
    (v_bob,'authenticated','authenticated','approval-bob@example.invalid','',now(),now()),
    (v_admin,'authenticated','authenticated','approval-admin@example.invalid','',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (v_alice,'approval_alice',true),(v_bob,'approval_bob',true),(v_admin,'approval_admin',true);
  insert into private.admin_users(user_id) values(v_admin);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  assert public.current_user_is_admin(), 'Fixture admin must have explicit allowlist membership';
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_category,'승인 흐름 검증','qa-approval-lifecycle','open',true,true);

  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  assert not public.current_user_is_admin(), 'Submitter must be an ordinary user';
  v_product := public.submit_product(v_category,'검증용 제품');
  assert v_product.status='pending' and v_product.created_by=v_alice, 'Requests must start pending and belong to their submitter';
  v_retry := public.submit_product(v_category,'  검증용   제품  ');
  assert v_retry.id=v_product.id, 'Retry must reuse the same normalized own request';
  assert (select count(*)=0 from public.picks where user_id=v_alice), 'A product request must not create a Pick';

  update public.products set status='active' where id=v_product.id;
  get diagnostics v_rows = row_count;
  assert v_rows=0, 'Submitter must not approve their own product';
  begin
    insert into public.products(category_id,name,normalized_name,status,created_by)
      values(v_category,'승인 우회','승인우회','active',v_alice);
    assert false, 'Direct active-product insertion must fail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_pick(v_category,v_product.id,'검증용 제품','승인 전 선택');
    assert false, 'Pending product must not be selectable';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PRODUCT_NOT_ELIGIBLE', 'Expected pending-product rejection';
  end;

  perform set_config('request.jwt.claim.sub',v_bob::text,true);
  assert (select count(*)=0 from public.products where id=v_product.id), 'Another user must not see a private pending request';
  v_duplicate := public.submit_product(v_category,'검증용 제품');
  assert v_duplicate.id<>v_product.id and v_duplicate.created_by=v_bob, 'Another submitter receives their own private request';
  v_rejected := public.submit_product(v_category,'보류할 검증 제품');

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  assert (select count(*)=3 from public.products where category_id=v_category and status='pending'), 'Admin must see all requests';
  update public.products set status='active' where id=v_product.id and status='pending';
  get diagnostics v_rows = row_count;
  assert v_rows=1, 'Admin approval must update exactly one pending product';
  update public.products set status='rejected' where id=v_product.id and status='pending';
  get diagnostics v_rows = row_count;
  assert v_rows=0, 'A stale moderation action must not overwrite an approval';
  update public.products set status='merged',merged_into_product_id=v_product.id
    where id=v_duplicate.id and status='pending';
  get diagnostics v_rows = row_count;
  assert v_rows=1, 'Admin can merge the duplicate request into the approved master';
  update public.products set status='rejected' where id=v_rejected.id and status='pending';
  get diagnostics v_rows = row_count;
  assert v_rows=1, 'Admin can reject a pending request';

  perform set_config('request.jwt.claim.sub',v_alice::text,true);
  assert (select status='active' from public.products where id=v_product.id), 'Submitter can read approval status';
  perform public.register_pick(v_category,v_product.id,'검증용 제품','첫 선택 이유');
  perform public.register_pick(v_category,v_product.id,'검증용 제품','수정한 선택 이유');
  assert (select count(*)=1 from public.picks where user_id=v_alice and category_id=v_category and status='active'), 'Repeated selection must preserve one current Pick';
  assert (select one_line_review='수정한 선택 이유' from public.picks where user_id=v_alice and category_id=v_category and status='active'), 'Repeated selection must update the review';

  perform set_config('request.jwt.claim.sub',v_bob::text,true);
  assert (select status='merged' and merged_into_product_id=v_product.id from public.products where id=v_duplicate.id), 'Submitter can read the canonical merge target';
  assert (select status='rejected' from public.products where id=v_rejected.id), 'Submitter can read rejection status';
  begin
    perform public.register_pick(v_category,v_duplicate.id,'검증용 제품','병합된 원본 선택');
    assert false, 'Merged duplicate must not be selectable';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PRODUCT_NOT_ELIGIBLE', 'Expected merged-product rejection';
  end;
  begin
    perform public.register_pick(v_category,v_rejected.id,'보류할 검증 제품','거절된 제품 선택');
    assert false, 'Rejected product must not be selectable';
  exception when sqlstate 'P0001' then
    assert sqlerrm='PRODUCT_NOT_ELIGIBLE', 'Expected rejected-product rejection';
  end;
  v_retry := public.submit_product(v_category,'검증용 제품');
  assert v_retry.id=v_product.id, 'Later requests must reuse the approved shared master';
  perform public.register_pick(v_category,v_product.id,'검증용 제품','다른 사람의 선택 이유');
  assert (select count(*)=2 from public.picks where product_id=v_product.id and status='active'), 'Two users must share one product_id with separate Picks';

  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  assert (select count(*)=1 from public.products where category_id=v_category), 'Anonymous catalog must show only the approved product';
  assert (select count(*)=2 from public.picks where product_id=v_product.id and status='active'), 'Approved Picks remain discoverable publicly';
  reset role;
end;
$flow$;
$test$, 'Product request, approval, stale moderation, merge, rejection and shared selection lifecycle');

select * from finish();
rollback;
