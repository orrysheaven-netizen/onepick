create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_product_id uuid,
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
  v_category public.categories%rowtype;
  v_product public.products%rowtype;
  v_current public.picks%rowtype;
  v_result public.picks%rowtype;
  v_new_pick_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_review is null or char_length(v_review) < 1 or char_length(v_review) > 100 then
    raise exception 'REVIEW_INVALID' using errcode = 'P0001';
  end if;

  select * into v_category
  from public.categories
  where id = p_category_id;

  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_category.status <> 'open' or v_category.is_pickable is not true then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.categories
    where parent_id = p_category_id
  ) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_product.category_id <> p_category_id then
    raise exception 'PRODUCT_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;

  if v_product.status not in ('active','discontinued') then
    raise exception 'PRODUCT_NOT_ELIGIBLE' using errcode = 'P0001';
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
    insert into public.picks (
      id, user_id, category_id, product_id, one_line_review,
      status, started_at, ended_at, replaced_by_pick_id
    ) values (
      v_new_pick_id, v_user_id, p_category_id, p_product_id, v_review,
      'active', now(), null, null
    )
    returning * into v_result;

    return v_result;
  end if;

  if v_current.product_id = p_product_id then
    update public.picks
    set one_line_review = v_review,
        status = 'active',
        ended_at = null,
        updated_at = now()
    where id = v_current.id
    returning * into v_result;

    return v_result;
  end if;

  update public.picks
  set status = 'replaced',
      ended_at = now(),
      replaced_by_pick_id = v_new_pick_id,
      updated_at = now()
  where id = v_current.id;

  insert into public.picks (
    id, user_id, category_id, product_id, one_line_review,
    status, started_at, ended_at, replaced_by_pick_id
  ) values (
    v_new_pick_id, v_user_id, p_category_id, p_product_id, v_review,
    'active', now(), null, null
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function private.change_pick_impl(uuid, uuid, text) from public, anon;
grant execute on function private.change_pick_impl(uuid, uuid, text) to authenticated;

create or replace function public.change_pick(
  p_category_id uuid,
  p_product_id uuid,
  p_one_line_review text
)
returns public.picks
language sql
security invoker
set search_path = ''
as $$
  select private.change_pick_impl(
    p_category_id,
    p_product_id,
    p_one_line_review
  );
$$;

revoke execute on function public.change_pick(uuid, uuid, text) from public, anon;
grant execute on function public.change_pick(uuid, uuid, text) to authenticated;
