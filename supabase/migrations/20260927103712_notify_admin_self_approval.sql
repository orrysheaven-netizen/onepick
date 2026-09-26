-- The self-resolution skip (from 20260926230000, kept in 20260927010000) left
-- out the notification whenever the requester changed the item's status. It
-- was meant for a user whose category choice merged the request into an
-- existing product, but it also silenced an administrator approving their own
-- request. Keep the skip for ordinary users only. Otherwise identical to the
-- 20260927010000 definition.

create or replace function private.notify_requester_on_item_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_outcome text;
  v_target public.items%rowtype;
  v_intent public.pending_item_picks%rowtype;
  v_current public.picks%rowtype;
  v_has_current boolean;
  v_pick_id uuid;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return new;
  end if;

  select * into v_intent from public.pending_item_picks where item_id = new.id;
  if found then
    delete from public.pending_item_picks where item_id = new.id;
  end if;

  if new.created_by is null then
    return new;
  end if;
  if new.status = 'active' then
    v_outcome := 'approved';
    v_target := new;
  elsif new.status = 'merged' and new.merged_into_item_id is not null then
    v_outcome := 'merged';
    select * into v_target from public.items where id = new.merged_into_item_id;
  else
    -- Rejections are sent by admin_review_pending_item, which has the reason.
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.created_by::text||':'||v_target.category_id::text,0)
  );
  select * into v_current
  from public.picks
  where user_id = new.created_by
    and category_id = v_target.category_id
    and status in ('active','needs_review')
  for update;
  v_has_current := found;

  if v_has_current and v_current.item_id = v_target.id then
    return new;
  end if;

  if v_intent.item_id is not null then
    if (v_has_current and v_current.started_at > v_intent.created_at)
       or private.is_user_suspended(new.created_by) then
      return new;
    end if;

    v_pick_id := gen_random_uuid();
    if v_has_current then
      update public.picks
      set status='replaced', ended_at=now(), replaced_by_pick_id=v_pick_id, updated_at=now()
      where id = v_current.id;
    end if;
    insert into public.picks(id,user_id,category_id,item_id,one_line_review,status,started_at)
    values (v_pick_id,new.created_by,v_target.category_id,v_target.id,v_intent.one_line_review,'needs_review',now());
    update public.picks set status='active' where id = v_pick_id;
  end if;

  -- The requester resolved it themselves (choosing a category that matched an
  -- existing product) and sees the result on screen already. An administrator
  -- approving their own request still gets the notification.
  if new.created_by = (select auth.uid()) and not private.is_admin(new.created_by) then
    return new;
  end if;

  -- A request resolved again with a different result (rejected, reopened, then
  -- approved) replaces its earlier notification and is unread again.
  insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, pick_id)
  values (new.id, new.created_by, v_outcome, v_target.id, v_pick_id)
  on conflict (item_id, recipient_id) do update
    set outcome = excluded.outcome,
        target_item_id = excluded.target_item_id,
        pick_id = excluded.pick_id,
        reason = null,
        created_at = now(),
        read_at = null
    where public.item_review_notifications.outcome is distinct from excluded.outcome;
  return new;
end;
$$;
revoke all on function private.notify_requester_on_item_review() from public, anon, authenticated;
