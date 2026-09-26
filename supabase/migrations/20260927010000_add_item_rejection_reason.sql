-- An admin rejecting a product request must say why, and the requester hears the
-- reason in their inbox. Approval ignores any reason passed.
--
-- Nothing is added to public.items: SQL functions returning public.items with an
-- explicit column list (search_items and others) break when its shape changes.
-- The reason goes on the requester's notification; who reviewed, when and why
-- goes to a private append-only log so admin accounts are not exposed.

begin;

create table private.item_review_log (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  status text not null check (status in ('active','rejected')),
  rejection_reason text,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now()
);
create index item_review_log_item_idx on private.item_review_log(item_id, reviewed_at desc);
revoke all on private.item_review_log from public, anon, authenticated;
comment on table private.item_review_log is
  'Who approved or rejected each pending item and when. Written by admin_review_pending_item only.';

drop function public.admin_review_pending_item(uuid,text,uuid);
drop function private.admin_review_pending_item_impl(uuid,text,uuid);

create function private.admin_review_pending_item_impl(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null,
  p_reject_reason text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_reason text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if p_status='rejected' then
    v_reason := btrim(p_reject_reason);
    if v_reason is null or char_length(v_reason) not between 1 and 500 then
      raise exception 'REJECT_REASON_INVALID' using errcode='P0001';
    end if;

    update public.items
    set status='rejected', merged_into_item_id=null
    where id=v_item.id
    returning * into v_item;

    insert into private.item_review_log(item_id,status,rejection_reason,reviewed_by)
    values (v_item.id,'rejected',v_reason,auth.uid());

    -- The status trigger does not know the reason, so the rejection is sent here.
    if v_item.created_by is not null then
      insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, reason)
      values (v_item.id, v_item.created_by, 'rejected', v_item.id, v_reason)
      on conflict (item_id, recipient_id) do update
        set outcome = excluded.outcome,
            target_item_id = excluded.target_item_id,
            pick_id = null,
            reason = excluded.reason,
            created_at = now(),
            read_at = null;
    end if;
    return v_item;
  end if;

  if p_status<>'active' then
    raise exception 'ITEM_STATUS_INVALID' using errcode='P0001';
  end if;

  select * into v_category
  from public.categories
  where id=coalesce(p_category_id,v_item.category_id);

  if not found
     or v_category.slug='pending-product'
     or not public.category_is_open_leaf(v_category.id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(v_item.name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  if exists (
    select 1 from public.items i
    where i.id<>v_item.id
      and i.category_id=v_category.id
      and i.normalized_name=v_normalized
      and i.status in ('active','discontinued')
  ) then
    raise exception 'ITEM_DUPLICATE' using errcode='P0001';
  end if;

  update public.items
  set category_id=v_category.id,
      name=v_name,
      normalized_name=v_normalized,
      status='active',
      merged_into_item_id=null
  where id=v_item.id
  returning * into v_item;

  insert into private.item_review_log(item_id,status,reviewed_by)
  values (v_item.id,'active',auth.uid());
  return v_item;
end;
$$;

revoke all on function private.admin_review_pending_item_impl(uuid,text,uuid,text)
  from public, anon;
grant execute on function private.admin_review_pending_item_impl(uuid,text,uuid,text)
  to authenticated, service_role;

create function public.admin_review_pending_item(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null,
  p_reject_reason text default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.admin_review_pending_item_impl(p_item_id,p_status,p_category_id,p_reject_reason);
$$;

revoke all on function public.admin_review_pending_item(uuid,text,uuid,text)
  from public, anon;
grant execute on function public.admin_review_pending_item(uuid,text,uuid,text)
  to authenticated, service_role;

-- Rejections now reach the requester too, with the reason. A rejected row points
-- at the request itself (target_item_id = item_id); there is nothing to pick.
alter table public.item_review_notifications
  add column reason text,
  drop constraint item_review_notifications_outcome_check,
  add constraint item_review_notifications_outcome_check
    check (outcome in ('approved','merged','rejected')),
  add constraint item_review_notifications_reason_check
    check ((outcome = 'rejected') = (reason is not null)
      and (reason is null or char_length(reason) between 1 and 500));

-- Rejected requests are never pickable, so they are shown without the target check.
drop policy item_review_notifications_read_own on public.item_review_notifications;
create policy item_review_notifications_read_own on public.item_review_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and (
    outcome = 'rejected'
    or exists (
      select 1 from public.items i
      where i.id = target_item_id and i.status in ('active','discontinued')
    )
  )
);

-- Same as 20260926230000 except: rejections are left to the review endpoint,
-- and a changed result replaces the earlier notification.
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
  -- existing product) and sees the result on screen already.
  if new.created_by = (select auth.uid()) then
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

-- Same as 20260926230000; item_review rows now carry the rejection reason in body.
create or replace function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
returns table(kind text, id uuid, pick_id uuid, username text, body text, item_name text, created_at timestamptz, read_at timestamptz, item_id uuid, outcome text)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'comment'::text, n.comment_id, c.pick_id, pr.username, c.body, i.name, n.created_at, n.read_at, null::uuid, null::text
    from public.comment_notifications n
    join public.comments c on c.id = n.comment_id
    join public.picks p on p.id = c.pick_id
    join public.profiles pr on pr.id = c.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'pick_change'::text, n.pick_id, n.pick_id, pr.username, p.one_line_review, i.name, n.created_at, n.read_at, null::uuid, null::text
    from public.pick_change_notifications n
    join public.picks p on p.id = n.pick_id
    join public.profiles pr on pr.id = p.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'item_review'::text, n.item_id, n.pick_id, null::text, n.reason, i.name, n.created_at, n.read_at, n.target_item_id, n.outcome
    from public.item_review_notifications n
    join public.items i on i.id = n.target_item_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at, item_id, outcome)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
comment on function public.notification_page(timestamptz, uuid) is
  'Own inbox: comments on my picks, pick changes by people I follow and reviews of my product requests (rejections carry the reason in body), newest first, caller RLS, 20 + lookahead.';

commit;
