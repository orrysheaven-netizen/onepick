create or replace function private.update_pick_review_impl(
  p_pick_id uuid,
  p_one_line_review text
)
returns public.picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_pick public.picks%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if v_review is null or char_length(v_review) < 1 or char_length(v_review) > 100 then
    raise exception 'REVIEW_INVALID' using errcode = 'P0001';
  end if;

  select * into v_pick
  from public.picks
  where id = p_pick_id;

  if not found then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_pick.user_id <> v_user_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_pick.category_id::text, 0)
  );

  select * into v_pick
  from public.picks
  where id = p_pick_id
  for update;

  if not found
     or v_pick.user_id <> v_user_id
     or v_pick.status not in ('active','needs_review') then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.picks
  set one_line_review = v_review,
      status = 'active',
      updated_at = now()
  where id = v_pick.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function private.update_pick_review_impl(uuid, text) from public, anon;
grant execute on function private.update_pick_review_impl(uuid, text) to authenticated;

create or replace function public.update_pick_review(
  p_pick_id uuid,
  p_one_line_review text
)
returns public.picks
language sql
security invoker
set search_path = ''
as $$
  select private.update_pick_review_impl(p_pick_id, p_one_line_review);
$$;

revoke execute on function public.update_pick_review(uuid, text) from public, anon;
grant execute on function public.update_pick_review(uuid, text) to authenticated;

create or replace function private.remove_pick_impl(
  p_category_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.picks%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_category_id::text, 0)
  );

  select * into v_current
  from public.picks
  where user_id = v_user_id
    and category_id = p_category_id
    and status in ('active','needs_review')
  for update;

  if not found then
    return false;
  end if;

  update public.picks
  set status = 'removed',
      ended_at = now(),
      replaced_by_pick_id = null,
      updated_at = now()
  where id = v_current.id;

  return true;
end;
$$;

revoke execute on function private.remove_pick_impl(uuid) from public, anon;
grant execute on function private.remove_pick_impl(uuid) to authenticated;

create or replace function public.remove_pick(
  p_category_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.remove_pick_impl(p_category_id);
$$;

revoke execute on function public.remove_pick(uuid) from public, anon;
grant execute on function public.remove_pick(uuid) to authenticated;
