grant usage on schema private to service_role;

alter function public.admin_users(text) set schema private;
alter function public.admin_user_moderation(uuid) set schema private;
alter function public.admin_set_user_suspension(uuid, boolean, text) set schema private;

create function public.admin_users(p_query text default '')
returns table(
  id uuid,
  username text,
  onboarding_completed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  moderation_status text,
  suspension_reason text,
  suspended_at timestamptz,
  is_admin boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.admin_users(p_query);
$function$;

create function public.admin_user_moderation(p_user_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_user_moderation(p_user_id);
$function$;

create function public.admin_set_user_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_set_user_suspension(p_user_id, p_suspended, p_reason);
$function$;

revoke all on function public.admin_users(text) from public, anon;
revoke all on function public.admin_user_moderation(uuid) from public, anon;
revoke all on function public.admin_set_user_suspension(uuid, boolean, text) from public, anon;

grant execute on function public.admin_users(text) to authenticated, service_role;
grant execute on function public.admin_user_moderation(uuid) to authenticated, service_role;
grant execute on function public.admin_set_user_suspension(uuid, boolean, text) to authenticated, service_role;
