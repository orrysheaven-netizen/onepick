create or replace function public.admin_operations_snapshot(p_days integer default 7)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_since timestamptz;
  v_metrics jsonb;
  v_funnel jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_days < 1 or p_days > 90 then
    raise exception 'INVALID_ANALYTICS_WINDOW' using errcode = '22023';
  end if;

  v_since := now() - make_interval(days => p_days);

  select jsonb_build_object(
    'profiles', (
      select count(*) from public.profiles p
      where p.username not like 'demo\_%' escape '\'
    ),
    'active_picks', (
      select count(*)
      from public.picks p
      join public.profiles pr on pr.id = p.user_id
      where p.status = 'active'
        and pr.username not like 'demo\_%' escape '\'
    ),
    'comments', (
      select count(*)
      from public.comments c
      join public.profiles pr on pr.id = c.user_id
      where pr.username not like 'demo\_%' escape '\'
    ),
    'active_items', (
      select count(*) from public.items where status in ('active','discontinued')
    ),
    'pending_items', (
      select count(*) from public.items where status = 'pending'
    ),
    'open_reports', (
      select count(*) from public.content_reports where status in ('open','reviewing')
    )
  ) into v_metrics;

  with filtered_events as (
    select e.*
    from public.product_analytics_events e
    left join public.profiles actor on actor.id = e.user_id
    left join public.picks related_pick on related_pick.id = e.pick_id
    left join public.profiles pick_owner on pick_owner.id = related_pick.user_id
    where e.created_at >= v_since
      and (actor.id is null or actor.username not like 'demo\_%' escape '\')
      and (e.pick_id is null or pick_owner.id is null or pick_owner.username not like 'demo\_%' escape '\')
  )
  select jsonb_build_object(
    'days', p_days,
    'pick_created', count(*) filter (where event_name='pick_created'),
    'pick_share_clicked', count(*) filter (where event_name='pick_share_clicked'),
    'pick_link_opened', count(*) filter (where event_name='pick_link_opened'),
    'item_detail_viewed', count(*) filter (where event_name='item_detail_viewed'),
    'auth_started', count(*) filter (where event_name='auth_started'),
    'auth_completed', count(*) filter (where event_name='auth_completed')
  ) into v_funnel
  from filtered_events;

  return jsonb_build_object(
    'metrics', v_metrics,
    'funnel', v_funnel,
    'generated_at', now()
  );
end;
$function$;

revoke all on function public.admin_operations_snapshot(integer) from public, anon;
grant execute on function public.admin_operations_snapshot(integer) to authenticated, service_role;
