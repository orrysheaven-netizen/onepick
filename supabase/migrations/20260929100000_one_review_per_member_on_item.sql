-- 아이템 상세에는 한 사람의 한줄평이 하나만 보인다 (user 2026-09-29).
--
-- A member who ends a Pick and picks the same item again gets a new picks row
-- with a new 한줄평; the ended row was kept (20260928140000), so the item page
-- listed the same member two or more times. Comments are unaffected: a member
-- may still leave any number of comments and replies.
--
-- item_review_page now returns, per member, only their newest review on the
-- item: the current Pick if there is one, otherwise the most recently started
-- ended one. "Newest" is judged against every row of that member on the item
-- that could be shown (active, replaced, removed, and needs_review only to its
-- owner), including deleted reviews, so deleting the newest review does not
-- bring an older one back. Tombstones (deleted reviews kept for their comments)
-- carry no author and are still returned so their conversations stay reachable.
--
-- Older reviews are not deleted and stay reachable by their own links
-- (/pick/[pickId], inbox, comment_locate); only the item list drops them.
-- Output shape, ordering, cursor and grants are unchanged.

begin;

create or replace function public.item_review_page(
  p_item_id uuid,
  p_after_is_current boolean default null,
  p_after_started_at timestamptz default null,
  p_after_id uuid default null,
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
  if not (
    (p_after_is_current is null and p_after_started_at is null and p_after_id is null)
    or (p_after_is_current is not null and p_after_started_at is not null and p_after_id is not null)
  ) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;

  return query
  select jsonb_build_object(
      'id', r.id,
      'user_id', case when r.is_deleted then null else r.user_id end,
      'category_id', r.category_id,
      'item_id', r.item_id,
      'channel', r.channel,
      'one_line_review', case when r.is_deleted then null else r.one_line_review end,
      'is_current', r.is_current,
      'is_deleted', r.is_deleted,
      'started_at', r.started_at,
      'comment_count', (
        select count(*) from public.comments c
        where c.pick_id = r.id and c.deleted_at is null
      ),
      'can_comment', private.comment_write_allowed(r.id, v_viewer),
      'can_manage', v_viewer is not null and r.user_id = v_viewer and not r.is_deleted,
      'profile', case when r.is_deleted then null else to_jsonb(pr) end,
      'category', to_jsonb(c),
      'item', to_jsonb(i)
    )
  from (
    select p.*,
           p.status in ('active', 'needs_review') as is_current,
           p.review_deleted_at is not null as is_deleted
    from public.picks p
    where p.item_id = p_item_id
      and private.pick_thread_visible(p, v_viewer)
      and (
        p.review_deleted_at is not null
        or not exists (
          select 1 from public.picks n
          where n.user_id = p.user_id
            and n.item_id = p.item_id
            and n.id <> p.id
            and (
              n.status in ('active', 'replaced', 'removed')
              or (n.status = 'needs_review' and n.user_id = v_viewer)
            )
            and (n.status in ('active', 'needs_review'), n.started_at, n.id)
              > (p.status in ('active', 'needs_review'), p.started_at, p.id)
        )
      )
  ) r
  join public.profiles pr on pr.id = r.user_id
  join public.categories c on c.id = r.category_id
  join public.items i on i.id = r.item_id and i.category_id = r.category_id
  where p_after_id is null
     or (r.is_current, r.started_at, r.id) < (p_after_is_current, p_after_started_at, p_after_id)
  order by r.is_current desc, r.started_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
comment on function public.item_review_page(uuid, boolean, timestamptz, uuid, integer) is
  'Item detail reviews, one per member (their newest: current Pick, else latest ended), current first, keyset-paged by (is_current, started_at, id). Allowlisted fields only: status is reduced to is_current, deleted reviews are tombstones (is_deleted, no author or text) kept while comments exist. comment_count, can_comment and can_manage are for the caller. Hidden, others'' needs_review, suspended and blocked members excluded.';

commit;
