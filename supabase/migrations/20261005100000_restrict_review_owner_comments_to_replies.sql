-- Align the DB write rule with the MVP review UI (#708 follow-up).
--
-- A review author may participate in the conversation under their own review,
-- but only by replying to another member's live top-level comment. They may
-- not create a new top-level comment or reply to their own comment.
-- Other eligible members keep the existing same-item + same-channel rule.

begin;

create or replace function private.comment_insert_allowed(
  p_pick_id uuid,
  p_parent_comment_id uuid,
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.comment_write_allowed(p_pick_id, p_user)
    and (
      -- Non-authors keep the existing write behavior.
      not exists (
        select 1
        from public.picks p
        where p.id = p_pick_id
          and p.user_id = p_user
      )
      or (
        -- Review authors can only reply to another member's live root comment.
        p_parent_comment_id is not null
        and exists (
          select 1
          from public.comments c
          where c.id = p_parent_comment_id
            and c.pick_id = p_pick_id
            and c.parent_comment_id is null
            and c.deleted_at is null
            and c.user_id <> p_user
        )
      )
    );
$$;

revoke all on function private.comment_insert_allowed(uuid, uuid, uuid)
  from public, anon, authenticated;
-- The comments INSERT policy executes this helper as the caller.
grant execute on function private.comment_insert_allowed(uuid, uuid, uuid)
  to authenticated;

drop policy if exists comments_insert_when_eligible on public.comments;
create policy comments_insert_when_eligible on public.comments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    select private.comment_insert_allowed(
      comments.pick_id,
      comments.parent_comment_id,
      (select auth.uid())
    )
  )
);

comment on function private.comment_insert_allowed(uuid, uuid, uuid) is
  'Comment INSERT guard: eligible non-authors keep existing writes; a review author may only reply to another member''s live top-level comment.';

commit;
