-- OnePick taste onboarding + AI profile evaluation.
-- First AI evaluation unlocks at 5 picks, one immediate quality upgrade is
-- available at 10 picks, then paid re-analysis requires 5 category-level
-- taste changes and 7 days since the last successful generation.

create table if not exists public.system_actors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  actor_type text not null default 'ai' check (actor_type = 'ai'),
  bio text null check (bio is null or char_length(btrim(bio)) between 1 and 240),
  avatar_url text null,
  is_verified boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.system_actors (slug, display_name, actor_type, bio, is_verified, is_active)
values (
  'onepick_ai',
  'OnePick AI',
  'ai',
  '내 취향이 곧 나이다. 공개된 원픽을 바탕으로 취향의 패턴을 해석합니다.',
  true,
  true
)
on conflict (slug) do update
set display_name = excluded.display_name,
    bio = excluded.bio,
    is_verified = true,
    is_active = true,
    updated_at = now();

create table if not exists public.profile_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.system_actors(id),
  summary text not null check (char_length(btrim(summary)) between 1 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 1200),
  keywords text[] not null default '{}'::text[] check (cardinality(keywords) <= 5),
  pick_snapshot jsonb not null default '[]'::jsonb,
  source_fingerprint text not null check (char_length(source_fingerprint) between 8 and 128),
  model_name text not null check (char_length(btrim(model_name)) between 1 and 80),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 40),
  is_visible boolean not null default false,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_version bigint not null default 0 check (source_version >= 0),
  is_stale boolean not null default false
);

alter table public.profile_ai_reviews
  add column if not exists tone text generated always as (
    case
      when split_part(prompt_version, ':', 2) in ('direct','warm')
       and split_part(prompt_version, ':', 3) = 'tone-v1'
       and split_part(prompt_version, ':', 4) = ''
      then split_part(prompt_version, ':', 2)
      else null
    end
  ) stored;

create table if not exists public.profile_ai_generation_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  next_allowed_at timestamptz not null,
  created_at timestamptz not null default now(),
  source_version bigint not null default 0 check (source_version >= 0)
);

alter table public.system_actors enable row level security;
alter table public.profile_ai_reviews enable row level security;
alter table public.profile_ai_generation_limits enable row level security;

drop policy if exists system_actors_public_read on public.system_actors;
create policy system_actors_public_read
on public.system_actors for select
to anon, authenticated
using (is_active = true);

drop policy if exists profile_ai_reviews_anon_read_visible on public.profile_ai_reviews;
create policy profile_ai_reviews_anon_read_visible
on public.profile_ai_reviews for select
to anon
using (is_visible = true);

drop policy if exists profile_ai_reviews_authenticated_read on public.profile_ai_reviews;
create policy profile_ai_reviews_authenticated_read
on public.profile_ai_reviews for select
to authenticated
using (is_visible = true or profile_id = (select auth.uid()));

drop policy if exists profile_ai_reviews_owner_visibility on public.profile_ai_reviews;
create policy profile_ai_reviews_owner_visibility
on public.profile_ai_reviews for update
to authenticated
using (profile_id = (select auth.uid()))
with check (profile_id = (select auth.uid()));

revoke all on table public.profile_ai_generation_limits from anon, authenticated;
grant select on table public.system_actors to anon, authenticated;
revoke select on table public.profile_ai_reviews from anon, authenticated;
grant select (
  id, profile_id, actor_id, summary, body, keywords,
  is_visible, is_stale, generated_at, created_at, updated_at, tone
) on table public.profile_ai_reviews to anon, authenticated;
grant update (is_visible) on table public.profile_ai_reviews to authenticated;

