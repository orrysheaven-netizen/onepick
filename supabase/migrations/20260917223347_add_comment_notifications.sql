-- Durable inbox references only: no copies of deleted/blocked comment text.
create table public.comment_notifications (
  comment_id uuid primary key references public.comments(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index comment_notifications_recipient_created_idx
  on public.comment_notifications(recipient_id, created_at desc, comment_id desc);
create index comment_notifications_unread_idx
  on public.comment_notifications(recipient_id) where read_at is null;
alter table public.comment_notifications enable row level security;
revoke all on public.comment_notifications from public, anon, authenticated;
grant select on public.comment_notifications to authenticated;
grant update(read_at) on public.comment_notifications to authenticated;

create policy comment_notifications_read_own on public.comment_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.comments c join public.picks p on p.id = c.pick_id
    where c.id = comment_id and p.user_id = recipient_id
      and p.status in ('active', 'replaced') and c.user_id <> recipient_id
      and not private.users_blocked((select auth.uid()), c.user_id)
  )
);
create policy comment_notifications_mark_read_own on public.comment_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

-- Privileged only because the commenter cannot insert another user's inbox row.
-- Trigger-only, private schema, no direct caller execution, no text snapshots.
create function private.notify_pick_owner_on_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  insert into public.comment_notifications(comment_id, recipient_id)
  select new.id, p.user_id from public.picks p
  where p.id = new.pick_id and p.status = 'active' and p.user_id <> new.user_id
    and not private.users_blocked(new.user_id, p.user_id)
  on conflict (comment_id) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_pick_owner_on_comment() from public, anon, authenticated;
create trigger comments_notify_owner after insert on public.comments
for each row execute function private.notify_pick_owner_on_comment();

create function public.comment_notification_count(p_recipient_id uuid)
returns bigint language sql stable security invoker set search_path = ''
as $$
  select count(*) from public.comment_notifications
  where recipient_id = (select auth.uid()) and recipient_id = p_recipient_id and read_at is null;
$$;

create function public.comment_notification_page(p_recipient_id uuid, p_before_time timestamptz default null, p_before_id uuid default null)
returns table(comment_id uuid, pick_id uuid, username text, body text, item_name text, created_at timestamptz, read_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select n.comment_id, c.pick_id, pr.username, c.body, i.name, n.created_at, n.read_at
  from public.comment_notifications n
  join public.comments c on c.id = n.comment_id
  join public.picks p on p.id = c.pick_id
  join public.profiles pr on pr.id = c.user_id
  join public.items i on i.id = p.item_id
  where n.recipient_id = (select auth.uid()) and n.recipient_id = p_recipient_id
    and (p_before_time is null or (n.created_at, n.comment_id) < (p_before_time, p_before_id))
  order by n.created_at desc, n.comment_id desc limit 21;
$$;
revoke all on function public.comment_notification_count(uuid) from public, anon;
revoke all on function public.comment_notification_page(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.comment_notification_count(uuid) to authenticated;
grant execute on function public.comment_notification_page(uuid, timestamptz, uuid) to authenticated;
