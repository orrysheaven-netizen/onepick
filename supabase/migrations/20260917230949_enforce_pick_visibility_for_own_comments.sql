-- Owning a comment must not bypass the parent Pick's block/visibility rules.
-- Keep administrator moderation access and permit suspended authors to remove
-- their own comments where the parent Pick is still visible to them.
drop policy comments_authenticated_read_visible_pick on public.comments;
create policy comments_authenticated_read_visible_pick on public.comments
for select to authenticated
using (
  (select private.is_admin((select auth.uid())))
  or (
    (
      user_id = (select auth.uid())
      or (
        not public.user_is_suspended(user_id)
        and not (select private.users_blocked((select auth.uid()), comments.user_id))
      )
    )
    and exists (
      select 1 from public.picks p
      where p.id = comments.pick_id
        and (
          p.user_id = (select auth.uid())
          or (
            p.status = 'active'
            and not public.user_is_suspended(p.user_id)
            and not (select private.users_blocked((select auth.uid()), p.user_id))
          )
        )
    )
  )
);