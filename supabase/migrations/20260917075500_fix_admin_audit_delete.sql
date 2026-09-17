create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type = 'product' then
    v_summary := jsonb_build_object(
      'name', v_row ->> 'name',
      'status', v_row ->> 'status',
      'category_id', v_row ->> 'category_id'
    );
  elsif v_entity_type = 'category' then
    v_summary := jsonb_build_object(
      'name', v_row ->> 'name',
      'status', v_row ->> 'status'
    );
  elsif v_entity_type = 'brand' then
    v_summary := jsonb_build_object(
      'name', v_row ->> 'name',
      'is_active', v_row -> 'is_active'
    );
  elsif v_entity_type = 'content_report' then
    v_summary := jsonb_build_object(
      'status', v_row ->> 'status',
      'target_type', v_row ->> 'target_type',
      'target_id', v_row ->> 'target_id'
    );
  end if;

  insert into public.admin_audit_logs(actor_user_id, entity_type, entity_id, action, summary)
  values (v_actor, v_entity_type, v_entity_id, lower(tg_op), v_summary);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit() from public, anon, authenticated;
