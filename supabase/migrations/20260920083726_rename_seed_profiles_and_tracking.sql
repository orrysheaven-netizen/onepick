begin;

with renamed(id, username, bio) as (
  values
    ('d0e00001-1111-4111-8111-111111111111'::uuid, 'moodarchive', '영화, 게임, 라면처럼 오래 기억에 남는 취향을 모읍니다.'),
    ('d0e00002-2222-4222-8222-222222222222'::uuid, 'weekendpick', '주말에 다시 찾게 되는 콘텐츠와 음식 위주로 기록해요.'),
    ('d0e00003-3333-4333-8333-333333333333'::uuid, 'tastecollector', '작은 취향도 이유가 있으면 오래 남는다고 생각해요.'),
    ('d0e00004-4444-4444-8444-444444444444'::uuid, 'slowfavorite', '천천히 보고 자주 다시 찾는 것들을 골라요.'),
    ('d0e00005-5555-4555-8555-555555555555'::uuid, 'pickandnote', '좋아하는 이유를 한 줄씩 남기는 취향 기록.')
)
update public.profiles p
set username = r.username,
    bio = r.bio,
    updated_at = now()
from renamed r
where p.id = r.id;

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
      where p.id not in (
        'd0e00001-1111-4111-8111-111111111111'::uuid,
        'd0e00002-2222-4222-8222-222222222222'::uuid,
        'd0e00003-3333-4333-8333-333333333333'::uuid,
        'd0e00004-4444-4444-8444-444444444444'::uuid,
        'd0e00005-5555-4555-8555-555555555555'::uuid
      )
    ),
    'active_picks', (
      select count(*)
      from public.picks p
      where p.status = 'active'
        and p.user_id not in (
          'd0e00001-1111-4111-8111-111111111111'::uuid,
          'd0e00002-2222-4222-8222-222222222222'::uuid,
          'd0e00003-3333-4333-8333-333333333333'::uuid,
          'd0e00004-4444-4444-8444-444444444444'::uuid,
          'd0e00005-5555-4555-8555-555555555555'::uuid
        )
    ),
    'comments', (
      select count(*)
      from public.comments c
      where c.user_id not in (
        'd0e00001-1111-4111-8111-111111111111'::uuid,
        'd0e00002-2222-4222-8222-222222222222'::uuid,
        'd0e00003-3333-4333-8333-333333333333'::uuid,
        'd0e00004-4444-4444-8444-444444444444'::uuid,
        'd0e00005-5555-4555-8555-555555555555'::uuid
      )
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
    left join public.picks related_pick on related_pick.id = e.pick_id
    where e.created_at >= v_since
      and (
        e.user_id is null or e.user_id not in (
          'd0e00001-1111-4111-8111-111111111111'::uuid,
          'd0e00002-2222-4222-8222-222222222222'::uuid,
          'd0e00003-3333-4333-8333-333333333333'::uuid,
          'd0e00004-4444-4444-8444-444444444444'::uuid,
          'd0e00005-5555-4555-8555-555555555555'::uuid
        )
      )
      and (
        e.pick_id is null
        or related_pick.id is null
        or related_pick.user_id not in (
          'd0e00001-1111-4111-8111-111111111111'::uuid,
          'd0e00002-2222-4222-8222-222222222222'::uuid,
          'd0e00003-3333-4333-8333-333333333333'::uuid,
          'd0e00004-4444-4444-8444-444444444444'::uuid,
          'd0e00005-5555-4555-8555-555555555555'::uuid
        )
      )
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

commit;
