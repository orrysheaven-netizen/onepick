-- Run after the community-write migration. All fixtures are rolled back.
begin;
-- Keep this legacy fixture focused on its original contract after the
-- photo-required Pick invariant. Rolled back with this pgTAP transaction.
alter table public.items alter column image_source_url
  set default 'https://example.test/onepick-test-item.png'; -- test fixture default for the photo-required Pick invariant
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($check$
do $test$
declare
  a constant uuid := 'f9100000-0000-4000-8000-000000000001';
  b constant uuid := 'f9100000-0000-4000-8000-000000000002';
  c constant uuid := 'f9200000-0000-4000-8000-000000000001';
  item uuid;
  pick uuid;
  b_pick uuid;
  comment_id uuid;
  comment_ids uuid[] := '{}';
begin
  insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
    (a,'authenticated','authenticated','limit-a@example.invalid','',now(),now()),
    (b,'authenticated','authenticated','limit-b@example.invalid','',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values
    (a,'limit_test_a',true),(b,'limit_test_b',true);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(c,'Quota fixture','quota-fixture','open',true,true);
  insert into public.items(category_id,name,normalized_name,status)
    values(c,'Quota item','quotaitem','active') returning id into item;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.register_pick(c,item,'Quota item','Fixture review');
  select id into pick from public.picks where user_id=a and category_id=c and status='active';
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.register_pick(c,item,'Quota item','Same item review');
  select id into b_pick from public.picks where user_id=b and category_id=c and status='active';
  for i in 1..10 loop
    insert into public.comments(pick_id,user_id,body) values(pick,b,'Comment '||i)
      returning id into comment_id;
    comment_ids := array_append(comment_ids,comment_id);
  end loop;
  begin
    insert into public.comments(pick_id,user_id,body) values(pick,b,'Over limit');
    assert false, 'Eleventh comment must fail';
  exception when sqlstate 'P0001' then assert sqlerrm='RATE_LIMITED'; end;
  begin
    update public.comments set body='Edit spam' where id=comment_ids[1];
    assert false, 'Edits share the comment quota';
  exception when sqlstate 'P0001' then assert sqlerrm='RATE_LIMITED'; end;
  update public.comments set body=body where id=comment_ids[1];
  begin
    perform 1 from private.community_write_limits;
    assert false, 'Clients cannot read quotas';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.community_write_limits;
    assert false, 'Clients cannot reset quotas';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',a::text,true);
  -- A review author only replies on their own review, so A uses B's review.
  insert into public.comments(pick_id,user_id,body) values(b_pick,a,'Separate user quota');
  for i in 1..10 loop
    insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
      values(a,'comment',comment_ids[i],'spam');
  end loop;
  begin
    insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
      values(a,'profile',b,'spam');
    assert false, 'Eleventh report must fail';
  exception when sqlstate 'P0001' then assert sqlerrm='RATE_LIMITED'; end;
  begin
    insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
      values(a,'comment',comment_ids[1],'spam');
    assert false, 'Duplicate report must fail without charging quota';
  exception when unique_violation then null; end;
  perform set_config('request.jwt.claim.sub',b::text,true);
  delete from public.comments where id=comment_ids[1];
  begin
    insert into public.comments(pick_id,user_id,body) values(pick,b,'Delete does not reset');
    assert false, 'Deleting content must not restore quota';
  exception when sqlstate 'P0001' then assert sqlerrm='RATE_LIMITED'; end;
  reset role;
  assert (select requests=10 from private.community_write_limits where user_id=b and action='comment');
  assert (select requests=10 from private.community_write_limits where user_id=a and action='report');
  assert (select count(*)=10 from public.content_reports where reporter_user_id=a);
  update private.community_write_limits set window_start=clock_timestamp()-interval '2 hours'
    where user_id in (a,b);
  set local role authenticated;
  insert into public.comments(pick_id,user_id,body) values(pick,b,'Window reset');
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.content_reports(reporter_user_id,target_type,target_id,reason)
    values(a,'profile',b,'spam');
  reset role;
  assert (select requests=1 from private.community_write_limits where user_id=b and action='comment');
  assert (select requests=1 from private.community_write_limits where user_id=a and action='report');
end;
$test$;
$check$, 'Community quotas reject excess writes and isolate users, reset windows and protect counters');
select * from finish();
rollback;
