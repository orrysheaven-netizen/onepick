-- Bound authenticated external-catalog imports across all providers.
-- Manual item submission already uses the same 20 items / rolling 24h policy.
create table private.external_catalog_import_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default statement_timestamp(),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default statement_timestamp()
);

alter table private.external_catalog_import_limits enable row level security;
revoke all on table private.external_catalog_import_limits from public, anon, authenticated;

create or replace function public.reserve_external_catalog_import(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_user_id is null
     or not exists(select 1 from public.profiles p where p.id = p_user_id) then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('external-catalog-import:' || p_user_id::text, 0)
  );

  select window_started_at, used_count
    into v_window, v_count
  from private.external_catalog_import_limits
  where user_id = p_user_id
  for update;

  if found
     and v_window > v_now - interval '24 hours'
     and v_count >= 20 then
    return false;
  end if;

  insert into private.external_catalog_import_limits(
    user_id, window_started_at, used_count, updated_at
  )
  values(p_user_id, v_now, 1, v_now)
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

  return true;
end;
$$;

revoke all on function public.reserve_external_catalog_import(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_external_catalog_import(uuid)
  to service_role;
