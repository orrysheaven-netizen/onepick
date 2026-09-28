-- 한줄평·댓글 보존/삭제와 쓰기 권한 (#448 서버 인계 2번, user decisions 2026-09-28).
--
-- Decisions this migration implements:
--   * Ending a Pick (replace or remove) keeps its review and conversation; only
--     the current-Pick badge goes. That part is 20260928140000.
--   * Deleting a review is a separate action (delete_pick_review). Deleting the
--     current review also ends the Pick. A review with live comments stays as a
--     tombstone (author, text and badge removed) so the conversation survives;
--     a review without comments leaves the item page.
--   * Comments have one level of replies (parent_comment_id). Deleting a comment
--     with live replies leaves a tombstone; without replies it is removed, and a
--     tombstone whose last reply goes is removed with it.
--   * New comments and replies are allowed only while the writer currently holds
--     the same item under the same channel as an active Pick, or is the author
--     of the review. Ended reviews stay open to such writers; deleted reviews and
--     hidden threads are read-only.
--   * Inbox: a top-level comment notifies the review author; a reply notifies the
--     parent comment's author (never both). Notifications survive the Pick ending.
--
-- Lifecycle status, end times and past selections are still never returned
-- (20260928140000). Direct table reads keep their narrow RLS; readers below are
-- item-, review- or viewer-scoped.

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.comments
  add column parent_comment_id uuid references public.comments(id) on delete cascade,
  add column deleted_at timestamptz;

alter table public.comments drop constraint comments_body_length;
alter table public.comments add constraint comments_body_length check (
  (deleted_at is null and char_length(btrim(body)) between 1 and 300)
  or (deleted_at is not null and body = '')
);

create index comments_parent_idx
  on public.comments(parent_comment_id, created_at, id)
  where parent_comment_id is not null;

comment on column public.comments.parent_comment_id is
  'Reply target: a top-level comment on the same Pick. One level only.';
comment on column public.comments.deleted_at is
  'Tombstone: the author deleted this comment while replies existed. Body is empty and the author is not returned.';

alter table public.picks add column review_deleted_at timestamptz;

alter table public.picks drop constraint picks_review_length;
alter table public.picks add constraint picks_review_length check (
  (review_deleted_at is null and char_length(btrim(one_line_review)) between 1 and 100)
  or (review_deleted_at is not null and one_line_review = '')
);
alter table public.picks add constraint picks_deleted_review_is_ended check (
  review_deleted_at is null or status in ('replaced','removed','hidden')
);

comment on column public.picks.review_deleted_at is
  'The author deleted the review. The Pick is ended; the row stays only to keep its conversation (tombstone) and history.';

alter table public.comment_notifications
  add column kind text not null default 'comment' check (kind in ('comment','reply'));

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------

-- A review thread is shown while it is a current or ended Pick of a member the
-- viewer may see; a deleted review only while live comments keep it alive.
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
        and i.status in ('active', 'discontinued')
    )
    and (
      p.review_deleted_at is null
      or exists (
        select 1 from public.comments c
        where c.pick_id = p.id and c.deleted_at is null
      )
    );
$$;

create or replace function private.pick_thread_visible_by_id(p_pick_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.picks p
    where p.id = p_pick_id and private.pick_thread_visible(p, p_viewer)
  );
$$;
revoke all on function private.pick_thread_visible_by_id(uuid, uuid) from public, anon, authenticated;
-- Called from the comments update policy, so the policy's role must execute it.
grant execute on function private.pick_thread_visible_by_id(uuid, uuid) to authenticated;

