create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_suspended', (select count(*) from public.profiles p where public.user_is_suspended(p.id)),
    'categories_total', (select count(*) from public.categories),
    'categories_open', (select count(*) from public.categories where status = 'open'),
    'items_total', (select count(*) from public.items),
    'items_pending', (select count(*) from public.items where status = 'pending'),
    'items_active', (select count(*) from public.items where status = 'active'),
    'picks_total', (select count(*) from public.picks),
    'picks_active', (select count(*) from public.picks where status = 'active'),
    'reports_open', (select count(*) from public.content_reports where status in ('open', 'reviewing'))
  );
end;
$function$;
