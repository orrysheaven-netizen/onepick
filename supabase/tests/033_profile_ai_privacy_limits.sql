begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  actor_id uuid;
  n integer;
  visible boolean;
  allowed boolean;
  owner_name text;
begin
  owner_name := 'ai_t_' || substr(replace(owner_id::text, '-', ''), 1, 12);
  select id into actor_id from public.system_actors where slug='onepick_ai';
  assert actor_id is not null, 'System author exists';
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,viewer_id]) id;
  insert into public.profiles(id,username,onboarding_completed) values
    (owner_id,owner_name,true),
    (viewer_id,'ai_t_' || substr(replace(viewer_id::text, '-', ''), 1, 12),true);
  insert into public.profile_ai_reviews(profile_id,actor_id,summary,body,keywords,source_fingerprint,model_name,prompt_version)
    values(owner_id,actor_id,'테스트 요약','테스트 평가',array['선택','취향','기록'],'test0001','test','test');
  select is_visible into visible from public.profile_ai_reviews where profile_id=owner_id;
  assert visible=false, 'New evaluations default to private';
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(id) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=0, 'Anonymous cannot read a private evaluation';
  begin
    perform public.reserve_profile_ai_generation(owner_id);
    raise exception 'Anonymous reservation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true where profile_id=owner_id;
  get diagnostics n=row_count;
  assert n=1, 'Owner can publish';
  begin
    update public.profile_ai_reviews set body='Spoofed review' where profile_id=owner_id;
    raise exception 'Body edit unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reserve_profile_ai_generation(owner_id);
    raise exception 'Client reservation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  set local role authenticated;
  select count(id) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=1, 'Other users can read a published evaluation';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(viewer_id,owner_id,owner_name);
  select count(id) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=0, 'Block rules protect the evaluation too';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role service_role;
  select public.reserve_profile_ai_generation(owner_id) into allowed;
  assert allowed, 'First server reservation succeeds';
  select public.reserve_profile_ai_generation(owner_id) into allowed;
  assert not allowed, 'A duplicate reservation is blocked';
  update public.profile_ai_generation_limits set next_allowed_at=now()-interval '1 second' where profile_id=owner_id;
  select public.reserve_profile_ai_generation(owner_id) into allowed;
  assert allowed, 'Expired reservation can be renewed';
  reset role;
  insert into private.user_moderation(user_id,reason) values(owner_id,'Synthetic AI review security test');
  set local role anon;
  select count(id) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=0, 'Suspended profile evaluation is not public';
  reset role;
end;
$flow$;
$test$, 'AI reviews default to private, inherit profile RLS, and reserve generation atomically');
select * from finish();
rollback;
