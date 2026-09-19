create or replace function public.admin_user_moderation(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row private.user_moderation%rowtype;
  v_is_admin boolean;
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_is_admin := private.is_admin(p_user_id);
  select * into v_row from private.user_moderation where user_id = p_user_id;
  if found then
    return jsonb_build_object(
      'user_id', p_user_id,
      'status', 'suspended',
      'reason', v_row.reason,
      'suspended_at', v_row.suspended_at,
      'is_admin', v_is_admin
    );
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'status', 'active',
    'reason', null,
    'suspended_at', null,
    'is_admin', v_is_admin
  );
end;
$$;
revoke all on function public.admin_user_moderation(uuid) from public, anon;
grant execute on function public.admin_user_moderation(uuid) to authenticated;