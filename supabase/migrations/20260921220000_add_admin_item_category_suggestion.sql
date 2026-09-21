-- Let admins see the AI category suggestion for a pending item while reviewing it.
--
-- item_category_ai_suggestions is service-role only (the Edge Function writes
-- it and only the submitting user reads it back through that function), so the
-- admin review screen had no way to show the suggestion it should default to.
-- Same definer-impl + invoker-wrapper shape as the other admin RPCs; the impl
-- returns only the stored payload plus provenance, never the user id. Null when
-- no suggestion was ever generated for the item.
create or replace function private.admin_item_category_suggestion_impl(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'item_id', s.item_id,
    'item_name', s.item_name,
    'suggestions', coalesce(s.payload -> 'suggestions', '[]'::jsonb),
    'needs_new_category', coalesce((s.payload ->> 'needsNewCategory')::boolean, false),
    'model_name', s.model_name,
    'updated_at', s.updated_at
  )
  into v_result
  from public.item_category_ai_suggestions s
  where s.item_id = p_item_id;

  return v_result;
end;
$$;

revoke all on function private.admin_item_category_suggestion_impl(uuid) from public, anon;
grant execute on function private.admin_item_category_suggestion_impl(uuid) to authenticated, service_role;

create or replace function public.admin_item_category_suggestion(p_item_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_item_category_suggestion_impl(p_item_id);
$$;

revoke all on function public.admin_item_category_suggestion(uuid) from public, anon;
grant execute on function public.admin_item_category_suggestion(uuid) to authenticated, service_role;
