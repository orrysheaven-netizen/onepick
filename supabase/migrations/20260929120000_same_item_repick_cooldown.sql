-- 같은 가게(아이템) 재원픽 대기 24시간 (user 2026-09-29).
--
-- A member who ends a Pick — replacing it, removing it, or deleting its review —
-- has to wait 24 hours before picking the same item again. Other items, even in
-- the same category and channel, can be picked right away. The existing hourly
-- change quota (private.limit_pick_change) stays as it is.
--
-- The check runs on every new picks row the member writes themselves, whatever
-- RPC they came through, so a new write path cannot skip it. Rows written by
-- administrators, migrations or seeds (auth.uid() is not the row's owner) and
-- status changes of existing rows (approval activating a needs_review Pick) are
-- not affected. Hidden Picks (moderation) do not start a cooldown.
--
-- Raises PICK_COOLDOWN (P0001) with the time the item becomes available again in
-- DETAIL (ISO 8601), so the app can say when to come back.

begin;

create or replace function private.enforce_same_item_repick_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_last_end timestamptz;
begin
  if v_user is null or new.user_id is distinct from v_user
     or new.status not in ('active', 'needs_review') then
    return new;
  end if;

  select max(p.ended_at) into v_last_end
  from public.picks p
  where p.user_id = new.user_id
    and p.item_id = new.item_id
    and p.status in ('replaced', 'removed')
    and p.ended_at > clock_timestamp() - interval '24 hours';

  if v_last_end is not null then
    raise exception 'PICK_COOLDOWN'
      using errcode = 'P0001',
            detail = to_char((v_last_end + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            hint = 'The same item can be picked again 24 hours after the previous Pick of it ended.';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_same_item_repick_cooldown() from public, anon, authenticated;

drop trigger if exists picks_same_item_repick_cooldown on public.picks;
create trigger picks_same_item_repick_cooldown
before insert on public.picks
for each row execute function private.enforce_same_item_repick_cooldown();

comment on function private.enforce_same_item_repick_cooldown() is
  'A member cannot start a new Pick of an item within 24 hours after their previous Pick of that item ended (replaced/removed). Raises PICK_COOLDOWN with the available-again time in DETAIL.';

commit;
