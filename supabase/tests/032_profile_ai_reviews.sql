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
  review_id uuid := gen_random_uuid();
  n integer;
  visible boolean;
begin
  select id into actor_id
  from public.system_actors
  where slug = 'onepick_ai' and actor_type = 'ai' and is_verified and is_active;

  assert actor_id is not null, 'OnePick AI system actor is seeded and active';

  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now()
    from unnest(array[owner_id,viewer_id]) id;

  insert into public.profiles(id,username,onboarding_completed) values
    (owner_id,'ai_'||substr(replace(owner_id::text,'-',''),1,12),true),
    (viewer_id,'ai_'||substr(replace(viewer_id::text,'-',''),1,12),true);

  insert into public.profile_ai_reviews(
    id, profile_id, actor_id, summary, body, keywords, pick_snapshot,
    source_fingerprint, model_name, prompt_version, is_visible
  ) values (
    review_id, owner_id, actor_id,
    '분명한 기준이 보이는 취향',
    '서로 다른 카테고리에서도 선택 이유가 비교적 선명하게 드러납니다.',
    array['기준','몰입','선명함'],
    '[]'::jsonb,
    '12345678',
    'test-model',
    'test-v1',
    true
  );

  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from public.system_actors where id=actor_id;
  assert n=1, 'Anonymous viewers can read the active AI author';

  select count(*) into n
  from public.profile_ai_reviews
  where profile_id=owner_id and is_visible;
  assert n=1, 'Anonymous viewers can read a visible AI review';

  begin
    perform model_name from public.profile_ai_reviews where profile_id=owner_id;
    assert false, 'Internal model metadata must not be public';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.system_actors(slug,display_name)
      values('fake_ai','Fake AI');
    assert false, 'Anonymous viewers must not create system actors';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  update public.profile_ai_reviews
  set is_visible=false
  where profile_id=owner_id;
  get diagnostics n = row_count;
  assert n=1, 'Owner can hide their own AI review';

  select is_visible into visible
  from public.profile_ai_reviews
  where profile_id=owner_id;
  assert visible=false, 'Owner can still read their hidden AI review';

  begin
    update public.profile_ai_reviews
    set body='사용자가 바꾼 평가'
    where profile_id=owner_id;
    assert false, 'Owner must not edit AI-authored review text';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profile_ai_reviews(
      profile_id, actor_id, summary, body, keywords, source_fingerprint, model_name, prompt_version
    ) values (
      owner_id, actor_id, '위조', '위조된 AI 평가', array['위조'], 'abcdefgh', 'fake', 'fake'
    );
    assert false, 'Authenticated clients must not create AI reviews';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=0, 'Anonymous viewers cannot read a hidden AI review';
  reset role;

  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  set local role authenticated;
  select count(*) into n from public.profile_ai_reviews where profile_id=owner_id;
  assert n=0, 'Another authenticated user cannot read a hidden AI review';

  update public.profile_ai_reviews
  set is_visible=true
  where profile_id=owner_id;
  get diagnostics n = row_count;
  assert n=0, 'Another authenticated user cannot change visibility';
  reset role;
end;
$flow$;
$test$, 'OnePick AI actor and profile AI review RLS prevent impersonation and protect hidden reviews');

select * from finish();
rollback;
