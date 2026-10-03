-- Security QA #640 L4 (user decision 2026-10-02/03): the first photo for a
-- published product is reviewed by an admin before anyone else sees it.
--
--   * A photo uploaded for an active/discontinued product without an approved
--     photo is stored as an item_photo_candidates row, not on items. The
--     product stays photo-less for everyone else until approval.
--   * A Pick saved with such a candidate is needs_review: only its owner sees
--     it (existing picks RLS / read RPCs), together with their candidate photo.
--   * An admin (AAL2) approves a candidate: it becomes the item's photo (credit
--     follows the Storage owner as before), every other pending candidate for
--     that item is superseded and the item's waiting needs_review Picks become
--     active. Rejecting drops only the photo: the Pick keeps waiting and the
--     member can send another photo.
--   * A new product is unchanged: it is already a pending request visible only
--     to its requester and reviewed as a whole, photo included.
--   * Storage stays as is (public item-photos bucket; user decision). The
--     restriction before approval applies to app/API exposure only; a Storage
--     URL itself is not private. Pending candidate files are protected from the
--     owner-delete policy and the stale cleanup.
--
-- Lock order everywhere: items row, then candidate rows.
-- Production apply remains a separate user approval gate.

begin;

-- ---------------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------------

create table public.item_photo_candidates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null,
  thumbnail_path text not null,
  image_source_url text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_path <> thumbnail_path)
);

create unique index item_photo_candidates_one_pending_idx
  on public.item_photo_candidates(item_id, user_id)
  where status = 'pending';
create index item_photo_candidates_pending_queue_idx
  on public.item_photo_candidates(created_at, id)
  where status = 'pending';
create index item_photo_candidates_user_idx
  on public.item_photo_candidates(user_id);
create index item_photo_candidates_pending_image_idx
  on public.item_photo_candidates(image_path)
  where status = 'pending';
create index item_photo_candidates_pending_thumbnail_idx
  on public.item_photo_candidates(thumbnail_path)
  where status = 'pending';

alter table public.item_photo_candidates enable row level security;
revoke all on public.item_photo_candidates from public, anon, authenticated;
grant select on public.item_photo_candidates to authenticated;
grant all on public.item_photo_candidates to service_role;

-- The uploader sees their own candidates; nobody else does. Writes go through
-- the SECURITY DEFINER functions below only.
create policy item_photo_candidates_own_select
on public.item_photo_candidates
for select to authenticated
using (user_id = (select auth.uid()));

comment on table public.item_photo_candidates is
  'L4: member photos for a published product without an approved photo, waiting for admin review. Readable only by the uploader; approval copies the photo onto items. Not a Storage privacy boundary (public bucket).';

create or replace function private.item_has_photo(p_item public.items)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(p_item.image_path), ''),
    nullif(btrim(p_item.thumbnail_path), ''),
    nullif(btrim(p_item.image_source_url), '')
  ) is not null;
$$;
revoke all on function private.item_has_photo(public.items) from public, anon, authenticated;

create or replace function private.has_pending_item_photo_candidate(p_user uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.item_photo_candidates c
    where c.item_id = p_item_id
      and c.user_id = p_user
      and c.status = 'pending'
  );
$$;
revoke all on function private.has_pending_item_photo_candidate(uuid, uuid) from public, anon, authenticated;

