begin;

create table if not exists public.item_category_ai_suggestions (
  item_id uuid primary key references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_name text not null,
  category_fingerprint text not null,
  payload jsonb not null,
  model_name text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_category_ai_suggestions_payload_object
    check (jsonb_typeof(payload) = 'object')
);

alter table public.item_category_ai_suggestions enable row level security;
revoke all on table public.item_category_ai_suggestions from public, anon, authenticated;
grant select, insert, update, delete on table public.item_category_ai_suggestions to service_role;

create or replace function private.classify_pending_item_impl(
  p_item_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.items%rowtype;
  v_source_slug text;
  v_target public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_existing public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='P0001';
  end if;

  select * into v_item
  from public.items i
  where i.id = p_item_id
    and i.created_by = v_user
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  select c.slug into v_source_slug
  from public.categories c
  where c.id = v_item.category_id;

  if v_item.status <> 'pending' then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  if v_source_slug is distinct from 'pending-product' then
    raise exception 'ITEM_CATEGORY_ALREADY_SET' using errcode='P0001';
  end if;

  select * into v_target
  from public.categories
  where id = p_category_id;

  if not found
     or not public.category_is_open_leaf(v_target.id)
     or not exists (
       select 1
       from public.category_catalog_sources s
       where s.category_id = v_target.id
         and s.mode = 'internal'
         and s.is_enabled = true
     ) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(v_item.name, v_target.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  perform pg_advisory_xact_lock(
    hashtextextended('internal-item:' || v_target.id::text || ':' || v_normalized, 0)
  );

  select * into v_existing
  from public.items i
  where i.id <> v_item.id
    and i.category_id = v_target.id
    and i.normalized_name = v_normalized
    and i.status in ('active','discontinued')
  order by case i.status when 'active' then 0 else 1 end, i.created_at, i.id
  limit 1
  for update;

  if found then
    update public.items
    set status='merged',
        merged_into_item_id=v_existing.id
    where id=v_item.id;

    delete from public.item_category_ai_suggestions where item_id=v_item.id;

    return jsonb_build_object(
      'type','existing_item',
      'itemId',v_existing.id,
      'categoryId',v_existing.category_id
    );
  end if;

  if exists (
    select 1
    from public.items i
    where i.id <> v_item.id
      and i.category_id = v_target.id
      and i.normalized_name = v_normalized
      and i.status = 'pending'
  ) then
    raise exception 'ITEM_ALREADY_PENDING' using errcode='P0001';
  end if;

  update public.items
  set category_id=v_target.id,
      name=v_name,
      normalized_name=v_normalized,
      merged_into_item_id=null
  where id=v_item.id;

  delete from public.item_category_ai_suggestions where item_id=v_item.id;

  return jsonb_build_object(
    'type','classified',
    'itemId',v_item.id,
    'categoryId',v_target.id
  );
end;
$$;

revoke all on function private.classify_pending_item_impl(uuid,uuid)
  from public, anon;
grant execute on function private.classify_pending_item_impl(uuid,uuid)
  to authenticated, service_role;

create or replace function public.classify_pending_item(
  p_item_id uuid,
  p_category_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.classify_pending_item_impl(p_item_id,p_category_id);
$$;

revoke all on function public.classify_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.classify_pending_item(uuid,uuid)
  to authenticated, service_role;

commit;
