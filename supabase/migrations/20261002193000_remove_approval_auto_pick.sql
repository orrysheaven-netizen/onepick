-- #674: pending item approval/merge must not create a new Pick from legacy intent.
--
-- Current register_item_pick already creates a needs_review Pick before review.
-- That existing Pick may still be activated/moved on review. The deprecated
-- pending_item_picks intent is only cleaned up; it never creates a Pick.
-- Approval/merge rows are not kept in the user inbox. Rejection/fix-needed
-- notifications are still created by admin_review_pending_item.
--
-- Production apply remains a separate user approval gate.

begin;

create or replace function private.notify_requester_on_item_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target public.items%rowtype;
  v_channel text;
  v_waiting public.picks%rowtype;
  v_slot public.picks%rowtype;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return new;
  end if;

  -- Legacy request review/intents are no longer converted into Picks.
  delete from public.pending_item_picks where item_id = new.id;

  if new.created_by is null then
    return new;
  end if;

  if new.status = 'active' then
    v_target := new;
  elsif new.status = 'merged' and new.merged_into_item_id is not null then
    select * into v_target
    from public.items
    where id = new.merged_into_item_id
    for update;
  else
    -- Rejections are handled by admin_review_pending_item, which stores only
    -- the 수정 필요 reason. Existing needs_review Picks stay untouched.
    return new;
  end if;

  -- Approval/merge is not a user notification event in the current MVP.
  -- Remove an older fix-needed/review row after the request is resolved.
  delete from public.item_review_notifications
  where item_id = new.id
    and recipient_id = new.created_by;

  perform pg_advisory_xact_lock(
    hashtextextended(new.created_by::text||':'||v_target.category_id::text,0)
  );

  -- Modern flow: register_item_pick already saved the member's Pick as
  -- needs_review. Review may publish/move that existing Pick, but never creates
  -- a new Pick from pending_item_picks.
  for v_waiting in
    select * from public.picks
    where item_id = new.id
      and status = 'needs_review'
    for update
  loop
    if new.status = 'active' then
      update public.picks
      set status = 'active',
          updated_at = now()
      where id = v_waiting.id;
      continue;
    end if;

    -- Merged: if the member already holds the target, end the waiting Pick
    -- against that already-current target.
    if exists (
      select 1
      from public.picks q
      where q.user_id = v_waiting.user_id
        and q.item_id = v_target.id
        and q.status in ('active','needs_review')
    ) then
      update public.picks
      set status = 'replaced',
          ended_at = now(),
          updated_at = now(),
          replaced_by_pick_id = (
            select q.id
            from public.picks q
            where q.user_id = v_waiting.user_id
              and q.item_id = v_target.id
              and q.status in ('active','needs_review')
            limit 1
          )
      where id = v_waiting.id;
      continue;
    end if;

    begin
      v_channel := private.resolve_pick_channel(
        v_target.category_id,
        v_target.id,
        v_waiting.channel
      );
    exception when others then
      v_channel := private.resolve_pick_channel(
        v_target.category_id,
        v_target.id,
        null
      );
    end;

    if v_target.category_id <> v_waiting.category_id
       or v_channel is distinct from v_waiting.channel then
      select * into v_slot
      from public.picks
      where user_id = v_waiting.user_id
        and category_id = v_target.category_id
        and channel is not distinct from v_channel
        and status in ('active','needs_review')
        and id <> v_waiting.id
      for update;

      if found then
        update public.picks
        set status = 'replaced',
            ended_at = now(),
            replaced_by_pick_id = v_waiting.id,
            updated_at = now()
        where id = v_slot.id;
      end if;
    end if;

    update public.picks
    set item_id = v_target.id,
        category_id = v_target.category_id,
        channel = v_channel,
        status = 'active',
        updated_at = now()
    where id = v_waiting.id;
  end loop;

  return new;
end;
$function$;

revoke all on function private.notify_requester_on_item_review()
  from public, anon, authenticated;

comment on function private.notify_requester_on_item_review() is
  'Resolves existing needs_review Picks when a pending item is approved/merged. Legacy pending_item_picks intents are discarded and never create a Pick; approval/merge creates no inbox event.';

comment on table public.pending_item_picks is
  'Legacy private request review/intents retained for compatibility. Resolution deletes the intent and never creates a Pick; members choose approved items directly unless a needs_review Pick already exists from register_item_pick.';

commit;
