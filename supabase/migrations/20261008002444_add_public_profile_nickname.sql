-- #804: optional public display name, separate from the stable username.
-- No backfill, uniqueness rule, length/character policy, or signup requirement.
begin;

alter table public.profiles add column nickname text;

comment on column public.profiles.nickname is
  'Optional public display name. NULL means unset. Not an identifier; username and profile URLs remain unchanged. Read through existing profile RLS.';

-- Existing table SELECT grants expose this field only on rows allowed by RLS.
-- Editing is a profile UPDATE after profile creation: reuse profiles_self_update
-- and reject_suspended_profile_update instead of adding a privileged write RPC.
-- No new INSERT grant: signup keeps its existing column allowlist.
grant update (nickname) on public.profiles to authenticated;

commit;
