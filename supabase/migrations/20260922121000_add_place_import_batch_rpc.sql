begin;

create or replace function private.stage_place_import_batch(
  p_provider text,
  p_source_updated_at timestamptz,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_count integer;
  v_unique_count integer;
  v_duplicate_count integer;
  v_inserted_count integer;
  v_existing_count integer;
begin
  if p_provider is null
     or p_provider !~ '^[a-z][a-z0-9_]{0,31}$' then
    raise exception 'PLACE_PROVIDER_INVALID' using errcode='P0001';
  end if;

  if p_source_updated_at is null or p_source_updated_at > now() then
    raise exception 'SOURCE_UPDATED_AT_INVALID' using errcode='P0001';
  end if;

  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'PLACE_IMPORT_ROWS_INVALID' using errcode='P0001';
  end if;

  v_input_count := jsonb_array_length(p_rows);
  if v_input_count < 1 or v_input_count > 500 then
    raise exception 'PLACE_IMPORT_BATCH_SIZE_INVALID' using errcode='P0001';
  end if;

  with parsed as (
    select
      ordinality,
      nullif(btrim(row->>'provider_place_id'),'') as provider_place_id,
      row->'payload' as payload
    from jsonb_array_elements(p_rows) with ordinality as input(row,ordinality)
  )
  select count(distinct provider_place_id), count(*)-count(distinct provider_place_id)
  into v_unique_count,v_duplicate_count
  from parsed
  where provider_place_id is not null;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as input(row)
    where nullif(btrim(row->>'provider_place_id'),'') is null
       or char_length(btrim(row->>'provider_place_id')) > 200
       or jsonb_typeof(row->'payload') is distinct from 'object'
  ) then
    raise exception 'PLACE_IMPORT_ROW_INVALID' using errcode='P0001';
  end if;

  if v_unique_count <> v_input_count or v_duplicate_count <> 0 then
    raise exception 'PLACE_IMPORT_BATCH_DUPLICATE' using errcode='P0001';
  end if;

  with parsed as (
    select
      btrim(row->>'provider_place_id') as provider_place_id,
      row->'payload' as payload
    from jsonb_array_elements(p_rows) as input(row)
  ),
  inserted as (
    insert into private.place_import_raw(
      place_provider,provider_place_id,source_updated_at,payload
    )
    select p_provider,p.provider_place_id,p_source_updated_at,p.payload
    from parsed p
    on conflict(place_provider,provider_place_id,source_updated_at) do nothing
    returning 1
  )
  select count(*) into v_inserted_count from inserted;

  v_existing_count := v_input_count-v_inserted_count;

  return jsonb_build_object(
    'provider',p_provider,
    'source_updated_at',p_source_updated_at,
    'input_count',v_input_count,
    'inserted_count',v_inserted_count,
    'existing_count',v_existing_count
  );
end;
$$;

revoke all on function private.stage_place_import_batch(text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function private.stage_place_import_batch(text,timestamptz,jsonb)
  to service_role;

commit;
