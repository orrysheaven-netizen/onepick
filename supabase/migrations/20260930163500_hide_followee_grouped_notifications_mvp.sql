-- Initial public MVP defers follow. Keep follow rows/data for a later rollout,
-- but exclude followee_pick from the grouped in-app inbox so list, badge and
-- mark-read all operate on the same visible event set (#533).
--
-- This changes only the shared event projection. No follow rows are deleted and
-- the follow notification trigger / preference schema stay intact.

begin;

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
comment on function private.notification_events(uuid) is
  'Visible grouped-inbox events for the initial follow-off MVP: comment, reply, fix_needed and pick_review. followee_pick rows remain stored in pick_change_notifications for a later follow rollout but are intentionally excluded from this projection.';

comment on function public.notification_unread_count() is
  'Unread events of the grouped inbox (the badge). Counts exactly what notification_group_page lists. Initial MVP excludes followee_pick while follow is deferred; approved / merged results are also excluded.';
comment on function public.notification_group_page(timestamptz, text, integer) is
  'Initial MVP inbox grouped by visible kind and target (comment: review, reply: parent comment, pick_review: product, fix_needed: request), latest first, keyset-paged by (latest_at, group_id). followee_pick is retained in storage but excluded while follow is deferred. snapshot is passed to mark_notification_group_read after destination load.';
comment on function public.mark_notification_group_read(text, timestamptz) is
  'After a visible grouped-inbox destination loaded: mark events in that visible group up to snapshot read. Hidden followee_pick rows are not changed while follow is deferred.';

commit;
