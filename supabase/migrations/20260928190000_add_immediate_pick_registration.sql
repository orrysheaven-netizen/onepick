-- 즉시 등록 / 원픽 교체 (#448 서버 인계 1번, user decisions 2026-09-28).
--
-- One call saves a new product, its photo, the one-line review and the member's
-- current Pick atomically: register_item_pick. A brand-new product is created
-- as a pending request (visible only to its requester, as items RLS already
-- does) and the Pick is inserted as needs_review, which is the requester's
-- current Pick in that menu and channel (picks RLS shows it to nobody else).
-- Approval turns the Pick active; a merge moves it onto the target product.
-- Existing (active) products get an active Pick at once, as change_pick does.
--
-- Concurrency: the caller passes the current Pick it saw in that menu+channel
-- (p_expected_previous_pick_id, null = none). A different current Pick raises
-- PICK_CHANGED_ELSEWHERE with the actual id in DETAIL, and the client asks the
-- member again. Retries carry p_request_id: a Pick already saved for it is
-- returned as is, nothing is created twice.
--
-- The response holds ids and whether the Pick is published; review state and
-- request history are not exposed. A rejection is the only review event the
-- member hears about (item_review_notifications outcome=rejected, reason):
-- revise_item_request lets them fix the link or photo and re-request, while
-- their needs_review Pick stays their current one.

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.picks add column client_request_id uuid;
create unique index picks_client_request_idx
  on public.picks(user_id, client_request_id)
  where client_request_id is not null;
comment on column public.picks.client_request_id is
  'Idempotency key from register_item_pick: a retry with the same id returns this Pick instead of saving again.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The photo rules of attach_item_photo / register_pick: both files are the
-- caller's own uploads in item-photos, JPEG, within size limits.
create or replace function private.assert_item_photo_owned(
  p_user uuid,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_image_path is null
     or p_thumbnail_path is null
     or p_image_path = p_thumbnail_path
     or split_part(p_image_path, '/', 1) <> p_user::text
     or split_part(p_thumbnail_path, '/', 1) <> p_user::text then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  perform 1 from storage.objects
  where bucket_id = 'item-photos' and name = p_image_path and owner_id = p_user::text
    and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint, 0) between 1 and 786432
  for share;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  perform 1 from storage.objects
  where bucket_id = 'item-photos' and name = p_thumbnail_path and owner_id = p_user::text
    and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint, 0) between 1 and 98304
  for share;
  if not found then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  if p_image_source_url is not null
     and (char_length(p_image_source_url) > 2048 or p_image_source_url !~ '^https://') then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.assert_item_photo_owned(uuid, text, text, text) from public, anon, authenticated;

create or replace function private.is_https_link(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) between 12 and 2048
     and p_url ~ '^https://[^[:space:]]+$';
$$;
revoke all on function private.is_https_link(text) from public, anon, authenticated;

