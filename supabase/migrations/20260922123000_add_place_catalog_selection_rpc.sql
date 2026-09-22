begin;

create or replace function private.select_place_catalog_item_impl(
  p_catalog_id uuid,
  p_category_id uuid
)
returns table(item_id uuid, category_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_catalog public.place_catalog%rowtype;
  v_place public.places%rowtype;
  v_item public.items%rowtype;
  v_name text;
  v_branch text;
  v_road text;
  v_normalized text;
  v_is_food boolean := false;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if private.user_is_suspended(v_user_id) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if p_catalog_id is null or p_category_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  if not public.category_is_open_leaf(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  with recursive ancestors as (
    select c.id,c.parent_id,c.slug
    from public.categories c
    where c.id=p_category_id
    union all
    select p.id,p.parent_id,p.slug
    from public.categories p
    join ancestors a on a.parent_id=p.id
  )
  select exists(select 1 from ancestors where slug='food') into v_is_food;

  if not v_is_food then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_catalog
  from public.place_catalog
  where id=p_catalog_id
    and business_status='open';

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  v_name := btrim(regexp_replace(v_catalog.name,'[[:space:]]+',' ','g'));
  v_branch := nullif(btrim(regexp_replace(coalesce(v_catalog.branch_name,''),'[[:space:]]+',' ','g')),'');
  v_road := coalesce(
    nullif(btrim(regexp_replace(coalesce(v_catalog.road_address,''),'[[:space:]]+',' ','g')),''),
    nullif(btrim(regexp_replace(coalesce(v_catalog.address,''),'[[:space:]]+',' ','g')),'')
  );

  if char_length(v_name) not between 1 and 100
     or v_road is null
     or char_length(v_road) not between 1 and 300
     or (v_branch is not null and char_length(v_branch)>100)
     or (v_catalog.address is not null and char_length(btrim(v_catalog.address))>300)
     or (v_catalog.region_1 is not null and char_length(btrim(v_catalog.region_1))>80)
     or (v_catalog.region_2 is not null and char_length(btrim(v_catalog.region_2))>80)
     or ((v_catalog.latitude is null) <> (v_catalog.longitude is null))
     or (v_catalog.latitude is not null and v_catalog.latitude not between -90 and 90)
     or (v_catalog.longitude is not null and v_catalog.longitude not between -180 and 180) then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'place:'||v_catalog.place_provider||':'||v_catalog.provider_place_id,
      0
    )
  );

  select * into v_place
  from public.places
  where place_provider=v_catalog.place_provider
    and provider_place_id=v_catalog.provider_place_id
  for update;

  if found then
    if not v_place.is_visible then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;
  else
    insert into public.places(
      name,branch_name,road_address,address,region_1,region_2,
      latitude,longitude,place_provider,provider_place_id
    )
    values(
      v_name,v_branch,v_road,nullif(btrim(v_catalog.address),''),
      nullif(btrim(v_catalog.region_1),''),nullif(btrim(v_catalog.region_2),''),
      v_catalog.latitude,v_catalog.longitude,
      v_catalog.place_provider,v_catalog.provider_place_id
    )
    returning * into v_place;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'place-item:'||v_place.id::text||':'||p_category_id::text,
      0
    )
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
    if v_item.status not in ('active','discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;

    insert into public.item_channels(item_id,channel,target_url,is_primary)
    values(v_item.id,'offline',null,true)
    on conflict(item_id,channel) do update
    set is_primary=true,
        updated_at=now();

    return query select v_item.id,p_category_id,false;
    return;
  end if;

  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  insert into public.items(
    category_id,name,normalized_name,status,external_source,external_id
  )
  values(
    p_category_id,v_name,v_normalized,'active','onepick_place',
    v_place.id::text||':'||p_category_id::text
  )
  returning * into v_item;

  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,p_category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',null,true);

  return query select v_item.id,p_category_id,true;
end;
$$;

revoke all on function private.select_place_catalog_item_impl(uuid,uuid)
  from public,anon;
grant execute on function private.select_place_catalog_item_impl(uuid,uuid)
  to authenticated;

create or replace function public.select_place_catalog_item(
  p_catalog_id uuid,
  p_category_id uuid
)
returns table(item_id uuid, category_id uuid, created boolean)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.select_place_catalog_item_impl(p_catalog_id,p_category_id);
$$;

revoke all on function public.select_place_catalog_item(uuid,uuid)
  from public,anon;
grant execute on function public.select_place_catalog_item(uuid,uuid)
  to authenticated;

commit;
