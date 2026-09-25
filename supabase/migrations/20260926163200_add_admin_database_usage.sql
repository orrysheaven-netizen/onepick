-- Admin dashboard: database and file storage usage, so capacity is visible
-- before the hosted plan limit is reached. Sizes are read from the catalog
-- (pg_database_size / pg_total_relation_size) and storage object metadata;
-- nothing is scanned row by row except storage.objects, grouped by bucket.

create or replace function public.admin_database_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_tables jsonb;
  v_buckets jsonb;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t order by (t->>'total_bytes')::bigint desc), '[]'::jsonb)
    into v_tables
  from (
    select jsonb_build_object(
             'schema', n.nspname,
             'name', c.relname,
             'total_bytes', pg_catalog.pg_total_relation_size(c.oid),
             'row_estimate', greatest(c.reltuples, 0)::bigint
           ) as t
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'm')
      and n.nspname in ('public', 'private', 'storage', 'auth')
    order by pg_catalog.pg_total_relation_size(c.oid) desc
    limit 10
  ) top;

  select coalesce(jsonb_agg(jsonb_build_object(
           'bucket', b.id,
           'objects', coalesce(o.objects, 0),
           'bytes', coalesce(o.bytes, 0)
         ) order by coalesce(o.bytes, 0) desc, b.id), '[]'::jsonb)
    into v_buckets
  from storage.buckets b
  left join (
    select bucket_id,
           count(*) as objects,
           sum(coalesce((metadata->>'size')::bigint, 0)) as bytes
    from storage.objects
    group by bucket_id
  ) o on o.bucket_id = b.id;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'storage_bytes', coalesce((select sum((bucket->>'bytes')::bigint) from jsonb_array_elements(v_buckets) bucket), 0),
    'tables', v_tables,
    'buckets', v_buckets
  );
end;
$function$;

revoke all on function public.admin_database_usage() from public, anon;
grant execute on function public.admin_database_usage() to authenticated, service_role;
