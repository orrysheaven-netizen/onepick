begin;

-- Notifications (Figma 39) show one line of the comment for 새 댓글 / 새 답글.
-- Same inbox as before; each comment/reply group also carries `preview`, the
-- latest comment's text (at most 120 characters, the app shows one line).
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
      'reason', l.reason,
      -- Figma 39: one line of the latest comment/reply. Events already exclude
      -- deleted, blocked and suspended authors (comment_notification_visible).
      'preview', case when g.kind in ('comment', 'reply') and cm.deleted_at is null
                      then left(cm.body, 120) end
    )
  from g
  join latest l on l.group_id = g.group_id
  left join public.profiles pr on pr.id = l.actor_id
  left join public.items i on i.id = l.item_id
  left join public.categories c on c.id = l.category_id
  left join public.comments cm on cm.id = l.comment_id
  where p_before_group_id is null
     or (g.latest_at, g.group_id) < (p_before_activity, p_before_group_id)
  order by g.latest_at desc, g.group_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

comment on function public.notification_group_page(timestamptz, text, integer) is
  'Initial MVP inbox grouped by visible kind and target (comment: review, reply: parent comment, pick_review: product, fix_needed: request), latest first, keyset-paged by (latest_at, group_id). followee_pick is retained in storage but excluded while follow is deferred. comment/reply groups carry preview = latest comment text (<=120 chars). snapshot is passed to mark_notification_group_read after destination load.';

commit;
