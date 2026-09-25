-- Security QA #289 item 4 (follow-up to 20260926001500): close the write
-- paths that the first pass left open for suspended users.
--
-- * Item rows: submit_unclassified_item, set_pending_item_category_hint and
--   classify_pending_item still let a suspended caller create or edit pending
--   items. Photo columns were already guarded by items_guard_photo_actor; this
--   gate covers every other column with the same MFA-admin exception.
-- * Paid/limited quotas: the AI and image-import reservations are taken for a
--   suspended user as well. analyze-profile-taste and suggest-item-categories
--   reserve through the service role with the user id as an argument, so the
--   gate keys off the row owner rather than auth.uid().

begin;

create or replace function private.reject_suspended_item_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null
     and private.is_user_suspended(v_actor)
     and not private.is_admin_mfa() then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_suspended_item_actor()
  from public, anon, authenticated;

-- Named after items_guard_photo_actor so photo writes keep reporting
-- ACCOUNT_SUSPENDED from the older, more specific guard.
drop trigger if exists items_reject_suspended_actor on public.items;
create trigger items_reject_suspended_actor
before insert or update on public.items
for each row execute function private.reject_suspended_item_actor();

create or replace function private.reject_suspended_quota_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_owner is not null and private.is_user_suspended(v_owner) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_suspended_quota_owner()
  from public, anon, authenticated;

drop trigger if exists reject_suspended_quota_owner on public.profile_ai_generation_limits;
create trigger reject_suspended_quota_owner
before insert or update on public.profile_ai_generation_limits
for each row execute function private.reject_suspended_quota_owner('profile_id');

drop trigger if exists reject_suspended_quota_owner on public.item_category_ai_generation_limits;
create trigger reject_suspended_quota_owner
before insert or update on public.item_category_ai_generation_limits
for each row execute function private.reject_suspended_quota_owner('user_id');

drop trigger if exists reject_suspended_quota_owner on private.image_import_limits;
create trigger reject_suspended_quota_owner
before insert or update on private.image_import_limits
for each row execute function private.reject_suspended_quota_owner('user_id');

commit;
