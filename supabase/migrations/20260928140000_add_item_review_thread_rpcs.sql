-- Item detail keeps ended 한줄평 and their comments (#448 decisions 2·3·4, user
-- 2026-09-27): once a Pick is replaced or removed its review stays on the item
-- page with the same neutral presentation, only the current-Pick badge goes.
--
-- The picks/comments RLS stays as it is (others read active Picks only). Opening
-- ended Picks through RLS would let anyone list a member's past Picks with
-- `picks?user_id=eq.X&status=eq.replaced`, which decision 2 forbids. Instead two
-- item-scoped readers expose ended reviews without any per-person entry point:
--
--   item_review_page(p_item_id, p_after_is_current, p_after_started_at,
--                    p_after_id, p_limit)
--     reviews on one item: current Picks first, then ended ones; hidden Picks,
--     other people's needs_review Picks, suspended authors and blocked members
--     are left out. Rows carry an explicit allowlist, not the whole picks row:
--     the lifecycle status is reduced to is_current (replaced and removed look
--     the same), and ended_at / replaced_by_pick_id / updated_at / created_at /
--     purchase_* never leave the database, so the UI cannot say when or by what
--     a Pick ended. Keyset cursor = the last row's (is_current, started_at, id).
--   pick_comment_page(p_pick_id, p_after_time, p_after_id, p_limit)
--     comments under one review that item_review_page would show, oldest first,
--     with author_current_pick_matches_item: the commenter currently holds this
--     item in this channel as an active Pick (`✓ 이 집 원픽`, decisions 4·6).
--
-- pick_comment_page rows keep the app's `*, author` shape. item_review_page rows
-- need their own small mapper (is_current instead of status). New comments stay
-- limited to active Picks (decision A).

begin;

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
    );
$$;
revoke all on function private.pick_thread_visible(public.picks, uuid) from public, anon, authenticated;

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
      'user_id', r.user_id,
      'category_id', r.category_id,
      'item_id', r.item_id,
      'channel', r.channel,
      'one_line_review', r.one_line_review,
      'is_current', r.is_current,
      'started_at', r.started_at,
      'profile', to_jsonb(pr),
      'category', to_jsonb(c),
      'item', to_jsonb(i)
    )
  from (
    select p.*, p.status in ('active', 'needs_review') as is_current
    from public.picks p
    where p.item_id = p_item_id
      and private.pick_thread_visible(p, auth.uid())
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
revoke all on function public.item_review_page(uuid, boolean, timestamptz, uuid, integer) from public;
grant execute on function public.item_review_page(uuid, boolean, timestamptz, uuid, integer) to anon, authenticated, service_role;
comment on function public.item_review_page(uuid, boolean, timestamptz, uuid, integer) is
  'Item detail reviews: current Picks first, then ended ones, keyset-paged by (is_current, started_at, id). Allowlisted fields only: status is reduced to is_current and no end/update/creation time or purchase fields are returned. Hidden, others'' needs_review, suspended and blocked members excluded.';

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
  select to_jsonb(cm) || jsonb_build_object(
      'author', to_jsonb(pr),
      'author_current_pick_matches_item', exists (
        select 1 from public.picks q
        where q.user_id = cm.user_id
          and q.item_id = v_pick.item_id
          and q.status = 'active'
          and q.channel is not distinct from v_pick.channel
      )
    )
  from public.comments cm
  join public.profiles pr on pr.id = cm.user_id
  where cm.pick_id = v_pick.id
    and (
      cm.user_id = v_viewer
      or (
        not private.user_is_suspended(cm.user_id)
        and not private.users_blocked(v_viewer, cm.user_id)
      )
    )
    and (p_after_time is null or (cm.created_at, cm.id) > (p_after_time, p_after_id))
  order by cm.created_at asc, cm.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;
revoke all on function public.pick_comment_page(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.pick_comment_page(uuid, timestamptz, uuid, integer) to anon, authenticated, service_role;
comment on function public.pick_comment_page(uuid, timestamptz, uuid, integer) is
  'Comments under one review item_review_page would show (current or ended Pick), oldest first, with author_current_pick_matches_item for the ✓ 이 집 원픽 badge.';

commit;
