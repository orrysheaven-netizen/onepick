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
set search_path to ''
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

  update public.profile_ai_generation_limits
  set next_allowed_at = '-infinity'::timestamptz
  where profile_id = p_profile_id;

  return to_jsonb(saved) - array[
    'pick_snapshot', 'source_fingerprint', 'source_version',
    'model_name', 'prompt_version'
  ];
end;
$function$;

