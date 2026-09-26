-- An administrator approving their own product request still hears about the
-- result; an ordinary user resolving their own request on screen does not.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  admin uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); existing uuid := gen_random_uuid();
  own_request uuid := gen_random_uuid(); member_request uuid := gen_random_uuid();
  r public.item_review_notifications%rowtype;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[admin,member]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'sa_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[admin,member]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Self approval','self-approval-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (existing,cat,'Existing self','existingself','active');
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (own_request,cat,'Admin own request','adminownrequest','pending',admin),
    (member_request,cat,'Member request','memberrequest','pending',member);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform public.set_pending_item_pick_review(own_request,'Admin reason');
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform public.set_pending_item_pick_review(member_request,'Member reason');

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform public.admin_review_pending_item(own_request,'active');
  reset role;

  select * into r from public.item_review_notifications where item_id=own_request;
  assert found and r.recipient_id=admin and r.outcome='approved', 'An admin approving their own request is notified';
  assert r.pick_id=(select id from public.picks where user_id=admin and item_id=own_request and status='active'),
    'The notification points at the pick the approval made';

  -- The member resolves their own request (category match on apply): pick, no inbox entry.
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform set_config('request.jwt.claims','{}',true);
  update public.items set status='merged', merged_into_item_id=existing where id=member_request;
  assert exists(select 1 from public.picks where user_id=member and item_id=existing and status='active'),
    'The member''s own resolution still makes the pick';
  assert not exists(select 1 from public.item_review_notifications where item_id=member_request),
    'An ordinary user resolving their own request is not notified';
end;
$flow$;
$test$, 'Admin self-approval is notified; ordinary self-resolution is not');
select * from finish();
rollback;
