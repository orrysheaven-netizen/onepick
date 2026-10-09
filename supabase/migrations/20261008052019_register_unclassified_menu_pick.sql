begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #836 (2026-10-08): automatic classification must not block a typed menu.
-- Save an owner-only needs_review Pick, preserving menu and store identity.
-- No public taxonomy is inferred from arbitrary text. Existing categories and
-- ordinary category/channel uniqueness are unchanged.

create table private.unclassified_menu_places (
  item_id uuid primary key references public.items(id) on delete cascade,
  place_id uuid references public.places(id),
  created_at timestamptz not null default now()
);
create index unclassified_menu_places_place_idx on private.unclassified_menu_places(place_id);
alter table private.unclassified_menu_places enable row level security;
revoke all on private.unclassified_menu_places from public, anon, authenticated;
grant all on private.unclassified_menu_places to service_role;
comment on table private.unclassified_menu_places is
  'Store of an automatically unclassified menu (pending-product item). Review hint only: the item becomes a place item when an admin classifies it.';

-- Exempt the pending-product category from the one-current-Pick slot. Its id
-- differs per environment, so the predicate is written with a literal.
do $do$
declare
  v_pending uuid;
begin
  select id into v_pending from public.categories where slug = 'pending-product';
  if v_pending is null then
    raise exception 'pending-product category is missing';
  end if;
  drop index if exists public.picks_one_current_per_category_channel;
  execute format(
    'create unique index picks_one_current_per_category_channel
       on public.picks(user_id, category_id, coalesce(channel, %L))
       where status in (%L, %L) and category_id <> %L::uuid',
    '', 'active', 'needs_review', v_pending
  );
end;
$do$;

