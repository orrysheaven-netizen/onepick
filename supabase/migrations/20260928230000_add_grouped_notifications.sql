-- 앱 안 알림: 종류별 그룹, 읽음 스냅샷, 승인 이벤트 제외 (#448 서버 인계 4번,
-- user decisions 2026-09-28).
--
-- Kinds (decision D): 내 원픽 새 한줄평 (pick_review), 내 한줄평 댓글 (comment),
-- 내 댓글 답글 (reply), 수정 필요 (fix_needed), 팔로잉 원픽 (followee_pick).
--   * Groups: product (item + channel) / review / parent comment / request /
--     followee + menu + channel. Each group carries a stable id, the latest
--     actor, distinct actor count, unread and total counts and latest_at, which
--     doubles as the read snapshot.
--   * Own events never notify; a reply notifies only the parent's author
--     (20260928170000); review edits notify nobody (unchanged).
--   * Opening the tab marks nothing. After the destination loads the app calls
--     mark_notification_group_read(group_id, snapshot): rows up to that moment
--     are read, later arrivals stay unread.
--   * Approved / merged / registered results are neither listed nor counted:
--     notification_unread_count only counts what notification_group_page shows,
--     so the badge cannot point at a hidden row.
--
-- The row-level readers notification_page / notification_count stay for the
-- current app and are superseded by the grouped API. No push is sent anywhere.

begin;

-- ---------------------------------------------------------------------------
-- 내 원픽 새 한줄평: someone else now holds the same product
-- ---------------------------------------------------------------------------

create table public.pick_review_notifications (
  pick_id uuid not null references public.picks(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (pick_id, recipient_id)
);
create index pick_review_notifications_recipient_created_idx
  on public.pick_review_notifications(recipient_id, created_at desc, pick_id desc);
create index pick_review_notifications_unread_idx
  on public.pick_review_notifications(recipient_id) where read_at is null;
alter table public.pick_review_notifications enable row level security;
revoke all on public.pick_review_notifications from public, anon, authenticated;
grant select on public.pick_review_notifications to authenticated;
grant update(read_at) on public.pick_review_notifications to authenticated;
grant all on public.pick_review_notifications to service_role;
comment on table public.pick_review_notifications is
  'Inbox references: another member made a product the recipient currently holds their Pick (내 원픽 새 한줄평). Written by trigger only.';

create policy pick_review_notifications_read_own on public.pick_review_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and exists (
    select 1 from public.picks p
    where p.id = pick_id and p.status = 'active' and p.user_id <> recipient_id
      and not private.users_blocked((select auth.uid()), p.user_id)
      and not private.user_is_suspended(p.user_id)
  )
);
create policy pick_review_notifications_mark_read_own on public.pick_review_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

-- Fan out to current holders of the same item in the same channel, like the
-- follower fan-out: a member's own insert, or an activation (approval) later.
create or replace function private.notify_item_holders_on_pick()
returns trigger
language plpgsql
security definer
set search_path = ''
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

  insert into public.pick_review_notifications(pick_id, recipient_id)
  select new.id, h.user_id
  from (
    select distinct p.user_id
    from public.picks p
    where p.item_id = new.item_id
      and p.channel is not distinct from new.channel
      and p.status = 'active'
      and p.user_id <> new.user_id
  ) h
  where not private.users_blocked(h.user_id, new.user_id)
    and not private.user_is_suspended(h.user_id)
  limit 1000
  on conflict (pick_id, recipient_id) do nothing;

  return new;
end;
$$;
revoke all on function private.notify_item_holders_on_pick() from public, anon, authenticated;

create trigger picks_notify_item_holders
after insert or update of status on public.picks
for each row execute function private.notify_item_holders_on_pick();

-- ---------------------------------------------------------------------------
-- Events the viewer may see, one row per notification, with its group
-- ---------------------------------------------------------------------------