-- A live comment is shown unless its author is suspended or blocked; tombstones
-- carry nothing of their author and are always shown.
create or replace function private.comment_visible(c public.comments, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.deleted_at is not null
    or c.user_id = p_viewer
    or (
      not private.user_is_suspended(c.user_id)
      and not private.users_blocked(p_viewer, c.user_id)
    );
$$;
revoke all on function private.comment_visible(public.comments, uuid) from public, anon, authenticated;

-- Writing: the review's author, or a member whose active Pick is this item under
-- this channel. Deleted reviews and threads the writer cannot see are closed.
create or replace function private.comment_write_allowed(p_pick_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.picks p
    where p.id = p_pick_id
      and p.review_deleted_at is null
      and private.pick_thread_visible(p, p_user)
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
$$;
revoke all on function private.comment_write_allowed(uuid, uuid) from public, anon, authenticated;
-- Called from the comments insert policy.
grant execute on function private.comment_write_allowed(uuid, uuid) to authenticated;

-- Whether a comment was addressed to the viewer (their review or their comment).
-- Definer so the comments policy can ask without recursing through RLS.
create or replace function private.comment_addressed_to(p_comment_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1 from public.comment_notifications n
    where n.comment_id = p_comment_id and n.recipient_id = p_viewer
  );
$$;
revoke all on function private.comment_addressed_to(uuid, uuid) from public, anon, authenticated;

-- Table reads for members. Own comments on any thread the member may see (so a
-- comment just written under an ended review comes back from INSERT ... RETURNING
-- and edits work); other members' live comments on the viewer's own Picks, on
-- active visible Picks, or addressed to the viewer (the inbox) while that thread
-- is still visible to them and neither side blocked the other. Tombstones never.
create or replace function private.comment_readable(c public.comments, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.deleted_at is null and p_viewer is not null and (
    (
      c.user_id = p_viewer
      and private.pick_thread_visible_by_id(c.pick_id, p_viewer)
    )
    or (
      not private.user_is_suspended(c.user_id)
      and not private.users_blocked(p_viewer, c.user_id)
      and (
        exists (
          select 1 from public.picks p
          where p.id = c.pick_id
            and (
              p.user_id = p_viewer
              or (
                p.status = 'active'
                and not private.user_is_suspended(p.user_id)
                and not private.users_blocked(p_viewer, p.user_id)
              )
            )
        )
        or (
          private.comment_addressed_to(c.id, p_viewer)
          and private.pick_thread_visible_by_id(c.pick_id, p_viewer)
        )
      )
    )
  );
$$;
revoke all on function private.comment_readable(public.comments, uuid) from public, anon, authenticated;
-- Called from the comments select policy.
grant execute on function private.comment_readable(public.comments, uuid) to authenticated;

-- An inbox row is shown while the comment is live, from someone the viewer has
-- not blocked and who is not suspended, on a thread the viewer may see.
create or replace function private.comment_notification_visible(p_comment_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1
    from public.comments c
    join public.picks p on p.id = c.pick_id
    where c.id = p_comment_id
      and c.deleted_at is null
      and c.user_id <> p_viewer
      and not private.user_is_suspended(c.user_id)
      and not private.users_blocked(p_viewer, c.user_id)
      and private.pick_thread_visible(p, p_viewer)
  );
$$;
revoke all on function private.comment_notification_visible(uuid, uuid) from public, anon, authenticated;
-- Called from the comment_notifications select policy.
grant execute on function private.comment_notification_visible(uuid, uuid) to authenticated;

create or replace function public.can_comment_on_pick(p_pick_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.comment_write_allowed(p_pick_id, auth.uid());
$$;
revoke all on function public.can_comment_on_pick(uuid) from public;
grant execute on function public.can_comment_on_pick(uuid) to anon, authenticated, service_role;
comment on function public.can_comment_on_pick(uuid) is
  'True when the caller may write a comment or reply under this review: its author, or a member whose active Pick is the same item in the same channel.';

-- ---------------------------------------------------------------------------
-- Comment triggers: reply shape, tombstones, pruning
-- ---------------------------------------------------------------------------

create or replace function private.validate_comment_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.comments%rowtype;
begin
  -- Clients cannot create tombstones.
  new.deleted_at := null;
  if new.parent_comment_id is not null then
    select * into v_parent from public.comments where id = new.parent_comment_id;
    if not found
       or v_parent.pick_id <> new.pick_id
       or v_parent.parent_comment_id is not null
       or v_parent.deleted_at is not null then
      raise exception 'COMMENT_PARENT_INVALID' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_comment_thread() from public, anon, authenticated;

create trigger comments_validate_thread
before insert on public.comments
for each row execute function private.validate_comment_thread();

-- A comment with live replies is not removed: it becomes a tombstone so the
-- replies keep their place. Both the delete_comment RPC and a direct DELETE
-- (existing clients) get the same behaviour.
create or replace function private.tombstone_comment_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.parent_comment_id is null and exists (
    select 1 from public.comments r
    where r.parent_comment_id = old.id and r.deleted_at is null
  ) then
    if old.deleted_at is null then
      update public.comments
      set body = '', deleted_at = now()
      where id = old.id;
    end if;
    return null;
  end if;
  return old;
end;
$$;
revoke all on function private.tombstone_comment_on_delete() from public, anon, authenticated;

create trigger comments_tombstone_on_delete
before delete on public.comments
for each row execute function private.tombstone_comment_on_delete();

-- When the last reply under a tombstone goes, the tombstone goes too.
create or replace function private.prune_comment_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.parent_comment_id is not null then
    delete from public.comments p
    where p.id = old.parent_comment_id
      and p.deleted_at is not null
      and not exists (
        select 1 from public.comments r
        where r.parent_comment_id = p.id and r.deleted_at is null
      );
  end if;
  return null;
end;
$$;
revoke all on function private.prune_comment_tombstone() from public, anon, authenticated;

create trigger comments_prune_tombstone
after delete on public.comments
for each row execute function private.prune_comment_tombstone();

-- Tombstoning is not a write the quota should count (same as 20260917110856
-- otherwise).
create or replace function private.limit_community_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_action text;
  v_window interval;
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if tg_table_schema = 'public' and tg_table_name = 'comments' then
    if new.user_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
    if tg_op = 'UPDATE' and new.deleted_at is not null then return null; end if;
    if tg_op = 'UPDATE' and new.body is not distinct from old.body then return null; end if;
    v_action := 'comment';
    v_window := interval '1 minute';
  elsif tg_table_schema = 'public' and tg_table_name = 'content_reports' and tg_op = 'INSERT' then
    if new.reporter_user_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
    v_action := 'report';
    v_window := interval '1 hour';
  else
    raise exception 'FORBIDDEN';
  end if;

  -- ON CONFLICT serializes writes to the same account/action. Never count
  -- client-provided timestamps or existing content that a user could delete.
  insert into private.community_write_limits as quota(user_id, action, window_start, requests)
    values (v_user, v_action, v_now, 1)
  on conflict (user_id, action) do update
    set requests = case when quota.window_start <= v_now - v_window then 1 else quota.requests + 1 end,
        window_start = case when quota.window_start <= v_now - v_window then v_now else quota.window_start end
    where quota.window_start <= v_now - v_window or quota.requests < 10
  returning requests into v_count;
  if not found then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  return null;
end;
$$;

-- Suspended members may still take their own content down: ending a Pick,
-- deleting a review and tombstoning a comment (same as 20260917131851 otherwise).
create or replace function private.prevent_suspended_content_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null
     and new.user_id = v_actor
     and private.is_user_suspended(v_actor) then
    -- Field checks live in per-table branches: a row of the other table has no
    -- such field and the whole IF expression would fail to resolve.
    if tg_table_name = 'picks' then
      if tg_op = 'UPDATE' and (new.status = 'removed' or new.review_deleted_at is not null) then
        return new;
      end if;
    elsif tg_table_name = 'comments' then
      if tg_op = 'UPDATE' and new.deleted_at is not null then
        return new;
      end if;
    end if;
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Suspended members may take their own content down (remove_pick,
-- delete_pick_review): the profile AI invalidation that follows must not write
-- their guarded quota row. Same as 20260927130500 otherwise.
create or replace function private.invalidate_profile_ai_sources()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  affected uuid[] := '{}'::uuid[];
  affected_profile uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  if tg_table_name = 'picks' then
    if tg_op = 'INSERT' then
      if new.status = 'active' then affected := array[new.user_id]; end if;
    elsif tg_op = 'DELETE' then
      if old.status = 'active' then affected := array[old.user_id]; end if;
    else
      if row(old.user_id, old.category_id, old.item_id, old.channel, old.status, old.one_line_review)
         is not distinct from
         row(new.user_id, new.category_id, new.item_id, new.channel, new.status, new.one_line_review) then
        return null;
      end if;
      if old.status = 'active' then affected := array_append(affected, old.user_id); end if;
      if new.status = 'active' then affected := array_append(affected, new.user_id); end if;
    end if;
  elsif tg_table_name = 'items' then
    if tg_op = 'UPDATE' and
       row(old.name, old.original_name, old.release_year, old.creator_name,
           old.collection_name, old.status, old.category_id)
       is not distinct from
       row(new.name, new.original_name, new.release_year, new.creator_name,
           new.collection_name, new.status, new.category_id) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.item_id = old.id and p.status = 'active';
  elsif tg_table_name = 'categories' then
    if tg_op = 'UPDATE' and
       row(old.name, old.status, old.is_visible)
       is not distinct from
       row(new.name, new.status, new.is_visible) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.category_id = old.id and p.status = 'active';
  else
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  for affected_profile in
    select distinct value
    from unnest(coalesce(affected, '{}'::uuid[])) as ids(value)
    where value is not null
    order by value
  loop
    if not exists (select 1 from public.profiles where id = affected_profile) then
      continue;
    end if;

    -- A suspended member's quota row is guarded (reject_suspended_quota_owner);
    -- taking their own content down must not trip it. Their review is still
    -- marked stale, and the next change after reinstatement bumps the version.
    if not private.is_user_suspended(affected_profile) then
      insert into public.profile_ai_generation_limits as limits
        (profile_id, next_allowed_at, source_version)
      values (affected_profile, '-infinity'::timestamptz, 1)
      on conflict (profile_id) do update
        set source_version = limits.source_version + 1;
    end if;

    -- Keep the last published comment visible until a paid refresh succeeds.
    update public.profile_ai_reviews
    set is_stale = true
    where profile_id = affected_profile and not is_stale;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbox: review author for comments, parent author for replies
-- ---------------------------------------------------------------------------

create or replace function private.notify_pick_owner_on_comment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_pick public.picks%rowtype;
  v_parent public.comments%rowtype;
  v_recipient uuid;
  v_kind text := 'comment';
begin
  if (select auth.uid()) is null or new.user_id is distinct from (select auth.uid()) then
    return new;
  end if;
  select * into v_pick from public.picks where id = new.pick_id;
  if not found or v_pick.status not in ('active', 'replaced', 'removed') then
    return new;
  end if;
  if new.parent_comment_id is not null then
    select * into v_parent from public.comments where id = new.parent_comment_id;
    if found and v_parent.user_id <> new.user_id then
      v_recipient := v_parent.user_id;
      v_kind := 'reply';
    end if;
  end if;
  -- A reply tells the parent's author only, never also the review author.
  -- A reply to one's own comment under someone else's review tells the review
  -- author, as a comment would.
  if v_recipient is null and v_pick.user_id <> new.user_id then
    v_recipient := v_pick.user_id;
  end if;
  if v_recipient is null or private.users_blocked(new.user_id, v_recipient) then
    return new;
  end if;
  insert into public.comment_notifications(comment_id, recipient_id, kind)
  values (new.id, v_recipient, v_kind)
  on conflict (comment_id) do nothing;
  return new;
end;
$$;

drop policy if exists comment_notifications_read_own on public.comment_notifications;
create policy comment_notifications_read_own on public.comment_notifications
for select to authenticated using (
  recipient_id = (select auth.uid())
  and (select private.comment_notification_visible(comment_id, (select auth.uid())))
);

-- Inbox rows for a reply on an ended review: the comment and its Pick are
-- resolved here instead of through the caller's picks RLS (which hides ended
-- Picks of other members). Only called for rows the inbox RLS already allowed.
create or replace function private.comment_notification_context(p_comment_id uuid)
returns table(pick_id uuid, username text, body text, item_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.pick_id, pr.username, c.body, i.name
  from public.comments c
  join public.picks p on p.id = c.pick_id
  join public.profiles pr on pr.id = c.user_id
  join public.items i on i.id = p.item_id
  where c.id = p_comment_id;
$$;
revoke all on function private.comment_notification_context(uuid) from public, anon, authenticated;
-- Called from the security invoker notification_page as the caller.
grant execute on function private.comment_notification_context(uuid) to authenticated;

create or replace function public.notification_page(p_before_time timestamptz default null, p_before_id uuid default null)
returns table(kind text, id uuid, pick_id uuid, username text, body text, item_name text, created_at timestamptz, read_at timestamptz, item_id uuid, outcome text)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'comment'::text, n.comment_id, x.pick_id, x.username, x.body, x.item_name, n.created_at, n.read_at, null::uuid, null::text
    from public.comment_notifications n
    cross join lateral private.comment_notification_context(n.comment_id) x
    where n.recipient_id = (select auth.uid())
    union all
    select 'pick_change'::text, n.pick_id, n.pick_id, pr.username, p.one_line_review, i.name, n.created_at, n.read_at, null::uuid, null::text
    from public.pick_change_notifications n
    join public.picks p on p.id = n.pick_id
    join public.profiles pr on pr.id = p.user_id
    join public.items i on i.id = p.item_id
    where n.recipient_id = (select auth.uid())
    union all
    select 'item_review'::text, n.item_id, n.pick_id, null::text, n.reason, i.name, n.created_at, n.read_at, n.target_item_id, n.outcome
    from public.item_review_notifications n
    join public.items i on i.id = n.target_item_id
    where n.recipient_id = (select auth.uid())
  ) rows(kind, id, pick_id, username, body, item_name, created_at, read_at, item_id, outcome)
  where (p_before_time is null or (created_at, id) < (p_before_time, p_before_id))
  order by created_at desc, id desc
  limit 21;
$$;
comment on function public.notification_page(timestamptz, uuid) is
  'Own inbox: comments on my reviews and replies to my comments (kind comment, also on ended Picks), pick changes by people I follow and reviews of my product requests (rejections carry the reason in body), newest first, caller RLS, 20 + lookahead.';

-- ---------------------------------------------------------------------------
-- Comments RLS
-- ---------------------------------------------------------------------------

-- Reads stay narrow (active Picks, own Picks, own comments, comments addressed
-- to the viewer); tombstones are never returned by the table. See
-- private.comment_readable.
drop policy if exists comments_anon_read_visible_pick on public.comments;
create policy comments_anon_read_visible_pick on public.comments
for select to anon
using (
  deleted_at is null
  and not private.user_is_suspended(user_id)
  and exists (
    select 1 from public.picks p
    where p.id = comments.pick_id
      and p.status = 'active'
      and not private.user_is_suspended(p.user_id)
  )
);

alter policy comments_authenticated_read_visible_pick on public.comments
  using (
    (select private.is_admin_mfa())
    or (select private.comment_readable(comments, (select auth.uid())))
  );

drop policy if exists comments_insert_own_on_active_pick on public.comments;
create policy comments_insert_when_eligible on public.comments
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.comment_write_allowed(comments.pick_id, (select auth.uid())))
);

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
for update to authenticated
using (
  user_id = (select auth.uid())
  and deleted_at is null
)
with check (
  user_id = (select auth.uid())
  and deleted_at is null
  and (select private.pick_thread_visible_by_id(comments.pick_id, (select auth.uid())))
);

-- ---------------------------------------------------------------------------
-- delete_comment
-- ---------------------------------------------------------------------------

create or replace function public.delete_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_comment public.comments%rowtype;
  v_rows integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_comment from public.comments where id = p_comment_id;
  if not found or v_comment.user_id <> v_user or v_comment.deleted_at is not null then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from public.comments where id = p_comment_id;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'removed' else 'tombstoned' end;
end;
$$;
revoke all on function public.delete_comment(uuid) from public, anon;
grant execute on function public.delete_comment(uuid) to authenticated, service_role;
comment on function public.delete_comment(uuid) is
  'Delete own comment. Returns removed (row gone) or tombstoned (kept without author or text because live replies exist). Deleting the last reply under a tombstone removes the tombstone.';

-- ---------------------------------------------------------------------------
-- delete_pick_review
-- ---------------------------------------------------------------------------

create or replace function private.delete_pick_review_impl(p_pick_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_pick public.picks%rowtype;
  v_was_current boolean;
  v_has_comments boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_pick from public.picks where id = p_pick_id;
  if not found or v_pick.user_id <> v_user or v_pick.status = 'hidden' or v_pick.review_deleted_at is not null then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Same lock as change_pick / remove_pick for this member and category.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || v_pick.category_id::text, 0)
  );
  select * into v_pick from public.picks where id = p_pick_id for update;
  if v_pick.status = 'hidden' or v_pick.review_deleted_at is not null then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_was_current := v_pick.status in ('active', 'needs_review');

  update public.picks
  set status = case when v_was_current then 'removed' else status end,
      ended_at = case when v_was_current then now() else ended_at end,
      replaced_by_pick_id = case when v_was_current then null else replaced_by_pick_id end,
      review_deleted_at = now(),
      one_line_review = '',
      purchase_url = null,
      purchase_tip = null,
      updated_at = now()
  where id = v_pick.id;

  select exists (
    select 1 from public.comments c where c.pick_id = v_pick.id and c.deleted_at is null
  ) into v_has_comments;

  return jsonb_build_object(
    'pick_id', v_pick.id,
    'category_id', v_pick.category_id,
    'item_id', v_pick.item_id,
    'channel', v_pick.channel,
    'was_current', v_was_current,
    'outcome', case when v_has_comments then 'tombstoned' else 'removed' end
  );
