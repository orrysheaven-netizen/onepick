begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
declare
  u uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid();
  actor uuid; rev bigint; next_time timestamptz; result jsonb; n integer;
begin
  select id into actor from public.system_actors where slug = 'onepick_ai';
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[u,v]) id;
  insert into public.profiles(id,username,onboarding_completed) values
    (u,'ait_'||substr(replace(u::text,'-',''),1,12),true),
    (v,'ait_'||substr(replace(v::text,'-',''),1,12),true);
  insert into public.categories(id,name,slug,status,is_visible,is_pickable) values
    (c1,'AI test 1','ait-'||c1,'open',true,true),
    (c2,'AI test 2','ait-'||c2,'open',true,true),
    (c3,'AI test 3','ait-'||c3,'open',true,true);
  insert into public.items(id,category_id,name,normalized_name,status) values
    (i1,c1,'AI item 1','ai item 1','active'),
    (i2,c2,'AI item 2','ai item 2','active'),
    (i3,c3,'AI item 3','ai item 3','active');
  insert into public.picks(user_id,category_id,item_id,one_line_review,status) values
    (u,c1,i1,'합성 테스트 1','active'),(u,c2,i2,'합성 테스트 2','active'),
    (u,c3,i3,'합성 테스트 3','active'),(v,c1,i1,'다른 사용자 테스트','active');
  select source_version into rev from public.profile_ai_generation_limits where profile_id=u;
  assert rev=3, 'Three active selections advance the source version';

  perform set_config('request.jwt.claim.sub','',true);
  set local role service_role;
  perform public.reserve_profile_ai_generation(u);
  select next_allowed_at into next_time from public.profile_ai_generation_limits where profile_id=u;
  result := public.save_profile_ai_review(u,rev,actor,'검증용 요약','실제 모델 호출 없는 합성 검증',array['취향','선택','기록'],'[]'::jsonb,'testfingerprint','test','test-v3');
  assert result->>'is_visible'='false' and result->>'is_stale'='false', 'A new result is a private fresh preview';
  assert not result ? 'source_version' and not result ? 'pick_snapshot', 'Internal source data stays out of the response';
  result := public.save_profile_ai_review(v,1,actor,'다른 사용자','별도 합성 검증',array['취향','선택','기록'],'[]'::jsonb,'testfingerprint','test','test-v3');
  reset role;
  update public.profile_ai_reviews set is_visible=true where profile_id in (u,v);

  update public.profiles set bio='소개 수정' where id=u;
  assert (select is_visible and not is_stale from public.profile_ai_reviews where profile_id=u), 'Bio edits preserve the evaluation';
  update public.picks set one_line_review='선택 이유가 바뀌었어요' where user_id=u and item_id=i1;
  assert (select is_stale and not is_visible from public.profile_ai_reviews where profile_id=u), 'Changing a one-line review hides and invalidates its AI result';
  assert (select is_visible and not is_stale from public.profile_ai_reviews where profile_id=v), 'Other users are not affected by a personal edit';
  assert (select next_allowed_at=next_time from public.profile_ai_generation_limits where profile_id=u), 'Source edits do not reset the quota';

  perform set_config('request.jwt.claim.sub',u::text,true);
  set local role authenticated;
  select count(id) into n from public.profile_ai_reviews where profile_id=u;
  assert n=1, 'Owner can still read the stale private result';
  begin
    update public.profile_ai_reviews set is_visible=true where profile_id=u;
    raise exception 'Stale publication unexpectedly succeeded';
  exception when check_violation then null;
  end;
  begin
    update public.profile_ai_reviews set is_stale=false where profile_id=u;
    raise exception 'Client cleared server-owned stale state';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_profile_ai_review(u,rev,actor,'위조','위조',array['a','b','c'],'[]','testfingerprint','fake','fake');
    raise exception 'Client invoked server-only save';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(id) into n from public.profile_ai_reviews where profile_id=u;
  assert n=0, 'Public readers cannot access a stale result';
  reset role;
  set local role service_role;
  begin
    perform public.save_profile_ai_review(u,rev,actor,'오래된 생성','변경 전 데이터로 생성',array['a','b','c'],'[]','testfingerprint','test','test-v3');
    raise exception 'A stale in-flight generation unexpectedly saved';
  exception when raise_exception then
    if sqlerrm <> 'AI_REVIEW_STALE' then raise; end if;
  end;
  select source_version into rev from public.profile_ai_generation_limits where profile_id=u;
  result := public.save_profile_ai_review(u,rev,actor,'새 요약','최신 선택으로 재평가',array['a','b','c'],'[]','testfingerprint','test','test-v3');
  assert result->>'is_visible'='false' and result->>'is_stale'='false', 'Fresh regeneration clears stale state but does not auto-publish';
  reset role;
  update public.profile_ai_reviews set is_visible=true where profile_id=u;

  update public.items set official_url='https://example.com/item' where id=i1;
  assert (select is_visible from public.profile_ai_reviews where profile_id=u), 'External-link-only edits preserve the evaluation';
  update public.items set name='Renamed AI item' where id=i1;
  assert (select bool_and(is_stale and not is_visible) from public.profile_ai_reviews where profile_id in(u,v)), 'Catalog name changes invalidate all affected profiles';
  select source_version into rev from public.profile_ai_generation_limits where profile_id=u;
  perform public.save_profile_ai_review(u,rev,actor,'새 요약','테스트',array['a','b','c'],'[]','testfingerprint','test','test-v3');
  update public.profile_ai_reviews set is_visible=true where profile_id=u;
  update public.categories set is_visible=false where id=c1;
  assert (select is_stale and not is_visible from public.profile_ai_reviews where profile_id=u), 'Hiding a source category hides its derived evaluation';

  select source_version into rev from public.profile_ai_generation_limits where profile_id=u;
  perform public.save_profile_ai_review(u,rev,actor,'새 요약','테스트',array['a','b','c'],'[]','testfingerprint','test','test-v3');
  update public.profile_ai_reviews set is_visible=true where profile_id=u;
  delete from public.picks where user_id=u and item_id=i2;
  assert (select is_stale and not is_visible from public.profile_ai_reviews where profile_id=u), 'Physical deletion of a selection hides its derived evaluation';
  select source_version into rev from public.profile_ai_generation_limits where profile_id=u;
  perform public.save_profile_ai_review(u,rev,actor,'새 요약','테스트',array['a','b','c'],'[]','testfingerprint','test','test-v3');
  update public.profile_ai_reviews set is_visible=true where profile_id=u;
  update public.picks set status='removed',ended_at=now() where user_id=u and item_id=i3;
  assert (select is_stale and not is_visible from public.profile_ai_reviews where profile_id=u), 'Removing a selection invalidates the evaluation';
end;
$flow$;
$test$, 'AI results become private and stale after source changes; old versions cannot be published or saved');
select * from finish();
rollback;
