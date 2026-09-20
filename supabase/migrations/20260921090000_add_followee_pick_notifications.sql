-- Second slice of docs/follow.md: "지민 님이 헤드폰 원픽을 바꿨어요".
-- Same rules as comment_notifications: a reference row only, no text copies,
-- and the read policy re-checks visibility so later blocks/suspensions hide it.

-- Opt-out preference. No row means the default (on). Own row only.
create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  followee_pick_change boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
create policy notification_preferences_own_read on public.notification_preferences
for select to authenticated using (user_id = (select auth.uid()));
create policy notification_preferences_own_insert on public.notification_preferences
for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_preferences_own_update on public.notification_preferences
for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.pick_change_notifications (
  pick_id uuid not null references public.picks(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (pick_id, recipient_id)
);
create index pick_change_notifications_recipient_created_idx
  on public.pick_change_notifications(recipient_id, created_at desc, pick_id desc);
create index pick_change_notifications_unread_idx
  on public.pick_change_notifications(recipient_id) where read_at is null;
alter table public.pick_change_notifications enable row level security;
revoke all on public.pick_change_notifications from public, anon, authenticated;
grant select on public.pick_change_notifications to authenticated;
grant update(read_at) on public.pick_change_notifications to authenticated;
comment on table public.pick_change_notifications is
  'Inbox references for followers when a followed person''s current pick changes. No copies of pick text.';

-- Visible while the pick is still the author''s current one and the two people
-- can still see each other. One-line-review text is read live at query time.
create policy pick_change_notifications_read_own on public.pick_change_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.picks p
    where p.id = pick_id and p.status = 'active' and p.user_id <> recipient_id
      and not private.users_blocked((select auth.uid()), p.user_id)
      and not private.user_is_suspended(p.user_id)
  )
);
create policy pick_change_notifications_mark_read_own on public.pick_change_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

-- Fan out to followers when a pick becomes the author''s current choice:
-- a fresh insert by the author, or a status change into 'active' (for example
-- approval of a pending item). Editing the one-line review keeps status and
-- therefore does not notify. Bounded so one popular account cannot turn a
-- single pick into an unbounded write.
create function private.notify_followers_on_pick_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;
  insert into public.pick_change_notifications(pick_id, recipient_id)
  select new.id, f.follower_id
  from public.user_follows f
  left join public.notification_preferences np on np.user_id = f.follower_id
  where f.followee_id = new.user_id
    and coalesce(np.followee_pick_change, true)
    and not private.users_blocked(f.follower_id, new.user_id)
    and not private.user_is_suspended(f.follower_id)
  order by f.created_at
  limit 1000
  on conflict (pick_id, recipient_id) do nothing;
  return new;
end;
$$;
revoke all on function private.notify_followers_on_pick_change() from public, anon, authenticated;
create trigger picks_notify_followers
after insert or update of status on public.picks
for each row execute function private.notify_followers_on_pick_change();

-- One inbox for both kinds. Comment RPCs stay for older clients.
create function public.notification_count()
returns bigint language sql stable security invoker set search_path = ''
as $$
  select (
    select count(*) from public.comment_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  ) + (
    select count(*) from public.pick_change_notifications
    where recipient_id = (select auth.uid()) and read_at is null
  );
$$;

create function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
returns table(kind text, id uuid, pick_id uuid, username text, body text, item_name text, created_at timestamptz, read_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'comment'::text, n.comment_id, c.pick_id, pr.username, c.body, i.name, n.created_at, n.read_at
    from public.comment_notifications n
    join public.comments c on c.id = n.comment_id
    join public.picks p on p.id = c.pick_id
    join public.profiles pr on pr.id = c.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'pick_change'::text, n.pick_id, n.pick_id, pr.username, p.one_line_review, i.name, n.created_at, n.read_at
    from public.pick_change_notifications n
    join public.picks p on p.id = n.pick_id
    join public.profiles pr on pr.id = p.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
revoke all on function public.notification_count() from public, anon;
revoke all on function public.notification_page(timestamptz, uuid) from public, anon;
grant execute on function public.notification_count() to authenticated;
grant execute on function public.notification_page(timestamptz, uuid) to authenticated;
comment on function public.notification_page(timestamptz, uuid) is
  'Own inbox: comments on my picks and pick changes by people I follow, newest first, caller RLS, 20 + lookahead.';
