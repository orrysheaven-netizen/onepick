-- A place picked from the SBIZ catalog used to become an active item at once,
-- so '원픽 등록' of a new 가게 skipped the admin review every other new item
-- goes through. Now the first selection of a place (per menu category) is a
-- request like submit_item: the item is created 'pending' with created_by, the
-- requester writes the one-line review with set_pending_item_pick_review, and
-- approval makes it their pick (notify_requester_on_item_review).
--
-- Selecting a place whose item is already
--   active/discontinued → unchanged, pick it directly
--   pending, own request → the same request (retry-safe)
--   pending, someone else's → ITEM_ALREADY_PENDING, like submit_item
--   rejected/hidden     → ITEM_NOT_ELIGIBLE, as before
-- (place items have a provider, so admin_merge_pending_item already refuses them)
--
-- Approval keeps a place-backed item's catalog name and category: its identity
-- is item_places (place + category), so two branches with the same name are not
-- duplicates, and item_places' (item_id, category_id) key cannot follow a
-- category change.

begin;

create or replace function private.select_place_catalog_item_impl(
  p_category_id uuid,
  p_catalog_id uuid
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_place public.places%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_place := private.place_from_catalog(p_catalog_id);

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:'||v_place.id::text||':'||p_category_id::text,0)
  );

  select i.* into v_item
  from public.item_places ip
  join public.items i
    on i.id=ip.item_id
   and i.category_id=ip.category_id
  where ip.place_id=v_place.id
    and ip.category_id=p_category_id
  for update of i;

  if found then
    if v_item.status='pending' then
      if v_item.created_by is distinct from v_user then
        raise exception 'ITEM_ALREADY_PENDING' using errcode='P0001';
      end if;
      return v_item;
    end if;

    if v_item.status not in ('active','discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;

    update public.item_channels
    set is_primary=false
    where item_id=v_item.id
      and channel<>'offline'
      and is_primary;

    insert into public.item_channels(item_id,channel,target_url,is_primary)
    values(v_item.id,'offline',v_place.map_url,true)
    on conflict(item_id,channel) do update
    set target_url=excluded.target_url,
        is_primary=true,
        updated_at=now();

    return v_item;
  end if;

  -- Same daily request limit as submit_item.
  if (
    select count(*)
    from public.items
    where created_by=v_user
      and created_at>now()-interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  insert into public.items(
    category_id,name,normalized_name,status,created_by,external_source,external_id
  ) values (
    p_category_id,btrim(v_place.name),lower(regexp_replace(btrim(v_place.name),'[[:space:]]+','','g')),
    'pending',v_user,'onepick_place',v_place.id::text||':'||p_category_id::text
  ) returning * into v_item;

  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,p_category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',v_place.map_url,true);

  return v_item;
end;
$$;

revoke all on function private.select_place_catalog_item_impl(uuid,uuid)
  from public, anon, authenticated;

create or replace function private.admin_review_pending_item_impl(
  p_item_id uuid,
  p_status text,
  p_category_id uuid default null,
  p_reject_reason text default null
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
  v_reason text;
  v_is_place boolean;
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
    v_reason := btrim(p_reject_reason);
    if v_reason is null or char_length(v_reason) not between 1 and 500 then
      raise exception 'REJECT_REASON_INVALID' using errcode='P0001';
    end if;

    update public.items
    set status='rejected', merged_into_item_id=null
    where id=v_item.id
    returning * into v_item;

    insert into private.item_review_log(item_id,status,rejection_reason,reviewed_by)
    values (v_item.id,'rejected',v_reason,auth.uid());

    -- The status trigger does not know the reason, so the rejection is sent here.
    if v_item.created_by is not null then
      insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, reason)
      values (v_item.id, v_item.created_by, 'rejected', v_item.id, v_reason)
      on conflict (item_id, recipient_id) do update
        set outcome = excluded.outcome,
            target_item_id = excluded.target_item_id,
            pick_id = null,
            reason = excluded.reason,
            created_at = now(),
            read_at = null;
    end if;
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

  v_is_place := exists(select 1 from public.item_places where item_id=v_item.id);

  if v_is_place then
    -- The place + category pair is the identity; reject it instead of moving it.
    if v_category.id<>v_item.category_id then
      raise exception 'PLACE_ITEM_CATEGORY_LOCKED' using errcode='P0001';
    end if;
    v_name := v_item.name;
    v_normalized := v_item.normalized_name;
  else
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
  end if;

  update public.items
  set category_id=v_category.id,
      name=v_name,
      normalized_name=v_normalized,
      status='active',
      merged_into_item_id=null
  where id=v_item.id
  returning * into v_item;

  insert into private.item_review_log(item_id,status,reviewed_by)
  values (v_item.id,'active',auth.uid());
  return v_item;
end;
$$;

revoke all on function private.admin_review_pending_item_impl(uuid,text,uuid,text)
  from public, anon;
grant execute on function private.admin_review_pending_item_impl(uuid,text,uuid,text)
  to authenticated, service_role;

commit;
