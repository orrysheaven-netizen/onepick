-- Client writes must reserve quota and insert the event in the same transaction.
revoke insert on public.product_analytics_events from public, anon, authenticated;
drop policy product_analytics_events_insert_session on public.product_analytics_events;

alter policy product_analytics_events_select_admin on public.product_analytics_events
  using ((select private.is_admin_mfa()));

create table private.analytics_event_limits (
  -- NULL denotes the single anonymous bucket; authenticated buckets cascade on deletion.
  user_id uuid references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  requests integer not null default 0 check (requests >= 0),
  unique nulls not distinct (user_id)
);
alter table private.analytics_event_limits enable row level security;
revoke all on private.analytics_event_limits from public, anon, authenticated;
create policy deny_client_access on private.analytics_event_limits
  for all to anon, authenticated using (false) with check (false);

create function private.consume_analytics_event(
  p_event_name text,
  p_pick_id uuid default null,
  p_item_id uuid default null,
  p_category_id uuid default null,
  p_source text default null,
  p_path text default null,
  p_platform text default null,
  p_app_version text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_limit integer := case when v_user_id is null then 120 else 60 end;
begin
  -- Anonymous calls intentionally share one bounded bucket. Request headers and
  -- client-chosen session IDs are not trusted identities at the direct RPC boundary.
  -- UPSERT locks the bucket, so concurrent requests cannot overrun the limit.
  insert into private.analytics_event_limits(user_id, requests) values (v_user_id, 1)
  on conflict (user_id) do update set
    requests = case when private.analytics_event_limits.window_start <= now() - interval '1 minute'
      then 1 else private.analytics_event_limits.requests + 1 end,
    window_start = case when private.analytics_event_limits.window_start <= now() - interval '1 minute'
      then now() else private.analytics_event_limits.window_start end
  returning requests into v_count;

  if v_count > v_limit then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  -- Caller cannot choose user_id, id or created_at. Existing CHECK/FK constraints
  -- still validate the payload; failure rolls back both the event and its quota.
  insert into public.product_analytics_events(
    user_id, event_name, pick_id, item_id, category_id, source, path, platform, app_version
  ) values (
    v_user_id, p_event_name, p_pick_id, p_item_id, p_category_id,
    p_source, p_path, p_platform, p_app_version
  );
end;
$$;
revoke all on function private.consume_analytics_event(text,uuid,uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function private.consume_analytics_event(text,uuid,uuid,uuid,text,text,text,text)
  to anon, authenticated;

create function public.capture_product_event(
  p_event_name text,
  p_pick_id uuid default null,
  p_item_id uuid default null,
  p_category_id uuid default null,
  p_source text default null,
  p_path text default null,
  p_platform text default null,
  p_app_version text default null
)
returns void language sql security invoker set search_path = '' as $$
  select private.consume_analytics_event(
    p_event_name, p_pick_id, p_item_id, p_category_id,
    p_source, p_path, p_platform, p_app_version
  );
$$;
revoke all on function public.capture_product_event(text,uuid,uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.capture_product_event(text,uuid,uuid,uuid,text,text,text,text)
  to anon, authenticated;