create or replace function private.register_unclassified_menu_pick_impl(
  p_menu_name text,
  p_one_line_review text,
  p_catalog_id uuid,
  p_place_name text,
  p_map_url text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_name text;
  v_map text;
  v_normalized text;
  v_user uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_label text := btrim(regexp_replace(coalesce(p_menu_name, ''), '[[:space:]]+', ' ', 'g'));
  v_category_id uuid;
  v_place public.places%rowtype;
  v_item public.items%rowtype;
  v_pick public.picks%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  if v_review is null or char_length(v_review) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode = 'P0001';
  end if;
  if char_length(v_label) not between 1 and 40 then
    raise exception 'CATEGORY_LABEL_INVALID' using errcode = 'P0001';
  end if;

  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_catalog_id is not null and (p_place_name is not null or p_map_url is not null) then
    raise exception 'ITEM_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;
  -- Serialize retries and the per-user quota, even when different menus race.
  perform pg_advisory_xact_lock(hashtextextended('unclassified-menu:' || v_user::text, 0));

  -- A retry of a call that already saved: same answer, nothing new.
  if p_request_id is not null then
    select * into v_pick from public.picks
    where user_id = v_user and client_request_id = p_request_id;
    if found then
      return jsonb_build_object(
        'item_id', v_pick.item_id, 'pick_id', v_pick.id,
        'published', v_pick.status = 'active', 'replaced_pick_id', null, 'retried', true
      );
    end if;
  end if;

  select id into v_category_id
  from public.categories
  where slug = 'pending-product' and status = 'open' and not is_visible and not is_pickable;
  if v_category_id is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_catalog_id is not null then
    v_place := private.place_from_catalog(p_catalog_id);
    v_store_name := btrim(v_place.name);
  elsif p_place_name is not null or p_map_url is not null then
    v_store_name := btrim(coalesce(p_place_name, ''));
    v_map := btrim(coalesce(p_map_url, ''));
    if char_length(v_store_name) not between 1 and 100 then
      raise exception 'PLACE_NAME_INVALID' using errcode = 'P0001';
    end if;
    if not coalesce(private.is_naver_map_url(v_map), false) then
      raise exception 'LINK_INVALID' using errcode = 'P0001';
    end if;
    v_normalized := lower(regexp_replace(v_store_name, '[[:space:]]+', '', 'g'));
  else
    raise exception 'ITEM_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;

  -- The same store and label from the same member is the same request: keep
  -- one item and one current Pick, and let a repeat only update the review.
  perform pg_advisory_xact_lock(
    hashtextextended('category-request:' || v_user::text || ':' || coalesce(v_place.id::text, v_normalized || ':' || v_map) || ':' || lower(v_label), 0)
  );

  select i.* into v_item
  from public.items i
  join private.unclassified_menu_places r on r.item_id = i.id
  where i.category_id = v_category_id
    and i.created_by = v_user
    and i.status = 'pending'
    and (r.place_id = v_place.id or (v_place.id is null and r.place_id is null and exists (
      select 1 from private.user_place_requests q where q.item_id = i.id
        and q.normalized_name = v_normalized and q.map_url = v_map
    )))
    and lower(i.requested_category_label) = lower(v_label)
  order by i.created_at, i.id
  limit 1
  for update;

  if found then
    select * into v_pick from public.picks
    where user_id = v_user and item_id = v_item.id and status in ('active', 'needs_review')
    for update;
    if found then
      update public.picks
      set one_line_review = v_review,
          client_request_id = coalesce(p_request_id, client_request_id),
          updated_at = now()
      where id = v_pick.id
      returning * into v_pick;
      return jsonb_build_object(
        'item_id', v_item.id, 'pick_id', v_pick.id,
        'published', false, 'replaced_pick_id', null, 'retried', false
      );
    end if;
  else
    -- A new request is a new product: it needs a real photo (decision 73/74).
    if p_image_path is null or p_thumbnail_path is null then
      raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
    end if;
    perform private.assert_item_photo_owned(v_user, p_image_path, p_thumbnail_path, p_image_source_url);

    if (
      select count(*) from public.items
      where created_by = v_user and created_at > now() - interval '1 day'
    ) >= 20 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;

    insert into public.items(
      category_id, name, normalized_name, status, created_by,
      image_path, thumbnail_path, image_source_url, requested_category_label
    ) values (
      v_category_id, v_store_name || ' ' || v_label,
      lower(regexp_replace(v_store_name || ' ' || v_label, '[[:space:]]+', '', 'g')),
      'pending', v_user,
      p_image_path, p_thumbnail_path, p_image_source_url, v_label
    ) returning * into v_item;

    insert into private.unclassified_menu_places(item_id, place_id) values (v_item.id, v_place.id);
    if v_place.id is null then
      insert into private.user_place_requests(item_id, name, normalized_name, map_url)
      values (v_item.id, v_store_name, v_normalized, v_map);
    end if;
  end if;

  insert into public.picks(
    user_id, category_id, item_id, channel, one_line_review, status, started_at, client_request_id
  ) values (
    v_user, v_category_id, v_item.id, null, v_review, 'needs_review', now(), p_request_id
  ) returning * into v_pick;

  return jsonb_build_object(
    'item_id', v_item.id, 'pick_id', v_pick.id,
    'published', false, 'replaced_pick_id', null, 'retried', false
  );
end;
$$;

create or replace function public.register_unclassified_menu_pick(
  p_menu_name text,
  p_one_line_review text,
  p_catalog_id uuid default null,
  p_place_name text default null,
  p_map_url text default null,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_unclassified_menu_pick_impl(
    p_menu_name, p_one_line_review, p_catalog_id, p_place_name, p_map_url,
    p_image_path, p_thumbnail_path, p_image_source_url, p_request_id
  );
$$;

revoke all on function private.register_unclassified_menu_pick_impl(text, text, uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function private.register_unclassified_menu_pick_impl(text, text, uuid, text, text, text, text, text, uuid) to authenticated, service_role;
revoke all on function public.register_unclassified_menu_pick(text, text, uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.register_unclassified_menu_pick(text, text, uuid, text, text, text, text, text, uuid) to authenticated, service_role;
comment on function public.register_unclassified_menu_pick(text, text, uuid, text, text, text, text, text, uuid) is
  'Save a store Pick when automatic classification cannot resolve the typed menu. Store = p_catalog_id, or p_place_name + Naver p_map_url. Creates the member''s pending request item in pending-product with requested_category_label (store in private.unclassified_menu_places) and a needs_review Pick (owner-only). Requests on different stores or labels never replace each other; repeating the same store+label updates the review. p_request_id makes retries idempotent.';


create or replace function private.classify_unclassified_menu(p_item_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.unclassified_menu_places%rowtype;
  v_item public.items%rowtype;
  v_place public.places%rowtype;
  v_category public.categories%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into v_request from private.unclassified_menu_places where item_id = p_item_id;
  if not found then
    return; -- Not a category request: the normal review handles it.
  end if;

  select * into v_item from public.items where id = p_item_id;
  -- Same lock order as registration/removal: owner first, then item/Pick rows.
  -- Serialize approval with cancellation so a removed request cannot publish.
  perform pg_advisory_xact_lock(hashtextextended('unclassified-menu:' || v_item.created_by::text, 0));
  select * into v_request from private.unclassified_menu_places where item_id = p_item_id for update;
  if not found then return; end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.status <> 'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.picks
    where item_id = v_item.id and user_id = v_item.created_by and status = 'needs_review'
  ) then
    raise exception 'PICK_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_category from public.categories where id = p_category_id;
  if not found or v_category.slug = 'pending-product'
     or v_category.status <> 'open' or not v_category.is_visible or not v_category.is_pickable
     or not public.category_is_open_leaf(p_category_id) or not private.category_is_food(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;

  -- A food menu created in the admin panel has no catalog source yet; a store
  -- request is what makes it a store menu. An existing source that turned the
  -- store catalog off is an explicit choice and is not overridden.
  insert into public.category_catalog_sources(category_id, mode, is_enabled, place_catalog_enabled)
  values (p_category_id, 'internal', true, true)
  on conflict (category_id) do nothing;
  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'PLACE_CATEGORY_REQUIRED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.created_by::text || ':' || p_category_id::text, 0));
  if v_item.created_by is not null and exists (
    select 1 from public.picks
    where user_id = v_item.created_by
      and category_id = p_category_id
      and coalesce(channel, '') = 'offline'
      and status in ('active', 'needs_review')
      and item_id <> v_item.id
  ) then
    -- The member already has a store Pick for this menu.
    raise exception 'PICK_CONFLICT' using errcode = 'P0001';
  end if;

  -- picks reference (item, category); move both together like admin_move_item_category.
  set constraints public.picks_item_category_fk deferred;

  if v_request.place_id is null then
    -- Resolve the real menu before #841 materializes an approved store request.
    update public.items set category_id = p_category_id where id = v_item.id;
    perform private.materialize_user_place_request(v_item.id);
    select p.* into v_place from public.places p
      join public.item_places ip on ip.place_id = p.id where ip.item_id = v_item.id;
    if not found then raise exception 'ITEM_SELECTION_REQUIRED' using errcode = 'P0001'; end if;
  else
    select * into v_place from public.places where id = v_request.place_id;
    perform pg_advisory_xact_lock(hashtextextended('place-item:' || v_place.id::text || ':' || p_category_id::text, 0));
    if exists (select 1 from public.item_places where place_id = v_place.id and category_id = p_category_id) then
      raise exception 'PLACE_ALREADY_LINKED' using errcode = 'P0001';
    end if;
    update public.items set category_id = p_category_id where id = v_item.id;
    insert into public.item_places(item_id, category_id, place_id)
    values (v_item.id, p_category_id, v_place.id);
  end if;
  update public.items
  set name = btrim(v_place.name),
      normalized_name = lower(regexp_replace(btrim(v_place.name), '[[:space:]]+', '', 'g')),
      external_source = 'onepick_place',
      external_id = v_place.id::text || ':' || p_category_id::text
  where id = v_item.id;

  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'offline', v_place.map_url, true)
  on conflict (item_id, channel) do nothing;

  update public.picks
  set category_id = p_category_id, channel = 'offline', updated_at = now()
  where item_id = v_item.id;

  set constraints public.picks_item_category_fk immediate;

  delete from private.unclassified_menu_places where item_id = v_item.id;
end;
$$;
revoke all on function private.classify_unclassified_menu(uuid, uuid) from public, anon;
grant execute on function private.classify_unclassified_menu(uuid, uuid) to authenticated, service_role;

-- Same signature and result as before; a category request is classified first.
create or replace function public.admin_review_pending_item(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null,
  p_reject_reason text default null
)
returns public.items
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status = 'active' and p_category_id is not null then
    perform private.classify_unclassified_menu(p_item_id, p_category_id);
  end if;
  return private.admin_review_pending_item_impl(p_item_id, p_status, p_category_id, p_reject_reason);
end;
$$;
revoke all on function public.admin_review_pending_item(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_review_pending_item(uuid, text, uuid, text) to authenticated, service_role;

-- Item IDs, not the shared staging category, identify a removal. Applies to all
-- picks so the UI never has to guess a hidden category's identity.
create function private.remove_pick_by_id_impl(p_pick_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_category uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  select category_id into v_category from public.picks where id=p_pick_id and user_id=v_user;
  if not found then raise exception 'PICK_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('unclassified-menu:' || v_user::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_category::text, 0));
  update public.picks set status='removed', ended_at=now(),
    replaced_by_pick_id=null, updated_at=now()
  where id=p_pick_id and user_id=v_user and status in ('active','needs_review');
end;
$$;
revoke all on function private.remove_pick_by_id_impl(uuid) from public, anon;
grant execute on function private.remove_pick_by_id_impl(uuid) to authenticated;

create function public.remove_pick_by_id(p_pick_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.remove_pick_by_id_impl(p_pick_id);
$$;
revoke all on function public.remove_pick_by_id(uuid) from public, anon;
grant execute on function public.remove_pick_by_id(uuid) to authenticated;
commit;

