-- Profile photos (user decision 10-05): an owned-storage avatar flow replacing
-- the dormant `profiles_profile_image_disabled` guard from 20260923151500.
--
-- * Bucket `profile-images`: public read, JPEG only, 1 MiB, one folder per user.
-- * profiles.profile_image_url now holds a storage *path* inside that bucket
--   (`<user id>/<uuid>.jpg`), never a remote URL, so a profile can never point
--   viewers at a tracking/remote image. The app turns the path into the public URL.
-- * Writes go through public.set_profile_image(p_path) only; the column stays
--   outside the authenticated UPDATE grant.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-images','profile-images',true,1048576,array['image/jpeg'])
on conflict (id) do update
  set public=excluded.public,
      file_size_limit=excluded.file_size_limit,
      allowed_mime_types=excluded.allowed_mime_types;

-- Includes current, previous and orphan uploads. VOLATILE gives each query a
-- fresh READ COMMITTED snapshot after the per-user transaction lock is acquired.
-- Call directly from RLS, never through a SELECT init-plan: multi-row INSERTs
-- must count preceding rows in the same statement.
create or replace function private.can_upload_profile_image(
  p_bucket text, p_name text, p_owner text
)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $quota$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null
     or p_bucket is distinct from 'profile-images'
     or p_owner is distinct from v_user::text
     or p_name is null
     or p_name !~ ('^' || v_user::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
     or current_setting('transaction_isolation') <> 'read committed'
     or private.is_user_suspended(v_user)
     or not exists (select 1 from public.profiles where id=v_user) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('onepick:profile-images:' || v_user::text, 0)
  );
  -- A separate query after the lock observes the preceding uploader's commit.
  select count(*) into v_count
  from (
    select 1 from storage.objects o
    where o.bucket_id='profile-images'
      and o.name like v_user::text || '/%'
    limit 20
  ) retained;
  return v_count < 20;
end;
$quota$;

revoke all on function private.can_upload_profile_image(text,text,text) from public, anon;
grant execute on function private.can_upload_profile_image(text,text,text) to authenticated;

drop policy if exists profile_images_own_insert on storage.objects;
create policy profile_images_own_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='profile-images'
  and private.can_upload_profile_image(bucket_id,name,owner_id)
);

drop policy if exists profile_images_own_select on storage.objects;
create policy profile_images_own_select
on storage.objects for select to authenticated
using (
  bucket_id='profile-images'
  and owner_id=(select auth.uid()::text)
);

-- Serialize DELETE with profile selection. A previously listed cleanup
-- candidate may have become current on another device before Storage removes it.
create or replace function private.can_delete_profile_image(
  p_bucket text, p_name text, p_owner text
)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $delete_guard$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_bucket is distinct from 'profile-images'
     or p_owner is distinct from v_user::text
     or p_name is null or p_name not like v_user::text || '/%'
     or current_setting('transaction_isolation') <> 'read committed' then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('onepick:profile-images:' || v_user::text, 0)
  );
  return not exists (
    select 1 from public.profiles p where p.id=v_user and p.profile_image_url=p_name
  );
end;
$delete_guard$;
revoke all on function private.can_delete_profile_image(text,text,text) from public, anon;
grant execute on function private.can_delete_profile_image(text,text,text) to authenticated;

-- Old photos are removed by their owner after a replacement; the current one
-- cannot be deleted while the profile still points at it.
drop policy if exists profile_images_unused_delete on storage.objects;
create policy profile_images_unused_delete
on storage.objects for delete to authenticated
using (
  bucket_id='profile-images'
  and private.can_delete_profile_image(bucket_id,name,owner_id)
);

alter table public.profiles
  drop constraint if exists profiles_profile_image_disabled,
  drop constraint if exists profiles_image_own_storage,
  add constraint profiles_image_own_storage
    check (
      profile_image_url is null
      or profile_image_url ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
    );

comment on constraint profiles_image_own_storage on public.profiles is
  'profile_image_url is null or a path in the owner''s own profile-images folder (<id>/<uuid>.jpg); never a remote URL.';

create or replace function public.set_profile_image(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'PROFILE_IMAGE_RETRY' using errcode='40001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('onepick:profile-images:' || v_user::text, 0)
  );
  if v_path is not null then
    if v_path !~ ('^' || v_user::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
      raise exception 'PROFILE_IMAGE_INVALID' using errcode='P0001';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id='profile-images' and o.name=v_path and o.owner_id=v_user::text
    ) then
      raise exception 'PROFILE_IMAGE_NOT_FOUND' using errcode='P0001';
    end if;
  end if;
  -- reject_suspended_profile_update still applies to this UPDATE.
  update public.profiles set profile_image_url=v_path, updated_at=now() where id=v_user;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0001'; end if;
  return v_path;
end;
$$;

-- Profile edits require a signed-in actor; service-role maintenance uses its own path.
revoke all on function public.set_profile_image(text) from public, anon, service_role;
grant execute on function public.set_profile_image(text) to authenticated;

comment on function public.set_profile_image(text) is
  'Sets (path) or clears (null) the caller''s profile photo; the path must be the caller''s own uploaded profile-images object.';
