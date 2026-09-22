begin;

alter table public.category_catalog_sources
  add column if not exists place_catalog_enabled boolean not null default false;

comment on column public.category_catalog_sources.place_catalog_enabled is
  'When true, this category may search trusted place_catalog rows and materialize a canonical place-backed item.';

-- Only the leaves introduced specifically for the restaurant-first taxonomy are
-- opened for place-backed selection. Existing packaged-product categories such
-- as ramen/ice-cream keep their current item catalog behavior.
update public.category_catalog_sources s
set place_catalog_enabled=true,
    updated_at=now()
from public.categories c
where c.id=s.category_id
  and c.slug in (
    'daechang','makchang','yeomtong','special-yang','gopchang-jeongol',
    'pork-neck','pork-jowl','pork-gabrisal','pork-ribs','beef-ribs',
    'beef-short-rib-meat','hanwoo-grill','bossam','spicy-pork','dakgalbi',
    'chicken-feet','duck-meat','lamb-skewers',
    'pyeongyang-naengmyeon','hamheung-naengmyeon','milmyeon','kalguksu',
    'sujebi','janchi-guksu','bibim-guksu','makguksu','soba',
    'japanese-ramen','jjajangmyeon','jjamppong','tantanmen','malatang',
    'mala-xiangguo',
    'pork-gukbap','sundae-guk','seolleongtang','gomtang','galbitang',
    'haejangguk','gamjatang','chueotang','yukgaejang','samgyetang',
    'kimchi-jjigae','doenjang-jjigae','cheonggukjang','budae-jjigae',
    'dakbokkeumtang','maeuntang','bibimbap','gimbap','omurice','curry',
    'rice-bowl',
    'sushi','sashimi','mulhoe','grilled-shellfish','steamed-shellfish',
    'agujjim','nakji','jjukkumi','blue-crab','spicy-marinated-crab',
    'grilled-fish',
    'sundae','fried-snacks','hotdog','toast','burger','fried-chicken',
    'donut','financier','madeleine','tart','pudding','bingsu'
  );

create or replace function public.category_uses_place_catalog(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.category_catalog_sources s
    join public.categories c on c.id=s.category_id
    where s.category_id=p_category_id
      and s.is_enabled
      and s.place_catalog_enabled
      and c.status='open'
      and c.is_visible
      and c.is_pickable
      and public.category_is_open_leaf(c.id)
  );
$$;

revoke all on function public.category_uses_place_catalog(uuid) from public;
grant execute on function public.category_uses_place_catalog(uuid) to anon, authenticated;

