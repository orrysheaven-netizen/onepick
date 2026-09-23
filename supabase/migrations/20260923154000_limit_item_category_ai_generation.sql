-- Bound paid item-category AI suggestions per authenticated user.
-- The Edge Function verifies the user before calling this service-role-only RPC.

create table public.item_category_ai_generation_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default statement_timestamp(),
  used_count integer not null default 0 check (used_count between 0 and 10),
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.item_category_ai_generation_limits enable row level security;
revoke all on public.item_category_ai_generation_limits from public, anon, authenticated;
grant all on public.item_category_ai_generation_limits to service_role;

create or replace function public.reserve_item_category_ai_generation(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window_started_at timestamptz;
  v_used_count integer;
begin
  if p_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('item-category-ai:' || p_user_id::text, 0)
  );

  select window_started_at, used_count
    into v_window_started_at, v_used_count
  from public.item_category_ai_generation_limits
  where user_id = p_user_id
  for update;

  if not found or v_window_started_at <= v_now - interval '1 hour' then
    insert into public.item_category_ai_generation_limits(
      user_id, window_started_at, used_count, updated_at
    )
    values (p_user_id, v_now, 1, v_now)
    on conflict (user_id) do update
      set window_started_at = excluded.window_started_at,
          used_count = 1,
          updated_at = excluded.updated_at;
    return true;
  end if;

  if v_used_count >= 10 then
    return false;
  end if;

  update public.item_category_ai_generation_limits
  set used_count = used_count + 1,
      updated_at = v_now
  where user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.reserve_item_category_ai_generation(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_item_category_ai_generation(uuid)
  to service_role;
