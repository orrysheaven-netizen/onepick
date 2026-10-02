-- #634: a current Pick must never lose its item's last representative photo.
--
-- New/replacement Picks already require a photo (20261001130000). This migration
-- protects the inverse direction: once an active/needs_review Pick exists, an
-- item update cannot remove its last representative photo.
--
-- Row locking is the concurrency contract:
--   * item photo removal UPDATEs lock the item row before the trigger runs.
--   * register_item_pick already locks the selected item row FOR UPDATE.
--   * change_pick now locks the selected item row FOR UPDATE before its existing
--     PHOTO_REQUIRED check.
--   * pending-item merge already locks source + target item rows; a small trigger
--     also refuses a photo-less target when a needs_review Pick would move there.
--
-- Production apply remains a separate user approval gate.

begin;

create or replace function private.guard_current_pick_item_photo_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Only guard an actual transition from an effective representative photo to
  -- none. Blank strings do not count as photos, so normalizing a legacy
  -- photo-less row from blanks to NULL remains allowed.
  if coalesce(
       nullif(btrim(new.image_path), ''),
       nullif(btrim(new.thumbnail_path), ''),
       nullif(btrim(new.image_source_url), '')
     ) is not null
     or coalesce(
       nullif(btrim(old.image_path), ''),
       nullif(btrim(old.thumbnail_path), ''),
       nullif(btrim(old.image_source_url), '')
     ) is null then
    return new;
  end if;

  if exists (
    select 1
    from public.picks p
    where p.item_id = new.id
      and p.status in ('active','needs_review')
  ) then
    raise exception 'PHOTO_REQUIRED' using errcode='P0001';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_current_pick_item_photo_removal()
  from public,anon,authenticated;

drop trigger if exists items_guard_current_pick_photo_removal on public.items;
create trigger items_guard_current_pick_photo_removal
before update of image_path,thumbnail_path,image_source_url
on public.items
for each row execute function private.guard_current_pick_item_photo_removal();

create or replace function private.guard_pending_pick_merge_target_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target public.items%rowtype;
begin
  if old.status <> 'pending'
     or new.status <> 'merged'
     or new.merged_into_item_id is null
     or not exists (
       select 1 from public.picks p
       where p.item_id = new.id
         and p.status = 'needs_review'
     ) then
    return new;
  end if;

  -- Serialize with representative-photo replacement/removal on the merge target.
  select * into v_target
  from public.items
  where id = new.merged_into_item_id
  for update;

  if found and coalesce(
       nullif(btrim(v_target.image_path), ''),
       nullif(btrim(v_target.thumbnail_path), ''),
       nullif(btrim(v_target.image_source_url), '')
     ) is null then
    raise exception 'PHOTO_REQUIRED' using errcode='P0001';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_pending_pick_merge_target_photo()
  from public,anon,authenticated;

drop trigger if exists items_guard_pending_pick_merge_target_photo on public.items;
create trigger items_guard_pending_pick_merge_target_photo
before update of status,merged_into_item_id
on public.items
for each row execute function private.guard_pending_pick_merge_target_photo();

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

    update public.picks
    set one_line_review=v_review,purchase_url=v_url,purchase_tip=v_tip,
        status='active',ended_at=null,updated_at=now()
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
  -- External catalog posters count via image_source_url.
  if coalesce(
       nullif(btrim(v_item.image_path), ''),
       nullif(btrim(v_item.thumbnail_path), ''),
       nullif(btrim(v_item.image_source_url), '')
     ) is null then
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
    'active',now(),null,null
  )
  returning * into v_result;

  return v_result;
end;
$function$;

comment on function private.change_pick_impl(uuid,uuid,text,text,text,text) is
  'Creates/replaces a current Pick only when the target item has a representative image; item-row locking serializes that check with last-photo removal. Same-item legacy review edits remain allowed.';

commit;