-- Callers lock the item row and validate the uploaded files first (same rules
-- as before this change). One pending candidate per uploader and item. A new
-- photo never reuses the old candidate id: the waiting one is superseded and
-- the new photo gets a new id, so an admin decision on an id always applies to
-- the exact photo the admin saw (an older id fails as not pending).
create or replace function private.submit_item_photo_candidate(
  p_user uuid,
  p_item_id uuid,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- The items photo trigger used to stop suspended members; keep that rule.
  if private.is_user_suspended(p_user) then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;

  update public.item_photo_candidates
  set status = 'superseded',
      updated_at = now()
  where item_id = p_item_id
    and user_id = p_user
    and status = 'pending';

  insert into public.item_photo_candidates(
    item_id, user_id, image_path, thumbnail_path, image_source_url
  ) values (
    p_item_id, p_user, p_image_path, p_thumbnail_path, p_image_source_url
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function private.submit_item_photo_candidate(uuid, uuid, text, text, text) from public, anon, authenticated;

-- Once a published item has a photo by any route (candidate approval, admin
-- replacement), the other waiting photos are settled and the Picks that waited
-- for a photo are published.
create or replace function private.settle_item_photo_candidates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.item_has_photo(new) then
    return new;
  end if;

  update public.item_photo_candidates
  set status = 'superseded', updated_at = now()
  where item_id = new.id
    and status = 'pending';

  if new.status in ('active', 'discontinued') then
    update public.picks
    set status = 'active', updated_at = now()
    where item_id = new.id
      and status = 'needs_review';
  end if;

  return new;
end;
$$;
revoke all on function private.settle_item_photo_candidates() from public, anon, authenticated;

create trigger items_settle_photo_candidates
after update of image_path, thumbnail_path, image_source_url
on public.items
for each row execute function private.settle_item_photo_candidates();

-- ---------------------------------------------------------------------------
-- Storage: a pending candidate's files are in use
-- ---------------------------------------------------------------------------

create or replace function private.is_unused_item_photo(p_path text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  select auth.uid() is not null
    and split_part(p_path,'/',1)=auth.uid()::text
    and not exists(
      select 1 from public.items
      where image_path=p_path or thumbnail_path=p_path
    )
    and not exists(
      select 1 from public.item_photo_candidates c
      where c.status='pending'
        and (c.image_path=p_path or c.thumbnail_path=p_path)
    );
$$;
revoke all on function private.is_unused_item_photo(text) from public,anon;
grant execute on function private.is_unused_item_photo(text) to authenticated;

create or replace function public.stale_item_photo_paths(p_limit integer default 100)
returns table(path text)
language sql
stable
security definer
set search_path = ''
as $function$
  select o.name
  from storage.objects o
  where o.bucket_id='item-photos'
    and o.created_at < clock_timestamp()-interval '24 hours'
    and not exists (
      select 1
      from public.items i
      where i.image_path=o.name or i.thumbnail_path=o.name
    )
    and not exists (
      select 1
      from public.item_photo_candidates c
      where c.status='pending'
        and (c.image_path=o.name or c.thumbnail_path=o.name)
    )
  order by o.created_at,o.name
  limit least(greatest(coalesce(p_limit,100),1),100);
$function$;
revoke all on function public.stale_item_photo_paths(integer) from public, anon, authenticated;
grant execute on function public.stale_item_photo_paths(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Member write paths: same validation, the photo becomes a candidate
-- ---------------------------------------------------------------------------

create or replace function private.attach_item_photo_impl(
  p_item_id uuid, p_image_path text, p_thumbnail_path text,
  p_image_source_url text default null
)
returns public.items language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_item public.items%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not exists(select 1 from public.profiles where id = v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_item.status not in ('active', 'discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  -- Row lock makes the first successful image authoritative. No overwrite.
  if v_item.image_path is not null or v_item.thumbnail_path is not null
     or v_item.image_source_url is not null then return v_item; end if;
  if p_image_path is null or p_thumbnail_path is null or p_image_path = p_thumbnail_path
     or split_part(p_image_path, '/', 1) <> v_user_id::text
     or split_part(p_thumbnail_path, '/', 1) <> v_user_id::text then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  perform 1 from storage.objects where bucket_id = 'item-photos' and name = p_image_path
    and owner_id = v_user_id::text and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint,0) > 0 for share;
  if not found then raise exception 'PHOTO_INVALID' using errcode = 'P0001'; end if;
  perform 1 from storage.objects where bucket_id = 'item-photos' and name = p_thumbnail_path
    and owner_id = v_user_id::text and metadata->>'mimetype' = 'image/jpeg'
    and coalesce((metadata->>'size')::bigint,0) > 0 for share;
  if not found then raise exception 'PHOTO_INVALID' using errcode = 'P0001'; end if;
  if p_image_source_url is not null
     and (char_length(p_image_source_url) > 2048 or p_image_source_url !~ '^https://') then
    raise exception 'PHOTO_INVALID' using errcode = 'P0001';
  end if;
  -- L4: the item keeps no photo until an admin approves this candidate.
  perform private.submit_item_photo_candidate(
    v_user_id, p_item_id, p_image_path, p_thumbnail_path, p_image_source_url
  );
  return v_item;
end;
$function$;

create or replace function private.register_pick_impl(
  p_category_id uuid, p_item_id uuid, p_item_name text, p_one_line_review text,
  p_image_path text, p_thumbnail_path text, p_image_source_url text, p_channel text
)
returns public.picks language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_result public.picks%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if p_one_line_review is null or char_length(btrim(p_one_line_review)) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;
  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable or v_category.status<>'open'
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;
  if p_item_id is null then raise exception 'ITEM_SELECTION_REQUIRED' using errcode='P0001'; end if;
  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001'; end if;
  if v_item.status not in ('active','discontinued') then raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001'; end if;
  if v_item.image_path is null and v_item.thumbnail_path is null and v_item.image_source_url is null
     and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    perform 1 from storage.objects where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg' and coalesce((metadata->>'size')::bigint,0) > 0 for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;
    if p_image_source_url is not null and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
    -- L4: a candidate until an admin approves it; change_pick_impl then saves
    -- the Pick as needs_review.
    perform private.submit_item_photo_candidate(
      v_user, v_item.id, p_image_path, p_thumbnail_path, p_image_source_url
    );
  end if;
  -- 이 경로는 아직 구매처 링크를 받지 않는다. 링크 인자를 명시적으로 비워
  -- 넘겨, 나중에 여기에도 붙일 자리를 드러내 둔다.
  v_result := private.change_pick_impl(
    p_category_id,v_item.id,btrim(p_one_line_review),null,null,p_channel
  );
  return v_result;
end;
$function$;

create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text,
  p_purchase_url text,
  p_purchase_tip text,
  p_channel text
)
returns public.picks
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
  v_fresh_url text := case when p_purchase_url is null then null
                           else private.normalize_purchase_url(p_purchase_url) end;
  v_url text;
  v_tip text;
  v_channel text;
  v_category public.categories%rowtype;
  v_item public.items%rowtype;
  v_current public.picks%rowtype;
  v_result public.picks%rowtype;
  v_new_pick_id uuid := gen_random_uuid();
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user_id) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;
  if v_review is null or char_length(v_review)<1 or char_length(v_review)>100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found then raise exception 'CATEGORY_NOT_FOUND' using errcode='P0001'; end if;
  if v_category.status<>'open' or v_category.is_pickable is not true
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  -- Match register_item_pick's item-row lock so a concurrent last-photo removal
  -- cannot pass while this transaction is creating/replacing a current Pick.
  select * into v_item
  from public.items
  where id=p_item_id
  for update;

  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then
    raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001';
  end if;
  if v_item.status not in ('active','discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  v_channel := private.resolve_pick_channel(p_category_id, p_item_id, p_channel);

  -- One lock per (member, category) covers every channel of the category.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text,0)
  );

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and channel is not distinct from v_channel
    and status in ('active','needs_review')
  for update;

  if found and v_current.item_id=p_item_id then
    -- A legacy Pick may be photo-less. Editing that same Pick's review must stay
    -- possible; the photo invariant applies when a new current Pick is created.
    v_url := case when p_purchase_url is null then v_current.purchase_url else v_fresh_url end;
    v_tip := case
      when p_purchase_tip is not null then private.normalize_purchase_tip(p_purchase_tip, v_url)
      when v_url is null then null
      else v_current.purchase_tip
    end;

    -- L4: a Pick waiting for its photo review stays waiting.
    update public.picks
    set one_line_review=v_review,purchase_url=v_url,purchase_tip=v_tip,
        status=case
          when v_current.status='needs_review' and not private.item_has_photo(v_item)
            then 'needs_review'
          else 'active'
        end,
        ended_at=null,updated_at=now()
    where id=v_current.id
    returning * into v_result;
    return v_result;
  end if;

  -- Preserve the existing error contract when the same item is already current
  -- under another channel.
  if exists (
    select 1 from public.picks
    where user_id=v_user_id
      and item_id=p_item_id
      and status in ('active','needs_review')
  ) then
    raise exception 'ITEM_ALREADY_PICKED' using errcode='P0001';
  end if;

  -- New/replacement Picks require a representative image at the server boundary.
  -- External catalog posters count via image_source_url. L4: my own photo that
  -- waits for admin review counts, and the Pick waits (needs_review) with it.
  if not private.item_has_photo(v_item)
     and not private.has_pending_item_photo_candidate(v_user_id, p_item_id) then
    raise exception 'PHOTO_REQUIRED' using errcode='P0001';
  end if;

  -- A new Pick. If the item changes, old purchase metadata does not carry over.
  v_url := v_fresh_url;
  v_tip := private.normalize_purchase_tip(p_purchase_tip, v_url);

  if found then
    update public.picks
    set status='replaced',ended_at=now(),replaced_by_pick_id=v_new_pick_id,updated_at=now()
    where id=v_current.id;
  end if;

  insert into public.picks(
    id,user_id,category_id,item_id,channel,one_line_review,purchase_url,purchase_tip,
    status,started_at,ended_at,replaced_by_pick_id
  ) values (
    v_new_pick_id,v_user_id,p_category_id,p_item_id,v_channel,v_review,v_url,v_tip,
    case when private.item_has_photo(v_item) then 'active' else 'needs_review' end,
    now(),null,null
  )
  returning * into v_result;

  return v_result;
end;
$function$;

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
  v_awaiting_photo boolean := false;
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
  -- L4: on a published product without an approved photo, my photo is only a
  -- candidate until an admin approves it, and my Pick waits (needs_review) with
  -- it. My own pending request is unchanged: the whole request, photo included,
  -- is reviewed and visible to nobody else.
  if not private.item_has_photo(v_item) then
    if p_image_path is null or p_thumbnail_path is null then
      if v_item.status = 'pending'
         or not private.has_pending_item_photo_candidate(v_user, v_item.id) then
        raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
      end if;
    else
      perform private.assert_item_photo_owned(v_user, p_image_path, p_thumbnail_path, p_image_source_url);
      if v_item.status = 'pending' then
        -- The first valid photo wins; a concurrent loser keeps the row as it is.
        update public.items
        set image_path = p_image_path,
            thumbnail_path = p_thumbnail_path,
            image_source_url = p_image_source_url
        where id = v_item.id and image_path is null;
        select * into v_item from public.items where id = v_item.id;
      else
        perform private.submit_item_photo_candidate(
          v_user, v_item.id, p_image_path, p_thumbnail_path, p_image_source_url
        );
      end if;
    end if;
    v_awaiting_photo := v_item.status <> 'pending' and not private.item_has_photo(v_item);
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
    case when v_item.status = 'pending' or v_awaiting_photo then 'needs_review' else 'active' end,
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

-- ---------------------------------------------------------------------------
-- Admin review (AAL2)
-- ---------------------------------------------------------------------------

create or replace function public.admin_item_photo_candidates(p_limit integer default 100)
returns table(
  candidate_id uuid,
  item_id uuid,
  item_name text,
  item_status text,
  category_name text,
  user_id uuid,
  username text,
  image_path text,
  thumbnail_path text,
  image_source_url text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  return query
  select c.id, i.id, i.name, i.status, cat.name, c.user_id, p.username,
         c.image_path, c.thumbnail_path, c.image_source_url, c.created_at
  from public.item_photo_candidates c
  join public.items i on i.id = c.item_id
  join public.categories cat on cat.id = i.category_id
  left join public.profiles p on p.id = c.user_id
  where c.status = 'pending'
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit,100),1),200);
end;
$$;
revoke all on function public.admin_item_photo_candidates(integer) from public, anon;
grant execute on function public.admin_item_photo_candidates(integer) to authenticated;

