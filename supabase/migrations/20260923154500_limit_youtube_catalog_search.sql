-- Protect YouTube Data API quota from authenticated abuse as well as anonymous callers.
-- Raw client IPs are never stored; the Edge Function sends a SHA-256 digest when available.

create table public.youtube_catalog_search_limits (
  scope text not null check (scope in ('user','ip')),
  subject text not null,
  window_started_at timestamptz not null default statement_timestamp(),
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, subject)
);

alter table public.youtube_catalog_search_limits enable row level security;
revoke all on public.youtube_catalog_search_limits from public, anon, authenticated;
grant all on public.youtube_catalog_search_limits to service_role;

create or replace function public.reserve_youtube_catalog_search(
  p_user_id uuid,
  p_ip_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_user_window timestamptz;
  v_user_count integer;
  v_ip_window timestamptz;
  v_ip_count integer;
begin
  if p_user_id is null then return false; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('youtube-search:user:' || p_user_id::text, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('youtube-search:ip:' || p_ip_hash, 0));
  end if;

  select window_started_at, used_count
    into v_user_window, v_user_count
  from public.youtube_catalog_search_limits
  where scope='user' and subject=p_user_id::text
  for update;

  if found and v_user_window > v_now - interval '1 hour' and v_user_count >= 20 then
    return false;
  end if;

  if p_ip_hash is not null then
    select window_started_at, used_count
      into v_ip_window, v_ip_count
    from public.youtube_catalog_search_limits
    where scope='ip' and subject=p_ip_hash
    for update;

    if found and v_ip_window > v_now - interval '1 hour' and v_ip_count >= 50 then
      return false;
    end if;
  end if;

  insert into public.youtube_catalog_search_limits(scope,subject,window_started_at,used_count,updated_at)
  values ('user',p_user_id::text,v_now,1,v_now)
  on conflict (scope,subject) do update
    set window_started_at = case
          when public.youtube_catalog_search_limits.window_started_at <= v_now - interval '1 hour'
            then v_now else public.youtube_catalog_search_limits.window_started_at end,
        used_count = case
          when public.youtube_catalog_search_limits.window_started_at <= v_now - interval '1 hour'
            then 1 else public.youtube_catalog_search_limits.used_count + 1 end,
        updated_at = v_now;

  if p_ip_hash is not null then
    insert into public.youtube_catalog_search_limits(scope,subject,window_started_at,used_count,updated_at)
    values ('ip',p_ip_hash,v_now,1,v_now)
    on conflict (scope,subject) do update
      set window_started_at = case
            when public.youtube_catalog_search_limits.window_started_at <= v_now - interval '1 hour'
              then v_now else public.youtube_catalog_search_limits.window_started_at end,
          used_count = case
            when public.youtube_catalog_search_limits.window_started_at <= v_now - interval '1 hour'
              then 1 else public.youtube_catalog_search_limits.used_count + 1 end,
          updated_at = v_now;
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_youtube_catalog_search(uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_youtube_catalog_search(uuid,text)
  to service_role;
