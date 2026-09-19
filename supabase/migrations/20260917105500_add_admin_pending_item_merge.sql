create or replace function public.admin_merge_pending_item(p_source_item_id uuid, p_target_item_id uuid)
returns public.items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.items%rowtype;
  v_target public.items%rowtype;
  v_result public.items%rowtype;
begin
  if not private.is_admin((select auth.uid())) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_source_item_id is null or p_target_item_id is null or p_source_item_id = p_target_item_id then
    raise exception 'MERGE_TARGET_INVALID' using errcode = 'P0001';
  end if;

  select * into v_source
  from public.items
  where id = p_source_item_id
  for update;

  if not found or v_source.status <> 'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.items
  where id = p_target_item_id
  for update;

  if not found or v_target.status not in ('active', 'discontinued') then
    raise exception 'TARGET_ITEM_INVALID' using errcode = 'P0001';
  end if;

  if v_source.category_id <> v_target.category_id then
    raise exception 'MERGE_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.picks where item_id = v_source.id) then
    raise exception 'SOURCE_ITEM_IN_USE' using errcode = 'P0001';
  end if;

  update public.items
  set status = 'merged', merged_into_item_id = v_target.id
  where id = v_source.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_merge_pending_item(uuid, uuid) from public;
revoke all on function public.admin_merge_pending_item(uuid, uuid) from anon;
grant execute on function public.admin_merge_pending_item(uuid, uuid) to authenticated;
