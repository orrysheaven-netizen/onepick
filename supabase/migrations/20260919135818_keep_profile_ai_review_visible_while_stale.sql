create or replace function private.invalidate_profile_ai_sources()
returns trigger
language plpgsql
security definer
set search_path to ''
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

    -- Keep the last published review visible while the user's taste evolves.
    -- The Edge Function decides whether enough distinct pick categories changed
    -- to permit a paid re-analysis.
    update public.profile_ai_reviews
      set is_stale = true
      where profile_id = affected_profile and not is_stale;
  end loop;

  return null;
end;
$function$;

