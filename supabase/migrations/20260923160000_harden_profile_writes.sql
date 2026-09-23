-- Harden public profile writes. Profile photos are not currently implemented:
-- the project has no dedicated profile image bucket and the live dev DB has no
-- non-null profile_image_url values. Keep the dormant column null until a
-- dedicated owned-storage flow is introduced.

alter table public.profiles
  add constraint profiles_bio_length
    check (bio is null or char_length(btrim(bio)) <= 160),
  add constraint profiles_profile_image_disabled
    check (profile_image_url is null);

revoke insert, update on public.profiles from authenticated;

grant insert (id, username, bio, onboarding_completed)
  on public.profiles to authenticated;
grant update (username, bio, onboarding_completed)
  on public.profiles to authenticated;

-- Server-owned timestamps remain writable only by privileged roles/triggers.
grant all on public.profiles to service_role;
