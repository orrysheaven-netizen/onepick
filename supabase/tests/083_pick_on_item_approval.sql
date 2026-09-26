-- A product request made from '원픽 등록' is the pick: approval (or a merge)
-- turns the saved review into the requester's current pick without asking
-- them to choose again. A later choice in the same category wins.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  cat1 uuid := gen_random_uuid(); cat2 uuid := gen_random_uuid(); cat3 uuid := gen_random_uuid();
  existing uuid := gen_random_uuid(); other2 uuid := gen_random_uuid(); existing3 uuid := gen_random_uuid();
  req_b uuid := gen_random_uuid(); req_c uuid := gen_random_uuid(); req_d uuid := gen_random_uuid();
  req_e uuid := gen_random_uuid(); req_f uuid := gen_random_uuid(); req_g uuid := gen_random_uuid();
  first_pick uuid := gen_random_uuid(); later_pick uuid := gen_random_uuid();
  p public.picks%rowtype; n integer; r record;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[alice,bob,admin]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'ap_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[alice,bob,admin]) id;
  insert into private.admin_users(user_id) values(admin);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (cat1,'Auto pick 1','auto-pick-1-'||cat1,'open',true,true),
    (cat2,'Auto pick 2','auto-pick-2-'||cat2,'open',true,true),
    (cat3,'Auto pick 3','auto-pick-3-'||cat3,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (existing,cat1,'Existing one','existingone','active'),
    (other2,cat2,'Other two','othertwo','active'),
    (existing3,cat3,'Existing three','existingthree','active');
  insert into public.items(id,category_id,name,normalized_name,status,created_by) values
    (req_b,cat1,'Request B','requestb','pending',alice),
    (req_c,cat2,'Request C','requestc','pending',alice),
    (req_d,cat1,'Request D','requestd','pending',alice),
    (req_e,cat1,'Request E','requeste','pending',alice),
    (req_f,cat3,'Request F','requestf','pending',alice),
    (req_g,cat3,'Request G','requestg','pending',alice);

  -- Alice already picks the existing product in cat1; Bob follows her.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(first_pick,alice,cat1,existing,'Old reason','active',now()-interval '2 hours');
  perform set_config('request.jwt.claim.sub',bob::text,true);
  insert into public.user_follows(follower_id,followee_id) values(bob,alice);

  -- Reviews are saved only by the requester, only for pending requests, 1..100 chars.
  assert not has_table_privilege('authenticated','public.pending_item_picks','insert'), 'No direct writes';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform public.set_pending_item_pick_review(req_b,'  Request B reason  ');
  perform public.set_pending_item_pick_review(req_c,'Request C reason');
  perform public.set_pending_item_pick_review(req_d,'Request D reason');
  perform public.set_pending_item_pick_review(req_e,'Request E reason');
  perform public.set_pending_item_pick_review(req_g,'Request G reason');
  perform public.set_pending_item_pick_review(req_g,'Request G rewritten');
  assert (select one_line_review from public.pending_item_picks where item_id=req_b)='Request B reason', 'Review is trimmed';
  assert (select one_line_review from public.pending_item_picks where item_id=req_g)='Request G rewritten', 'Resubmitting rewrites the review';
  begin
    perform public.set_pending_item_pick_review(req_f,'   ');
    assert false, 'Blank review must fail';
  exception when sqlstate 'P0001' then assert sqlerrm='REVIEW_INVALID', sqlerrm; end;
  begin
    perform public.set_pending_item_pick_review(existing,'Not a request');
    assert false, 'Only own pending requests take a review';
  exception when sqlstate 'P0001' then assert sqlerrm='ITEM_NOT_FOUND', sqlerrm; end;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  begin
    perform public.set_pending_item_pick_review(req_f,'Someone else''s');
    assert false, 'Other users cannot attach a review';
  exception when sqlstate 'P0001' then assert sqlerrm='ITEM_NOT_FOUND', sqlerrm; end;
  select count(*) into n from public.pending_item_picks;
  assert n=0, 'Saved reviews are private to the requester';
  reset role;

  -- Cat2: Alice picked something else after sending request C. Her later choice wins.
  update public.pending_item_picks set created_at=now()-interval '1 hour' where item_id=req_c;
  perform set_config('request.jwt.claim.sub',alice::text,true);
  insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values(later_pick,alice,cat2,other2,'Chosen later','active',now());

  -- Admin resolves the requests.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  perform public.admin_review_pending_item(req_b,'active');
  perform public.admin_review_pending_item(req_c,'active');
  perform public.admin_review_pending_item(req_e,'rejected');
  perform public.admin_review_pending_item(req_f,'active');
  reset role;

  select * into p from public.picks where user_id=alice and category_id=cat1 and status='active';
  assert p.item_id=req_b and p.one_line_review='Request B reason', 'Approval makes the request the pick with its review';
  assert (select status='replaced' and replaced_by_pick_id=p.id from public.picks where id=first_pick),
    'The previous pick in that category is replaced, as a normal pick change';
  assert not exists(select 1 from public.pending_item_picks where item_id in (req_b,req_c,req_e,req_f)),
    'Resolved requests drop their saved review';
  select * into r from public.item_review_notifications where item_id=req_b;
  assert r.pick_id=p.id and r.outcome='approved', 'The requester is told the pick was made';
  assert exists(select 1 from public.pick_change_notifications where pick_id=p.id and recipient_id=bob),
    'Followers hear about the new pick like any approval into active';

  assert (select item_id from public.picks where user_id=alice and category_id=cat2 and status='active')=other2,
    'A pick made after the request is kept';
  assert not exists(select 1 from public.picks where item_id=req_c), 'No pick for the superseded request';
  assert not exists(select 1 from public.item_review_notifications where item_id=req_c), 'Nothing to tell about a superseded request';

  assert not exists(select 1 from public.picks where item_id=req_e), 'Rejected requests never become picks';
  assert (select pick_id is null from public.item_review_notifications where item_id=req_f),
    'Requests without a saved review still get the choose-it notification';
  assert not exists(select 1 from public.picks where item_id=req_f), 'No review, no automatic pick';

  -- A merge makes the existing product the pick.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  perform public.admin_merge_pending_item(req_d,existing);
  reset role;
  select * into p from public.picks where user_id=alice and category_id=cat1 and status='active';
  assert p.item_id=existing and p.one_line_review='Request D reason', 'Merged requests pick the existing product';
  assert (select r2.pick_id=p.id and r2.outcome='merged' from public.item_review_notifications r2 where r2.item_id=req_d),
    'Merge notification points at the new pick';

  -- The requester resolving it themselves (category match on apply) still gets
  -- the pick but no inbox entry.
  perform set_config('request.jwt.claim.sub',alice::text,true);
  perform set_config('request.jwt.claims','{}',true);
  update public.items set status='merged', merged_into_item_id=existing3 where id=req_g;
  assert (select item_id=existing3 and one_line_review='Request G rewritten' from public.picks
          where user_id=alice and category_id=cat3 and status='active'), 'Self-resolved requests become the pick';
  assert not exists(select 1 from public.item_review_notifications where item_id=req_g), 'No notification for the requester''s own action';

  -- Inbox shows pick_id for the created pick.
  set local role authenticated;
  select * into r from public.notification_page() x where x.kind='item_review' and x.id=req_b;
  assert r.pick_id is not null and r.item_id=req_b, 'Inbox exposes the created pick';
  reset role;
end;
$flow$;
$test$, 'Approving or merging a product request makes it the requester''s pick');
select * from finish();
rollback;