-- The seller × menu product for an online Pick. Unlike select_online_provider_item
-- (which publishes at once), a product created here is a pending request of the
-- member and carries the individual product link, not the seller's home page.
create or replace function private.stage_online_provider_item(
  p_category_id uuid,
  p_provider_id uuid,
  p_link_url text
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_provider public.providers%rowtype;
  v_store public.online_stores%rowtype;
  v_item public.items%rowtype;
  v_link text := btrim(p_link_url);
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_provider from public.providers where id = p_provider_id;
  if not found or v_provider.kind <> 'online_store' or v_provider.status <> 'active' then
    raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_store from public.online_stores where id = v_provider.online_store_id;
  if not found or v_store.official_url is null then
    raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('provider-item:' || v_provider.id::text || ':' || p_category_id::text, 0)
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id = ipr.item_id
  where ipr.provider_id = v_provider.id
    and ipr.category_id = p_category_id
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

  -- A new online product needs its own purchase link (decision 73): the seller's
  -- home page never stands in for it.
  if v_link is null or v_link = '' then
    raise exception 'ITEM_LINK_REQUIRED' using errcode = 'P0001';
  end if;
  if not private.is_https_link(v_link) then
    raise exception 'LINK_INVALID' using errcode = 'P0001';
  end if;

  -- Same daily request limit as submit_item and place selection.
  if (
    select count(*) from public.items
    where created_by = v_user and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.items(
    category_id, brand_id, name, normalized_name, status,
    external_source, external_id, created_by
  ) values (
    p_category_id, v_provider.brand_id, v_provider.name,
    lower(regexp_replace(v_provider.name, '[[:space:]]', '', 'g')), 'pending',
    'onepick_provider', v_provider.id::text || ':' || p_category_id::text, v_user
  ) returning * into v_item;

  insert into public.item_providers(item_id, category_id, provider_id)
  values (v_item.id, p_category_id, v_provider.id);

  insert into public.item_channels(item_id, channel, target_url, is_primary)
  values (v_item.id, 'online', v_link, true);

  return v_item;
end;
$$;
revoke all on function private.stage_online_provider_item(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_item_pick
-- ---------------------------------------------------------------------------

create or replace function private.register_item_pick_impl(
  p_category_id uuid,
  p_channel text,
  p_one_line_review text,
  p_item_id uuid,
  p_catalog_id uuid,
  p_provider_id uuid,
  p_link_url text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text,
  p_expected_previous_pick_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_channel text;
  v_current public.picks%rowtype;
  v_has_current boolean;
  v_pick public.picks%rowtype;
  v_new_id uuid;
  v_replaced uuid;
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
  if p_channel is null or p_channel not in ('offline', 'online', 'recipe') then
    raise exception 'PICK_CHANNEL_INVALID' using errcode = 'P0001';
  end if;

  select * into v_category from public.categories where id = p_category_id;
  if not found
     or not v_category.is_visible or not v_category.is_pickable or v_category.status <> 'open'
     or not public.category_is_open_leaf(p_category_id)
     or not private.category_is_food(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode = 'P0001';
  end if;

  -- A retry of a call that already saved: same answer, nothing new.
  if p_request_id is not null then
    select * into v_pick from public.picks
    where user_id = v_user and client_request_id = p_request_id;
    if found then
      return jsonb_build_object(
        'item_id', v_pick.item_id,
        'pick_id', v_pick.id,
        'published', v_pick.status = 'active',
        'replaced_pick_id', null,
        'retried', true
      );
    end if;
  end if;

  -- The product: an existing one (mine while pending), or the store × menu
  -- product for the chosen place or seller (created as my request when new).
  if p_item_id is not null then
    select * into v_item from public.items where id = p_item_id for update;
    if not found or (v_item.status = 'pending' and v_item.created_by is distinct from v_user) then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_item.category_id <> p_category_id then
      raise exception 'ITEM_CATEGORY_MISMATCH' using errcode = 'P0001';
    end if;
    if v_item.status not in ('active', 'discontinued', 'pending') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
  elsif p_channel = 'offline' and p_catalog_id is not null then
    v_item := private.select_place_catalog_item_impl(p_category_id, p_catalog_id);
  elsif p_channel = 'online' and p_provider_id is not null then
    v_item := private.stage_online_provider_item(p_category_id, p_provider_id, p_link_url);
  else
    raise exception 'ITEM_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;

  -- A recipe is registered from its video (youtube-catalog); without the source
  -- link there is nothing to pick.
  if p_channel = 'recipe' and not exists (
    select 1 from public.item_channels ch
    where ch.item_id = v_item.id and ch.channel = 'recipe' and ch.target_url is not null
  ) then
    raise exception 'ITEM_LINK_REQUIRED' using errcode = 'P0001';
  end if;

  v_channel := private.resolve_pick_channel(p_category_id, v_item.id, p_channel);

  -- A new product needs a real photo; an existing photo is reused (decision 73/74).
  if v_item.image_path is null and v_item.thumbnail_path is null and v_item.image_source_url is null then
    if p_image_path is null or p_thumbnail_path is null then
      raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
    end if;
    perform private.assert_item_photo_owned(v_user, p_image_path, p_thumbnail_path, p_image_source_url);
    -- The first valid photo wins; a concurrent loser keeps the row as it is.
    update public.items
    set image_path = p_image_path,
        thumbnail_path = p_thumbnail_path,
        image_source_url = p_image_source_url
    where id = v_item.id and image_path is null;
    select * into v_item from public.items where id = v_item.id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':' || p_category_id::text, 0)
  );

  select * into v_current
  from public.picks
  where user_id = v_user
    and category_id = p_category_id
    and channel is not distinct from v_channel
    and status in ('active', 'needs_review')
  for update;
  v_has_current := found;

  -- The member confirmed a change against the Pick they saw. Anything else in
  -- the slot now (another device, a retry after a lost answer without
  -- p_request_id) needs a fresh confirmation.
  if p_expected_previous_pick_id is distinct from (case when v_has_current then v_current.id end) then
    raise exception 'PICK_CHANGED_ELSEWHERE'
      using errcode = 'P0001',
            detail = coalesce(v_current.id::text, '');
  end if;

  if v_has_current and v_current.item_id = v_item.id then
    update public.picks
    set one_line_review = v_review,
        client_request_id = coalesce(p_request_id, client_request_id),
        updated_at = now()
    where id = v_current.id
    returning * into v_pick;
    return jsonb_build_object(
      'item_id', v_item.id,
      'pick_id', v_pick.id,
      'published', v_pick.status = 'active',
      'replaced_pick_id', null,
      'retried', false
    );
  end if;

  if exists (
    select 1 from public.picks
    where user_id = v_user and item_id = v_item.id and status in ('active', 'needs_review')
  ) then
    raise exception 'ITEM_ALREADY_PICKED' using errcode = 'P0001';
  end if;

  v_new_id := gen_random_uuid();
  if v_has_current then
    update public.picks
    set status = 'replaced', ended_at = now(), replaced_by_pick_id = v_new_id, updated_at = now()
    where id = v_current.id;
    v_replaced := v_current.id;
  end if;

  insert into public.picks(
    id, user_id, category_id, item_id, channel, one_line_review,
    status, started_at, client_request_id
  ) values (
    v_new_id, v_user, p_category_id, v_item.id, v_channel, v_review,
    case when v_item.status = 'pending' then 'needs_review' else 'active' end,
    now(), p_request_id
  )
  returning * into v_pick;

  return jsonb_build_object(
    'item_id', v_item.id,
    'pick_id', v_pick.id,
    'published', v_pick.status = 'active',
    'replaced_pick_id', v_replaced,
    'retried', false
  );
end;
$$;

create or replace function public.register_item_pick(
  p_category_id uuid,
  p_channel text,
  p_one_line_review text,
  p_item_id uuid default null,
  p_catalog_id uuid default null,
  p_provider_id uuid default null,
  p_link_url text default null,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_expected_previous_pick_id uuid default null,
  p_request_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_item_pick_impl(
    p_category_id, p_channel, p_one_line_review, p_item_id, p_catalog_id, p_provider_id,
    p_link_url, p_image_path, p_thumbnail_path, p_image_source_url,
    p_expected_previous_pick_id, p_request_id
  );
$$;

revoke all on function private.register_item_pick_impl(uuid, text, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function private.register_item_pick_impl(uuid, text, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid) to authenticated, service_role;
revoke all on function public.register_item_pick(uuid, text, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.register_item_pick(uuid, text, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid) to authenticated, service_role;
comment on function public.register_item_pick(uuid, text, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid) is
  'Save a food Pick in one call: menu + channel + product (p_item_id, or p_catalog_id for a place, or p_provider_id + p_link_url for a seller) + photo when the product has none + review. A new product is the caller''s pending request and the Pick is theirs alone until approval (published=false). p_expected_previous_pick_id must equal the current Pick in that menu+channel (null = none) or PICK_CHANGED_ELSEWHERE (DETAIL = actual id). p_request_id makes retries idempotent.';

-- ---------------------------------------------------------------------------
-- revise_item_request: fix a request after "수정 필요" and ask again
-- ---------------------------------------------------------------------------

create or replace function private.revise_item_request_impl(
  p_item_id uuid,
  p_link_url text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text,
  p_remove_photo boolean
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.items%rowtype;
  v_link text := btrim(p_link_url);
  v_channel text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode = '42501';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.created_by is distinct from v_user or v_item.status not in ('pending', 'rejected') then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_link is not null and v_link <> '' then
    select ch.channel into v_channel
    from public.item_channels ch
    where ch.item_id = v_item.id
    order by ch.is_primary desc, ch.channel
    limit 1;
    if v_channel is null then
      raise exception 'ITEM_LINK_NOT_EDITABLE' using errcode = 'P0001';
    end if;
    if (v_channel = 'offline' and not private.is_naver_map_url(v_link))
       or (v_channel <> 'offline' and not private.is_https_link(v_link)) then
      raise exception 'LINK_INVALID' using errcode = 'P0001';
    end if;
    update public.item_channels
    set target_url = v_link, updated_at = now()
    where item_id = v_item.id and channel = v_channel;
  end if;

  if p_remove_photo then
    update public.items
    set image_path = null, thumbnail_path = null, image_source_url = null
    where id = v_item.id;
  elsif p_image_path is not null or p_thumbnail_path is not null then
    perform private.assert_item_photo_owned(v_user, p_image_path, p_thumbnail_path, p_image_source_url);
    update public.items
    set image_path = p_image_path,
        thumbnail_path = p_thumbnail_path,
        image_source_url = p_image_source_url
    where id = v_item.id;
  end if;

  -- Asking again: the request goes back to the queue. The rejection notice
  -- stays in the inbox as history; nothing announces the re-request.
  update public.items
  set status = 'pending', merged_into_item_id = null
  where id = v_item.id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.revise_item_request(
  p_item_id uuid,
  p_link_url text default null,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_remove_photo boolean default false
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.revise_item_request_impl(
    p_item_id, p_link_url, p_image_path, p_thumbnail_path, p_image_source_url, p_remove_photo
  );
$$;

revoke all on function private.revise_item_request_impl(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function private.revise_item_request_impl(uuid, text, text, text, text, boolean) to authenticated, service_role;
revoke all on function public.revise_item_request(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.revise_item_request(uuid, text, text, text, text, boolean) to authenticated, service_role;
comment on function public.revise_item_request(uuid, text, text, text, text, boolean) is
  'After a 수정 필요 notice: replace the link (map link for a place, https link otherwise) and/or the photo of my own pending or rejected request and put it back in the review queue. My needs_review Pick on it stays my current Pick.';

-- ---------------------------------------------------------------------------
-- Review outcome: the needs_review Pick follows the product
-- ---------------------------------------------------------------------------

-- Same as 20260927130500, plus: Picks saved by register_item_pick already exist
-- as needs_review on the request. Approval activates them; a merge moves them
-- onto the target product (replacing the member's current Pick there, if any,
-- unless they already hold the target).
create or replace function private.notify_requester_on_item_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_outcome text;
  v_target public.items%rowtype;
  v_intent public.pending_item_picks%rowtype;
  v_current public.picks%rowtype;
  v_has_current boolean;
  v_pick_id uuid;
  v_channel text;
  v_waiting public.picks%rowtype;
  v_slot public.picks%rowtype;
begin
  if old.status <> 'pending' or new.status = 'pending' then
    return new;
  end if;

  select * into v_intent from public.pending_item_picks where item_id = new.id;
  if found then
    delete from public.pending_item_picks where item_id = new.id;
  end if;

  if new.created_by is null then
    return new;
  end if;
  if new.status = 'active' then
    v_outcome := 'approved';
    v_target := new;
  elsif new.status = 'merged' and new.merged_into_item_id is not null then
    v_outcome := 'merged';
    select * into v_target from public.items where id = new.merged_into_item_id;
  else
    -- Rejections are sent by admin_review_pending_item, which has the reason.
    -- A needs_review Pick on the request stays the member's own current Pick
    -- so they can revise and ask again.
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.created_by::text||':'||v_target.category_id::text,0)
  );

  -- Picks already saved on the request (register_item_pick).
  for v_waiting in
    select * from public.picks
    where item_id = new.id and status = 'needs_review'
    for update
  loop
    if v_outcome = 'approved' then
      update public.picks set status = 'active', updated_at = now() where id = v_waiting.id;
      if v_waiting.user_id = new.created_by then
        v_pick_id := v_waiting.id;
      end if;
      continue;
    end if;

    -- Merged: the member already holds the target → this request ends there.
    if exists (
      select 1 from public.picks q
      where q.user_id = v_waiting.user_id and q.item_id = v_target.id
        and q.status in ('active', 'needs_review')
    ) then
      update public.picks
      set status = 'replaced', ended_at = now(), updated_at = now(),
          replaced_by_pick_id = (
            select q.id from public.picks q
            where q.user_id = v_waiting.user_id and q.item_id = v_target.id
              and q.status in ('active', 'needs_review')
            limit 1
          )
      where id = v_waiting.id;
      continue;
    end if;

    -- The channel the member chose, if the target offers it; else its own.
    begin
      v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, v_waiting.channel);
    exception when others then
      v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, null);
    end;

    -- A current Pick in the target's slot gives way to this one.
    if v_target.category_id <> v_waiting.category_id or v_channel is distinct from v_waiting.channel then
      select * into v_slot from public.picks
      where user_id = v_waiting.user_id
        and category_id = v_target.category_id
        and channel is not distinct from v_channel
        and status in ('active', 'needs_review')
        and id <> v_waiting.id
      for update;
      if found then
        update public.picks
        set status = 'replaced', ended_at = now(), replaced_by_pick_id = v_waiting.id, updated_at = now()
        where id = v_slot.id;
      end if;
    end if;

    update public.picks
    set item_id = v_target.id,
        category_id = v_target.category_id,
        channel = v_channel,
        status = case when v_target.status = 'pending' then 'needs_review' else 'active' end,
        updated_at = now()
    where id = v_waiting.id;
    if v_waiting.user_id = new.created_by then
      v_pick_id := v_waiting.id;
    end if;
  end loop;

  -- The requested channel can no longer fit (for example the request was merged
  -- into an item sold elsewhere): fall back to the item's own channel rather than
  -- blocking the administrator's review.
  begin
    v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, v_intent.channel);
  exception when others then
    v_channel := private.resolve_pick_channel(v_target.category_id, v_target.id, null);
  end;

  select * into v_current
  from public.picks
  where user_id = new.created_by
    and category_id = v_target.category_id
    and channel is not distinct from v_channel
    and status in ('active','needs_review')
  for update;
  v_has_current := found;

  if v_has_current and v_current.item_id = v_target.id then
    if v_pick_id is null then
      return new;
    end if;
  elsif v_intent.item_id is not null
     and not exists (
       select 1 from public.picks
       where user_id = new.created_by
         and item_id = v_target.id
         and status in ('active','needs_review')
     ) then
    if (v_has_current and v_current.started_at > v_intent.created_at)
       or private.is_user_suspended(new.created_by) then
      return new;
    end if;

    v_pick_id := gen_random_uuid();
    if v_has_current then
      update public.picks
      set status='replaced', ended_at=now(), replaced_by_pick_id=v_pick_id, updated_at=now()
      where id = v_current.id;
    end if;
    insert into public.picks(id,user_id,category_id,item_id,channel,one_line_review,status,started_at)
    values (v_pick_id,new.created_by,v_target.category_id,v_target.id,v_channel,v_intent.one_line_review,'needs_review',now());
    update public.picks set status='active' where id = v_pick_id;
  end if;

  -- The requester resolved it themselves (choosing a category that matched an
  -- existing product) and sees the result on screen already. An administrator
  -- approving their own request still gets the notification.
  if new.created_by = (select auth.uid()) and not private.is_admin(new.created_by) then
    return new;
  end if;

  -- A request resolved again with a different result (rejected, reopened, then
  -- approved) replaces its earlier notification and is unread again.
  insert into public.item_review_notifications(item_id, recipient_id, outcome, target_item_id, pick_id)
  values (new.id, new.created_by, v_outcome, v_target.id, v_pick_id)
  on conflict (item_id, recipient_id) do update
    set outcome = excluded.outcome,
        target_item_id = excluded.target_item_id,
        pick_id = excluded.pick_id,
        reason = null,
        created_at = now(),
        read_at = null
    where public.item_review_notifications.outcome is distinct from excluded.outcome;
  return new;
end;
$$;
revoke all on function private.notify_requester_on_item_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merge guard: a Pick waiting on the request is not "in use"
-- ---------------------------------------------------------------------------

-- Same as 20260924235500, except that needs_review Picks (saved with the
-- request by register_item_pick) do not block a merge: the review trigger
-- moves them onto the target.
create or replace function public.admin_merge_pending_item(
  p_source_item_id uuid,
  p_target_item_id uuid
)
returns public.items
language plpgsql
set search_path = ''
as $$
declare
  v_source public.items%rowtype;
  v_target public.items%rowtype;
  v_source_category_slug text;
  v_result public.items%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_source_item_id is null
     or p_target_item_id is null
     or p_source_item_id=p_target_item_id then
    raise exception 'MERGE_TARGET_INVALID' using errcode='P0001';
  end if;

  select * into v_source
  from public.items
  where id=p_source_item_id
  for update;

  if not found or v_source.status<>'pending' then
    raise exception 'SOURCE_ITEM_NOT_PENDING' using errcode='P0001';
  end if;

  if exists(
    select 1 from public.item_providers
    where item_id=v_source.id
  ) then
    raise exception 'SOURCE_PROVIDER_ITEM_NOT_MERGEABLE' using errcode='P0001';
  end if;

  select * into v_target
  from public.items
  where id=p_target_item_id
  for update;

  if not found or v_target.status not in ('active','discontinued') then
    raise exception 'TARGET_ITEM_INVALID' using errcode='P0001';
  end if;

  if v_source.category_id<>v_target.category_id then
    select slug into v_source_category_slug
    from public.categories
    where id=v_source.category_id;

    if v_source_category_slug is distinct from 'pending-product' then
      raise exception 'MERGE_CATEGORY_MISMATCH' using errcode='P0001';
    end if;
  end if;

  if exists(
    select 1 from public.picks
    where item_id=v_source.id and status<>'needs_review'
  ) then
    raise exception 'SOURCE_ITEM_IN_USE' using errcode='P0001';
  end if;

  update public.items
  set status='merged',
      merged_into_item_id=v_target.id
  where id=v_source.id
  returning * into v_result;

  return v_result;
end;
$$;

commit;
