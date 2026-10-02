-- Approval/merge is not a user notification event and legacy pending intent
-- never creates a Pick, including for an administrator's own request.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
declare
  admin uuid := gen_random_uuid(); member uuid := gen_random_uuid();
  cat uuid := gen_random_uuid(); existing uuid := gen_random_uuid();
  own_request uuid := gen_random_uuid(); member_request uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[admin,member]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'sa_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[admin,member]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Self approval','self-approval-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,image_source_url)
    values(existing,cat,'Existing self','existingself','active','https://example.com/existing.jpg');
  insert into public.items(id,category_id,name,normalized_name,status,created_by,image_source_url) values
    (own_request,cat,'Admin own request','adminownrequest','pending',admin,'https://example.com/admin.jpg'),
    (member_request,cat,'Member request','memberrequest','pending',member,'https://example.com/member.jpg');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform public.set_pending_item_pick_review(own_request,'Admin note');
  perform set_config('request.jwt.claim.sub',member::text,true);
  perform public.set_pending_item_pick_review(member_request,'Member note');

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform public.admin_review_pending_item(own_request,'active');
  reset role;

  assert not exists(select 1 from public.item_review_notifications where item_id=own_request),
    'Admin self-approval creates no notification';
  assert not exists(select 1 from public.picks where user_id=admin and item_id=own_request),
    'Admin self-approval creates no Pick from legacy intent';

  perform set_config('request.jwt.claim.sub',member::text,true);
  perform set_config('request.jwt.claims','{}',true);
  update public.items set status='merged', merged_into_item_id=existing where id=member_request;
  assert not exists(select 1 from public.picks where user_id=member and item_id=existing),
    'Self-resolution merge creates no Pick from legacy intent';
  assert not exists(select 1 from public.item_review_notifications where item_id=member_request),
    'Self-resolution merge creates no notification';
end;
$flow$;
$test$, 'Approval and merge create neither legacy auto-Picks nor approval notifications');
select * from finish();
rollback;
