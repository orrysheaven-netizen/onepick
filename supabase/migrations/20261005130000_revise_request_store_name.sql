-- Figma 22 (user decision 10-05): the 정보 수정 screen edits 상호명 + 매장 링크.
-- revise_item_request gains p_name. Only a member-submitted store (places.place_provider
-- = 'user') used solely by the caller's own pending/rejected requests can be renamed;
-- catalog stores keep their catalog name.
--
-- The old 6-argument signature is dropped: keeping both overloads would make every
-- named-argument call (p_link_url => ...) ambiguous.

create or replace function private.revise_item_request_impl(
  p_item_id uuid,
  p_link_url text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text,
  p_remove_photo boolean,
  p_name text
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.items%rowtype;
  v_place public.places%rowtype;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'), '');
  v_normalized text;
  v_link text;
begin
  if v_name is not null then
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

    if v_name is distinct from v_item.name then
      if char_length(v_name) not between 1 and 100 then
        raise exception 'PLACE_NAME_INVALID' using errcode = 'P0001';
      end if;

      select p.* into v_place
      from public.item_places ip
      join public.places p on p.id = ip.place_id
      where ip.item_id = v_item.id and p.place_provider = 'user'
      for update of p;
      if not found or exists (
        select 1 from public.item_places ip
        join public.items i on i.id = ip.item_id
        where ip.place_id = v_place.id
          and (i.created_by is distinct from v_user or i.status not in ('pending', 'rejected'))
      ) then
        raise exception 'ITEM_NAME_NOT_EDITABLE' using errcode = 'P0001';
      end if;

      -- Same identity rule as registration (#593): normalized name + exact map link,
      -- checked against the link this same call is about to save.
      v_normalized := lower(regexp_replace(v_name, '[[:space:]]+', '', 'g'));
      v_link := coalesce(nullif(btrim(p_link_url), ''), v_place.map_url);
      perform pg_advisory_xact_lock(
        hashtextextended('user-place:' || v_normalized || ':' || coalesce(v_link, ''), 0)
      );
      if exists (
        select 1 from public.places p
        where p.place_provider = 'user'
          and p.id <> v_place.id
          and lower(regexp_replace(btrim(p.name), '[[:space:]]+', '', 'g')) = v_normalized
          and p.map_url is not distinct from v_link
      ) then
        raise exception 'PLACE_ALREADY_REGISTERED' using errcode = 'P0001';
      end if;

      update public.places set name = v_name, updated_at = now() where id = v_place.id;
      update public.place_catalog
      set name = v_name, normalized_name = private.normalize_place_name(v_name)
      where place_provider = v_place.place_provider and provider_place_id = v_place.provider_place_id;
      begin
        update public.items i
        set name = v_name, normalized_name = v_normalized
        from public.item_places ip
        where ip.place_id = v_place.id and i.id = ip.item_id;
      exception when unique_violation then
        raise exception 'PLACE_ALREADY_REGISTERED' using errcode = 'P0001';
      end;
    end if;
  end if;

  -- Link/photo edits and the return to the review queue are unchanged.
  return private.revise_item_request_impl(
    p_item_id, p_link_url, p_image_path, p_thumbnail_path, p_image_source_url, p_remove_photo
  );
end;
$$;

revoke all on function private.revise_item_request_impl(uuid, text, text, text, text, boolean, text) from public, anon;
grant execute on function private.revise_item_request_impl(uuid, text, text, text, text, boolean, text) to authenticated, service_role;

drop function if exists public.revise_item_request(uuid, text, text, text, text, boolean);

create or replace function public.revise_item_request(
  p_item_id uuid,
  p_link_url text default null,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null,
  p_remove_photo boolean default false,
  p_name text default null
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.revise_item_request_impl(
    p_item_id, p_link_url, p_image_path, p_thumbnail_path, p_image_source_url, p_remove_photo, p_name
  );
$$;

revoke all on function public.revise_item_request(uuid, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.revise_item_request(uuid, text, text, text, text, boolean, text) to authenticated, service_role;
comment on function public.revise_item_request(uuid, text, text, text, text, boolean, text) is
  'After a 수정 필요 notice: rename my own member-submitted store (p_name), replace the link and/or the photo of my own pending or rejected request, and put it back in the review queue. My needs_review Pick on it stays my current Pick.';
