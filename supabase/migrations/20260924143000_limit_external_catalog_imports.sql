-- Bound authenticated external-catalog item creation across all providers.
-- Manual item submission already uses the same 20 items / rolling 24h policy.
create table private.external_catalog_import_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default statement_timestamp(),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default statement_timestamp()
);

alter table private.external_catalog_import_limits enable row level security;
revoke all on table private.external_catalog_import_limits from public, anon, authenticated;

create or replace function private.enforce_external_catalog_import_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  -- Trusted maintenance/seed rows that have no requesting user remain outside
  -- the end-user quota. Edge catalog imports set created_by from the validated JWT.
  if new.external_source is null or new.created_by is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('external-catalog-import:' || new.created_by::text, 0)
  );

  select window_started_at, used_count
    into v_window, v_count
  from private.external_catalog_import_limits
  where user_id = new.created_by
  for update;

  if found
     and v_window > v_now - interval '24 hours'
     and v_count >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into private.external_catalog_import_limits(
    user_id, window_started_at, used_count, updated_at
  )
  values(new.created_by, v_now, 1, v_now)
  on conflict(user_id) do update
  set window_started_at = case
        when private.external_catalog_import_limits.window_started_at <= v_now - interval '24 hours'
          then v_now
        else private.external_catalog_import_limits.window_started_at
      end,
      used_count = case
        when private.external_catalog_import_limits.window_started_at <= v_now - interval '24 hours'
          then 1
        else private.external_catalog_import_limits.used_count + 1
      end,
      updated_at = v_now;

  return new;
end;
$$;

revoke all on function private.enforce_external_catalog_import_limit()
  from public, anon, authenticated;

drop trigger if exists items_external_catalog_import_limit on public.items;
create trigger items_external_catalog_import_limit
before insert on public.items
for each row
when (new.external_source is not null and new.created_by is not null)
execute function private.enforce_external_catalog_import_limit();
