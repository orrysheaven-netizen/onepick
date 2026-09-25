-- Security QA #289 item 3: client error timestamps and row ids are
-- server-owned. Authenticated clients may insert only the payload columns the
-- application intentionally supplies.

begin;

revoke insert on public.client_error_events from authenticated;

grant insert (
  user_id,
  context,
  error_code,
  platform,
  app_version
) on public.client_error_events to authenticated;

alter table public.client_error_events
  alter column id set default gen_random_uuid(),
  alter column created_at set default now();

commit;
