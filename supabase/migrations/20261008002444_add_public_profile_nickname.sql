-- #804: optional public display name, separate from the stable username.
-- No backfill, uniqueness rule, character allowlist, or signup requirement.
begin;

alter table public.profiles add column nickname text;

-- User-approved maximum of 15 PostgreSQL characters. No silent truncation.
alter table public.profiles add constraint profiles_nickname_max_15
  check (nickname is null or char_length(nickname) <= 15);

comment on column public.profiles.nickname is
  'Optional public display name. NULL means unset. Not an identifier; username and profile URLs remain unchanged. Read through existing profile RLS.';

-- Existing table SELECT grants expose this field only on rows allowed by RLS.
-- Editing is a profile UPDATE after profile creation: reuse profiles_self_update
-- and reject_suspended_profile_update instead of adding a privileged write RPC.
-- No new INSERT grant: signup keeps its existing column allowlist.
grant update (nickname) on public.profiles to authenticated;


-- Explicit profile response projection: only stable app profile fields and nickname.
-- Do not use to_jsonb(profile_row): future table columns must not leak into RPC JSON.
create or replace function private.public_profile_json(p public.profiles)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $onepick_profile_body$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'profile_image_url', p.profile_image_url,
    'bio', p.bio,
    'onboarding_completed', p.onboarding_completed,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'nickname', p.nickname
  );
$onepick_profile_body$;
revoke all on function private.public_profile_json(public.profiles) from public, anon, authenticated;

-- Preserve the existing SECURITY DEFINER visibility and tombstone logic.
-- Only replace the unconstrained profile-row JSON serializer.
create or replace function private.comment_json(c public.comments, p_pick public.picks, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $onepick_profile_body$
  select jsonb_build_object(
    'id', c.id,
    'pick_id', c.pick_id,
    'parent_comment_id', c.parent_comment_id,
    'user_id', case when c.deleted_at is null then c.user_id end,
    'body', case when c.deleted_at is null then c.body end,
    'created_at', c.created_at,
    'updated_at', case when c.deleted_at is null then c.updated_at end,
    'is_deleted', c.deleted_at is not null,
    'author', case when c.deleted_at is null then (select private.public_profile_json(pr) from public.profiles pr where pr.id = c.user_id) end,
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
$onepick_profile_body$;

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
as $onepick_profile_body$
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
        'profile', case when p.review_deleted_at is null then private.public_profile_json(pr) end
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
$onepick_profile_body$;

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
as $onepick_profile_body$
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
      'profile', case when r.is_deleted then null else private.public_profile_json(pr) end,
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
$onepick_profile_body$;

commit;
