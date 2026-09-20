-- Single-direction follow (docs/follow.md). No requests, no public counts,
-- no follower lists: a follower can read, add and remove only their own rows.
create table public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint user_follows_not_self check (follower_id <> followee_id)
);
create index user_follows_followee_idx on public.user_follows(followee_id, follower_id);
alter table public.user_follows enable row level security;
revoke all on public.user_follows from public, anon, authenticated;
grant select, insert, delete on public.user_follows to authenticated;
comment on table public.user_follows is
  'One-way follow. Rows are visible to the follower only; the followee learns nothing beyond their own count.';

create policy user_follows_read_own on public.user_follows
for select to authenticated
using (follower_id = (select auth.uid()));
create policy user_follows_insert_own on public.user_follows
for insert to authenticated
with check (follower_id = (select auth.uid()));
create policy user_follows_delete_own on public.user_follows
for delete to authenticated
using (follower_id = (select auth.uid()));

-- Same shape as private.prepare_user_block: the session user, an existing
-- target, no self, and no relationship across a block in either direction.
create function private.prepare_user_follow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.follower_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if new.follower_id = new.followee_id then
    raise exception 'FOLLOW_SELF';
  end if;
  if not exists (select 1 from public.profiles where id = new.followee_id) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if private.users_blocked(new.follower_id, new.followee_id) then
    raise exception 'FOLLOW_BLOCKED';
  end if;
  if private.is_user_suspended(new.followee_id) then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_user_follow() from public, anon, authenticated;
create trigger user_follows_prepare_before_insert
before insert on public.user_follows
for each row execute function private.prepare_user_follow();

-- Blocking ends the relationship both ways. Unblocking does not restore it.
create function private.remove_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.user_follows
  where (follower_id = new.blocker_user_id and followee_id = new.blocked_user_id)
     or (follower_id = new.blocked_user_id and followee_id = new.blocker_user_id);
  return new;
end;
$$;
revoke all on function private.remove_follows_on_block() from public, anon, authenticated;
create trigger user_blocks_remove_follows
after insert on public.user_blocks
for each row execute function private.remove_follows_on_block();

-- Counts for the caller only. Follower rows are not readable through RLS, so
-- this is the single privileged read, and it never takes a user id argument.
create function public.follow_counts()
returns table(following_count bigint, follower_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.user_follows where follower_id = (select auth.uid())),
    (select count(*) from public.user_follows where followee_id = (select auth.uid()))
  where (select auth.uid()) is not null;
$$;
revoke all on function public.follow_counts() from public, anon;
grant execute on function public.follow_counts() to authenticated;
comment on function public.follow_counts() is
  'Own following/follower counts. Empty when signed out. No per-profile variant exists on purpose.';

-- The people feed restricted to followed authors. Same columns, visibility
-- rules and cursor as home_pick_feed_page; the follow row is the only extra
-- condition, and it is read under the caller''s own RLS.
create function public.home_following_feed_page(
  p_before_time timestamptz default null,
  p_before_id uuid default null
)
returns table(
  pick_id uuid, user_id uuid, username text, profile_image_url text,
  item_id uuid, item_name text, category_id uuid, category_name text,
  one_line_review text, thumbnail_path text, image_path text,
  image_source_url text, started_at timestamptz
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (p_before_time is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGINATION_CURSOR' using errcode = '22023';
  end if;
  return query
  select p.id, p.user_id, pr.username, pr.profile_image_url,
    i.id, i.name, c.id, c.name, p.one_line_review,
    i.thumbnail_path, i.image_path, i.image_source_url, p.started_at
  from public.picks p
  join public.profiles pr on pr.id = p.user_id
  join public.items i on i.id = p.item_id and i.category_id = p.category_id
  join public.categories c on c.id = p.category_id
  where p.status = 'active'
    and exists (
      select 1 from public.user_follows f
      where f.follower_id = (select auth.uid()) and f.followee_id = p.user_id
    )
    and not private.user_is_suspended(p.user_id)
    and i.status in ('active', 'discontinued')
    and public.category_is_open_leaf(c.id)
    and (p_before_time is null or (p.started_at, p.id) < (p_before_time, p_before_id))
  order by p.started_at desc, p.id desc
  limit 21;
end;
$$;
revoke all on function public.home_following_feed_page(timestamptz, uuid) from public, anon;
grant execute on function public.home_following_feed_page(timestamptz, uuid) to authenticated;
comment on function public.home_following_feed_page(timestamptz, uuid) is
  'Home 팔로잉 tab: current public picks by people the caller follows, caller RLS, 20 rows + lookahead.';
