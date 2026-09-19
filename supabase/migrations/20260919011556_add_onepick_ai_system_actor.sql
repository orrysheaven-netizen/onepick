create table if not exists public.system_actors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40),
  actor_type text not null default 'ai'
    check (actor_type in ('ai')),
  bio text
    check (bio is null or char_length(btrim(bio)) between 1 and 240),
  avatar_url text,
  is_verified boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_actors enable row level security;

revoke all on table public.system_actors from anon, authenticated;
grant select (id, slug, display_name, actor_type, bio, avatar_url, is_verified, is_active, created_at, updated_at)
  on table public.system_actors to anon, authenticated;
grant all on table public.system_actors to service_role;

drop policy if exists system_actors_public_read on public.system_actors;
create policy system_actors_public_read
on public.system_actors
for select
to anon, authenticated
using (is_active = true);

drop trigger if exists system_actors_set_updated_at on public.system_actors;
create trigger system_actors_set_updated_at
before update on public.system_actors
for each row execute function private.set_updated_at();

insert into public.system_actors (
  slug,
  display_name,
  actor_type,
  bio,
  is_verified,
  is_active
)
values (
  'onepick_ai',
  'OnePick AI',
  'ai',
  '내 취향이 곧 나이다. 공개된 원픽을 바탕으로 취향의 패턴을 해석합니다.',
  true,
  true
)
on conflict (slug) do update
set
  display_name = excluded.display_name,
  actor_type = excluded.actor_type,
  bio = excluded.bio,
  is_verified = excluded.is_verified,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists public.profile_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique
    references public.profiles(id) on delete cascade,
  actor_id uuid not null
    references public.system_actors(id) on delete restrict,
  summary text not null
    check (char_length(btrim(summary)) between 1 and 180),
  body text not null
    check (char_length(btrim(body)) between 1 and 1200),
  keywords text[] not null default '{}'::text[]
    check (cardinality(keywords) <= 5),
  pick_snapshot jsonb not null default '[]'::jsonb,
  source_fingerprint text not null
    check (char_length(source_fingerprint) between 8 and 128),
  model_name text not null
    check (char_length(btrim(model_name)) between 1 and 80),
  prompt_version text not null
    check (char_length(btrim(prompt_version)) between 1 and 40),
  is_visible boolean not null default true,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_ai_reviews_actor_id_idx
  on public.profile_ai_reviews(actor_id);

alter table public.profile_ai_reviews enable row level security;

revoke all on table public.profile_ai_reviews from anon, authenticated;
grant select (id, profile_id, actor_id, summary, body, keywords, is_visible, generated_at, created_at, updated_at)
  on table public.profile_ai_reviews to anon, authenticated;
grant update (is_visible)
  on table public.profile_ai_reviews to authenticated;
grant all on table public.profile_ai_reviews to service_role;

drop policy if exists profile_ai_reviews_anon_read_visible on public.profile_ai_reviews;
create policy profile_ai_reviews_anon_read_visible
on public.profile_ai_reviews
for select
to anon
using (is_visible = true);

drop policy if exists profile_ai_reviews_authenticated_read on public.profile_ai_reviews;
create policy profile_ai_reviews_authenticated_read
on public.profile_ai_reviews
for select
to authenticated
using (is_visible = true or profile_id = (select auth.uid()));

drop policy if exists profile_ai_reviews_owner_visibility on public.profile_ai_reviews;
create policy profile_ai_reviews_owner_visibility
on public.profile_ai_reviews
for update
to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

drop trigger if exists profile_ai_reviews_set_updated_at on public.profile_ai_reviews;
create trigger profile_ai_reviews_set_updated_at
before update on public.profile_ai_reviews
for each row execute function private.set_updated_at();
