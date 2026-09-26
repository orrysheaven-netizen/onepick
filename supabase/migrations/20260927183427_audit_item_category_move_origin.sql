-- The item audit row only kept the new category_id, so a category move
-- (admin_move_item_category) did not show where the item came from. When an
-- UPDATE changes the category, the summary now also records
-- previous_category_id. Everything else is the same as the previous definition
-- in 20260924235500_add_online_provider_admin_workflow.sql.

begin;

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op='DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type='item' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status',
      'category_id',v_row->>'category_id'
    );
    if tg_op='UPDATE' and old.category_id is distinct from new.category_id then
      v_summary := v_summary || jsonb_build_object(
        'previous_category_id',old.category_id::text
      );
    end if;
  elsif v_entity_type='category' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status'
    );
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'is_active',v_row->'is_active'
    );
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  elsif v_entity_type='provider' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'kind',v_row->>'kind',
      'status',v_row->>'status',
      'brand_id',v_row->>'brand_id',
      'place_id',v_row->>'place_id',
      'online_store_id',v_row->>'online_store_id'
    );
  elsif v_entity_type='online_store' then
    v_summary := jsonb_build_object(
      'store_type',v_row->>'store_type',
      'host',v_row->>'host',
      'platform',v_row->>'platform',
      'store_key',v_row->>'store_key',
      'official_url',v_row->>'official_url'
    );
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit()
  from public, anon, authenticated;

commit;
