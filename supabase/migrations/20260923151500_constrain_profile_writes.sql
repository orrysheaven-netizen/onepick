-- Security QA #225 item 8: constrain public profile text/image values and
-- narrow authenticated writes to the columns the app intentionally owns.

-- Profile-photo upload is not implemented yet and there is no dedicated owned
-- avatar bucket. Keep this dormant public field null instead of accepting
-- arbitrary remote/tracking URLs. A future avatar feature can replace this with
-- an owned-storage-only constraint in its own migration.
update public.profiles
set profile_image_url=null
where profile_image_url is not null;

alter table public.profiles
  drop constraint if exists profiles_bio_length,
  add constraint profiles_bio_length
    check (bio is null or char_length(bio)<=100)
    not valid;

alter table public.profiles
  drop constraint if exists profiles_image_own_storage,
  drop constraint if exists profiles_profile_image_disabled,
  add constraint profiles_profile_image_disabled
    check (profile_image_url is null);

-- Keep historic >100-character bios intact. NOT VALID still enforces this check
-- for new/updated rows, so the next profile edit must bring an old long bio back
-- within the product's existing 100-character rule.
comment on constraint profiles_bio_length on public.profiles is
  'New/updated bios are limited to the existing 100-character product rule; historic longer bios are not rewritten.';
comment on constraint profiles_profile_image_disabled on public.profiles is
  'Dormant public profile image field remains null until OnePick ships an owned-storage avatar flow.';

revoke insert, update on public.profiles from authenticated;
grant insert (id,username,bio,onboarding_completed)
  on public.profiles to authenticated;
grant update (username,bio,onboarding_completed)
  on public.profiles to authenticated;
