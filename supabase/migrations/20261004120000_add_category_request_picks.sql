begin;

-- 2026-10-04 (user decision): when no category fits in registration step 2,
-- the member types one. The Pick is saved right away like any new product —
-- needs_review, visible only to its owner — on a store × "상품 분류 대기"
-- (pending-product) item that carries the typed label and the store. An admin
-- later moves it into a real category. Nothing tells the member about review.
--
-- Requests on different menus must not collide, so the pending-product slot is
-- exempt from "one current Pick per category". Request items do not get an
-- item_places row (unique per place × category) until an admin classifies
-- them; the store is kept in private.category_request_places instead.
-- (A new public.items column would change its row type and break the SQL
-- functions that return public.items, so the store lives in its own table.)

create table private.category_request_places (
  item_id uuid primary key references public.items(id) on delete cascade,
  place_id uuid not null references public.places(id),
  created_at timestamptz not null default now()
);
create index category_request_places_place_idx on private.category_request_places(place_id);
revoke all on private.category_request_places from public, anon, authenticated;
grant all on private.category_request_places to service_role;
comment on table private.category_request_places is
  'Store of a member category request (pending-product item). Review hint only: the item becomes a place item when an admin classifies it.';

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

-- The member-submitted store part of stage_user_place_item_impl, without a
-- category (decision 73: no catalog match → the Naver map link is identity).
create or replace function private.request_user_place(p_name text, p_map_url text)
returns public.places
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_map text := btrim(coalesce(p_map_url, ''));
  v_normalized text;
  v_place public.places%rowtype;
begin
  if char_length(v_name) not between 1 and 100 then
    raise exception 'PLACE_NAME_INVALID' using errcode = 'P0001';
  end if;
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

  select * into v_place
  from public.places p
  where p.place_provider = 'user'
    and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
    and p.map_url = v_map
  order by p.created_at
  limit 1
  for update;

  if not found then
    insert into public.places(
      name, branch_name, road_address, place_provider, provider_place_id, map_url, is_visible
    ) values (
      v_name, null, '', 'user', gen_random_uuid()::text, v_map, false
    ) returning * into v_place;

    insert into public.place_catalog(
      place_provider, provider_place_id, name, normalized_name, branch_name,
      road_address, business_status, source_updated_at
    ) values (
      v_place.place_provider, v_place.provider_place_id, v_name,
      private.normalize_place_name(v_name), null, null, 'pending', now()
    );
  end if;

  return v_place;
end;
$$;
revoke all on function private.request_user_place(text, text) from public, anon, authenticated;

create or replace function private.register_category_request_pick_impl(
  p_category_label text,
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
  v_user uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_label text := btrim(regexp_replace(coalesce(p_category_label, ''), '[[:space:]]+', ' ', 'g'));
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
  if char_length(v_label) not between 1 and 60 then
    raise exception 'CATEGORY_LABEL_INVALID' using errcode = 'P0001';
  end if;

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
  elsif p_place_name is not null or p_map_url is not null then
    v_place := private.request_user_place(p_place_name, p_map_url);
  else
    raise exception 'ITEM_SELECTION_REQUIRED' using errcode = 'P0001';
  end if;

  -- The same store and label from the same member is the same request: keep
  -- one item and one current Pick, and let a repeat only update the review.
  perform pg_advisory_xact_lock(
    hashtextextended('category-request:' || v_user::text || ':' || v_place.id::text || ':' || lower(v_label), 0)
  );

  select i.* into v_item
  from public.items i
  join private.category_request_places r on r.item_id = i.id
  where i.category_id = v_category_id
    and i.created_by = v_user
    and i.status = 'pending'
    and r.place_id = v_place.id
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
      v_category_id, btrim(v_place.name), lower(regexp_replace(btrim(v_place.name), '[[:space:]]+', '', 'g')),
      'pending', v_user,
      p_image_path, p_thumbnail_path, p_image_source_url, v_label
    ) returning * into v_item;

    insert into private.category_request_places(item_id, place_id) values (v_item.id, v_place.id);
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

create or replace function public.register_category_request_pick(
  p_category_label text,
  p_one_line_review text,
  p_catalog_id uuid default null,
  p_place_name text default null,
  p_map_url text default null,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_request_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_category_request_pick_impl(
    p_category_label, p_one_line_review, p_catalog_id, p_place_name, p_map_url,
    p_image_path, p_thumbnail_path, p_image_source_url, p_request_id
  );
$$;

revoke all on function private.register_category_request_pick_impl(text, text, uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function private.register_category_request_pick_impl(text, text, uuid, text, text, text, text, text, uuid) to authenticated, service_role;
revoke all on function public.register_category_request_pick(text, text, uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.register_category_request_pick(text, text, uuid, text, text, text, text, text, uuid) to authenticated, service_role;
comment on function public.register_category_request_pick(text, text, uuid, text, text, text, text, text, uuid) is
  'Save a store Pick whose category the member typed (no fitting category). Store = p_catalog_id, or p_place_name + Naver p_map_url. Creates the member''s pending request item in pending-product with requested_category_label (store in private.category_request_places) and a needs_review Pick (owner-only). Requests on different stores or labels never replace each other; repeating the same store+label updates the review. p_request_id makes retries idempotent.';

commit;
