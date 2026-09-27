-- A product request made from '원픽 등록' only stages a pending item; approval
-- does not create a pick. Tell the requester when their request is approved or
-- merged into an existing product so they can pick it from the inbox.
-- No pick is created automatically: the requester may have picked something
-- else while waiting, and the choice stays theirs.

create table public.item_review_notifications (
  item_id uuid not null references public.items(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('approved','merged')),
  target_item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (item_id, recipient_id)
);
create index item_review_notifications_recipient_created_idx
  on public.item_review_notifications(recipient_id, created_at desc, item_id desc);
create index item_review_notifications_unread_idx
  on public.item_review_notifications(recipient_id) where read_at is null;
create index item_review_notifications_target_idx
  on public.item_review_notifications(target_item_id);
alter table public.item_review_notifications enable row level security;
revoke all on public.item_review_notifications from public, anon, authenticated;
grant select on public.item_review_notifications to authenticated;
grant update(read_at) on public.item_review_notifications to authenticated;
comment on table public.item_review_notifications is
  'Inbox references for requesters when their pending item is approved or merged. Written by trigger only.';

-- Visible while the product to pick is still pickable.
create policy item_review_notifications_read_own on public.item_review_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.items i
    where i.id = target_item_id and i.status in ('active','discontinued')
  )
);
create policy item_review_notifications_mark_read_own on public.item_review_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

-- Fires for every path that resolves a pending item (admin review, admin merge,
-- manual status edits), so the review functions stay unchanged. Skipped when the
-- requester already has the target as their current pick.
create function private.notify_requester_on_item_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_outcome text;
  v_target uuid;
begin
  if old.status <> 'pending' or new.created_by is null then
    return new;
  end if;
  if new.status = 'active' then
    v_outcome := 'approved';
    v_target := new.id;
  elsif new.status = 'merged' and new.merged_into_item_id is not null then
    v_outcome := 'merged';
    v_target := new.merged_into_item_id;
  else
    return new;
  end if;
  if exists (
    select 1 from public.picks p
    where p.user_id = new.created_by and p.item_id = v_target and p.status = 'active'
  ) then
    return new;
  end if;
  insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id)
  values (new.id, new.created_by, v_outcome, v_target)
  on conflict (item_id, recipient_id) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_requester_on_item_review() from public, anon, authenticated;
create trigger items_notify_requester_on_review
after update of status on public.items
for each row execute function private.notify_requester_on_item_review();

-- One inbox for all kinds. item_review rows carry item_id (the product to pick)
-- and outcome; pick_id is null for them. Return shape changes, so recreate.
create or replace function public.notification_count()
returns bigint language sql stable security invoker set search_path = ''
as $$
  select (
    select count(*) from public.comment_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  ) + (
    select count(*) from public.pick_change_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  ) + (
    select count(*) from public.item_review_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  );
$$;

drop function public.notification_page(timestamptz, uuid);
create function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
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
    select 'item_review'::text, n.item_id, null::uuid, null::text, null::text, i.name, n.created_at, n.read_at, n.target_item_id, n.outcome
    from public.item_review_notifications n
    join public.items i on i.id = n.target_item_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at, item_id, outcome)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
revoke all on function public.notification_page(timestamptz, uuid) from public, anon;
grant execute on function public.notification_page(timestamptz, uuid) to authenticated;
comment on function public.notification_page(timestamptz, uuid) is
  'Own inbox: comments on my picks, pick changes by people I follow and reviews of my product requests, newest first, caller RLS, 20 + lookahead.';