create or replace function public.reserve_profile_ai_generation(p_profile_id uuid)
returns boolean
language sql
security invoker
set search_path to ''
as $$
  with reserved as (
    insert into public.profile_ai_generation_limits as limits (profile_id, next_allowed_at)
    values (p_profile_id, statement_timestamp() + interval '10 minutes')
    on conflict (profile_id) do update
      set next_allowed_at = excluded.next_allowed_at
      where limits.next_allowed_at <= statement_timestamp()
    returning profile_id
  )
  select exists (select 1 from reserved);
$$;

create or replace function public.save_profile_ai_review(
  p_profile_id uuid,
  p_source_version bigint,
  p_actor_id uuid,
  p_summary text,
  p_body text,
  p_keywords text[],
  p_pick_snapshot jsonb,
  p_source_fingerprint text,
  p_model_name text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  current_version bigint;
  saved public.profile_ai_reviews;
begin
  if p_profile_id is null or p_source_version is null or p_source_version < 0 then
    raise exception 'AI_REVIEW_INVALID';
  end if;
  if auth.uid() is not null and auth.uid() <> p_profile_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select limits.source_version into current_version
  from public.profile_ai_generation_limits limits
  where limits.profile_id = p_profile_id
  for update;

  if not found or current_version <> p_source_version then
    raise exception 'AI_REVIEW_STALE';
  end if;

  if not exists (
    select 1 from public.system_actors a
    where a.id = p_actor_id and a.slug = 'onepick_ai' and a.is_active
  ) then
    raise exception 'AI_ACTOR_NOT_FOUND';
  end if;

  if jsonb_typeof(p_pick_snapshot) is distinct from 'array'
     or cardinality(p_keywords) is distinct from 3 then
    raise exception 'AI_REVIEW_INVALID';
  end if;

  insert into public.profile_ai_reviews (
    profile_id, actor_id, summary, body, keywords, pick_snapshot,
    source_fingerprint, model_name, prompt_version, source_version,
    is_stale, is_visible, generated_at
  ) values (
    p_profile_id, p_actor_id, p_summary, p_body, p_keywords, p_pick_snapshot,
    p_source_fingerprint, p_model_name, p_prompt_version, p_source_version,
    false, false, clock_timestamp()
  )
  on conflict (profile_id) do update set
    actor_id = excluded.actor_id,
    summary = excluded.summary,
    body = excluded.body,
    keywords = excluded.keywords,
    pick_snapshot = excluded.pick_snapshot,
    source_fingerprint = excluded.source_fingerprint,
    model_name = excluded.model_name,
    prompt_version = excluded.prompt_version,
    source_version = excluded.source_version,
    is_stale = false,
    is_visible = false,
    generated_at = excluded.generated_at
  returning * into saved;

  return to_jsonb(saved) - array[
    'pick_snapshot', 'source_fingerprint', 'source_version',
    'model_name', 'prompt_version'
  ];
end;
$$;

revoke all on function public.reserve_profile_ai_generation(uuid) from public, anon, authenticated;
revoke all on function public.save_profile_ai_review(uuid,bigint,uuid,text,text,text[],jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_profile_ai_generation(uuid) to service_role;
grant execute on function public.save_profile_ai_review(uuid,bigint,uuid,text,text,text[],jsonb,text,text,text) to service_role;

create or replace function private.invalidate_profile_ai_sources()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  affected uuid[] := '{}'::uuid[];
  affected_profile uuid;
begin
  if tg_table_schema <> 'public' then
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  if tg_table_name = 'picks' then
    if tg_op = 'INSERT' then
      if new.status = 'active' then affected := array[new.user_id]; end if;
    elsif tg_op = 'DELETE' then
      if old.status = 'active' then affected := array[old.user_id]; end if;
    else
      if row(old.user_id, old.category_id, old.item_id, old.status, old.one_line_review)
         is not distinct from
         row(new.user_id, new.category_id, new.item_id, new.status, new.one_line_review) then
        return null;
      end if;
      if old.status = 'active' then affected := array_append(affected, old.user_id); end if;
      if new.status = 'active' then affected := array_append(affected, new.user_id); end if;
    end if;
  elsif tg_table_name = 'items' then
    if tg_op = 'UPDATE' and
       row(old.name, old.original_name, old.release_year, old.creator_name,
           old.collection_name, old.status, old.category_id)
       is not distinct from
       row(new.name, new.original_name, new.release_year, new.creator_name,
           new.collection_name, new.status, new.category_id) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.item_id = old.id and p.status = 'active';
  elsif tg_table_name = 'categories' then
    if tg_op = 'UPDATE' and
       row(old.name, old.status, old.is_visible)
       is not distinct from
       row(new.name, new.status, new.is_visible) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
    from public.picks p
    where p.category_id = old.id and p.status = 'active';
  else
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  for affected_profile in
    select distinct value
    from unnest(coalesce(affected, '{}'::uuid[])) as ids(value)
    where value is not null
    order by value
  loop
    if not exists (select 1 from public.profiles where id = affected_profile) then
      continue;
    end if;

    insert into public.profile_ai_generation_limits as limits
      (profile_id, next_allowed_at, source_version)
    values (affected_profile, '-infinity'::timestamptz, 1)
    on conflict (profile_id) do update
      set source_version = limits.source_version + 1;

    -- Keep the last published comment visible until a paid refresh succeeds.
    update public.profile_ai_reviews
    set is_stale = true
    where profile_id = affected_profile and not is_stale;
  end loop;

  return null;
end;
$$;

drop trigger if exists picks_invalidate_profile_ai on public.picks;
create trigger picks_invalidate_profile_ai
after insert or update or delete on public.picks
for each row execute function private.invalidate_profile_ai_sources();

drop trigger if exists items_invalidate_profile_ai on public.items;
create trigger items_invalidate_profile_ai
after update or delete on public.items
for each row execute function private.invalidate_profile_ai_sources();

drop trigger if exists categories_invalidate_profile_ai on public.categories;
create trigger categories_invalidate_profile_ai
after update or delete on public.categories
for each row execute function private.invalidate_profile_ai_sources();

create table if not exists public.profile_onboarding_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  current_category_id uuid null references public.categories(id) on delete set null,
  handled_count integer not null default 0 check (handled_count >= 0),
  exited_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_onboarding_category_events (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  action text not null check (action in ('picked','skipped')),
  sequence_no integer not null check (sequence_no >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, category_id),
  unique (profile_id, sequence_no)
);

alter table public.profile_onboarding_state enable row level security;
alter table public.profile_onboarding_category_events enable row level security;

drop policy if exists profile_onboarding_state_owner_read on public.profile_onboarding_state;
create policy profile_onboarding_state_owner_read
on public.profile_onboarding_state for select
to authenticated
using ((select auth.uid()) = profile_id);

drop policy if exists profile_onboarding_state_owner_insert on public.profile_onboarding_state;
create policy profile_onboarding_state_owner_insert
on public.profile_onboarding_state for insert
to authenticated
with check ((select auth.uid()) = profile_id);

drop policy if exists profile_onboarding_state_owner_update on public.profile_onboarding_state;
create policy profile_onboarding_state_owner_update
on public.profile_onboarding_state for update
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

drop policy if exists profile_onboarding_events_owner_read on public.profile_onboarding_category_events;
create policy profile_onboarding_events_owner_read
on public.profile_onboarding_category_events for select
to authenticated
using ((select auth.uid()) = profile_id);

drop policy if exists profile_onboarding_events_owner_insert on public.profile_onboarding_category_events;
create policy profile_onboarding_events_owner_insert
on public.profile_onboarding_category_events for insert
to authenticated
with check ((select auth.uid()) = profile_id);

drop policy if exists profile_onboarding_events_owner_update on public.profile_onboarding_category_events;
create policy profile_onboarding_events_owner_update
on public.profile_onboarding_category_events for update
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

revoke all on table public.profile_onboarding_state from anon;
revoke all on table public.profile_onboarding_category_events from anon;
grant select, insert, update on table public.profile_onboarding_state to authenticated;
grant select, insert, update on table public.profile_onboarding_category_events to authenticated;

create or replace function public.set_profile_onboarding_current(p_category_id uuid)
returns public.profile_onboarding_state
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profile_onboarding_state;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id
      and c.is_visible and c.is_pickable and c.status = 'open'
  ) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = '22023';
  end if;

  insert into public.profile_onboarding_state as s
    (profile_id, current_category_id, exited_at, updated_at)
  values (v_uid, p_category_id, null, now())
  on conflict (profile_id) do update
    set current_category_id = excluded.current_category_id,
        exited_at = null,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_profile_onboarding_action(p_category_id uuid, p_action text)
returns public.profile_onboarding_state
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_next integer;
  v_row public.profile_onboarding_state;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action not in ('picked','skipped') then
    raise exception 'ONBOARDING_ACTION_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.is_pickable
  ) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.profile_onboarding_state(profile_id)
  values (v_uid)
  on conflict (profile_id) do nothing;

  perform 1
  from public.profile_onboarding_state
  where profile_id = v_uid
  for update;

  select coalesce(max(e.sequence_no), 0) + 1
  into v_next
  from public.profile_onboarding_category_events e
  where e.profile_id = v_uid;

  insert into public.profile_onboarding_category_events as e
    (profile_id, category_id, action, sequence_no)
  values (v_uid, p_category_id, p_action, v_next)
  on conflict (profile_id, category_id) do update
    set action = excluded.action,
        updated_at = now();

  update public.profile_onboarding_state s
  set current_category_id = null,
      handled_count = (
        select count(*)::integer
        from public.profile_onboarding_category_events e
        where e.profile_id = v_uid
      ),
      exited_at = null,
      updated_at = now()
  where s.profile_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.pause_profile_onboarding()
