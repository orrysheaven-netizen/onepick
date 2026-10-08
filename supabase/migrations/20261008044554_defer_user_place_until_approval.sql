begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- #840: a submission is request data, not a canonical store. Existing legacy
-- hidden stores are retained; this change does not delete user data.
create table private.user_place_requests (
  item_id uuid primary key references public.items(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  normalized_name text not null,
  branch_name text,
  road_address text not null default '',
  map_url text not null,
  created_at timestamptz not null default now(),
  check (branch_name is null or char_length(branch_name) <= 100),
  check (char_length(road_address) <= 300),
  check (private.is_naver_map_url(map_url))
);
create index user_place_requests_identity_idx
  on private.user_place_requests(normalized_name, map_url);
alter table private.user_place_requests enable row level security;
revoke all on private.user_place_requests from public, anon, authenticated;
grant all on private.user_place_requests to service_role;
comment on table private.user_place_requests is
  'Unapproved store identity, linked only to the pending item. No places, place_catalog, providers or item_places row is created until an MFA administrator approves the item.';

-- Called by the existing MFA-gated review implementation while holding the
-- item row lock. All inserts roll back if any later review validation fails.
create function private.materialize_user_place_request(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_request private.user_place_requests%rowtype;
  v_item public.items%rowtype;
  v_place public.places%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  select * into v_request from private.user_place_requests where item_id = p_item_id;
  if not found then return; end if;
  if v_item.status <> 'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode = 'P0001';
  end if;
  if not public.category_uses_place_catalog(v_item.category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'user-place:' || v_request.normalized_name || ':' || v_request.map_url, 0));
  select * into v_place from public.places p
  where p.place_provider = 'user'
    and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_request.normalized_name
    and p.map_url = v_request.map_url
  order by p.created_at, p.id limit 1 for update;
  if not found then
    insert into public.places(name, branch_name, road_address, place_provider, provider_place_id, map_url, is_visible)
    values (v_request.name, v_request.branch_name, v_request.road_address,
      'user', gen_random_uuid()::text, v_request.map_url, false)
    returning * into v_place;
    insert into public.place_catalog(place_provider, provider_place_id, name, normalized_name,
      branch_name, road_address, business_status, source_updated_at)
    values (v_place.place_provider, v_place.provider_place_id, v_place.name,
      private.normalize_place_name(v_place.name), v_place.branch_name,
      nullif(v_place.road_address, ''), 'pending', now());
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'place-item:' || v_place.id::text || ':' || v_item.category_id::text, 0));
  if exists (select 1 from public.item_places
    where place_id = v_place.id and category_id = v_item.category_id and item_id <> v_item.id) then
    raise exception 'PLACE_ALREADY_LINKED' using errcode = 'P0001';
  end if;
  insert into public.item_places(item_id, category_id, place_id)
  values (v_item.id, v_item.category_id, v_place.id);
  update public.items set external_source = 'onepick_place',
    external_id = v_place.id::text || ':' || v_item.category_id::text
  where id = v_item.id;
  delete from private.user_place_requests where item_id = v_item.id;
  -- Existing items_activate_user_place and review triggers publish the store
  -- and the existing needs_review Pick when the caller changes status to active.
end;
$$;
revoke all on function private.materialize_user_place_request(uuid) from public, anon, authenticated;

-- Keep the request identity in sync when the owner fixes the map link through
-- revise_item_request. That RPC already locks/authorizes the pending item.
create function private.sync_user_place_request_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_request private.user_place_requests%rowtype;
begin
  select * into v_request from private.user_place_requests where item_id = new.item_id;
  if not found or new.target_url is not distinct from old.target_url then return new; end if;
  if new.channel <> 'offline' or not coalesce(private.is_naver_map_url(new.target_url), false) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'user-place:' || v_request.normalized_name || ':' || new.target_url, 0));
  if exists (select 1 from private.user_place_requests r
    join public.items i on i.id = r.item_id
    where i.category_id = (select category_id from public.items where id = new.item_id)
      and r.item_id <> new.item_id and r.normalized_name = v_request.normalized_name and r.map_url = new.target_url)
    or exists (select 1 from public.places p
      join public.item_places ip on ip.place_id = p.id
      where ip.category_id = (select category_id from public.items where id = new.item_id)
      and p.place_provider = 'user'
      and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_request.normalized_name
      and p.map_url = new.target_url) then
    raise exception 'PLACE_ALREADY_REGISTERED' using errcode = 'P0001';
  end if;
  update private.user_place_requests set map_url = new.target_url where item_id = new.item_id;
  return new;
end;
$$;
revoke all on function private.sync_user_place_request_link() from public, anon, authenticated;
create trigger item_channels_sync_user_place_request
before update of target_url on public.item_channels
for each row execute function private.sync_user_place_request_link();

-- Activation must materialize the request. A merge resolves it against an
-- existing item instead: retain the existing MFA admin merge/RLS contract and
-- let the existing review trigger move the needs_review Pick. No store is made.
create function private.guard_user_place_request_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'merged' and exists (
    select 1 from private.user_place_requests where item_id = new.id
  ) then
    if not private.is_admin_mfa() then
      raise exception 'ADMIN_REQUIRED' using errcode = '42501';
    end if;
    -- admin_merge_pending_item validates/locks both items before this update.
    -- Cleanup and existing Pick transfer roll back together on any failure.
    delete from private.user_place_requests where item_id = new.id;
  end if;
  if new.status in ('active', 'discontinued') and exists (
    select 1 from private.user_place_requests where item_id = new.id
  ) then
    raise exception 'USER_PLACE_REVIEW_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_user_place_request_status() from public, anon, authenticated;
