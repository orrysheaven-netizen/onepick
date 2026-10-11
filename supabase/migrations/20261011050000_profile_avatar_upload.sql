-- Profile photo upload (user decision 2026-10-11, #762 home author row).
--
-- Replaces the dormant `profiles_profile_image_disabled` guard from
-- 20260923151500_constrain_profile_writes.sql with the owned-storage-only rule
-- that migration anticipated:
--
-- - Photos live in a dedicated public bucket, `profile-avatars`, under
--   `<user id>/<name>.jpg`. Only the owner can upload into their own folder,
--   suspended members cannot upload, and each member holds at most a few objects.
-- - `profiles.profile_image_url` stores that object path (not a remote URL).
--   A check constraint pins the shape to the row's own folder, and a trigger
--   requires the object to exist and belong to the same user before the path is
--   stored, so no arbitrary/tracking URL can enter the field on any write path.
-- - The owner may delete only objects their profile no longer points at.
-- - No new RPC, no signup change: editing reuses profiles_self_update RLS and the
--   reject_suspended_profile_update trigger. Existing public profile RPCs already
--   return profile_image_url; the app turns the path into the public URL.

begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-avatars','profile-avatars',true,524288,array['image/jpeg'])
on conflict (id) do update
  set public=excluded.public,
      file_size_limit=excluded.file_size_limit,
      allowed_mime_types=excluded.allowed_mime_types;

-- Every row is NULL today (enforced by the dormant constraint), so the new check validates.
alter table public.profiles
  drop constraint if exists profiles_profile_image_disabled,
  drop constraint if exists profiles_profile_image_own_avatar,
  add constraint profiles_profile_image_own_avatar check (
    profile_image_url is null
    or (
      profile_image_url ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.jpg$'
      and split_part(profile_image_url,'/',1)=id::text
    )
  );

comment on constraint profiles_profile_image_own_avatar on public.profiles is
  'profile_image_url is NULL or a path in the owner''s own profile-avatars folder; never a remote URL.';
comment on column public.profiles.profile_image_url is
  'NULL or the profile-avatars object path <user id>/<name>.jpg. Clients build the public URL from the path.';

create or replace function private.guard_profile_avatar_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Shape is the check constraint's job (23514); this only proves the object exists.
  if new.profile_image_url is not null
    and (tg_op='INSERT' or new.profile_image_url is distinct from old.profile_image_url)
    and new.profile_image_url ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.jpg$'
    and split_part(new.profile_image_url,'/',1)=new.id::text
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id='profile-avatars'
        and o.name=new.profile_image_url
        and o.owner_id=new.id::text
    )
  then
    raise exception 'PROFILE_AVATAR_NOT_FOUND' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_avatar_path() from public, anon, authenticated;

drop trigger if exists profiles_guard_avatar_path on public.profiles;
create trigger profiles_guard_avatar_path
before insert or update of profile_image_url on public.profiles
for each row execute function private.guard_profile_avatar_path();

-- Upload gate: own folder, .jpg, not suspended, and a small per-member cap so a
-- member cannot use the public bucket as free storage (one current + a few in flight).
create or replace function private.can_upload_profile_avatar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}\.jpg$'
    and split_part(p_name,'/',1)=auth.uid()::text
    and not private.is_user_suspended(auth.uid())
    and (
      select count(*) from storage.objects o
      where o.bucket_id='profile-avatars' and o.owner_id=auth.uid()::text
    ) < 3;
$$;
revoke all on function private.can_upload_profile_avatar(text) from public, anon;
grant execute on function private.can_upload_profile_avatar(text) to authenticated;

create or replace function private.is_unused_profile_avatar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where profile_image_url=p_name);
$$;
revoke all on function private.is_unused_profile_avatar(text) from public, anon;
grant execute on function private.is_unused_profile_avatar(text) to authenticated;

drop policy if exists profile_avatars_owner_insert on storage.objects;
create policy profile_avatars_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='profile-avatars'
  and private.can_upload_profile_avatar(name)
);

-- Owners see their own objects (needed by the storage API for removal). Public
-- display goes through the bucket's public URL, not this policy.
drop policy if exists profile_avatars_owner_select on storage.objects;
create policy profile_avatars_owner_select on storage.objects
for select to authenticated
using (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
);

-- A photo the profile still points at cannot be deleted; clear or replace it first.
drop policy if exists profile_avatars_owner_delete on storage.objects;
create policy profile_avatars_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id='profile-avatars'
  and owner_id=(select auth.uid())::text
  and private.is_unused_profile_avatar(name)
);

-- Owner edits only; signup INSERT allowlist stays unchanged.
grant update (profile_image_url) on public.profiles to authenticated;

commit;