returns public.profile_onboarding_state
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profile_onboarding_state;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  insert into public.profile_onboarding_state as s(profile_id, exited_at, updated_at)
  values (v_uid, now(), now())
  on conflict (profile_id) do update
    set exited_at = now(), updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.complete_profile_onboarding()
returns public.profile_onboarding_state
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profile_onboarding_state;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  insert into public.profile_onboarding_state as s
    (profile_id, current_category_id, completed_at, updated_at)
  values (v_uid, null, now(), now())
  on conflict (profile_id) do update
    set current_category_id = null,
        completed_at = now(),
        updated_at = now()
  returning * into v_row;

  update public.profiles
  set onboarding_completed = true, updated_at = now()
  where id = v_uid;

  return v_row;
end;
$$;

revoke all on function public.set_profile_onboarding_current(uuid) from public, anon;
revoke all on function public.record_profile_onboarding_action(uuid,text) from public, anon;
revoke all on function public.pause_profile_onboarding() from public, anon;
revoke all on function public.complete_profile_onboarding() from public, anon;
grant execute on function public.set_profile_onboarding_current(uuid) to authenticated;
grant execute on function public.record_profile_onboarding_action(uuid,text) to authenticated;
grant execute on function public.pause_profile_onboarding() to authenticated;
grant execute on function public.complete_profile_onboarding() to authenticated;