end;
$$;

create or replace function public.delete_pick_review(p_pick_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.delete_pick_review_impl(p_pick_id);
$$;

revoke all on function private.delete_pick_review_impl(uuid) from public, anon;
grant execute on function private.delete_pick_review_impl(uuid) to authenticated, service_role;
revoke all on function public.delete_pick_review(uuid) from public, anon;
grant execute on function public.delete_pick_review(uuid) to authenticated, service_role;
comment on function public.delete_pick_review(uuid) is
  'Delete own review. A current Pick is ended with it (removed). Returns outcome tombstoned when live comments keep the thread on the item page, else removed.';

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

-- One comment as the app sees it. Tombstones carry no author, text or times of
-- change. Badge and edit/delete flags are false on tombstones; a suspended author
-- may still delete (can_delete) but not edit (can_edit).
create or replace function private.comment_json(c public.comments, p_pick public.picks, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'pick_id', c.pick_id,
    'parent_comment_id', c.parent_comment_id,
    'user_id', case when c.deleted_at is null then c.user_id end,
    'body', case when c.deleted_at is null then c.body end,
    'created_at', c.created_at,
    'updated_at', case when c.deleted_at is null then c.updated_at end,
    'is_deleted', c.deleted_at is not null,
    'author', case when c.deleted_at is null then (select to_jsonb(pr) from public.profiles pr where pr.id = c.user_id) end,
    'author_current_pick_matches_item', c.deleted_at is null and exists (
      select 1 from public.picks q
      where q.user_id = c.user_id
        and q.item_id = p_pick.item_id
        and q.status = 'active'
        and q.channel is not distinct from p_pick.channel
    ),
    'can_edit', p_viewer is not null and c.deleted_at is null and c.user_id = p_viewer
      and not private.user_is_suspended(c.user_id),
    'can_delete', p_viewer is not null and c.deleted_at is null and c.user_id = p_viewer
  );
$$;
revoke all on function private.comment_json(public.comments, public.picks, uuid) from public, anon, authenticated;

-- Top-level comments oldest first, each with its visible replies (oldest first)
-- embedded, keyset-paged by (created_at, id) of the top-level comment.
create or replace function public.pick_comment_page(
  p_pick_id uuid,
  p_after_time timestamptz default null,
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
  v_pick public.picks%rowtype;
begin
  if (p_after_time is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;

  select * into v_pick from public.picks where id = p_pick_id;
  if not found or not private.pick_thread_visible(v_pick, v_viewer) then
    return;
  end if;

  return query
  select private.comment_json(cm, v_pick, v_viewer) || jsonb_build_object(
      'replies', coalesce((
        select jsonb_agg(private.comment_json(rp, v_pick, v_viewer) order by rp.created_at, rp.id)
        from public.comments rp
        where rp.parent_comment_id = cm.id
          and private.comment_visible(rp, v_viewer)
      ), '[]'::jsonb),
      'reply_count', (
        select count(*) from public.comments rp
        where rp.parent_comment_id = cm.id
          and rp.deleted_at is null
          and private.comment_visible(rp, v_viewer)
      )
    )
  from public.comments cm
  where cm.pick_id = v_pick.id
    and cm.parent_comment_id is null
    and private.comment_visible(cm, v_viewer)
    and (p_after_time is null or (cm.created_at, cm.id) > (p_after_time, p_after_id))
  order by cm.created_at asc, cm.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
comment on function public.pick_comment_page(uuid, timestamptz, uuid, integer) is
  'Top-level comments under one review item_review_page would show, oldest first, each with its replies embedded; tombstones (is_deleted) carry no author or text. author_current_pick_matches_item drives ✓ 이 집 원픽; can_edit/can_delete are for the caller.';

-- Reviews of one item: current first, then ended; deleted reviews stay as
-- tombstones while live comments exist. Rows also say whether the caller may
-- write under them and manage them, and how many live comments they hold.
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
  'Item detail reviews: current Picks first, then ended ones, keyset-paged by (is_current, started_at, id). Allowlisted fields only: status is reduced to is_current, deleted reviews are tombstones (is_deleted, no author or text) kept while comments exist. comment_count, can_comment and can_manage are for the caller. Hidden, others'' needs_review, suspended and blocked members excluded.';

-- Where a comment lives, for deep links from the inbox and the profile: its
-- review and the page cursor that starts at its top-level comment.
create or replace function public.comment_locate(p_comment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_comment public.comments%rowtype;
  v_root public.comments%rowtype;
  v_pick public.picks%rowtype;
  v_after_time timestamptz;
  v_after_id uuid;
begin
  select * into v_comment from public.comments where id = p_comment_id;
  if not found or not private.comment_visible(v_comment, v_viewer) then
    return null;
  end if;
  select * into v_pick from public.picks where id = v_comment.pick_id;
  if not found or not private.pick_thread_visible(v_pick, v_viewer) then
    return null;
  end if;
  if v_comment.parent_comment_id is null then
    v_root := v_comment;
  else
    select * into v_root from public.comments where id = v_comment.parent_comment_id;
  end if;

  select c.created_at, c.id into v_after_time, v_after_id
  from public.comments c
  where c.pick_id = v_pick.id
    and c.parent_comment_id is null
    and private.comment_visible(c, v_viewer)
    and (c.created_at, c.id) < (v_root.created_at, v_root.id)
  order by c.created_at desc, c.id desc
  limit 1;

  return jsonb_build_object(
    'comment_id', v_comment.id,
    'root_comment_id', v_root.id,
    'pick_id', v_pick.id,
    'item_id', v_pick.item_id,
    'category_id', v_pick.category_id,
    'channel', v_pick.channel,
    'review_is_current', v_pick.status in ('active', 'needs_review'),
    'review_is_deleted', v_pick.review_deleted_at is not null,
    'page_after_time', v_after_time,
    'page_after_id', v_after_id
  );
end;
$$;
revoke all on function public.comment_locate(uuid) from public;
grant execute on function public.comment_locate(uuid) to anon, authenticated, service_role;
comment on function public.comment_locate(uuid) is
  'Deep link target for a comment: its review and item, and the pick_comment_page cursor (page_after_time, page_after_id; both null = first page) whose first row is the comment''s top-level comment. Null when the caller cannot see it.';

-- The caller's own comments, newest first, with their review and item, on
-- every thread including ended and deleted reviews (thread_visible says
-- whether the item page still shows it). Deleted comments are not listed.
create or replace function public.my_comment_page(
  p_after_time timestamptz default null,
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
  if (p_after_time is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  if v_viewer is null then
    return;
  end if;

  return query
  select jsonb_build_object(
      'comment', private.comment_json(cm, p, v_viewer),
      'pick', jsonb_build_object(
        'id', p.id,
        'user_id', case when p.review_deleted_at is null then p.user_id end,
        'category_id', p.category_id,
        'item_id', p.item_id,
        'channel', p.channel,
        'one_line_review', case when p.review_deleted_at is null then p.one_line_review end,
        'is_current', p.status in ('active', 'needs_review'),
        'is_deleted', p.review_deleted_at is not null,
        'profile', case when p.review_deleted_at is null then to_jsonb(pr) end
      ),
      'item', to_jsonb(i),
      'category', to_jsonb(c),
      'thread_visible', private.pick_thread_visible(p, v_viewer)
    )
  from public.comments cm
  join public.picks p on p.id = cm.pick_id
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id
  join public.categories c on c.id = p.category_id
  where cm.user_id = v_viewer
    and cm.deleted_at is null
    and (p_after_time is null or (cm.created_at, cm.id) < (p_after_time, p_after_id))
  order by cm.created_at desc, cm.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.my_comment_page(timestamptz, uuid, integer) from public, anon;
grant execute on function public.my_comment_page(timestamptz, uuid, integer) to authenticated, service_role;
comment on function public.my_comment_page(timestamptz, uuid, integer) is
  'Own comments newest first with their review, item and category, on ended and deleted reviews too, keyset-paged by (created_at, id). thread_visible is false when the item page no longer shows that thread.';

commit;
