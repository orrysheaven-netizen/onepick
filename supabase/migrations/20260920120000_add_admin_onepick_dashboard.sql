-- OnePick admin dashboard: one RPC that returns every number the admin
-- dashboard screen renders, with demo (`demo_%`) and admin-allowlisted
-- accounts removed from all user-activity metrics.
--
-- admin_operations_snapshot() only excludes demo profiles, and
-- admin_dashboard_metrics() excludes nothing, so admins testing the product
-- inflated their own service numbers. This function is the single source for
-- the dashboard; both older RPCs are left in place for existing callers/tests.
--
-- Catalog counts (categories, items) and operational queues (pending items,
-- open reports, suspended users) are not user activity and are not filtered.
--
-- Daily buckets use the Asia/Seoul calendar day, matching how the team reads
-- the numbers, not the UTC day.
create or replace function public.admin_onepick_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_today date;
  v_start date;
  v_since timestamptz;
  v_since_7d timestamptz := now() - interval '7 days';
  v_since_30d timestamptz := now() - interval '30 days';
  v_excluded_ids uuid[];
  v_excluded jsonb;
  v_totals jsonb;
  v_recent jsonb;
  v_queue jsonb;
  v_daily jsonb;
  v_categories jsonb;
  v_top_items jsonb;
  v_funnel jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_days < 7 or p_days > 90 then
    raise exception 'INVALID_DASHBOARD_WINDOW' using errcode = '22023';
  end if;

  v_today := (now() at time zone 'Asia/Seoul')::date;
  v_start := v_today - (p_days - 1);
  v_since := (v_start::timestamp) at time zone 'Asia/Seoul';

  -- private.is_admin(uuid) is security definer, so the allowlist can be
  -- consulted here even though private.admin_users itself is not readable by
  -- the invoking (authenticated) role. The ids are held in an array (a stable
  -- function cannot write a temp table); `<> all(...)` on an empty array is
  -- true, so the coalesce keeps every row when nothing is excluded.
  select
    coalesce(array_agg(p.id), '{}'::uuid[]),
    jsonb_build_object(
      'demo_users', count(*) filter (where p.username like 'demo\_%' escape '\'),
      'admin_users', count(*) filter (where p.username not like 'demo\_%' escape '\')
    )
  into v_excluded_ids, v_excluded
  from public.profiles p
  where p.username like 'demo\_%' escape '\'
     or private.is_admin(p.id);

  select jsonb_build_object(
    'users', (
      select count(*) from public.profiles p
      where p.id <> all(v_excluded_ids)
    ),
    'active_picks', (
      select count(*) from public.picks pk
      where pk.status = 'active'
        and pk.user_id <> all(v_excluded_ids)
    ),
    'picks_total', (
      select count(*) from public.picks pk
      where pk.user_id <> all(v_excluded_ids)
    ),
    'comments', (
      select count(*) from public.comments c
      where c.user_id <> all(v_excluded_ids)
    ),
    'open_categories', (select count(*) from public.categories where status = 'open'),
    'active_items', (select count(*) from public.items where status = 'active')
  ) into v_totals;

  select jsonb_build_object(
    'users_7d', (
      select count(*) from public.profiles p
      where p.created_at >= v_since_7d
        and p.id <> all(v_excluded_ids)
    ),
    'users_30d', (
      select count(*) from public.profiles p
      where p.created_at >= v_since_30d
        and p.id <> all(v_excluded_ids)
    ),
    'picks_7d', (
      select count(*) from public.picks pk
      where pk.created_at >= v_since_7d
        and pk.user_id <> all(v_excluded_ids)
    ),
    'picks_30d', (
      select count(*) from public.picks pk
      where pk.created_at >= v_since_30d
        and pk.user_id <> all(v_excluded_ids)
    ),
    'comments_7d', (
      select count(*) from public.comments c
      where c.created_at >= v_since_7d
        and c.user_id <> all(v_excluded_ids)
    ),
    'comments_30d', (
      select count(*) from public.comments c
      where c.created_at >= v_since_30d
        and c.user_id <> all(v_excluded_ids)
    ),
    'active_users_7d', (
      select count(distinct actor.user_id)
      from (
        select pk.user_id from public.picks pk where pk.created_at >= v_since_7d
        union all
        select c.user_id from public.comments c where c.created_at >= v_since_7d
      ) actor
      where actor.user_id <> all(v_excluded_ids)
    ),
    'active_users_30d', (
      select count(distinct actor.user_id)
      from (
        select pk.user_id from public.picks pk where pk.created_at >= v_since_30d
        union all
        select c.user_id from public.comments c where c.created_at >= v_since_30d
      ) actor
      where actor.user_id <> all(v_excluded_ids)
    )
  ) into v_recent;

  select jsonb_build_object(
    'pending_items', (select count(*) from public.items where status = 'pending'),
    'open_reports', (select count(*) from public.content_reports where status in ('open', 'reviewing')),
    'suspended_users', (select count(*) from public.profiles p where private.user_is_suspended(p.id))
  ) into v_queue;

  with days as (
    select generate_series(v_start, v_today, interval '1 day')::date as day
  ),
  new_users as (
    select (p.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
    from public.profiles p
    where p.created_at >= v_since
      and p.id <> all(v_excluded_ids)
    group by 1
  ),
  new_picks as (
    select (pk.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
    from public.picks pk
    where pk.created_at >= v_since
      and pk.user_id <> all(v_excluded_ids)
    group by 1
  ),
  new_comments as (
    select (c.created_at at time zone 'Asia/Seoul')::date as day, count(*)::int as n
    from public.comments c
    where c.created_at >= v_since
      and c.user_id <> all(v_excluded_ids)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', to_char(d.day, 'YYYY-MM-DD'),
    'users', coalesce(u.n, 0),
    'picks', coalesce(pk.n, 0),
    'comments', coalesce(c.n, 0)
  ) order by d.day), '[]'::jsonb) into v_daily
  from days d
  left join new_users u on u.day = d.day
  left join new_picks pk on pk.day = d.day
  left join new_comments c on c.day = d.day;

  with per_category as (
    select
      cat.id,
      cat.name,
      cat.slug,
      count(pk.id) filter (where pk.status = 'active')::int as active_picks,
      count(distinct pk.user_id) filter (where pk.status = 'active')::int as pickers,
      count(pk.id) filter (where pk.created_at >= v_since)::int as picks_in_window
    from public.categories cat
    left join public.picks pk
      on pk.category_id = cat.id
      and pk.user_id <> all(v_excluded_ids)
    where cat.status = 'open'
    group by cat.id, cat.name, cat.slug
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id,
    'name', pc.name,
    'slug', pc.slug,
    'active_picks', pc.active_picks,
    'pickers', pc.pickers,
    'picks_in_window', pc.picks_in_window
  ) order by pc.active_picks desc, pc.name asc), '[]'::jsonb) into v_categories
  from per_category pc;

  with per_item as (
    select
      i.id,
      i.name,
      cat.name as category_name,
      count(pk.id)::int as active_picks
    from public.picks pk
    join public.items i on i.id = pk.item_id
    join public.categories cat on cat.id = i.category_id
    where pk.status = 'active'
      and pk.user_id <> all(v_excluded_ids)
    group by i.id, i.name, cat.name
    order by count(pk.id) desc, i.name asc
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pi.id,
    'name', pi.name,
    'category_name', pi.category_name,
    'active_picks', pi.active_picks
  ) order by pi.active_picks desc, pi.name asc), '[]'::jsonb) into v_top_items
  from per_item pi;

  -- Same shape and exclusion rules as admin_operations_snapshot's funnel,
  -- extended so admin actors and admin-owned Picks are dropped as well.
  -- Anonymous events (user_id null) are kept: auth_started must stay measurable.
  with filtered_events as (
    select ev.*
    from public.product_analytics_events ev
    left join public.picks related_pick on related_pick.id = ev.pick_id
    where ev.created_at >= v_since
      and (ev.user_id is null or ev.user_id <> all(v_excluded_ids))
      and (related_pick.id is null or related_pick.user_id <> all(v_excluded_ids))
  )
  select jsonb_build_object(
    'pick_created', count(*) filter (where event_name = 'pick_created'),
    'pick_share_clicked', count(*) filter (where event_name = 'pick_share_clicked'),
    'pick_link_opened', count(*) filter (where event_name = 'pick_link_opened'),
    'item_detail_viewed', count(*) filter (where event_name = 'item_detail_viewed'),
    'auth_started', count(*) filter (where event_name = 'auth_started'),
    'auth_completed', count(*) filter (where event_name = 'auth_completed')
  ) into v_funnel
  from filtered_events;

  return jsonb_build_object(
    'days', p_days,
    'generated_at', now(),
    'excluded', v_excluded,
    'totals', v_totals,
    'recent', v_recent,
    'queue', v_queue,
    'daily', v_daily,
    'categories', v_categories,
    'top_items', v_top_items,
    'funnel', v_funnel
  );
end;
$function$;

revoke all on function public.admin_onepick_dashboard(integer) from public, anon;
grant execute on function public.admin_onepick_dashboard(integer) to authenticated, service_role;
