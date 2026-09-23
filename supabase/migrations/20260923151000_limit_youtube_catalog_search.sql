-- Security QA #225 item 1: bound authenticated YouTube provider searches.
create table private.youtube_catalog_search_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default clock_timestamp(),
  requests integer not null default 0 check (requests between 0 and 30)
);
alter table private.youtube_catalog_search_limits enable row level security;
revoke all on table private.youtube_catalog_search_limits from public, anon, authenticated;

create policy deny_client_access on private.youtube_catalog_search_limits
  for all to anon, authenticated
  using (false) with check (false);

create or replace function public.consume_youtube_catalog_search(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_allowed boolean;
begin
  if p_user_id is null then
    return false;
  end if;

  insert into private.youtube_catalog_search_limits(user_id, window_start, requests)
  values (p_user_id, clock_timestamp(), 1)
  on conflict (user_id) do update
  set
    window_start = case
      when private.youtube_catalog_search_limits.window_start <= clock_timestamp() - interval '1 hour'
        then clock_timestamp()
      else private.youtube_catalog_search_limits.window_start
    end,
    requests = case
      when private.youtube_catalog_search_limits.window_start <= clock_timestamp() - interval '1 hour'
        then 1
      else private.youtube_catalog_search_limits.requests + 1
    end
  returning requests <= 30 into v_allowed;

  return coalesce(v_allowed, false);
end;
$function$;

revoke all on function public.consume_youtube_catalog_search(uuid) from public, anon, authenticated;
grant execute on function public.consume_youtube_catalog_search(uuid) to service_role;