create or replace function public.profile_ai_status()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current_count integer := 0;
  v_review public.profile_ai_reviews;
  v_review_count integer := 0;
  v_changed_count integer := 0;
  v_has_ids boolean := false;
  v_retry_seconds integer := 0;
  v_can_generate boolean := false;
  v_reason text := 'NEED_FIRST_PICKS';
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select count(*)::integer
  into v_current_count
  from public.picks p
  join public.categories c on c.id = p.category_id
  join public.items i on i.id = p.item_id
  where p.user_id = v_uid
    and p.status = 'active'
    and c.is_visible = true
    and i.status in ('active','discontinued');

  select *
  into v_review
  from public.profile_ai_reviews r
  where r.profile_id = v_uid;

  if not found then
    v_can_generate := v_current_count >= 5;
    v_reason := case when v_can_generate then 'READY_FIRST' else 'NEED_FIRST_PICKS' end;
    return jsonb_build_object(
      'currentPickCount', v_current_count,
      'minimumPicks', 5,
      'recommendedPicks', 10,
      'hasReview', false,
      'reviewPickCount', 0,
      'changedCount', 0,
      'minimumChanges', 5,
      'retryAfterSeconds', 0,
      'canGenerate', v_can_generate,
      'reason', v_reason
    );
  end if;

  if jsonb_typeof(v_review.pick_snapshot) = 'array' then
    v_review_count := jsonb_array_length(v_review.pick_snapshot);

    select exists (
      select 1
      from jsonb_array_elements(v_review.pick_snapshot) e
      where e ? 'categoryId' and nullif(e->>'categoryId','') is not null
    )
    into v_has_ids;

    with previous as (
      select
        case when v_has_ids
          then coalesce(nullif(e->>'categoryId',''), 'name:' || coalesce(e->>'category',''))
          else 'name:' || coalesce(e->>'category','')
        end as category_key,
        case when v_has_ids
          then coalesce(nullif(e->>'itemId',''), 'name:' || coalesce(e->>'item',''))
          else 'name:' || coalesce(e->>'item','')
        end as item_key,
        coalesce(e->>'review','') as review
      from jsonb_array_elements(v_review.pick_snapshot) e
    ),
    current_values as (
      select
        case when v_has_ids then c.id::text else 'name:' || c.name end as category_key,
        case when v_has_ids then i.id::text else 'name:' || i.name end as item_key,
        coalesce(p.one_line_review,'') as review
      from public.picks p
      join public.categories c on c.id = p.category_id
      join public.items i on i.id = p.item_id
      where p.user_id = v_uid
        and p.status = 'active'
        and c.is_visible = true
        and i.status in ('active','discontinued')
    ),
    compared as (
      select
        coalesce(a.category_key, b.category_key) as category_key,
        a.item_key as old_item,
        b.item_key as new_item,
        a.review as old_review,
        b.review as new_review
      from previous a
      full join current_values b using (category_key)
    )
    select count(*)::integer
    into v_changed_count
    from compared
    where old_item is distinct from new_item
       or old_review is distinct from new_review;
  end if;

  if v_review_count < 10 then
    v_can_generate := v_current_count >= 10;
    v_reason := case when v_can_generate then 'READY_TEN_PICK_UPGRADE' else 'NEED_TEN_PICKS' end;
  else
    if v_review.generated_at is not null
       and v_review.generated_at + interval '7 days' > now() then
      v_retry_seconds := greatest(
        1,
        ceil(extract(epoch from (
          v_review.generated_at + interval '7 days' - now()
        )))::integer
      );
    end if;

    v_can_generate := v_changed_count >= 5 and v_retry_seconds = 0;
    v_reason := case
      when v_changed_count < 5 then 'NEED_CHANGES'
      when v_retry_seconds > 0 then 'WAIT_WEEK'
      else 'READY_REANALYSIS'
    end;
  end if;

  return jsonb_build_object(
    'currentPickCount', v_current_count,
    'minimumPicks', 5,
    'recommendedPicks', 10,
    'hasReview', true,
    'reviewPickCount', v_review_count,
    'changedCount', v_changed_count,
    'minimumChanges', 5,
    'retryAfterSeconds', v_retry_seconds,
    'canGenerate', v_can_generate,
    'reason', v_reason,
    'generatedAt', v_review.generated_at,
    'isVisible', v_review.is_visible,
    'isStale', v_review.is_stale
  );
end;
$$;

revoke all on function public.profile_ai_status() from public, anon;
grant execute on function public.profile_ai_status() to authenticated;
