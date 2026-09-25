-- Claude post-review follow-up for Security QA #289 item 6.
-- Use a username-impossible sentinel for future hidden block snapshots.
-- Existing 'private_user' rows are intentionally not backfilled because they
-- cannot be distinguished safely from a legitimate historical username.

begin;

create or replace function private.prepare_user_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_hidden boolean;
begin
  if new.blocker_user_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if new.blocker_user_id = new.blocked_user_id then
    raise exception 'BLOCK_SELF';
  end if;

  select
    p.username,
    private.is_user_suspended(p.id)
      or private.users_blocked(new.blocker_user_id, p.id)
  into v_username, v_hidden
  from public.profiles p
  where p.id = new.blocked_user_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  new.blocked_username_snapshot := case
    when coalesce(v_hidden, true) then 'private-user'
    else v_username
  end;

  return new;
end;
$$;

revoke all on function private.prepare_user_block()
  from public, anon, authenticated;

commit;
