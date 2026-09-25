-- #343: the hidden-target snapshot from #329 was 'private_user', which is a
-- valid username (^[a-z0-9_]{3,20}$). Use a sentinel no profile can hold so a
-- hidden target never looks like a real @private_user and vice versa.

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
  -- username side channel for those hidden targets. '(private)' cannot match
  -- profiles_username_format, so it never collides with a real username.
  new.blocked_username_snapshot := case
    when coalesce(v_hidden, true) then '(private)'
    else v_username
  end;

  return new;
end;
$$;

revoke all on function private.prepare_user_block()
  from public, anon, authenticated;

-- Move existing hidden-target rows to the new sentinel. A row whose target
-- really is @private_user keeps its snapshot only when that target was visible
-- to the blocker (not suspended, no reverse block); otherwise it is the
-- sentinel too, so a hidden @private_user stays indistinguishable.
update public.user_blocks b
set blocked_username_snapshot = '(private)'
from public.profiles p
where b.blocked_username_snapshot = 'private_user'
  and p.id = b.blocked_user_id
  and (
    p.username <> 'private_user'
    or private.is_user_suspended(p.id)
    or exists (
      select 1 from public.user_blocks r
      where r.blocker_user_id = b.blocked_user_id
        and r.blocked_user_id = b.blocker_user_id
    )
  );

comment on column public.user_blocks.blocked_username_snapshot is
  'Target username at block time, or ''(private)'' when the target was hidden from the blocker (suspended or reverse-blocked).';

commit;
