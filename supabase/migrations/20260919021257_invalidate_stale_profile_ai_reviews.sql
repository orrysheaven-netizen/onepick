-- Track source changes independently of successful generations. Invalidation must
-- never reset the existing quota deadline.
alter table public.profile_ai_generation_limits
  add column source_version bigint not null default 0 check (source_version >= 0);
alter table public.profile_ai_reviews
  add column source_version bigint not null default 0 check (source_version >= 0),
  add column is_stale boolean not null default false;
grant select (is_stale) on public.profile_ai_reviews to anon, authenticated;

-- Results created before source-version tracking must be reviewed again.
update public.profile_ai_reviews set is_stale = true, is_visible = false;
alter table public.profile_ai_reviews add constraint profile_ai_reviews_no_stale_publication
  check (not is_visible or not is_stale);

-- This is a private integrity trigger, not an RPC. Source writes have already
-- passed their existing commands/RLS. Definer rights are narrowly needed to
-- invalidate system-owned results without granting users AI-author permissions.
create function private.invalidate_profile_ai_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
      from public.picks p where p.item_id = old.id and p.status = 'active';
  elsif tg_table_name = 'categories' then
    if tg_op = 'UPDATE' and row(old.name, old.status, old.is_visible)
       is not distinct from row(new.name, new.status, new.is_visible) then
      return null;
    end if;
    select array_agg(distinct p.user_id) into affected
      from public.picks p where p.category_id = old.id and p.status = 'active';
  else
    raise exception 'INVALID_AI_SOURCE_TRIGGER';
  end if;

  -- Stable lock order for catalog changes affecting more than one profile.
  for affected_profile in
    select distinct value from unnest(coalesce(affected, '{}'::uuid[])) as ids(value)
    where value is not null order by value
  loop
    -- Account deletion may have already removed the referenced profile.
    if not exists (select 1 from public.profiles where id = affected_profile) then
      continue;
    end if;
    insert into public.profile_ai_generation_limits as limits
      (profile_id, next_allowed_at, source_version)
    values (affected_profile, '-infinity'::timestamptz, 1)
    on conflict (profile_id) do update
      set source_version = limits.source_version + 1;
    update public.profile_ai_reviews
      set is_stale = true, is_visible = false
      where profile_id = affected_profile and (not is_stale or is_visible);
  end loop;
  return null;
end;
$function$;
revoke all on function private.invalidate_profile_ai_sources() from public, anon, authenticated;

create trigger picks_invalidate_profile_ai
  after insert or update or delete on public.picks
  for each row execute function private.invalidate_profile_ai_sources();
create trigger items_invalidate_profile_ai
  after update or delete on public.items
  for each row execute function private.invalidate_profile_ai_sources();
create trigger categories_invalidate_profile_ai
  after update or delete on public.categories
  for each row execute function private.invalidate_profile_ai_sources();

-- Server-only, SECURITY INVOKER: the caller must already have write privileges.
-- Saving and invalidation lock the same quota/source row. A result generated from
-- an older source version cannot be saved after a committed source change.
create function public.save_profile_ai_review(
  p_profile_id uuid, p_source_version bigint, p_actor_id uuid,
  p_summary text, p_body text, p_keywords text[], p_pick_snapshot jsonb,
  p_source_fingerprint text, p_model_name text, p_prompt_version text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
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
    where limits.profile_id = p_profile_id for update;
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
  ) on conflict (profile_id) do update set
    actor_id = excluded.actor_id, summary = excluded.summary, body = excluded.body,
    keywords = excluded.keywords, pick_snapshot = excluded.pick_snapshot,
    source_fingerprint = excluded.source_fingerprint, model_name = excluded.model_name,
    prompt_version = excluded.prompt_version, source_version = excluded.source_version,
    is_stale = false, is_visible = false, generated_at = excluded.generated_at
  returning * into saved;
  -- New text always receives a private preview, even after a previous publication.
  return to_jsonb(saved) - array[
    'pick_snapshot', 'source_fingerprint', 'source_version', 'model_name', 'prompt_version'
  ];
end;
$function$;
revoke all on function public.save_profile_ai_review(uuid,bigint,uuid,text,text,text[],jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.save_profile_ai_review(uuid,bigint,uuid,text,text,text[],jsonb,text,text,text)
  to service_role;

