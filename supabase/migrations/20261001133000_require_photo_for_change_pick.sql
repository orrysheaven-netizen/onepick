-- Enforce the product policy that a newly created/replaced Pick must have a photo.
-- Existing legacy photo-less Picks may still update their review/link because the
-- same-item branch returns before PHOTO_REQUIRED is checked.
--
-- A photo is present when items.image_path, thumbnail_path or image_source_url
-- contains a non-blank value. This covers uploaded photos and external catalog art.

begin;

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

  select * into v_item from public.items where id=p_item_id;
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
    -- Legacy photo-less Picks can still edit their review/link; this path does
    -- not create a new Pick.
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

  -- The same item cannot be a current Pick under another channel.
  if exists (
    select 1 from public.picks
    where user_id=v_user_id
      and item_id=p_item_id
      and status in ('active','needs_review')
  ) then
    raise exception 'ITEM_ALREADY_PICKED' using errcode='P0001';
  end if;

  -- New/replacement Picks must point to an item that already has a usable photo.
  if coalesce(
    nullif(btrim(v_item.image_path),''),
    nullif(btrim(v_item.thumbnail_path),''),
    nullif(btrim(v_item.image_source_url),'')
  ) is null then
    raise exception 'PHOTO_REQUIRED' using errcode='P0001';
  end if;

  -- 새 원픽이다. 상품이 달라졌으면 이전 구매처는 이 선택의 것이 아니다.
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

commit;
