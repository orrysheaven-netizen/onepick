begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid(); viewer_id uuid := gen_random_uuid(); n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,viewer_id]) id;
  insert into public.profiles(id,username,onboarding_completed)
    select id,'sns_'||substr(replace(id::text,'-',''),1,12),true from unnest(array[owner_id,viewer_id]) id;
  insert into public.profile_social_links(user_id,platform,url) values(owner_id,'x','https://x.com/hello');
  insert into private.user_moderation(user_id,reason) values(owner_id,'Synthetic suspension test');
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  set local role authenticated;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=0, 'Suspended profile links are hidden from other users';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=0, 'Suspended profile links are hidden from anonymous visitors';
  reset role;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  select count(*) into n from public.profile_social_links where user_id=owner_id;
  assert n=1, 'Suspended owners can still review their own links';
  update public.profile_social_links set url='https://x.com/updated' where user_id=owner_id;
  get diagnostics n = row_count;
  assert n=0, 'Suspended owners cannot update links';
  begin
    insert into public.profile_social_links(user_id,platform,url) values(owner_id,'instagram','https://www.instagram.com/hello');
    raise exception 'Suspended owners cannot add links';
  exception when insufficient_privilege then null;
  end;
  delete from public.profile_social_links where user_id=owner_id;
  get diagnostics n = row_count;
  assert n=1, 'Suspended owners retain the ability to remove their links';
  reset role;
end;
$flow$;
$test$, 'SNS suspension: public visibility, write denial and owner removal');
select * from finish();
rollback;
