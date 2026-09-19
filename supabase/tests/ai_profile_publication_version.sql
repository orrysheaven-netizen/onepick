begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
declare
  u uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  r uuid := gen_random_uuid(); replacement uuid := gen_random_uuid(); actor uuid;
  first_time timestamptz := '2026-09-19T05:00:00.123001+00:00';
  second_time timestamptz := '2026-09-19T05:00:00.123002+00:00';
  n integer;
begin
  select id into actor from public.system_actors where slug='onepick_ai';
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[u,v]) id;
  insert into public.profiles(id,username,onboarding_completed) values
    (u,'aip_'||substr(replace(u::text,'-',''),1,12),true),
    (v,'aip_'||substr(replace(v::text,'-',''),1,12),true);
  insert into public.profile_ai_reviews(id,profile_id,actor_id,summary,body,keywords,source_fingerprint,model_name,prompt_version,generated_at,is_visible)
    values(r,u,actor,'처음 확인한 요약','처음 확인한 본문',array['선택','기록','취향'],'test0001','test','test',first_time,false);

  perform set_config('request.jwt.claim.sub',u::text,true);
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=r and generated_at=first_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=1, 'Matching displayed version may be published';
  reset role;

  -- A new generation changes the text and generated_at in the same row.
  update public.profile_ai_reviews set body='새로 생성한 본문',generated_at=second_time,is_visible=false where id=r;
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=r and generated_at=first_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=0, 'An old screen cannot publish the new text, even one microsecond apart';
  assert (select not is_visible from public.profile_ai_reviews where id=r), 'Rejected publication stays private';
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=r and generated_at=second_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=1, 'The new preview can be published after explicit confirmation';
  update public.profile_ai_reviews set is_visible=false where profile_id=u;
  get diagnostics n=row_count;
  assert n=1, 'Hiding deliberately ignores the displayed version';
  reset role;

  update public.profile_ai_reviews set is_stale=true where id=r;
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=r and generated_at=second_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=0, 'Source invalidation also blocks publication';
  reset role;

  delete from public.profile_ai_reviews where id=r;
  insert into public.profile_ai_reviews(id,profile_id,actor_id,summary,body,keywords,source_fingerprint,model_name,prompt_version,generated_at,is_visible)
    values(replacement,u,actor,'다시 생성한 요약','다시 생성한 본문',array['선택','기록','취향'],'test0002','test','test',second_time,false);
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=r and generated_at=second_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=0, 'A recreated row cannot reuse consent for the deleted row';
  reset role;

  perform set_config('request.jwt.claim.sub',v::text,true);
  set local role authenticated;
  update public.profile_ai_reviews set is_visible=true
    where profile_id=u and id=replacement and generated_at=second_time and is_stale=false;
  get diagnostics n=row_count;
  assert n=0, 'Knowing another users version never bypasses owner RLS';
  reset role;
  assert not has_column_privilege('authenticated','public.profile_ai_reviews','body','UPDATE'), 'AI body remains server-owned';
end;
$flow$;
$test$, 'Conditional publication preserves exact displayed versions and existing owner RLS');
select * from finish();
rollback;