create trigger items_guard_user_place_request
before update of status on public.items
for each row execute function private.guard_user_place_request_status();

create or replace function private.stage_user_place_item_impl(
  p_category_id uuid,
  p_name text,
  p_branch_name text,
  p_road_address text,
  p_map_url text
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  -- Legacy input: the app no longer asks for it; stored as '' when absent.
  v_road text := btrim(coalesce(p_road_address, ''));
  v_map text := btrim(coalesce(p_map_url, ''));
  v_normalized text;
  v_place public.places%rowtype;
  v_item public.items%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;
  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 100
     or (v_branch is not null and char_length(v_branch) > 100) then
    raise exception 'PLACE_NAME_INVALID' using errcode = 'P0001';
  end if;
  if char_length(v_road) > 300 then
    raise exception 'PLACE_ADDRESS_INVALID' using errcode = 'P0001';
  end if;
  -- Without a catalog match the map link is the store's identity (decision 73).
  if v_map = '' then
    raise exception 'ITEM_LINK_REQUIRED' using errcode = 'P0001';
  end if;
  if not private.is_naver_map_url(v_map) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  v_normalized := lower(regexp_replace(v_name, '[[:space:]]+', '', 'g'));

  perform pg_advisory_xact_lock(
    hashtextextended('user-place:' || v_normalized || ':' || v_map, 0)
  );

  -- Serialize identities without locking an existing item here. Review and
  -- link correction lock the item first; staging never mutates that item.
  select i.* into v_item
  from private.user_place_requests r join public.items i on i.id = r.item_id
  where r.normalized_name = v_normalized and r.map_url = v_map
    and i.category_id = p_category_id
  order by i.created_at, i.id limit 1;
  if found then
    if v_item.status = 'pending' then
      if v_item.created_by is distinct from v_user then
        raise exception 'ITEM_ALREADY_PENDING' using errcode = 'P0001';
      end if;
      return v_item;
    end if;
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- The same normalized name with the exact same map link is the same store.
  -- The link is not expanded (no external lookup), so another short link to the
  -- same store makes a second pending request; review resolves duplicates.
  select * into v_place
  from public.places p
  where p.place_provider = 'user'
    and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
    and p.map_url = v_map
  order by p.created_at
  limit 1
  for update;

  if not found then
    if (select count(*) from public.items
      where created_by = v_user and created_at > now() - interval '1 day') >= 20 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    insert into public.items(category_id, name, normalized_name, status, created_by, external_source, external_id)
    values (p_category_id, v_name, v_normalized, 'pending', v_user,
      'onepick_place', 'request:' || gen_random_uuid()::text)
    returning * into v_item;
    insert into private.user_place_requests(item_id, name, normalized_name, branch_name, road_address, map_url)
    values (v_item.id, v_name, v_normalized, v_branch, v_road, v_map);
    insert into public.item_channels(item_id, channel, target_url, is_primary)
    values (v_item.id, 'offline', v_map, true);
    return v_item;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place-item:' || v_place.id::text || ':' || p_category_id::text, 0)
  );

  select i.* into v_item
  from public.item_places ip
  join public.items i on i.id = ip.item_id and i.category_id = ip.category_id
  where ip.place_id = v_place.id
    and ip.category_id = p_category_id
  for update of i;

  if found then
    if v_item.status = 'pending' then
      if v_item.created_by is distinct from v_user then
        raise exception 'ITEM_ALREADY_PENDING' using errcode = 'P0001';
      end if;
      return v_item;
    end if;
    if v_item.status not in ('active', 'discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    return v_item;
  end if;

  if (
    select count(*) from public.items
    where created_by = v_user and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.items(
    category_id, name, normalized_name, status, created_by, external_source, external_id
  ) values (
    p_category_id, v_name, v_normalized, 'pending', v_user,
    'onepick_place', v_place.id::text || ':' || p_category_id::text
  ) returning * into v_item;

  insert into public.item_places(item_id, category_id, place_id)
  values (v_item.id, p_category_id, v_place.id);

  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'offline', v_place.map_url, true);

  return v_item;
end;
$$;


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
  v_identity_backed boolean;
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

  if exists (select 1 from private.user_place_requests where item_id = v_item.id)
     and v_category.id <> v_item.category_id then
    raise exception 'PLACE_ITEM_CATEGORY_LOCKED' using errcode = 'P0001';
  end if;
  perform private.materialize_user_place_request(v_item.id);

  v_identity_backed :=
    exists(select 1 from public.item_places where item_id=v_item.id)
    or exists(select 1 from public.item_providers where item_id=v_item.id)
    or exists(select 1 from public.item_brand_scopes where item_id=v_item.id);

  if v_identity_backed then
    -- The (place | provider | brand) + category pair is the identity; reject
    -- it instead of moving it.
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


comment on function public.stage_user_place_item(uuid, text, text, text, text) is
  'Unlisted store name + Naver link become a private request and pending item. Canonical places/catalog/provider links are created only by administrator approval. Existing canonical store identities are reused. Register the pending item with register_item_pick.';
commit;
