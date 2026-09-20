-- Keep the suspension helper private to normal clients while exposing a narrowly scoped
-- service-role-only RPC for Edge Functions that create external catalog items.
create or replace function public.catalog_user_is_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.user_moderation m
    where m.user_id = p_user_id
  );
$$;

revoke all on function public.catalog_user_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.catalog_user_is_suspended(uuid) to service_role;

comment on function public.catalog_user_is_suspended(uuid) is
  'Server-only suspension check for service-role catalog Edge Functions.';
