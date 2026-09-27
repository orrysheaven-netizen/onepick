-- Store-first pick registration (원픽 등록 6단계): the user finds the store or
-- online seller first, then chooses the menu. This adds
--   1. category-free store search over place_catalog,
--   2. online seller search and a user-callable seller × menu item selection,
--   3. user-submitted Naver map links, reviewed by an administrator.

-- ---------------------------------------------------------------------------
-- 1. Store search without a menu
-- ---------------------------------------------------------------------------

create or replace function public.search_store_catalog(
  p_query text,
  p_limit integer default 20
)
returns table(
  catalog_id uuid,
  name text,
  branch_name text,
  road_address text,
  address text,
  region_1 text,
  region_2 text,
  provider_category text,
  map_url text
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
  if char_length(v_query) not between 2 and 100 then
    return;
  end if;

  return query
  select
    pc.id,
    pc.name,
    pc.branch_name,
    pc.road_address,
    pc.address,
    pc.region_1,
    pc.region_2,
    pc.provider_category,
    p.map_url
  from public.place_catalog pc
  left join public.places p
    on p.place_provider=pc.place_provider
   and p.provider_place_id=pc.provider_place_id
   and p.is_visible
  where pc.business_status='open'
    and (
      pc.normalized_name like v_query||'%'
      or pc.normalized_name like '%'||v_query||'%'
      or extensions.similarity(pc.normalized_name,v_query) >= 0.3
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
    pc.id
  limit v_limit;
end;
$$;
revoke all on function public.search_store_catalog(text,integer) from public;
grant execute on function public.search_store_catalog(text,integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Online sellers
-- ---------------------------------------------------------------------------

create or replace function public.search_online_sellers(
  p_query text,
  p_limit integer default 20
)
returns table(
  provider_id uuid,
  name text,
  host text,
  official_url text
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
  if char_length(v_query) not between 1 and 100 then
    return;
  end if;

  return query
  select pr.id, pr.name, os.host, os.official_url
  from public.providers pr
  join public.online_stores os on os.id=pr.online_store_id
  where pr.kind='online_store'
    and pr.status='active'
    and os.official_url is not null
    and lower(regexp_replace(pr.name,'[[:space:]]+','','g')) like '%'||v_query||'%'
  order by
    case when lower(regexp_replace(pr.name,'[[:space:]]+','','g')) like v_query||'%' then 0 else 1 end,
    pr.name,
    pr.id
  limit v_limit;
end;
$$;
revoke all on function public.search_online_sellers(text,integer) from public;
grant execute on function public.search_online_sellers(text,integer) to anon, authenticated;

-- A user choosing an existing seller for a menu gets the seller × menu item,
-- created on first use exactly as the admin workflow would (same identity key
-- and online primary channel). Only active online providers and open food
-- leaves qualify; provider and store rows are never written here.
create or replace function private.select_online_provider_item_impl(
  p_category_id uuid,
  p_provider_id uuid
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
     or not private.category_is_food(p_category_id)
     or not exists(select 1 from public.categories c where c.id=p_category_id and c.is_visible and c.is_pickable)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  select * into v_provider from public.providers where id=p_provider_id;
  if not found or v_provider.kind<>'online_store' or v_provider.status<>'active' then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;
  select * into v_store from public.online_stores where id=v_provider.online_store_id;
  if not found or v_store.official_url is null then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('provider-item:'||v_provider.id::text||':'||p_category_id::text,0)
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_provider.id
    and ipr.category_id=p_category_id;

  if found then
    if v_item.status not in ('active','discontinued') then
      raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
    end if;
    return v_item;
  end if;

  insert into public.items(
    category_id,brand_id,name,normalized_name,status,
    external_source,external_id,created_by
  ) values (
    p_category_id,v_provider.brand_id,v_provider.name,
    lower(regexp_replace(v_provider.name,'[[:space:]]','','g')),'active',
    'onepick_provider',v_provider.id::text||':'||p_category_id::text,v_user
  ) returning * into v_item;

  insert into public.item_providers(item_id,category_id,provider_id)
  values(v_item.id,p_category_id,v_provider.id);

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_store.official_url,true);

  return v_item;
end;
$$;
revoke all on function private.select_online_provider_item_impl(uuid,uuid) from public, anon, authenticated;

create or replace function public.select_online_provider_item(
  p_category_id uuid,
  p_provider_id uuid
)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and private.is_user_suspended(v_actor) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  return private.select_online_provider_item_impl(p_category_id,p_provider_id);
end;
$$;
revoke all on function public.select_online_provider_item(uuid,uuid) from public, anon;
grant execute on function public.select_online_provider_item(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Naver map links suggested by users
-- ---------------------------------------------------------------------------

create or replace function private.is_naver_map_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url !~ '[[:space:]]'
     and p_url ~* '^https://(naver\.me|map\.naver\.com|m\.map\.naver\.com|place\.naver\.com|m\.place\.naver\.com|pcmap\.place\.naver\.com)(/|$)';
$$;
revoke all on function private.is_naver_map_url(text) from public, anon, authenticated;

create table public.item_link_suggestions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  url text not null check (private.is_naver_map_url(url)),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint item_link_suggestions_review_state check (
    (status='pending' and reviewed_at is null) or (status<>'pending' and reviewed_at is not null)
  )
);
create unique index item_link_suggestions_one_pending
  on public.item_link_suggestions(item_id,user_id) where status='pending';
create index item_link_suggestions_pending_created
  on public.item_link_suggestions(created_at desc) where status='pending';
alter table public.item_link_suggestions enable row level security;
revoke all on public.item_link_suggestions from public, anon, authenticated;
grant select on public.item_link_suggestions to authenticated;
create policy item_link_suggestions_read on public.item_link_suggestions
for select to authenticated using (
  user_id=(select auth.uid()) or (select private.is_admin_mfa())
);
comment on table public.item_link_suggestions is
  'Naver map links users suggest for a store item; an administrator approves them onto the place.';

create or replace function private.suggest_item_map_link_impl(p_item_id uuid, p_url text)
returns public.item_link_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_url text := btrim(coalesce(p_url,''));
  v_item public.items%rowtype;
  v_result public.item_link_suggestions%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if private.is_user_suspended(v_user) then
    raise exception 'USER_SUSPENDED' using errcode='42501';
  end if;
  if not private.is_naver_map_url(v_url) then
    raise exception 'LINK_INVALID' using errcode='P0001';
  end if;

  select * into v_item from public.items where id=p_item_id;
  if not found
     or not (v_item.status in ('active','discontinued')
             or (v_item.status='pending' and v_item.created_by=v_user)) then
    raise exception 'ITEM_NOT_FOUND' using errcode='P0001';
  end if;

  update public.item_link_suggestions
  set url=v_url, created_at=now()
  where item_id=v_item.id and user_id=v_user and status='pending'
  returning * into v_result;
  if not found then
    if (select count(*) from public.item_link_suggestions
        where user_id=v_user and created_at>now()-interval '1 day') >= 30 then
      raise exception 'RATE_LIMITED' using errcode='P0001';
    end if;
    insert into public.item_link_suggestions(item_id,user_id,url)
    values(v_item.id,v_user,v_url)
    returning * into v_result;
  end if;
  return v_result;
end;
$$;
revoke all on function private.suggest_item_map_link_impl(uuid,text) from public, anon, authenticated;

create or replace function public.suggest_item_map_link(p_item_id uuid, p_url text)
returns public.item_link_suggestions
language sql
security definer
set search_path = ''
as $$
  select private.suggest_item_map_link_impl(p_item_id,p_url);
$$;
revoke all on function public.suggest_item_map_link(uuid,text) from public, anon;
grant execute on function public.suggest_item_map_link(uuid,text) to authenticated;

create or replace function public.admin_pending_item_link_suggestions(p_limit integer default 50)
returns table(
  suggestion_id uuid,
  item_id uuid,
  item_name text,
  item_status text,
  category_name text,
  place_id uuid,
  place_name text,
  place_branch_name text,
  place_road_address text,
  current_map_url text,
  url text,
  username text,
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
  select s.id, i.id, i.name, i.status, c.name, p.id, p.name, p.branch_name, p.road_address,
         p.map_url, s.url, pr.username, s.created_at
  from public.item_link_suggestions s
  join public.items i on i.id=s.item_id
  join public.categories c on c.id=i.category_id
  left join public.item_places ip on ip.item_id=i.id
  left join public.places p on p.id=ip.place_id
  left join public.profiles pr on pr.id=s.user_id
  where s.status='pending'
  order by s.created_at desc, s.id
  limit least(greatest(coalesce(p_limit,50),1),200);
end;
$$;
revoke all on function public.admin_pending_item_link_suggestions(integer) from public, anon;
grant execute on function public.admin_pending_item_link_suggestions(integer) to authenticated;

-- Approving writes the link onto the store (places.map_url) and every menu item
-- of that store, so all of them open the same map page. A pending request has
-- no place yet: link it to a place first (채널 연결), then approve.
create or replace function public.admin_review_item_link_suggestion(
  p_suggestion_id uuid,
  p_approve boolean
)
returns public.item_link_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_suggestion public.item_link_suggestions%rowtype;
  v_place_id uuid;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  select * into v_suggestion from public.item_link_suggestions
  where id=p_suggestion_id for update;
  if not found or v_suggestion.status<>'pending' then
    raise exception 'LINK_SUGGESTION_NOT_PENDING' using errcode='P0001';
  end if;

  if p_approve then
    select ip.place_id into v_place_id from public.item_places ip where ip.item_id=v_suggestion.item_id;
    if v_place_id is null then
      raise exception 'LINK_ITEM_NOT_PLACE' using errcode='P0001';
    end if;

    update public.places set map_url=v_suggestion.url where id=v_place_id;
    update public.item_channels ic
    set target_url=v_suggestion.url, updated_at=now()
    from public.item_places ip
    where ip.place_id=v_place_id
      and ic.item_id=ip.item_id
      and ic.channel='offline';

    -- Other pending suggestions for the same store are settled by this one.
    update public.item_link_suggestions s
    set status='rejected', reviewed_at=now(), reviewed_by=v_actor
    from public.item_places ip
    where ip.place_id=v_place_id
      and s.item_id=ip.item_id
      and s.status='pending'
      and s.id<>v_suggestion.id;
  end if;

  update public.item_link_suggestions
  set status=case when p_approve then 'approved' else 'rejected' end,
      reviewed_at=now(),
      reviewed_by=v_actor
  where id=v_suggestion.id
  returning * into v_suggestion;
  return v_suggestion;
end;
$$;
revoke all on function public.admin_review_item_link_suggestion(uuid,boolean) from public, anon;
grant execute on function public.admin_review_item_link_suggestion(uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Menu choices for step 2 (manual selection)
-- ---------------------------------------------------------------------------

-- Open, pickable food leaves with their group name. place_enabled says whether
-- a catalog store can be picked for that menu (select_place_catalog_item).
create or replace function public.store_menu_options()
returns table(category_id uuid, name text, group_name text, place_enabled boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.name, g.name, public.category_uses_place_catalog(c.id)
  from public.categories c
  left join public.categories g on g.id=c.parent_id
  where c.status='open' and c.is_visible and c.is_pickable
    and public.category_is_open_leaf(c.id)
    and exists (
      select 1 from public.category_catalog_sources s
      where s.category_id=c.id and s.mode='internal' and s.is_enabled
    )
    and (
      g.slug='food'
      or exists (select 1 from public.categories r where r.id=g.parent_id and r.slug='food')
    )
  order by g.name nulls first, c.name;
$$;
revoke all on function public.store_menu_options() from public;
grant execute on function public.store_menu_options() to anon, authenticated;