create or replace function public.search_place_catalog(
  p_category_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table(
  catalog_id uuid,
  place_provider text,
  provider_place_id text,
  name text,
  branch_name text,
  road_address text,
  address text,
  region_1 text,
  region_2 text,
  latitude double precision,
  longitude double precision,
  provider_category text,
  existing_item_id uuid
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g'));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),20);
begin
  if p_category_id is null
     or char_length(v_query) not between 2 and 100
     or not public.category_uses_place_catalog(p_category_id) then
    return;
  end if;

  return query
  select
    pc.id,
    pc.place_provider,
    pc.provider_place_id,
    pc.name,
    pc.branch_name,
    pc.road_address,
    pc.address,
    pc.region_1,
    pc.region_2,
    pc.latitude,
    pc.longitude,
    pc.provider_category,
    case when i.id is not null then i.id else null end
  from public.place_catalog pc
  left join public.places p
    on p.place_provider=pc.place_provider
   and p.provider_place_id=pc.provider_place_id
   and p.is_visible
  left join public.item_places ip
    on ip.place_id=p.id
   and ip.category_id=p_category_id
  left join public.items i
    on i.id=ip.item_id
   and i.category_id=ip.category_id
   and i.status in ('active','discontinued')
  where pc.business_status='open'
    and (
      pc.normalized_name=v_query
      or pc.normalized_name like v_query||'%'
      or pc.normalized_name like '%'||v_query||'%'
      or extensions.similarity(pc.normalized_name,v_query) >= 0.25
    )
  order by
    case
      when pc.normalized_name=v_query then 0
      when pc.normalized_name like v_query||'%' then 1
      when pc.normalized_name like '%'||v_query||'%' then 2
      else 3
    end,
    extensions.similarity(pc.normalized_name,v_query) desc,
    pc.name,
    coalesce(pc.branch_name,''),
    pc.provider_place_id
  limit v_limit;
end;
$$;

revoke all on function public.search_place_catalog(uuid,text,integer) from public;
grant execute on function public.search_place_catalog(uuid,text,integer) to anon, authenticated;

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
  v_catalog public.place_catalog%rowtype;
  v_place public.places%rowtype;
  v_match public.places%rowtype;
  v_item public.items%rowtype;
  v_road text;
  v_address text;
  v_normalized text;
  v_match_count integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if not public.category_uses_place_catalog(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_catalog
  from public.place_catalog
  where id=p_catalog_id
    and business_status='open'
  for share;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  v_road := coalesce(nullif(btrim(v_catalog.road_address),''), nullif(btrim(v_catalog.address),''));
  v_address := nullif(btrim(v_catalog.address),'');
  v_normalized := lower(regexp_replace(btrim(v_catalog.name),'[[:space:]]+','','g'));

  if char_length(btrim(v_catalog.name)) not between 1 and 100
     or v_road is null
     or char_length(v_road)>300
     or (v_address is not null and char_length(v_address)>300)
     or (v_catalog.branch_name is not null and char_length(btrim(v_catalog.branch_name))>100)
     or (v_catalog.region_1 is not null and char_length(btrim(v_catalog.region_1))>80)
     or (v_catalog.region_2 is not null and char_length(btrim(v_catalog.region_2))>80)
     or ((v_catalog.latitude is null) <> (v_catalog.longitude is null))
     or (v_catalog.latitude is not null and v_catalog.latitude not between -90 and 90)
     or (v_catalog.longitude is not null and v_catalog.longitude not between -180 and 180) then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('place:'||v_catalog.place_provider||':'||v_catalog.provider_place_id,0)
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
    -- Provider IDs can change between source revisions. Before creating another
    -- canonical place, reuse one same-provider place only when exact metadata
    -- identifies a single unambiguous candidate. Ambiguous matches remain for
    -- administrator reconciliation instead of silently merging branches.
    select count(*), min(p.id) into v_match_count, v_match.id
    from public.places p
    where p.place_provider=v_catalog.place_provider
      and lower(regexp_replace(btrim(p.name),'[[:space:]]+','','g'))=v_normalized
      and (
        nullif(btrim(p.road_address),'')=v_road
        or (v_address is not null and nullif(btrim(p.address),'')=v_address)
        or (
          v_catalog.latitude is not null
          and p.latitude=v_catalog.latitude
          and p.longitude=v_catalog.longitude
        )
      );

    if v_match_count>1 then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    elsif v_match_count=1 then
      select * into v_place from public.places where id=v_match.id for update;
      if not v_place.is_visible then
        raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
      end if;
      update public.places
      set provider_place_id=v_catalog.provider_place_id,
          name=btrim(v_catalog.name),
          branch_name=nullif(btrim(v_catalog.branch_name),''),
          road_address=v_road,
          address=v_address,
          region_1=nullif(btrim(v_catalog.region_1),''),
          region_2=nullif(btrim(v_catalog.region_2),''),
          latitude=v_catalog.latitude,
          longitude=v_catalog.longitude
      where id=v_place.id
      returning * into v_place;
    else
      insert into public.places(
        name,branch_name,road_address,address,region_1,region_2,
        latitude,longitude,place_provider,provider_place_id
      ) values (
        btrim(v_catalog.name),nullif(btrim(v_catalog.branch_name),''),v_road,v_address,
        nullif(btrim(v_catalog.region_1),''),nullif(btrim(v_catalog.region_2),''),
        v_catalog.latitude,v_catalog.longitude,v_catalog.place_provider,v_catalog.provider_place_id
      ) returning * into v_place;
    end if;
  end if;

  if v_place.provider_place_id=v_catalog.provider_place_id then
    update public.places
    set name=btrim(v_catalog.name),
        branch_name=nullif(btrim(v_catalog.branch_name),''),
        road_address=v_road,
        address=v_address,
        region_1=nullif(btrim(v_catalog.region_1),''),
        region_2=nullif(btrim(v_catalog.region_2),''),
        latitude=v_catalog.latitude,
        longitude=v_catalog.longitude
    where id=v_place.id
      and is_visible
    returning * into v_place;
  end if;

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

  insert into public.items(
    category_id,name,normalized_name,status,external_source,external_id
  ) values (
    p_category_id,btrim(v_catalog.name),v_normalized,'active','onepick_place',
    v_place.id::text||':'||p_category_id::text
  ) returning * into v_item;

  insert into public.item_places(item_id,category_id,place_id)
  values(v_item.id,p_category_id,v_place.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'offline',v_place.map_url,true);

  return v_item;
end;
$$;

revoke all on function private.select_place_catalog_item_impl(uuid,uuid)
  from public, anon;
grant execute on function private.select_place_catalog_item_impl(uuid,uuid)
  to authenticated;

create or replace function public.select_place_catalog_item(
  p_category_id uuid,
  p_catalog_id uuid
)
returns public.items
language sql
security invoker
set search_path = ''
as $$
  select private.select_place_catalog_item_impl(p_category_id,p_catalog_id);
$$;

revoke all on function public.select_place_catalog_item(uuid,uuid)
  from public, anon;
grant execute on function public.select_place_catalog_item(uuid,uuid)
  to authenticated;

commit;
