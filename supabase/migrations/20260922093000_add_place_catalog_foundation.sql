begin;

create table public.place_catalog (
  id uuid primary key default gen_random_uuid(),
  place_provider text not null,
  provider_place_id text not null,
  name text not null,
  normalized_name text not null,
  branch_name text,
  road_address text,
  address text,
  region_1 text,
  region_2 text,
  latitude double precision,
  longitude double precision,
  provider_category text,
  business_status text not null default 'open'
    check (business_status in ('open','closed')),
  source_updated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_catalog_provider_shape
    check (place_provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint place_catalog_provider_id_length
    check (char_length(btrim(provider_place_id)) between 1 and 200),
  constraint place_catalog_name_length
    check (char_length(btrim(name)) between 1 and 200),
  constraint place_catalog_coordinate_pair
    check ((latitude is null) = (longitude is null)),
  constraint place_catalog_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint place_catalog_longitude_range
    check (longitude is null or longitude between -180 and 180),
  constraint place_catalog_closed_at
    check (
      (business_status='closed' and closed_at is not null)
      or (business_status='open' and closed_at is null)
    ),
  unique(place_provider, provider_place_id)
);

create index place_catalog_name_trgm
  on public.place_catalog using gin (normalized_name extensions.gin_trgm_ops);
create index place_catalog_region
  on public.place_catalog(region_1, region_2)
  where business_status='open';

create trigger place_catalog_set_updated_at
before update on public.place_catalog
for each row execute function private.set_updated_at();

alter table public.place_catalog enable row level security;

revoke all on public.place_catalog from public, anon, authenticated;
grant select on public.place_catalog to anon, authenticated;
grant all on public.place_catalog to service_role;

create policy place_catalog_anon_read on public.place_catalog
for select to anon
using (business_status='open');

create policy place_catalog_authenticated_read on public.place_catalog
for select to authenticated
using ((select private.is_admin_mfa()) or business_status='open');

create table private.place_import_raw (
  id bigint generated always as identity primary key,
  place_provider text not null,
  provider_place_id text not null,
  source_updated_at timestamptz not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  constraint place_import_raw_provider_shape
    check (place_provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint place_import_raw_provider_id_length
    check (char_length(btrim(provider_place_id)) between 1 and 200),
  constraint place_import_raw_payload_object
    check (jsonb_typeof(payload)='object'),
  unique(place_provider, provider_place_id, source_updated_at)
);

create table private.place_import_runs (
  id bigint generated always as identity primary key,
  provider text not null,
  window_start date not null,
  window_end date not null,
  fetched_count integer not null default 0 check (fetched_count >= 0),
  promoted_count integer not null default 0 check (promoted_count >= 0),
  status text not null default 'running'
    check (status in ('running','succeeded','failed','aborted')),
  error_message text,
  checkpoint jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint place_import_runs_provider_shape
    check (provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint place_import_run_window
    check (window_start <= window_end),
  constraint place_import_run_finished
    check (
      (status='running' and finished_at is null)
      or (status<>'running' and finished_at is not null)
    )
);

alter table private.place_import_raw enable row level security;
alter table private.place_import_runs enable row level security;

revoke all on private.place_import_raw, private.place_import_runs
  from public, anon, authenticated;
grant select, insert, update, delete on private.place_import_raw to service_role;
grant select, insert, update on private.place_import_runs to service_role;
grant usage, select on sequence private.place_import_raw_id_seq to service_role;
grant usage, select on sequence private.place_import_runs_id_seq to service_role;

create or replace function private.normalize_place_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_name),'[[:space:]]+','','g'));
$$;

revoke all on function private.normalize_place_name(text)
  from public, anon, authenticated;

create or replace function private.promote_place_imports(p_provider text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_provider is null
     or p_provider !~ '^[a-z][a-z0-9_]{0,31}$' then
    raise exception 'PLACE_PROVIDER_INVALID' using errcode='P0001';
  end if;

  with latest as (
    select distinct on (r.place_provider,r.provider_place_id)
      r.place_provider,
      r.provider_place_id,
      r.source_updated_at,
      r.payload
    from private.place_import_raw r
    where r.place_provider=p_provider
    order by r.place_provider,r.provider_place_id,r.source_updated_at desc
  ),
  prepared as (
    select
      l.place_provider,
      l.provider_place_id,
      nullif(btrim(l.payload->>'name'),'') as name,
      nullif(btrim(l.payload->>'branch_name'),'') as branch_name,
      nullif(btrim(l.payload->>'road_address'),'') as road_address,
      nullif(btrim(l.payload->>'address'),'') as address,
      nullif(btrim(l.payload->>'region_1'),'') as region_1,
      nullif(btrim(l.payload->>'region_2'),'') as region_2,
      case
        when (l.payload->>'latitude') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (l.payload->>'latitude')::double precision
      end as latitude,
      case
        when (l.payload->>'longitude') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (l.payload->>'longitude')::double precision
      end as longitude,
      nullif(btrim(l.payload->>'provider_category'),'') as provider_category,
      case
        when lower(coalesce(l.payload->>'business_status','open'))='closed'
          then 'closed'
        else 'open'
      end as business_status,
      l.source_updated_at
    from latest l
  ),
  valid as (
    select *
    from prepared
    where name is not null
      and char_length(name) between 1 and 200
      and (
        (latitude is null and longitude is null)
        or (
          latitude between -90 and 90
          and longitude between -180 and 180
        )
      )
  )
  insert into public.place_catalog(
    place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,address,region_1,region_2,latitude,longitude,
    provider_category,business_status,source_updated_at,closed_at
  )
  select
    v.place_provider,
    v.provider_place_id,
    v.name,
    private.normalize_place_name(v.name),
    v.branch_name,
    v.road_address,
    v.address,
    v.region_1,
    v.region_2,
    v.latitude,
    v.longitude,
    v.provider_category,
    v.business_status,
    v.source_updated_at,
    case
      when v.business_status='closed'
        then v.source_updated_at
      else null
    end
  from valid v
  on conflict(place_provider,provider_place_id) do update set
    name=excluded.name,
    normalized_name=excluded.normalized_name,
    branch_name=excluded.branch_name,
    road_address=excluded.road_address,
    address=excluded.address,
    region_1=excluded.region_1,
    region_2=excluded.region_2,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    provider_category=excluded.provider_category,
    business_status=excluded.business_status,
    source_updated_at=excluded.source_updated_at,
    closed_at=excluded.closed_at
  where public.place_catalog.source_updated_at is null
     or excluded.source_updated_at > public.place_catalog.source_updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- SECURITY DEFINER changes current_user to the function owner, so caller
-- authorization is enforced by the function ACL instead of an in-body
-- current_user check. Only service_role may execute the promotion function.
revoke all on function private.promote_place_imports(text)
  from public, anon, authenticated;
grant execute on function private.promote_place_imports(text)
  to service_role;

commit;
