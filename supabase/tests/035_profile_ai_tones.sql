begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($scenario$
do $flow$
declare owner_id uuid := gen_random_uuid(); ai_id uuid; version bigint; result jsonb; n bigint;
begin
  select id into ai_id from public.system_actors where slug='onepick_ai';
  assert ai_id is not null, 'AI author exists';
  insert into auth.users(id,aud,role,created_at,updated_at) values(owner_id,'authenticated','authenticated',now(),now());
  insert into public.profiles(id,username,onboarding_completed) values(owner_id,'tone_' || substr(replace(owner_id::text,'-',''),1,12),true);
  set local role service_role;
  perform public.reserve_profile_ai_generation(owner_id);
  select source_version into version from public.profile_ai_generation_limits where profile_id=owner_id;
  result := public.save_profile_ai_review(owner_id,version,ai_id,'선택 이유의 공통점','테스트용 직접 작성 본문입니다.',array['선택','기록','취향'],'[]'::jsonb,'tone-test-fingerprint','test-model','taste-v5-no-age:direct:tone-v1');
  assert result->>'tone'='direct', 'Direct metadata';
  assert result->>'is_visible'='false', 'First preview private';
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true where profile_id=owner_id;
  get diagnostics n=row_count;
  assert n=1, 'Owner can publish';
  begin
    update public.profile_ai_reviews set tone='warm' where profile_id=owner_id;
    raise exception 'CLIENT_TONE_WRITE_UNEXPECTEDLY_ALLOWED';
  exception when insufficient_privilege or sqlstate '428C9' then null;
  end;
  begin
    update public.profile_ai_reviews set prompt_version='fake:warm:tone-v1' where profile_id=owner_id;
    raise exception 'CLIENT_PROMPT_WRITE_UNEXPECTEDLY_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role service_role;
  result := public.save_profile_ai_review(owner_id,version,ai_id,'선택 사이의 연결','테스트용 다정한 본문입니다.',array['선택','연결','기록'],'[]'::jsonb,'tone-test-fingerprint','test-model','taste-v5-no-age:warm:tone-v1');
  assert result->>'tone'='warm', 'Warm metadata';
  assert result->>'is_visible'='false', 'Changed mode requires fresh preview';
  select count(*) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=1, 'Single latest comment';
  result := public.save_profile_ai_review(owner_id,version,ai_id,'이전 규칙의 댓글','이전 서버 저장 경로를 검증하는 본문입니다.',array['선택','연결','기록'],'[]'::jsonb,'tone-test-fingerprint','test-model','taste-v5-no-age');
  assert result->>'tone' is null, 'Legacy is not relabeled';
  assert result->>'is_visible'='false', 'Legacy preview remains private';
  reset role;
end;
$flow$;
$scenario$, 'Tone is server-authored, private after mode changes, latest-only, and legacy compatible');
select * from finish();
rollback;
