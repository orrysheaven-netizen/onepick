drop function if exists public.admin_users(text);
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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select p.id,
         p.username,
         p.onboarding_completed,
         p.created_at,
         p.updated_at,
         case when m.user_id is null then 'active'::text else 'suspended'::text end,
         m.reason,
         m.suspended_at,
         private.is_admin(p.id)
  from public.profiles p
  left join private.user_moderation m on m.user_id = p.id
  where coalesce(btrim(p_query), '') = ''
     or p.username ilike '%' || btrim(p_query) || '%'
  order by p.created_at desc
  limit 100;
end;
$$;
revoke all on function public.admin_users(text) from public, anon;
grant execute on function public.admin_users(text) to authenticated;