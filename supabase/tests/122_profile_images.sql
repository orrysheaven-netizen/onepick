begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'profile-images'),
  row(true, 1048576::bigint, array['image/jpeg']::text[])::text,
  'profile-images is a public 1 MiB JPEG-only bucket'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'profile_image_url', 'UPDATE'),
  'profile_image_url stays outside the authenticated UPDATE grant (RPC only)'
);

select ok(
  not has_function_privilege('anon', 'public.set_profile_image(text)', 'EXECUTE'),
  'anon cannot set a profile photo'
);

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  me uuid := 'f1220000-0000-4000-8000-000000000001';
  other uuid := 'f1220000-0000-4000-8000-000000000002';
  mine text := 'f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
  missing text := 'f1220000-0000-4000-8000-000000000001/1c7f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
  theirs text := 'f1220000-0000-4000-8000-000000000002/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
  failed boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[me,other]) id;
  insert into public.profiles(id,username,onboarding_completed)
    values (me,'pi_me',true),(other,'pi_other',true);
  insert into storage.objects(bucket_id,name,owner_id)
    values ('profile-images',mine,me::text),('profile-images',theirs,other::text);

  -- A remote URL can never be stored, even by a privileged writer.
  failed := false;
  begin
    update public.profiles set profile_image_url='https://tracker.example/pixel.jpg' where id=me;
  exception when check_violation then failed := true;
  end;
  assert failed, 'remote URLs violate profiles_image_own_storage';

  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',me::text,true);
  set local role authenticated;

  assert public.set_profile_image(mine) = mine, 'own uploaded photo is accepted';
  assert (select profile_image_url from public.profiles where id=me) = mine, 'profile points at the photo path';

  failed := false;
  begin perform public.set_profile_image(theirs);
  exception when raise_exception then failed := sqlerrm = 'PROFILE_IMAGE_INVALID';
  end;
  assert failed, 'another user''s folder is rejected';

  failed := false;
  begin perform public.set_profile_image(missing);
  exception when raise_exception then failed := sqlerrm = 'PROFILE_IMAGE_NOT_FOUND';
  end;
  assert failed, 'a path that was never uploaded is rejected';

  failed := false;
  begin perform public.set_profile_image('https://tracker.example/pixel.jpg');
  exception when raise_exception then failed := sqlerrm = 'PROFILE_IMAGE_INVALID';
  end;
  assert failed, 'URLs are rejected by the RPC';

  failed := false;
  begin update public.profiles set profile_image_url=null where id=me;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'direct column writes are denied';

  assert public.set_profile_image(null) is null, 'null clears the photo';
  assert (select profile_image_url from public.profiles where id=me) is null, 'profile photo cleared';
  reset role;
end;
$flow$;
$test$, 'set_profile_image accepts only the caller''s own uploaded JPEG path and can clear it');


select ok(
  not has_function_privilege('anon', 'private.can_upload_profile_image(text,text,text)', 'EXECUTE')
  and (select provolatile = 'v' from pg_proc
       where oid='private.can_upload_profile_image(text,text,text)'::regprocedure),
  'quota helper is private to authenticated uploads and uses fresh snapshots'
);

select lives_ok($test$
do $flow$
#variable_conflict use_variable
declare
  me uuid := 'f1220000-0000-4000-8000-000000000003';
  other uuid := 'f1220000-0000-4000-8000-000000000004';
  candidate text;
  failed boolean;
begin
  insert into auth.users(id,aud,role,created_at,updated_at)
    select id,'authenticated','authenticated',now(),now() from unnest(array[me,other]) id;
  insert into public.profiles(id,username,onboarding_completed)
    values (me,'pi_quota',true),(other,'pi_quota_other',true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  perform set_config('request.jwt.claim.sub',me::text,true);
  set local role authenticated;

  foreach candidate in array array[
    me::text || '/not-a-uuid.jpg',
    me::text || '/nested/00000000-0000-4000-8000-000000000001.jpg',
    me::text || '/00000000-0000-4000-8000-000000000001.png',
    other::text || '/00000000-0000-4000-8000-000000000001.jpg'
  ] loop
    failed := false;
    begin
      insert into storage.objects(bucket_id,name,owner_id)
        values ('profile-images',candidate,me::text);
    exception when insufficient_privilege then failed := true;
    end;
    assert failed, 'malformed paths, subfolders and other user folders are denied';
  end loop;

  failed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id)
      values ('profile-images',me::text || '/00000000-0000-4000-8000-000000000001.jpg',other::text);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the object owner must match the caller';

  -- One INSERT statement tests visibility of earlier rows within that statement.
  insert into storage.objects(bucket_id,name,owner_id)
    select 'profile-images',
      me::text || '/00000000-0000-4000-8000-' || lpad(n::text,12,'0') || '.jpg',
      me::text
    from generate_series(1,20) n;
  assert (select count(*) from storage.objects
          where bucket_id='profile-images' and owner_id=me::text)=20,
    'twenty retained objects are admitted, including orphan uploads';

  failed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id)
      values ('profile-images',me::text || '/00000000-0000-4000-8000-000000000021.jpg',me::text);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'twenty-first retained object is denied';

  -- Hitting the limit does not prevent setting or clearing an existing photo.
  candidate := me::text || '/00000000-0000-4000-8000-000000000001.jpg';
  assert public.set_profile_image(candidate)=candidate, 'existing image can still be selected at quota';
  assert public.set_profile_image(null) is null, 'image can still be cleared at quota';

  perform set_config('request.jwt.claim.sub',other::text,true);
  failed := false;
  begin
    insert into storage.objects(bucket_id,name,owner_id)
      select 'profile-images',
        other::text || '/00000000-0000-4000-8000-' || lpad(n::text,12,'0') || '.jpg',
        other::text
      from generate_series(1,21) n;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a single bulk INSERT cannot bypass the cap';
  assert (select count(*) from storage.objects
          where bucket_id='profile-images' and owner_id=other::text)=0,
    'the over-quota statement rolls back every row';
  insert into storage.objects(bucket_id,name,owner_id)
    values ('profile-images',other::text || '/00000000-0000-4000-8000-000000000001.jpg',other::text);
  assert (select count(*) from storage.objects
          where bucket_id='profile-images' and owner_id=other::text)=1,
    'quota is per user';
  reset role;
end;
$flow$;
$test$, 'profile upload RLS enforces UUID ownership and the retained-object cap');

select * from finish();
rollback;
