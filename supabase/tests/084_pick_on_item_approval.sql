-- Legacy pending_item_picks stores a private request-time review, but approval
-- or merge no longer turns that intent into a Pick. A member chooses the
-- approved item explicitly. Validation/privacy of the legacy intent remains.
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
  existing uuid := gen_random_uuid();
  req_approve uuid := gen_random_uuid();
  req_merge uuid := gen_random_uuid();
  req_reject uuid := gen_random_uuid();
  n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'legacy_'||substr(replace(id::text,'-',''),1,10),true from unnest(array[alice,bob,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(cat,'Legacy intent','legacy-intent-'||cat,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status,image_source_url)
    values(existing,cat,'Existing','existing','active','https://example.com/existing.jpg');
  insert into public.items(id,category_id,name,normalized_name,status,created_by,image_source_url) values
    (req_approve,cat,'Approve request','approverequest','pending',alice,'https://example.com/a.jpg'),
    (req_merge,cat,'Merge request','mergerequest','pending',alice,'https://example.com/m.jpg'),
    (req_reject,cat,'Reject request','rejectrequest','pending',alice,'https://example.com/r.jpg');

  assert not has_table_privilege('authenticated','public.pending_item_picks','insert'), 'No direct intent writes';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform public.set_pending_item_pick_review(req_approve,'  approval note  ');
  perform public.set_pending_item_pick_review(req_merge,'merge note');
  perform public.set_pending_item_pick_review(req_reject,'reject note');
  assert (select one_line_review='approval note' from public.pending_item_picks where item_id=req_approve),
    'Legacy request review is trimmed and stored privately';

  perform set_config('request.jwt.claim.sub',bob::text,true);
  select count(*) into n from public.pending_item_picks;
  assert n=0, 'Another member cannot read legacy request intents';
  reset role;

  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  perform public.admin_review_pending_item(req_approve,'active');
  perform public.admin_merge_pending_item(req_merge,existing);
  perform public.admin_review_pending_item(req_reject,'rejected',null,'정보를 고쳐주세요');
  reset role;

  assert not exists(
    select 1 from public.picks
    where user_id=alice and item_id in (req_approve,existing)
  ), 'Approval and merge create no Pick from legacy intent';

  assert not exists(
    select 1 from public.pending_item_picks
    where item_id in (req_approve,req_merge,req_reject)
  ), 'Resolved requests delete their legacy intents';

  assert not exists(
    select 1 from public.item_review_notifications
    where item_id in (req_approve,req_merge)
  ), 'Approval and merge create no user review notification';

  assert exists(
    select 1 from public.item_review_notifications
    where item_id=req_reject
      and recipient_id=alice
      and outcome='rejected'
      and reason='정보를 고쳐주세요'
  ), 'Only the correction-needed rejection is notified';

  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  assert (public.change_pick(cat,req_approve,'승인 뒤 직접 선택')).item_id=req_approve,
    'After approval the member explicitly chooses the item';
  reset role;
end;
$flow$;
$test$, 'Legacy request intents never auto-create Picks; rejection-only notification and explicit later choice remain');

select * from finish();
rollback;
