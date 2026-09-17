-- Two bounded quota rows per account; clients cannot inspect or reset them.
create table private.community_write_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('comment', 'report')),
  window_start timestamptz not null,
  requests integer not null check (requests between 1 and 10),
  primary key (user_id, action)
);
alter table private.community_write_limits enable row level security;
revoke all on private.community_write_limits from public, anon, authenticated;

create function private.limit_community_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_action text;
  v_window interval;
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if tg_table_schema = 'public' and tg_table_name = 'comments' then
    if new.user_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
    if tg_op = 'UPDATE' and new.body is not distinct from old.body then return null; end if;
    v_action := 'comment';
    v_window := interval '1 minute';
  elsif tg_table_schema = 'public' and tg_table_name = 'content_reports' and tg_op = 'INSERT' then
    if new.reporter_user_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
    v_action := 'report';
    v_window := interval '1 hour';
  else
    raise exception 'FORBIDDEN';
  end if;

  -- ON CONFLICT serializes writes to the same account/action. Never count
  -- client-provided timestamps or existing content that a user could delete.
  insert into private.community_write_limits as quota(user_id, action, window_start, requests)
    values (v_user, v_action, v_now, 1)
  on conflict (user_id, action) do update
    set requests = case when quota.window_start <= v_now - v_window then 1 else quota.requests + 1 end,
        window_start = case when quota.window_start <= v_now - v_window then v_now else quota.window_start end
    where quota.window_start <= v_now - v_window or quota.requests < 10
  returning requests into v_count;
  if not found then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  return null;
end;
$$;
revoke all on function private.limit_community_write() from public, anon, authenticated;

-- AFTER triggers only charge successful rows; failures roll back both content
-- and quota. Existing ownership, visibility and moderation policies remain.
create trigger comments_limit_writes
after insert or update of body on public.comments
for each row execute function private.limit_community_write();

create trigger content_reports_limit_writes
after insert on public.content_reports
for each row execute function private.limit_community_write();
