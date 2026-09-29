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
-- that can decide the viewer's winner (active, replaced, removed, hidden, and
-- needs_review only to its owner). Deleted and hidden rows still participate in
-- winner selection so deletion/moderation never resurrects an older review.
-- A winning deleted review is returned only while comments keep its tombstone
-- visible; if it has none, the member's newest commented tombstone is shown
-- instead so no conversation is dropped. Tombstones carry no author.
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
    join (
      -- The winner is judged over every row that can decide it. When the winner
      -- is a deleted review with no live comments it would show nothing; then the
      -- member's newest tombstone that still has live comments stands in, so a
      -- conversation is never dropped. Only tombstones fall back: an older live
      -- review never resurfaces.
      select coalesce(
               case
                 when w.review_deleted_at is not null
                  and not exists (
                    select 1 from public.comments wc
                    where wc.pick_id = w.id and wc.deleted_at is null
                  )
                 then (
                   select t.id from public.picks t
                   where t.user_id = w.user_id
                     and t.item_id = p_item_id
                     and t.review_deleted_at is not null
                     and exists (
                       select 1 from public.comments tc
                       where tc.pick_id = t.id and tc.deleted_at is null
                     )
                   order by t.started_at desc, t.id desc
                   limit 1
                 )
               end,
               w.id
             ) as id
      from (
        select distinct on (candidate.user_id)
               candidate.id, candidate.user_id, candidate.review_deleted_at
        from public.picks candidate
        where candidate.item_id = p_item_id
          and (
            candidate.status in ('active', 'replaced', 'removed', 'hidden')
            or (candidate.status = 'needs_review' and candidate.user_id = v_viewer)
          )
        order by candidate.user_id,
                 (candidate.status in ('active', 'needs_review')) desc,
                 candidate.started_at desc,
                 candidate.id desc
      ) w
    ) winner on winner.id = p.id
    where private.pick_thread_visible(p, v_viewer)
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
  'Item detail reviews, at most one per member: viewer-specific winner is current Pick first, else newest row; hidden/deleted winners suppress older reviews, and a deleted winner is returned only while comments keep its tombstone visible. Current first, keyset-paged by (is_current, started_at, id). Allowlisted fields only: status is reduced to is_current; comment_count, can_comment and can_manage are for the caller. Hidden, others'' needs_review, suspended and blocked members excluded from output.';

commit;