-- Idempotent: repeating the decision already recorded returns the row as is.
-- Concurrency: the item row is locked before the candidate (same order as the
-- member paths), so two admins approving two photos of one item serialize and
-- the second sees its candidate superseded.
create or replace function public.admin_review_item_photo_candidate(
  p_candidate_id uuid,
  p_approve boolean
)
returns public.item_photo_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_item public.items%rowtype;
  v_candidate public.item_photo_candidates%rowtype;
  v_decision text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_approve is null then
    raise exception 'PHOTO_REVIEW_DECISION_REQUIRED' using errcode='P0001';
  end if;
  v_decision := case when p_approve then 'approved' else 'rejected' end;

  select c.item_id into v_item_id
  from public.item_photo_candidates c
  where c.id = p_candidate_id;
  if v_item_id is null then
    raise exception 'PHOTO_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;

  select * into v_item from public.items where id = v_item_id for update;
  select * into v_candidate
  from public.item_photo_candidates
  where id = p_candidate_id
  for update;

  if v_candidate.status = v_decision then
    return v_candidate;
  end if;
  if v_candidate.status <> 'pending' then
    raise exception 'PHOTO_CANDIDATE_NOT_PENDING' using errcode='P0001';
  end if;

  if p_approve then
    if v_item.status not in ('active', 'discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;
    if private.item_has_photo(v_item) then
      -- Replacing an existing photo stays with admin_replace_item_photo.
      raise exception 'ITEM_PHOTO_EXISTS' using errcode='P0001';
    end if;

    perform 1
    from storage.objects original
    join storage.objects thumb
      on thumb.bucket_id='item-photos'
     and thumb.name=v_candidate.thumbnail_path
     and thumb.owner_id=original.owner_id
    where original.bucket_id='item-photos'
      and original.name=v_candidate.image_path
      and original.owner_id=v_candidate.user_id::text
      and original.metadata->>'mimetype'='image/jpeg'
      and thumb.metadata->>'mimetype'='image/jpeg';
    if not found then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    -- items triggers: credit (Storage owner), other candidates superseded,
    -- waiting needs_review Picks on this item published.
    update public.items
    set image_path = v_candidate.image_path,
        thumbnail_path = v_candidate.thumbnail_path,
        image_source_url = v_candidate.image_source_url,
        updated_at = clock_timestamp()
    where id = v_item.id;
  end if;

  update public.item_photo_candidates
  set status = v_decision,
      reviewed_by = v_actor,
      reviewed_at = now(),
      updated_at = now()
  where id = v_candidate.id
  returning * into v_candidate;

  return v_candidate;
end;
$$;
revoke all on function public.admin_review_item_photo_candidate(uuid, boolean) from public, anon;
grant execute on function public.admin_review_item_photo_candidate(uuid, boolean) to authenticated;

comment on function public.admin_review_item_photo_candidate(uuid, boolean) is
  'L4: approve (photo becomes the item photo, other pending candidates superseded, waiting Picks published) or reject (photo dropped, Pick keeps waiting) a pending member photo. AAL2 admin only, idempotent for a repeated decision, refuses when the item already has a photo.';

commit;
