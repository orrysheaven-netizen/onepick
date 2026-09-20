begin;

create index if not exists item_category_ai_suggestions_user_id_idx
  on public.item_category_ai_suggestions(user_id);

drop policy if exists item_category_ai_suggestions_deny_anon
  on public.item_category_ai_suggestions;
create policy item_category_ai_suggestions_deny_anon
on public.item_category_ai_suggestions
for all to anon
using (false)
with check (false);

drop policy if exists item_category_ai_suggestions_deny_authenticated
  on public.item_category_ai_suggestions;
create policy item_category_ai_suggestions_deny_authenticated
on public.item_category_ai_suggestions
for all to authenticated
using (false)
with check (false);

create or replace function private.admin_review_pending_item_impl(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found or v_item.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if p_status='rejected' then
    update public.items
    set status='rejected', merged_into_item_id=null
    where id=v_item.id
    returning * into v_item;
    return v_item;
  end if;

  if p_status<>'active' then
    raise exception 'ITEM_STATUS_INVALID' using errcode='P0001';
  end if;

  select * into v_category
  from public.categories
  where id=coalesce(p_category_id,v_item.category_id);

  if not found
     or v_category.slug='pending-product'
     or not public.category_is_open_leaf(v_category.id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(v_item.name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  if exists (
    select 1 from public.items i
    where i.id<>v_item.id
      and i.category_id=v_category.id
      and i.normalized_name=v_normalized
      and i.status in ('active','discontinued')
  ) then
    raise exception 'ITEM_DUPLICATE' using errcode='P0001';
  end if;

  update public.items
  set category_id=v_category.id,
      name=v_name,
      normalized_name=v_normalized,
      status='active',
      merged_into_item_id=null
  where id=v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function private.admin_review_pending_item_impl(uuid,text,uuid)
  from public, anon;
grant execute on function private.admin_review_pending_item_impl(uuid,text,uuid)
  to authenticated, service_role;

create or replace function public.admin_review_pending_item(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.admin_review_pending_item_impl(p_item_id,p_status,p_category_id);
$$;

revoke all on function public.admin_review_pending_item(uuid,text,uuid)
  from public, anon;
grant execute on function public.admin_review_pending_item(uuid,text,uuid)
  to authenticated, service_role;

commit;
