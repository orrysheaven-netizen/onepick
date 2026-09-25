-- Security QA #289 item 4: block suspended actors from remaining write paths.
-- Keep the existing moderation model intact; this adds a caller-level gate and
-- closes direct authenticated execution of privileged helper functions.

begin;

create or replace function private.reject_suspended_actor_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and private.is_user_suspended(v_actor) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_suspended_actor_write()
  from public, anon, authenticated;

drop trigger if exists reject_suspended_profile_update on public.profiles;
create trigger reject_suspended_profile_update
before update on public.profiles
for each row execute function private.reject_suspended_actor_write();

drop trigger if exists reject_suspended_user_block on public.user_blocks;
create trigger reject_suspended_user_block
before insert on public.user_blocks
for each row execute function private.reject_suspended_actor_write();

drop trigger if exists reject_suspended_content_report on public.content_reports;
create trigger reject_suspended_content_report
before insert on public.content_reports
for each row execute function private.reject_suspended_actor_write();

drop trigger if exists reject_suspended_user_follow on public.user_follows;
create trigger reject_suspended_user_follow
before insert on public.user_follows
for each row execute function private.reject_suspended_actor_write();

-- The public endpoint becomes the only authenticated path into the privileged
-- implementation. SECURITY DEFINER is required because authenticated no longer
-- receives EXECUTE on the private helper.
revoke all on function private.submit_item_impl(uuid,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.submit_item(
  p_category_id uuid,
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and private.is_user_suspended(v_actor) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;

  return private.submit_item_impl(
    p_category_id,
    p_item_name,
    p_image_path,
    p_thumbnail_path,
    p_image_source_url
  );
end;
$$;

revoke all on function public.submit_item(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.submit_item(uuid,text,text,text,text)
  to authenticated, service_role;

revoke all on function private.select_place_catalog_item_impl(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.select_place_catalog_item(
  p_category_id uuid,
  p_catalog_id uuid
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and private.is_user_suspended(v_actor) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;

  return private.select_place_catalog_item_impl(p_category_id,p_catalog_id);
end;
$$;

revoke all on function public.select_place_catalog_item(uuid,uuid)
  from public, anon;
grant execute on function public.select_place_catalog_item(uuid,uuid)
  to authenticated;

commit;
