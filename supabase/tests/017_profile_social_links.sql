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
  n integer;
  bad_url text;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,viewer_id]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'sns_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[owner_id,viewer_id]) id;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  insert into public.profile_social_links(user_id,platform,url) values
    (owner_id,'instagram','https://www.instagram.com/hello'),
    (owner_id,'youtube','https://www.youtube.com/@한글채널'),
    (owner_id,'x','https://x.com/hello'),
    (owner_id,'threads','https://www.threads.com/@hello'),
    (owner_id,'naver_blog','https://blog.naver.com/hello');
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=5, 'Owner can create five supported SNS links';
  insert into public.profile_social_links(user_id,platform,url) values(owner_id,'instagram','https://www.instagram.com/updated')
    on conflict(user_id,platform) do update set user_id=excluded.user_id,platform=excluded.platform,url=excluded.url;
  select count(*) into n from public.profile_social_links where user_id=owner_id and platform='instagram' and url='https://www.instagram.com/updated';
  assert n=1, 'Upsert updates one existing platform';
  foreach bad_url in array array['javascript:alert(1)','http://www.instagram.com/hello','https://www.instagram.com.evil.test/hello','https://www.instagram.com/hello?redirect=evil','https://www.instagram.com/hello/extra', E'https://www.instagram.com/hello\n'] loop
    begin
      update public.profile_social_links set url=bad_url where user_id=owner_id and platform='instagram';
      raise exception 'Unsafe URL must be rejected';
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.profile_social_links(user_id,platform,url) values(owner_id,'unknown','https://example.test');
    raise exception 'Unknown platform must be rejected';
  exception when check_violation then null;
  end;
  begin
    update public.profile_social_links set user_id=viewer_id where user_id=owner_id;
    raise exception 'Ownership must not be reassigned';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profile_social_links set created_at=now() where user_id=owner_id;
    raise exception 'Client must not alter server metadata';
  exception when insufficient_privilege then null;
  end;
  delete from public.profile_social_links where user_id=owner_id and platform='x';
  get diagnostics n = row_count;
  assert n=1, 'Owner can remove a single platform';
  reset role;
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  set local role authenticated;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=4, 'Unblocked viewer can read public SNS links';
  update public.profile_social_links set url='https://www.instagram.com/hijack' where user_id=owner_id and platform='instagram';
  get diagnostics n = row_count;
  assert n=0, 'Other users cannot edit links';
  delete from public.profile_social_links where user_id=owner_id;
  get diagnostics n = row_count;
  assert n=0, 'Other users cannot delete links';
  begin
    insert into public.profile_social_links(user_id,platform,url) values(owner_id,'x','https://x.com/hijack');
    raise exception 'Other users cannot add links to a profile';
  exception when insufficient_privilege then null;
  end;
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(viewer_id,owner_id,'sns_test');
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=0, 'Profile block rules also hide SNS links';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=4, 'Links are explicitly public for anonymous profile visitors';
  begin
    insert into public.profile_social_links(user_id,platform,url) values(owner_id,'x','https://x.com/hijack');
    raise exception 'Anonymous users cannot write';
  exception when insufficient_privilege then null;
  end;
  reset role;
  delete from public.profiles where id=owner_id;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=0, 'Deleting a profile cascades SNS links';
end;
$flow$;
$test$, 'SNS links: CRUD, five platforms, URL checks, ownership, block visibility, public reads and deletion');
select * from finish();
rollback;
