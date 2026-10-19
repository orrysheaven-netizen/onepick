begin;

-- 2026-10-04: an admin classifies a member category request (see
-- 20261004120000_add_category_request_picks) by approving it with a real
-- category in the existing pending-review panel. Before the normal approval
-- runs, the request becomes the ordinary store × menu pending item it would
-- have been had the category existed: item_places + offline channel, and the
-- member's waiting Pick moves to that category. The existing approval then
-- publishes item, store and Pick exactly like any new store item.

create or replace function private.classify_category_request(p_item_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.category_request_places%rowtype;
  v_item public.items%rowtype;
  v_place public.places%rowtype;
  v_category public.categories%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into v_request from private.category_request_places where item_id = p_item_id for update;
  if not found then
    return; -- Not a category request: the normal review handles it.
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.status <> 'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode = 'P0001';
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

  select * into v_place from public.places where id = v_request.place_id;

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:' || v_place.id::text || ':' || p_category_id::text, 0)
  );
  if exists (
    select 1 from public.item_places where place_id = v_place.id and category_id = p_category_id
  ) then
    -- That store already has this menu: reject the request instead.
    raise exception 'PLACE_ALREADY_LINKED' using errcode = 'P0001';
  end if;

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

  update public.items
  set category_id = p_category_id,
      external_source = 'onepick_place',
      external_id = v_place.id::text || ':' || p_category_id::text
  where id = v_item.id;

  insert into public.item_places(item_id, category_id, place_id)
  values (v_item.id, p_category_id, v_place.id);

  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'offline', v_place.map_url, true)
  on conflict (item_id, channel) do nothing;

  update public.picks
  set category_id = p_category_id, channel = 'offline', updated_at = now()
  where item_id = v_item.id;

  set constraints public.picks_item_category_fk immediate;

  delete from private.category_request_places where item_id = v_item.id;
end;
$$;
revoke all on function private.classify_category_request(uuid, uuid) from public, anon;
grant execute on function private.classify_category_request(uuid, uuid) to authenticated, service_role;

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
    perform private.classify_category_request(p_item_id, p_category_id);
  end if;
  return private.admin_review_pending_item_impl(p_item_id, p_status, p_category_id, p_reject_reason);
end;
$$;
revoke all on function public.admin_review_pending_item(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_review_pending_item(uuid, text, uuid, text) to authenticated, service_role;

commit;
