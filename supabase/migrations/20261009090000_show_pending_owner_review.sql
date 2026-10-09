begin;

-- #843 / 2026-10-09:
-- item_review_page intentionally exposes a member's own needs_review review,
-- but pick_thread_visible previously required the backing item to be active or
-- discontinued. New/store requests keep their item pending until admin review,
-- so the owner could open the item detail but their own review row disappeared.
--
-- Keep pending items private: only the request owner may see their own current
-- needs_review thread. Guests and other members remain excluded.

create or replace function private.pick_thread_visible(p public.picks, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      p.status in ('active', 'replaced', 'removed')
      or (p.status = 'needs_review' and p.user_id = p_viewer)
    )
    and not private.user_is_suspended(p.user_id)
    and not private.users_blocked(p_viewer, p.user_id)
    and exists (
      select 1 from public.items i
      where i.id = p.item_id
        and i.category_id = p.category_id
        and (
          i.status in ('active', 'discontinued')
          or (
            i.status = 'pending'
            and p.status = 'needs_review'
            and p.user_id = p_viewer
            and i.created_by = p_viewer
          )
        )
    )
    and (
      p.review_deleted_at is null
      or exists (
        select 1 from public.comments c
        where c.pick_id = p.id and c.deleted_at is null
      )
    );
$$;

comment on function private.pick_thread_visible(public.picks, uuid) is
  'Review visibility helper. Current/ended reviews require a public item; a pending item is visible only to its creator for that creator''s own needs_review Pick.';

-- Visibility of the owner's private pending review must not expand comment-write
-- permissions. Comments remain writable only after the backing item is public.
create or replace function private.comment_write_allowed(p_pick_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $
  select p_user is not null and exists (
    select 1 from public.picks p
    where p.id = p_pick_id
      and p.review_deleted_at is null
      and private.pick_thread_visible(p, p_user)
      and exists (
        select 1 from public.items i
        where i.id = p.item_id
          and i.category_id = p.category_id
          and i.status in ('active', 'discontinued')
      )
      and (
        p.user_id = p_user
        or exists (
          select 1 from public.picks q
          where q.user_id = p_user
            and q.item_id = p.item_id
            and q.status = 'active'
            and q.channel is not distinct from p.channel
        )
      )
  );
$;

comment on function private.comment_write_allowed(uuid, uuid) is
  'Comment writes require a visible review on an active/discontinued item; private pending review visibility is read/manage only.';

commit;
