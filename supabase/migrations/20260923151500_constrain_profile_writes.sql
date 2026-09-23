-- Security QA #225 item 8: constrain public profile text/image values and
-- narrow authenticated writes to the columns the app intentionally owns.

-- Public profile images must never be arbitrary remote tracking URLs. Existing
-- values outside OnePick-owned Storage are removed instead of being grandfathered.
update public.profiles
set profile_image_url=null
where profile_image_url is not null
  and not (
    profile_image_url ~ (
      '^https://ygoipwzakzdnkaaxyrgb\\.supabase\\.co/storage/v1/object/public/profile-images/'
      || id::text
      || '/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
    )
    and position('/../' in profile_image_url)=0
    and position('/./' in profile_image_url)=0
  );

alter table public.profiles
  drop constraint if exists profiles_bio_length,
  add constraint profiles_bio_length
    check (bio is null or char_length(bio)<=100)
    not valid;

alter table public.profiles
  drop constraint if exists profiles_image_own_storage,
  add constraint profiles_image_own_storage
    check (
      profile_image_url is null
      or (
        char_length(profile_image_url)<=320
        and profile_image_url ~ (
          '^https://ygoipwzakzdnkaaxyrgb\\.supabase\\.co/storage/v1/object/public/profile-images/'
          || id::text
          || '/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$'
        )
        and position('/../' in profile_image_url)=0
        and position('/./' in profile_image_url)=0
      )
    );

-- Keep historic >100-character bios intact, matching the existing product rule.
-- NOT VALID still enforces the check for every new or updated row.
comment on constraint profiles_bio_length on public.profiles is
  'New/updated bios are limited to 100 characters; historic longer bios are not rewritten.';
comment on constraint profiles_image_own_storage on public.profiles is
  'Profile images must be null or an HTTPS public profile-images object under the same user UUID.';

revoke insert, update on public.profiles from authenticated;
grant insert (id,username,profile_image_url,bio,onboarding_completed)
  on public.profiles to authenticated;
grant update (username,profile_image_url,bio,onboarding_completed)
  on public.profiles to authenticated;
