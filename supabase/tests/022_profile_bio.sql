-- Existing profiles.bio and existing RLS only; no schema or grant changes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
set local plpgsql.check_asserts = on;
select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid(); viewer_id uuid := gen_random_uuid();
  owner_name text := 'bio_' || substr(replace(owner_id::text,'-',''),1,12);
  intro text := E'라면과 영화를 좋아해요.\n취향을 모읍니다.';
  result text; n integer;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[owner_id,viewer_id]) id;
  insert into public.profiles(id,username,onboarding_completed) values
    (owner_id,owner_name,true),(viewer_id,'bio_'||substr(replace(viewer_id::text,'-',''),1,12),true);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  update public.profiles set bio=intro where id=owner_id;
  get diagnostics n = row_count;
  assert n=1, 'Owner can add a bio';
  select p.bio into result from public.profiles p where p.id=owner_id;
  assert result=intro, 'Unicode and newlines round-trip';
  update public.profiles set bio=repeat('가',100) where id=owner_id;
  select char_length(p.bio) into n from public.profiles p where p.id=owner_id;
  assert n=100, 'The UI limit fits the existing field';
  update public.profiles set bio=null where id=owner_id;
  select p.bio into result from public.profiles p where p.id=owner_id;
  assert result is null, 'Owner can clear a bio without deleting the profile';
  update public.profiles set bio=intro where id=owner_id;
  select p.username into result from public.profiles p where p.id=owner_id;
  assert result=owner_name, 'Other profile fields remain unchanged';
  reset role;
  perform set_config('request.jwt.claim.sub',viewer_id::text,true);
  set local role authenticated;
  update public.profiles set bio='Not allowed' where id=owner_id;
  get diagnostics n = row_count;
  assert n=0, 'Another account cannot overwrite a bio';
  select p.bio into result from public.profiles p where p.id=owner_id;
  assert result=intro, 'Public profile visitors see the saved bio';
  insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
    values(viewer_id,owner_id,owner_name);
  select count(*) into n from public.profiles p where p.id=owner_id;
  assert n=0, 'Block rules also protect the bio';
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  set local role anon;
  select p.bio into result from public.profiles p where p.id=owner_id;
  assert result=intro, 'The bio is public to anonymous visitors';
  begin
    update public.profiles set bio='Anonymous edit' where id=owner_id;
    get diagnostics n = row_count;
    assert n=0, 'Anonymous visitors cannot edit';
  exception when insufficient_privilege then null;
  end;
  reset role;
  insert into private.user_moderation(user_id,reason) values(owner_id,'Synthetic bio visibility test');
  set local role anon;
  select count(*) into n from public.profiles p where p.id=owner_id;
  assert n=0, 'Suspended profiles remain hidden';
  reset role;
end;
$flow$;
$test$, 'Existing profile bio supports owner editing, public reading, clearing and existing block/suspension policies');
select * from finish();
rollback;
