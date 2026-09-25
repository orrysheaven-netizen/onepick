-- Security QA #289 item 6: do not expose hidden target usernames through
-- the SECURITY DEFINER user-block preparation trigger.

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

  -- The profile read policy hides suspended users and users on either side of
  -- an existing block. The definer trigger must not turn a known UUID into a
  -- username side channel for those hidden targets.
  new.blocked_username_snapshot := case
    when coalesce(v_hidden, true) then 'private_user'
    else v_username
  end;

  return new;
end;
$$;

revoke all on function private.prepare_user_block()
  from public, anon, authenticated;

commit;
