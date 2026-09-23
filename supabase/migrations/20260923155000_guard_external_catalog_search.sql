-- Add per-caller quotas before the existing provider-wide queue and
-- prune stale search-cache rows on a fixed schedule.

create table public.external_catalog_caller_limits (
  provider text not null check (provider in ('tmdb','musicbrainz','igdb','google_books')),
  scope text not null check (scope in ('user','ip')),
  subject text not null,
  window_started_at timestamptz not null default statement_timestamp(),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (provider, scope, subject)
);

alter table public.external_catalog_caller_limits enable row level security;
revoke all on public.external_catalog_caller_limits from public, anon, authenticated;
grant all on public.external_catalog_caller_limits to service_role;

create or replace function public.reserve_external_catalog_caller(
  p_provider text,
  p_user_id uuid default null,
  p_ip_hash text default null
)
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
  if p_provider not in ('tmdb','musicbrainz','igdb','google_books') then return false; end if;
  if p_user_id is null and p_ip_hash is null then return false; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then return false; end if;

  if p_user_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('catalog-caller:' || p_provider || ':user:' || p_user_id::text, 0)
    );
    select window_started_at, used_count into v_window, v_count
    from public.external_catalog_caller_limits
    where provider=p_provider and scope='user' and subject=p_user_id::text
    for update;
    if found and v_window > v_now - interval '1 hour' and v_count >= 60 then
      return false;
    end if;
  end if;

  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('catalog-caller:' || p_provider || ':ip:' || p_ip_hash, 0)
    );
    select window_started_at, used_count into v_window, v_count
    from public.external_catalog_caller_limits
    where provider=p_provider and scope='ip' and subject=p_ip_hash
    for update;
    if found and v_window > v_now - interval '1 hour' and v_count >= 120 then
      return false;
    end if;
  end if;

  if p_user_id is not null then
    insert into public.external_catalog_caller_limits(provider,scope,subject,window_started_at,used_count,updated_at)
    values (p_provider,'user',p_user_id::text,v_now,1,v_now)
    on conflict (provider,scope,subject) do update
      set window_started_at = case
            when public.external_catalog_caller_limits.window_started_at <= v_now - interval '1 hour'
              then v_now else public.external_catalog_caller_limits.window_started_at end,
          used_count = case
            when public.external_catalog_caller_limits.window_started_at <= v_now - interval '1 hour'
              then 1 else public.external_catalog_caller_limits.used_count + 1 end,
          updated_at = v_now;
  end if;

  if p_ip_hash is not null then
    insert into public.external_catalog_caller_limits(provider,scope,subject,window_started_at,used_count,updated_at)
    values (p_provider,'ip',p_ip_hash,v_now,1,v_now)
    on conflict (provider,scope,subject) do update
      set window_started_at = case
            when public.external_catalog_caller_limits.window_started_at <= v_now - interval '1 hour'
              then v_now else public.external_catalog_caller_limits.window_started_at end,
          used_count = case
            when public.external_catalog_caller_limits.window_started_at <= v_now - interval '1 hour'
              then 1 else public.external_catalog_caller_limits.used_count + 1 end,
          updated_at = v_now;
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_external_catalog_caller(text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_external_catalog_caller(text,uuid,text)
  to service_role;

create or replace function private.prune_external_catalog_cache()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.external_catalog_cache
  where provider in ('tmdb','musicbrainz','igdb','google_books')
    and fetched_at < statement_timestamp() - interval '24 hours';
$$;

revoke all on function private.prune_external_catalog_cache() from public, anon, authenticated;
grant execute on function private.prune_external_catalog_cache() to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid)
from cron.job
where jobname = 'onepick-prune-external-catalog-cache';

select cron.schedule(
  'onepick-prune-external-catalog-cache',
  '17 * * * *',
  $$select private.prune_external_catalog_cache();$$
);