create or replace function private.notification_events(p_viewer uuid)
returns table(
  source text, source_id uuid, group_id text, kind text,
  created_at timestamptz, read_at timestamptz,
  actor_id uuid, item_id uuid, category_id uuid, channel text,
  pick_id uuid, comment_id uuid, root_comment_id uuid, target_user_id uuid, reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- 내 한줄평 댓글 / 내 댓글 답글
  select 'comment', n.comment_id,
         case when n.kind = 'reply' then 'reply:' || c.parent_comment_id::text else 'comment:' || c.pick_id::text end,
         case when n.kind = 'reply' then 'reply' else 'comment' end,
         n.created_at, n.read_at,
         c.user_id, p.item_id, p.category_id, p.channel,
         c.pick_id, c.id, coalesce(c.parent_comment_id, c.id), null::uuid, null::text
  from public.comment_notifications n
  join public.comments c on c.id = n.comment_id
  join public.picks p on p.id = c.pick_id
  where n.recipient_id = p_viewer
    and private.comment_notification_visible(n.comment_id, p_viewer)
  union all
  -- 팔로잉 원픽
  select 'pick_change', n.pick_id,
         'follow:' || p.user_id::text || ':' || p.category_id::text || ':' || coalesce(p.channel, ''),
         'followee_pick',
         n.created_at, n.read_at,
         p.user_id, p.item_id, p.category_id, p.channel,
         p.id, null::uuid, null::uuid, p.user_id, null::text
  from public.pick_change_notifications n
  join public.picks p on p.id = n.pick_id
  where n.recipient_id = p_viewer
    and p.status = 'active'
    and p.user_id <> p_viewer
    and not private.users_blocked(p_viewer, p.user_id)
    and not private.user_is_suspended(p.user_id)
  union all
  -- 수정 필요 (approved / merged results are not events)
  select 'item_review', n.item_id,
         'fix:' || n.item_id::text,
         'fix_needed',
         n.created_at, n.read_at,
         null::uuid, n.item_id, i.category_id, null::text,
         n.pick_id, null::uuid, null::uuid, null::uuid, n.reason
  from public.item_review_notifications n
  join public.items i on i.id = n.item_id
  where n.recipient_id = p_viewer
    and n.outcome = 'rejected'
  union all
  -- 내 원픽 새 한줄평
  select 'pick_review', n.pick_id,
         'review:' || p.item_id::text || ':' || coalesce(p.channel, ''),
         'pick_review',
         n.created_at, n.read_at,
         p.user_id, p.item_id, p.category_id, p.channel,
         p.id, null::uuid, null::uuid, null::uuid, null::text
  from public.pick_review_notifications n
  join public.picks p on p.id = n.pick_id
  where n.recipient_id = p_viewer
    and p.status = 'active'
    and p.user_id <> p_viewer
    and not private.users_blocked(p_viewer, p.user_id)
    and not private.user_is_suspended(p.user_id);
$$;
revoke all on function private.notification_events(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grouped inbox
-- ---------------------------------------------------------------------------

create or replace function public.notification_unread_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from private.notification_events(auth.uid()) e where e.read_at is null;
$$;
revoke all on function public.notification_unread_count() from public, anon;
grant execute on function public.notification_unread_count() to authenticated, service_role;
comment on function public.notification_unread_count() is
  'Unread events of the grouped inbox (the badge). Counts exactly what notification_group_page lists: approved / merged results are excluded.';

create or replace function public.notification_group_page(
  p_before_activity timestamptz default null,
  p_before_group_id text default null,
  p_limit integer default 20
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if (p_before_activity is null) <> (p_before_group_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if v_viewer is null then
    return;
  end if;

  return query
  with e as (
    select * from private.notification_events(v_viewer)
  ),
  g as (
    select e.group_id, e.kind,
           max(e.created_at) as latest_at,
           count(*) filter (where e.read_at is null) as unread_count,
           count(*) as total_count,
           count(distinct e.actor_id) as actor_count
    from e
    group by e.group_id, e.kind
  ),
  latest as (
    select distinct on (e.group_id) e.*
    from e
    order by e.group_id, e.created_at desc, e.source_id desc
  )
  select jsonb_build_object(
      'group_id', g.group_id,
      'kind', g.kind,
      'latest_at', g.latest_at,
      'snapshot', g.latest_at,
      'unread_count', g.unread_count,
      'total_count', g.total_count,
      'actor_count', g.actor_count,
      'actor', case when l.actor_id is null then null
               else jsonb_build_object('user_id', pr.id, 'username', pr.username, 'profile_image_url', pr.profile_image_url) end,
      'target', jsonb_build_object(
        'item_id', l.item_id,
        'item_name', i.name,
        'category_id', l.category_id,
        'category_name', c.name,
        'channel', l.channel,
        'pick_id', l.pick_id,
        'comment_id', l.comment_id,
        'root_comment_id', l.root_comment_id,
        'user_id', l.target_user_id
      ),
      'reason', l.reason
    )
  from g
  join latest l on l.group_id = g.group_id
  left join public.profiles pr on pr.id = l.actor_id
  left join public.items i on i.id = l.item_id
  left join public.categories c on c.id = l.category_id
  where p_before_group_id is null
     or (g.latest_at, g.group_id) < (p_before_activity, p_before_group_id)
  order by g.latest_at desc, g.group_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.notification_group_page(timestamptz, text, integer) from public, anon;
grant execute on function public.notification_group_page(timestamptz, text, integer) to authenticated, service_role;
comment on function public.notification_group_page(timestamptz, text, integer) is
  'Own inbox grouped by kind and target (comment: review, reply: parent comment, pick_review: product, fix_needed: request, followee_pick: followee + menu + channel), latest first, keyset-paged by (latest_at, group_id). snapshot is the value to pass to mark_notification_group_read after the destination loaded. Approved / merged results are not listed.';

-- Marks the group''s events up to the snapshot read; events that arrived after
-- it stay unread. Returns how many rows changed.
create or replace function public.mark_notification_group_read(
  p_group_id text,
  p_until timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_now timestamptz := now();
  v_rows integer;
  v_total integer := 0;
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_group_id is null or p_until is null then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  update public.comment_notifications n
  set read_at = v_now
  where n.recipient_id = v_viewer and n.read_at is null
    and n.comment_id in (
      select e.source_id from private.notification_events(v_viewer) e
      where e.group_id = p_group_id and e.source = 'comment' and e.created_at <= p_until
    );
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  update public.pick_change_notifications n
  set read_at = v_now
  where n.recipient_id = v_viewer and n.read_at is null
    and n.pick_id in (
      select e.source_id from private.notification_events(v_viewer) e
      where e.group_id = p_group_id and e.source = 'pick_change' and e.created_at <= p_until
    );
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  update public.item_review_notifications n
  set read_at = v_now
  where n.recipient_id = v_viewer and n.read_at is null
    and n.item_id in (
      select e.source_id from private.notification_events(v_viewer) e
      where e.group_id = p_group_id and e.source = 'item_review' and e.created_at <= p_until
    );
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  update public.pick_review_notifications n
  set read_at = v_now
  where n.recipient_id = v_viewer and n.read_at is null
    and n.pick_id in (
      select e.source_id from private.notification_events(v_viewer) e
      where e.group_id = p_group_id and e.source = 'pick_review' and e.created_at <= p_until
    );
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;

  return v_total;
end;
$$;
revoke all on function public.mark_notification_group_read(text, timestamptz) from public, anon;
grant execute on function public.mark_notification_group_read(text, timestamptz) to authenticated, service_role;
comment on function public.mark_notification_group_read(text, timestamptz) is
  'After the group''s destination loaded: mark its events up to the snapshot (latest_at at open time) read. Events that arrived later stay unread. Returns the number of rows marked.';

commit;
