-- Security QA #225 item 2: bound public external-catalog search pressure.
create table private.external_catalog_caller_limits (
  provider text not null,
  subject_hash text not null,
  window_start timestamptz not null default clock_timestamp(),
  requests integer not null default 0 check (requests between 0 and 61),
  primary key(provider, subject_hash),
  constraint external_catalog_caller_limits_provider_check
    check (provider in ('tmdb','musicbrainz','igdb','google_books')),
  constraint external_catalog_caller_limits_subject_check
    check (subject_hash ~ '^[0-9a-f]{64}$')
);
alter table private.external_catalog_caller_limits enable row level security;
revoke all on table private.external_catalog_caller_limits from public, anon, authenticated;

create policy deny_client_access on private.external_catalog_caller_limits
  for all to anon, authenticated
  using (false) with check (false);

create or replace function public.consume_external_catalog_search(
  p_provider text,
  p_subject_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_allowed boolean;
begin
  if p_provider not in ('tmdb','musicbrainz','igdb','google_books')
     or p_subject_hash is null
     or p_subject_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into private.external_catalog_caller_limits(provider,subject_hash,window_start,requests)
  values(p_provider,p_subject_hash,clock_timestamp(),1)
  on conflict(provider,subject_hash) do update
  set
    window_start = case
      when private.external_catalog_caller_limits.window_start <= clock_timestamp()-interval '1 hour'
        then clock_timestamp()
      else private.external_catalog_caller_limits.window_start
    end,
    requests = case
      when private.external_catalog_caller_limits.window_start <= clock_timestamp()-interval '1 hour'
        then 1
      else least(61,private.external_catalog_caller_limits.requests+1)
    end
  returning requests <= 60 into v_allowed;

  return coalesce(v_allowed,false);
end;
$function$;

revoke all on function public.consume_external_catalog_search(text,text) from public, anon, authenticated;
grant execute on function public.consume_external_catalog_search(text,text) to service_role;

create or replace function private.cleanup_external_catalog_security_state()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cache integer;
  v_limits integer;
begin
  delete from public.external_catalog_cache
  where provider in ('tmdb','musicbrainz','igdb','google_books')
    and fetched_at < clock_timestamp()-interval '35 days';
  get diagnostics v_cache = row_count;

  delete from private.external_catalog_caller_limits
  where window_start < clock_timestamp()-interval '2 hours';
  get diagnostics v_limits = row_count;

  return v_cache + v_limits;
end;
$function$;

revoke all on function private.cleanup_external_catalog_security_state() from public, anon, authenticated;

select cron.schedule(
  'onepick-external-catalog-security-cleanup',
  '43 3 * * *',
  $cron$select private.cleanup_external_catalog_security_state();$cron$
);
