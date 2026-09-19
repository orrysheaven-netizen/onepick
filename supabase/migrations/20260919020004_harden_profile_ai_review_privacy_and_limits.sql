-- New evaluations are private until their owner explicitly publishes them.
alter table public.profile_ai_reviews alter column is_visible set default false;

-- Reuse the existing profile RLS, including block and suspension rules.
create policy profile_ai_reviews_profile_access
on public.profile_ai_reviews as restrictive
for select to anon, authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = profile_ai_reviews.profile_id
));

-- Only server-side code may reserve an AI generation slot.
create table public.profile_ai_generation_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  next_allowed_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.profile_ai_generation_limits enable row level security;
revoke all on table public.profile_ai_generation_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_ai_generation_limits to service_role;
create policy profile_ai_generation_limits_server_only
on public.profile_ai_generation_limits for all to service_role
using (true) with check (true);

-- ON CONFLICT takes a row lock: concurrent requests cannot both succeed.
-- Failed provider attempts also consume the ten-minute slot.
create function public.reserve_profile_ai_generation(p_profile_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  with reserved as (
    insert into public.profile_ai_generation_limits as limits (profile_id, next_allowed_at)
    values (p_profile_id, statement_timestamp() + interval '10 minutes')
    on conflict (profile_id) do update
      set next_allowed_at = excluded.next_allowed_at
      where limits.next_allowed_at <= statement_timestamp()
    returning profile_id
  )
  select exists (select 1 from reserved);
$function$;
revoke all on function public.reserve_profile_ai_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_profile_ai_generation(uuid) to service_role;
