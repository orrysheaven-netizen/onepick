-- Admin user management: server-side counts, status filter, search by
-- username or id, paging, and per-user activity so a suspension decision does
-- not need a trip to other tabs. admin_users(text) (100-row cap, client-side
-- filtering) stays for compatibility. `matched` is the filtered total; it
-- reads 0 for an offset past the end, which only happens after the list shrank.

create or replace function private.admin_user_directory(
  p_query text default '',
  p_status text default 'all',
  p_sort text default 'created',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_query text := coalesce(btrim(p_query), '');
  v_status text := coalesce(p_status, 'all');
  v_sort text := coalesce(p_sort, 'created');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_counts jsonb;
  v_users jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if v_status not in ('all', 'active', 'suspended') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  if v_sort not in ('created', 'activity') then
    raise exception 'INVALID_SORT' using errcode = '22023';
  end if;

  -- Summary cards count every profile, independent of search and paging.
  select jsonb_build_object(
           'total', count(*),
           'active', count(*) filter (where m.user_id is null),
           'suspended', count(*) filter (where m.user_id is not null)
         )
    into v_counts
  from public.profiles p
  left join private.user_moderation m on m.user_id = p.id;

  with matched as (
    select p.id,
           p.username,
           p.onboarding_completed,
           p.created_at,
           p.updated_at,
           m.user_id is not null as suspended,
           m.reason,
           m.suspended_at,
           (select count(*) from public.picks pk where pk.user_id = p.id and pk.status = 'active') as active_pick_count,
           (select count(*) from public.comments c where c.user_id = p.id) as comment_count,
           (select count(*) from public.content_reports r where r.target_user_id = p.id) as report_count,
           (select count(*) from public.content_reports r where r.target_user_id = p.id and r.status in ('open', 'reviewing')) as open_report_count,
           greatest(
             p.updated_at,
             (select max(pk.created_at) from public.picks pk where pk.user_id = p.id),
             (select max(c.created_at) from public.comments c where c.user_id = p.id)
           ) as last_active_at
    from public.profiles p
    left join private.user_moderation m on m.user_id = p.id
    where (v_status = 'all'
           or (v_status = 'active' and m.user_id is null)
           or (v_status = 'suspended' and m.user_id is not null))
      and (v_query = ''
           or p.username ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           or p.id::text = lower(v_query))
  ),
  counted as (
    select matched.*, count(*) over () as matched_count
    from matched
    order by case when v_sort = 'activity' then last_active_at end desc nulls last,
             created_at desc,
             id
    limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
           'matched', coalesce(max(matched_count), 0),
           'rows', coalesce(jsonb_agg(jsonb_build_object(
             'id', id,
             'username', username,
             'onboarding_completed', onboarding_completed,
             'created_at', created_at,
             'updated_at', updated_at,
             'moderation_status', case when suspended then 'suspended' else 'active' end,
             'suspension_reason', reason,
             'suspended_at', suspended_at,
             'is_admin', private.is_admin(id),
             'active_pick_count', active_pick_count,
             'comment_count', comment_count,
             'report_count', report_count,
             'open_report_count', open_report_count,
             'last_active_at', last_active_at
           ) order by case when v_sort = 'activity' then last_active_at end desc nulls last, created_at desc, id), '[]'::jsonb)
         )
    into v_users
  from counted;

  return jsonb_build_object(
    'counts', v_counts,
    'matched', v_users->'matched',
    'users', v_users->'rows'
  );
end;
$function$;

revoke all on function private.admin_user_directory(text, text, text, integer, integer) from public, anon;
grant execute on function private.admin_user_directory(text, text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_user_directory(
  p_query text default '',
  p_status text default 'all',
  p_sort text default 'created',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_user_directory(p_query, p_status, p_sort, p_limit, p_offset);
$function$;

revoke all on function public.admin_user_directory(text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_user_directory(text, text, text, integer, integer) to authenticated, service_role;
