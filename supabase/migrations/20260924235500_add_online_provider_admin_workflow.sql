begin;

-- PR 0b: AAL2-only online provider administration.
-- Depends on 20260924231500_add_provider_foundation.sql.

-- ---------------------------------------------------------------------------
-- Canonical online-store URL / identity helpers
-- ---------------------------------------------------------------------------

create or replace function private.online_store_host(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url,''));
  v_authority text;
begin
  if v_url = ''
     or char_length(v_url) > 2048
     or v_url ~ '[[:space:]]'
     or v_url !~ '^https://'
  then
    raise exception 'ONLINE_STORE_URL_INVALID' using errcode='P0001';
  end if;

  v_authority := split_part(
    split_part(
      split_part(substr(v_url,9),'/',1),
      '?',1
    ),
    '#',1
  );

  if v_authority !~ '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
  then
    raise exception 'ONLINE_STORE_URL_INVALID' using errcode='P0001';
  end if;

  return lower(v_authority);
end;
$$;

revoke all on function private.online_store_host(text) from public, anon, authenticated;

create or replace function private.canonical_online_store_key(
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_host text := private.online_store_host(p_official_url);
  v_platform text := lower(btrim(coalesce(p_platform,'')));
  v_key text := lower(btrim(coalesce(p_store_key,'')));
begin
  if v_type='official_site' then
    if v_platform<>'' then
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;
    if v_key<>'' and v_key<>'site:'||v_host then
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;
    return 'site:'||v_host;
  end if;

  if v_type='platform_store' then
    if v_platform !~ '^[a-z][a-z0-9_]{0,31}$'
       or char_length(v_key) not between 3 and 300
       or v_key !~ '^[a-z][a-z0-9_]{0,31}:.+
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;

    if not public.is_shopping_url(p_official_url) then
      raise exception 'ONLINE_STORE_PLATFORM_HOST_INVALID' using errcode='P0001';
    end if;

    return v_key;
  end if;

  raise exception 'ONLINE_STORE_TYPE_INVALID' using errcode='P0001';
end;
$$;

revoke all on function private.canonical_online_store_key(text,text,text,text)
  from public, anon, authenticated;

-- Store identity is fixed once created. Only official_url may be refreshed.
create or replace function private.guard_online_store_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_type is distinct from old.store_type
     or new.host is distinct from old.host
     or new.platform is distinct from old.platform
     or new.store_key is distinct from old.store_key
  then
    raise exception 'ONLINE_STORE_IDENTITY_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_online_store_identity()
  from public, anon, authenticated;

create trigger online_stores_guard_identity
before update of store_type, host, platform, store_key on public.online_stores
for each row execute function private.guard_online_store_identity();

-- ---------------------------------------------------------------------------
-- Provider/item invariants
-- ---------------------------------------------------------------------------

-- Once an item is provider-backed its brand is inherited through providers.
create or replace function private.guard_provider_item_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_id is not null
     and exists (
       select 1 from public.item_providers ipr
       where ipr.item_id=new.id
     )
  then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_provider_item_brand()
  from public, anon, authenticated;

create trigger items_guard_provider_brand
before update of brand_id on public.items
for each row execute function private.guard_provider_item_brand();

-- Strengthen the PR 0a cross-table check:
-- * provider-backed items never own items.brand_id
-- * online mappings use onepick_provider
-- * offline mappings use onepick_place
-- * active/discontinued onepick_provider items cannot be orphaned
create or replace function private.assert_item_provider_consistency(
  p_item_id uuid,
  p_check_brand boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_provider_id uuid;
  v_kind text;
  v_place_id uuid;
begin
  select * into v_item
  from public.items i
  where i.id=p_item_id;

  if not found then
    return;
  end if;

  select pr.id, pr.kind, pr.place_id
  into v_provider_id, v_kind, v_place_id
  from public.item_providers ipr
  join public.providers pr on pr.id=ipr.provider_id
  where ipr.item_id=p_item_id;

  if v_provider_id is null then
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ITEM_PROVIDER_REQUIRED' using errcode='23514';
    end if;
    if v_item.external_source='onepick_provider'
       and v_item.status in ('active','discontinued')
    then
      raise exception 'ONLINE_PROVIDER_ITEM_ORPHANED' using errcode='23514';
    end if;
    return;
  end if;

  if v_item.brand_id is not null then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;

  if v_kind='offline_branch' then
    if v_item.external_source is distinct from 'onepick_place' then
      raise exception 'OFFLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.item_places
      where item_id=p_item_id and place_id=v_place_id
    ) then
      raise exception 'ITEM_PROVIDER_PLACE_MISMATCH' using errcode='23514';
    end if;
  elsif v_kind='online_store' then
    if v_item.external_source is distinct from 'onepick_provider' then
      raise exception 'ONLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ONLINE_PROVIDER_ITEM_HAS_PLACE' using errcode='23514';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_item_provider_consistency(uuid,boolean)
  from public, anon, authenticated;

create or replace function private.check_item_row_provider_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_item_provider_consistency(new.id);
  return null;
end;
$$;

revoke all on function private.check_item_row_provider_consistency()
  from public, anon, authenticated;

create constraint trigger items_provider_consistency
after insert or update of brand_id, external_source, status, category_id on public.items
deferrable initially deferred
for each row execute function private.check_item_row_provider_consistency();

-- ---------------------------------------------------------------------------
-- Admin online provider upsert
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_online_provider_item_impl(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_url text := btrim(coalesce(p_official_url,''));
  v_host text;
  v_platform text := nullif(lower(btrim(coalesce(p_platform,''))),'');
  v_store_key text;
  v_store public.online_stores%rowtype;
  v_provider public.providers%rowtype;
  v_item public.items%rowtype;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if char_length(v_name) not between 1 and 100 then
    raise exception 'PROVIDER_NAME_INVALID' using errcode='P0001';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  v_host := private.online_store_host(v_url);
  v_store_key := private.canonical_online_store_key(
    v_type,v_url,v_platform,p_store_key
  );

  perform pg_advisory_xact_lock(
    hashtextextended('online-store:'||v_store_key,0)
  );

  select * into v_store
  from public.online_stores
  where store_key=v_store_key
  for update;

  if found then
    if v_store.store_type<>v_type
       or v_store.host<>v_host
       or v_store.platform is distinct from v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if v_store.official_url is distinct from v_url then
      update public.online_stores
      set official_url=v_url
      where id=v_store.id
      returning * into v_store;
    end if;
  else
    insert into public.online_stores(
      store_type,host,platform,store_key,official_url
    )
    values(
      v_type,v_host,v_platform,v_store_key,v_url
    )
    returning * into v_store;
  end if;

  select pr.* into v_provider
  from public.providers pr
  where pr.online_store_id=v_store.id
  for update;

  if found then
    if v_provider.kind<>'online_store' then
      raise exception 'PROVIDER_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if p_brand_id is not null
       and v_provider.brand_id is not null
       and v_provider.brand_id<>p_brand_id
    then
      raise exception 'PROVIDER_BRAND_CONFLICT' using errcode='P0001';
    end if;

    update public.providers
    set name=v_name,
        brand_id=coalesce(v_provider.brand_id,p_brand_id)
    where id=v_provider.id
    returning * into v_provider;
  else
    insert into public.providers(
      kind,name,brand_id,online_store_id,status,created_by
    )
    values(
      'online_store',v_name,p_brand_id,v_store.id,'active',v_actor
    )
    returning * into v_provider;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_provider.id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_provider.id
    and ipr.category_id=p_category_id
  for update of i;

  if not found then
    v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

    insert into public.items(
      category_id,brand_id,name,normalized_name,status,
      external_source,external_id,created_by
    )
    values(
      p_category_id,null,v_name,v_normalized,'active',
      'onepick_provider',v_provider.id::text||':'||p_category_id::text,v_actor
    )
    returning * into v_item;

    insert into public.item_providers(item_id,category_id,provider_id)
    values(v_item.id,p_category_id,v_provider.id);
  end if;

  -- Existing provider items keep their item identity but follow the provider's
  -- current display name and official URL.
  if v_item.name is distinct from v_name then
    update public.items
    set name=v_name,
        normalized_name=lower(regexp_replace(v_name,'[[:space:]]','','g'))
    where id=v_item.id
    returning * into v_item;
  end if;

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_url,true)
  on conflict(item_id,channel) do update
  set target_url=excluded.target_url,
      is_primary=true,
      updated_at=now();

  provider_id := v_provider.id;
  online_store_id := v_store.id;
  item_id := v_item.id;
  category_id := p_category_id;
  return next;
end;
$$;

revoke all on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) to authenticated;

create or replace function public.admin_upsert_online_provider_item(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.admin_upsert_online_provider_item_impl(
    p_category_id,p_name,p_store_type,p_official_url,
    p_platform,p_store_key,p_brand_id
  );
$$;

revoke all on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Brand and status administration
-- ---------------------------------------------------------------------------

create or replace function private.admin_set_provider_brand_impl(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  update public.providers
  set brand_id=p_brand_id
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_brand_impl(uuid,uuid)
  from public, anon;
grant execute on function private.admin_set_provider_brand_impl(uuid,uuid)
  to authenticated;

create or replace function public.admin_set_provider_brand(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_brand_impl(p_provider_id,p_brand_id);
$$;

revoke all on function public.admin_set_provider_brand(uuid,uuid)
  from public, anon;
grant execute on function public.admin_set_provider_brand(uuid,uuid)
  to authenticated;

create or replace function private.admin_set_provider_status_impl(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if v_status not in ('pending','active','hidden') then
    raise exception 'PROVIDER_STATUS_INVALID' using errcode='P0001';
  end if;

  update public.providers
  set status=v_status
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_status_impl(uuid,text)
  from public, anon;
grant execute on function private.admin_set_provider_status_impl(uuid,text)
  to authenticated;

create or replace function public.admin_set_provider_status(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_status_impl(p_provider_id,p_status);
$$;

revoke all on function public.admin_set_provider_status(uuid,text)
  from public, anon;
grant execute on function public.admin_set_provider_status(uuid,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Pending-item merge guard
-- ---------------------------------------------------------------------------

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

  if exists(select 1 from public.picks where item_id=v_source.id) then
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

revoke all on function public.admin_merge_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin audit
-- ---------------------------------------------------------------------------

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_entity_type_check,
  add constraint admin_audit_logs_entity_type_check
  check (
    entity_type in (
      'category','brand','item','content_report','user_moderation',
      'provider','online_store'
    )
  );

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op='DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type='item' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status',
      'category_id',v_row->>'category_id'
    );
  elsif v_entity_type='category' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status'
    );
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'is_active',v_row->'is_active'
    );
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  elsif v_entity_type='provider' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'kind',v_row->>'kind',
      'status',v_row->>'status',
      'brand_id',v_row->>'brand_id',
      'place_id',v_row->>'place_id',
      'online_store_id',v_row->>'online_store_id'
    );
  elsif v_entity_type='online_store' then
    v_summary := jsonb_build_object(
      'store_type',v_row->>'store_type',
      'host',v_row->>'host',
      'platform',v_row->>'platform',
      'store_key',v_row->>'store_key',
      'official_url',v_row->>'official_url'
    );
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit()
  from public, anon, authenticated;

create trigger providers_admin_audit
after insert or update or delete on public.providers
for each row execute function private.log_admin_audit('provider');

create trigger online_stores_admin_audit
after insert or update or delete on public.online_stores
for each row execute function private.log_admin_audit('online_store');

commit;

       or split_part(v_key,':',1)<>v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;

    if not public.is_shopping_url(p_official_url) then
      raise exception 'ONLINE_STORE_PLATFORM_HOST_INVALID' using errcode='P0001';
    end if;

    return v_key;
  end if;

  raise exception 'ONLINE_STORE_TYPE_INVALID' using errcode='P0001';
end;
$$;

revoke all on function private.canonical_online_store_key(text,text,text,text)
  from public, anon, authenticated;

-- Store identity is fixed once created. Only official_url may be refreshed.
create or replace function private.guard_online_store_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_type is distinct from old.store_type
     or new.host is distinct from old.host
     or new.platform is distinct from old.platform
     or new.store_key is distinct from old.store_key
  then
    raise exception 'ONLINE_STORE_IDENTITY_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_online_store_identity()
  from public, anon, authenticated;

create trigger online_stores_guard_identity
before update of store_type, host, platform, store_key on public.online_stores
for each row execute function private.guard_online_store_identity();

-- ---------------------------------------------------------------------------
-- Provider/item invariants
-- ---------------------------------------------------------------------------

-- Once an item is provider-backed its brand is inherited through providers.
create or replace function private.guard_provider_item_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_id is not null
     and exists (
       select 1 from public.item_providers ipr
       where ipr.item_id=new.id
     )
  then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_provider_item_brand()
  from public, anon, authenticated;

create trigger items_guard_provider_brand
before update of brand_id on public.items
for each row execute function private.guard_provider_item_brand();

-- Strengthen the PR 0a cross-table check:
-- * provider-backed items never own items.brand_id
-- * online mappings use onepick_provider
-- * offline mappings use onepick_place
-- * active/discontinued onepick_provider items cannot be orphaned
create or replace function private.assert_item_provider_consistency(
  p_item_id uuid,
  p_check_brand boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_provider_id uuid;
  v_kind text;
  v_place_id uuid;
begin
  select * into v_item
  from public.items i
  where i.id=p_item_id;

  if not found then
    return;
  end if;

  select pr.id, pr.kind, pr.place_id
  into v_provider_id, v_kind, v_place_id
  from public.item_providers ipr
  join public.providers pr on pr.id=ipr.provider_id
  where ipr.item_id=p_item_id;

  if v_provider_id is null then
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ITEM_PROVIDER_REQUIRED' using errcode='23514';
    end if;
    if v_item.external_source='onepick_provider'
       and v_item.status in ('active','discontinued')
    then
      raise exception 'ONLINE_PROVIDER_ITEM_ORPHANED' using errcode='23514';
    end if;
    return;
  end if;

  if v_item.brand_id is not null then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;

  if v_kind='offline_branch' then
    if v_item.external_source is distinct from 'onepick_place' then
      raise exception 'OFFLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.item_places
      where item_id=p_item_id and place_id=v_place_id
    ) then
      raise exception 'ITEM_PROVIDER_PLACE_MISMATCH' using errcode='23514';
    end if;
  elsif v_kind='online_store' then
    if v_item.external_source is distinct from 'onepick_provider' then
      raise exception 'ONLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ONLINE_PROVIDER_ITEM_HAS_PLACE' using errcode='23514';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_item_provider_consistency(uuid,boolean)
  from public, anon, authenticated;

create or replace function private.check_item_row_provider_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_item_provider_consistency(new.id);
  return null;
end;
$$;

revoke all on function private.check_item_row_provider_consistency()
  from public, anon, authenticated;

create constraint trigger items_provider_consistency
after insert or update of brand_id, external_source, status, category_id on public.items
deferrable initially deferred
for each row execute function private.check_item_row_provider_consistency();

-- ---------------------------------------------------------------------------
-- Admin online provider upsert
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_online_provider_item_impl(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_url text := btrim(coalesce(p_official_url,''));
  v_host text;
  v_platform text := nullif(lower(btrim(coalesce(p_platform,''))),'');
  v_store_key text;
  v_store public.online_stores%rowtype;
  v_provider public.providers%rowtype;
  v_item public.items%rowtype;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if char_length(v_name) not between 1 and 100 then
    raise exception 'PROVIDER_NAME_INVALID' using errcode='P0001';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  v_host := private.online_store_host(v_url);
  v_store_key := private.canonical_online_store_key(
    v_type,v_url,v_platform,p_store_key
  );

  perform pg_advisory_xact_lock(
    hashtextextended('online-store:'||v_store_key,0)
  );

  select * into v_store
  from public.online_stores
  where store_key=v_store_key
  for update;

  if found then
    if v_store.store_type<>v_type
       or v_store.host<>v_host
       or v_store.platform is distinct from v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if v_store.official_url is distinct from v_url then
      update public.online_stores
      set official_url=v_url
      where id=v_store.id
      returning * into v_store;
    end if;
  else
    insert into public.online_stores(
      store_type,host,platform,store_key,official_url
    )
    values(
      v_type,v_host,v_platform,v_store_key,v_url
    )
    returning * into v_store;
  end if;

  select * into v_provider
  from public.providers
  where online_store_id=v_store.id
  for update;

  if found then
    if v_provider.kind<>'online_store' then
      raise exception 'PROVIDER_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if p_brand_id is not null
       and v_provider.brand_id is not null
       and v_provider.brand_id<>p_brand_id
    then
      raise exception 'PROVIDER_BRAND_CONFLICT' using errcode='P0001';
    end if;

    update public.providers
    set name=v_name,
        brand_id=coalesce(v_provider.brand_id,p_brand_id)
    where id=v_provider.id
    returning * into v_provider;
  else
    insert into public.providers(
      kind,name,brand_id,online_store_id,status,created_by
    )
    values(
      'online_store',v_name,p_brand_id,v_store.id,'active',v_actor
    )
    returning * into v_provider;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_provider.id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_provider.id
    and ipr.category_id=p_category_id
  for update of i;

  if not found then
    v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

    insert into public.items(
      category_id,brand_id,name,normalized_name,status,
      external_source,external_id,created_by
    )
    values(
      p_category_id,null,v_name,v_normalized,'active',
      'onepick_provider',v_provider.id::text||':'||p_category_id::text,v_actor
    )
    returning * into v_item;

    insert into public.item_providers(item_id,category_id,provider_id)
    values(v_item.id,p_category_id,v_provider.id);
  end if;

  -- Existing provider items keep their item identity but follow the provider's
  -- current display name and official URL.
  if v_item.name is distinct from v_name then
    update public.items
    set name=v_name,
        normalized_name=lower(regexp_replace(v_name,'[[:space:]]','','g'))
    where id=v_item.id
    returning * into v_item;
  end if;

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_url,true)
  on conflict(item_id,channel) do update
  set target_url=excluded.target_url,
      is_primary=true,
      updated_at=now();

  provider_id := v_provider.id;
  online_store_id := v_store.id;
  item_id := v_item.id;
  category_id := p_category_id;
  return next;
end;
$$;

revoke all on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) to authenticated;

create or replace function public.admin_upsert_online_provider_item(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.admin_upsert_online_provider_item_impl(
    p_category_id,p_name,p_store_type,p_official_url,
    p_platform,p_store_key,p_brand_id
  );
$$;

revoke all on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Brand and status administration
-- ---------------------------------------------------------------------------

create or replace function private.admin_set_provider_brand_impl(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  update public.providers
  set brand_id=p_brand_id
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_brand_impl(uuid,uuid)
  from public, anon;
grant execute on function private.admin_set_provider_brand_impl(uuid,uuid)
  to authenticated;

create or replace function public.admin_set_provider_brand(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_brand_impl(p_provider_id,p_brand_id);
$$;

revoke all on function public.admin_set_provider_brand(uuid,uuid)
  from public, anon;
grant execute on function public.admin_set_provider_brand(uuid,uuid)
  to authenticated;

create or replace function private.admin_set_provider_status_impl(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if v_status not in ('pending','active','hidden') then
    raise exception 'PROVIDER_STATUS_INVALID' using errcode='P0001';
  end if;

  update public.providers
  set status=v_status
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_status_impl(uuid,text)
  from public, anon;
grant execute on function private.admin_set_provider_status_impl(uuid,text)
  to authenticated;

create or replace function public.admin_set_provider_status(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_status_impl(p_provider_id,p_status);
$$;

revoke all on function public.admin_set_provider_status(uuid,text)
  from public, anon;
grant execute on function public.admin_set_provider_status(uuid,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Pending-item merge guard
-- ---------------------------------------------------------------------------

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

  if exists(select 1 from public.picks where item_id=v_source.id) then
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

revoke all on function public.admin_merge_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin audit
-- ---------------------------------------------------------------------------

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_entity_type_check,
  add constraint admin_audit_logs_entity_type_check
  check (
    entity_type in (
      'category','brand','item','content_report','provider','online_store'
    )
  );

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op='DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type='item' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status',
      'category_id',v_row->>'category_id'
    );
  elsif v_entity_type='category' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status'
    );
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'is_active',v_row->'is_active'
    );
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  elsif v_entity_type='provider' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'kind',v_row->>'kind',
      'status',v_row->>'status',
      'brand_id',v_row->>'brand_id',
      'place_id',v_row->>'place_id',
      'online_store_id',v_row->>'online_store_id'
    );
  elsif v_entity_type='online_store' then
    v_summary := jsonb_build_object(
      'store_type',v_row->>'store_type',
      'host',v_row->>'host',
      'platform',v_row->>'platform',
      'store_key',v_row->>'store_key',
      'official_url',v_row->>'official_url'
    );
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit()
  from public, anon, authenticated;

create trigger providers_admin_audit
after insert or update or delete on public.providers
for each row execute function private.log_admin_audit('provider');

create trigger online_stores_admin_audit
after insert or update or delete on public.online_stores
for each row execute function private.log_admin_audit('online_store');

commit;
\n       or split_part(v_key,':',1)<>v_platform\n    then
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;

    if not public.is_shopping_url(p_official_url) then
      raise exception 'ONLINE_STORE_PLATFORM_HOST_INVALID' using errcode='P0001';
    end if;

    return v_key;
  end if;

  raise exception 'ONLINE_STORE_TYPE_INVALID' using errcode='P0001';
end;
$$;

revoke all on function private.canonical_online_store_key(text,text,text,text)
  from public, anon, authenticated;

-- Store identity is fixed once created. Only official_url may be refreshed.
create or replace function private.guard_online_store_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_type is distinct from old.store_type
     or new.host is distinct from old.host
     or new.platform is distinct from old.platform
     or new.store_key is distinct from old.store_key
  then
    raise exception 'ONLINE_STORE_IDENTITY_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_online_store_identity()
  from public, anon, authenticated;

create trigger online_stores_guard_identity
before update of store_type, host, platform, store_key on public.online_stores
for each row execute function private.guard_online_store_identity();

-- ---------------------------------------------------------------------------
-- Provider/item invariants
-- ---------------------------------------------------------------------------

-- Once an item is provider-backed its brand is inherited through providers.
create or replace function private.guard_provider_item_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_id is not null
     and exists (
       select 1 from public.item_providers ipr
       where ipr.item_id=new.id
     )
  then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_provider_item_brand()
  from public, anon, authenticated;

create trigger items_guard_provider_brand
before update of brand_id on public.items
for each row execute function private.guard_provider_item_brand();

-- Strengthen the PR 0a cross-table check:
-- * provider-backed items never own items.brand_id
-- * online mappings use onepick_provider
-- * offline mappings use onepick_place
-- * active/discontinued onepick_provider items cannot be orphaned
create or replace function private.assert_item_provider_consistency(
  p_item_id uuid,
  p_check_brand boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_provider_id uuid;
  v_kind text;
  v_place_id uuid;
begin
  select * into v_item
  from public.items i
  where i.id=p_item_id;

  if not found then
    return;
  end if;

  select pr.id, pr.kind, pr.place_id
  into v_provider_id, v_kind, v_place_id
  from public.item_providers ipr
  join public.providers pr on pr.id=ipr.provider_id
  where ipr.item_id=p_item_id;

  if v_provider_id is null then
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ITEM_PROVIDER_REQUIRED' using errcode='23514';
    end if;
    if v_item.external_source='onepick_provider'
       and v_item.status in ('active','discontinued')
    then
      raise exception 'ONLINE_PROVIDER_ITEM_ORPHANED' using errcode='23514';
    end if;
    return;
  end if;

  if v_item.brand_id is not null then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;

  if v_kind='offline_branch' then
    if v_item.external_source is distinct from 'onepick_place' then
      raise exception 'OFFLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.item_places
      where item_id=p_item_id and place_id=v_place_id
    ) then
      raise exception 'ITEM_PROVIDER_PLACE_MISMATCH' using errcode='23514';
    end if;
  elsif v_kind='online_store' then
    if v_item.external_source is distinct from 'onepick_provider' then
      raise exception 'ONLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ONLINE_PROVIDER_ITEM_HAS_PLACE' using errcode='23514';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_item_provider_consistency(uuid,boolean)
  from public, anon, authenticated;

create or replace function private.check_item_row_provider_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_item_provider_consistency(new.id);
  return null;
end;
$$;

revoke all on function private.check_item_row_provider_consistency()
  from public, anon, authenticated;

create constraint trigger items_provider_consistency
after insert or update of brand_id, external_source, status, category_id on public.items
deferrable initially deferred
for each row execute function private.check_item_row_provider_consistency();

-- ---------------------------------------------------------------------------
-- Admin online provider upsert
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_online_provider_item_impl(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_url text := btrim(coalesce(p_official_url,''));
  v_host text;
  v_platform text := nullif(lower(btrim(coalesce(p_platform,''))),'');
  v_store_key text;
  v_store public.online_stores%rowtype;
  v_provider public.providers%rowtype;
  v_item public.items%rowtype;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if char_length(v_name) not between 1 and 100 then
    raise exception 'PROVIDER_NAME_INVALID' using errcode='P0001';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  v_host := private.online_store_host(v_url);
  v_store_key := private.canonical_online_store_key(
    v_type,v_url,v_platform,p_store_key
  );

  perform pg_advisory_xact_lock(
    hashtextextended('online-store:'||v_store_key,0)
  );

  select * into v_store
  from public.online_stores
  where store_key=v_store_key
  for update;

  if found then
    if v_store.store_type<>v_type
       or v_store.host<>v_host
       or v_store.platform is distinct from v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if v_store.official_url is distinct from v_url then
      update public.online_stores
      set official_url=v_url
      where id=v_store.id
      returning * into v_store;
    end if;
  else
    insert into public.online_stores(
      store_type,host,platform,store_key,official_url
    )
    values(
      v_type,v_host,v_platform,v_store_key,v_url
    )
    returning * into v_store;
  end if;

  select pr.* into v_provider
  from public.providers pr
  where pr.online_store_id=v_store.id
  for update;

  if found then
    if v_provider.kind<>'online_store' then
      raise exception 'PROVIDER_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if p_brand_id is not null
       and v_provider.brand_id is not null
       and v_provider.brand_id<>p_brand_id
    then
      raise exception 'PROVIDER_BRAND_CONFLICT' using errcode='P0001';
    end if;

    update public.providers
    set name=v_name,
        brand_id=coalesce(v_provider.brand_id,p_brand_id)
    where id=v_provider.id
    returning * into v_provider;
  else
    insert into public.providers(
      kind,name,brand_id,online_store_id,status,created_by
    )
    values(
      'online_store',v_name,p_brand_id,v_store.id,'active',v_actor
    )
    returning * into v_provider;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_provider.id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_provider.id
    and ipr.category_id=p_category_id
  for update of i;

  if not found then
    v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

    insert into public.items(
      category_id,brand_id,name,normalized_name,status,
      external_source,external_id,created_by
    )
    values(
      p_category_id,null,v_name,v_normalized,'active',
      'onepick_provider',v_provider.id::text||':'||p_category_id::text,v_actor
    )
    returning * into v_item;

    insert into public.item_providers(item_id,category_id,provider_id)
    values(v_item.id,p_category_id,v_provider.id);
  end if;

  -- Existing provider items keep their item identity but follow the provider's
  -- current display name and official URL.
  if v_item.name is distinct from v_name then
    update public.items
    set name=v_name,
        normalized_name=lower(regexp_replace(v_name,'[[:space:]]','','g'))
    where id=v_item.id
    returning * into v_item;
  end if;

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_url,true)
  on conflict(item_id,channel) do update
  set target_url=excluded.target_url,
      is_primary=true,
      updated_at=now();

  provider_id := v_provider.id;
  online_store_id := v_store.id;
  item_id := v_item.id;
  category_id := p_category_id;
  return next;
end;
$$;

revoke all on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) to authenticated;

create or replace function public.admin_upsert_online_provider_item(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.admin_upsert_online_provider_item_impl(
    p_category_id,p_name,p_store_type,p_official_url,
    p_platform,p_store_key,p_brand_id
  );
$$;

revoke all on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Brand and status administration
-- ---------------------------------------------------------------------------

create or replace function private.admin_set_provider_brand_impl(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  update public.providers
  set brand_id=p_brand_id
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_brand_impl(uuid,uuid)
  from public, anon;
grant execute on function private.admin_set_provider_brand_impl(uuid,uuid)
  to authenticated;

create or replace function public.admin_set_provider_brand(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_brand_impl(p_provider_id,p_brand_id);
$$;

revoke all on function public.admin_set_provider_brand(uuid,uuid)
  from public, anon;
grant execute on function public.admin_set_provider_brand(uuid,uuid)
  to authenticated;

create or replace function private.admin_set_provider_status_impl(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if v_status not in ('pending','active','hidden') then
    raise exception 'PROVIDER_STATUS_INVALID' using errcode='P0001';
  end if;

  update public.providers
  set status=v_status
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_status_impl(uuid,text)
  from public, anon;
grant execute on function private.admin_set_provider_status_impl(uuid,text)
  to authenticated;

create or replace function public.admin_set_provider_status(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_status_impl(p_provider_id,p_status);
$$;

revoke all on function public.admin_set_provider_status(uuid,text)
  from public, anon;
grant execute on function public.admin_set_provider_status(uuid,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Pending-item merge guard
-- ---------------------------------------------------------------------------

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

  if exists(select 1 from public.picks where item_id=v_source.id) then
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

revoke all on function public.admin_merge_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin audit
-- ---------------------------------------------------------------------------

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_entity_type_check,
  add constraint admin_audit_logs_entity_type_check
  check (
    entity_type in (
      'category','brand','item','content_report','user_moderation',
      'provider','online_store'
    )
  );

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op='DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type='item' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status',
      'category_id',v_row->>'category_id'
    );
  elsif v_entity_type='category' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status'
    );
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'is_active',v_row->'is_active'
    );
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  elsif v_entity_type='provider' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'kind',v_row->>'kind',
      'status',v_row->>'status',
      'brand_id',v_row->>'brand_id',
      'place_id',v_row->>'place_id',
      'online_store_id',v_row->>'online_store_id'
    );
  elsif v_entity_type='online_store' then
    v_summary := jsonb_build_object(
      'store_type',v_row->>'store_type',
      'host',v_row->>'host',
      'platform',v_row->>'platform',
      'store_key',v_row->>'store_key',
      'official_url',v_row->>'official_url'
    );
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit()
  from public, anon, authenticated;

create trigger providers_admin_audit
after insert or update or delete on public.providers
for each row execute function private.log_admin_audit('provider');

create trigger online_stores_admin_audit
after insert or update or delete on public.online_stores
for each row execute function private.log_admin_audit('online_store');

commit;

       or split_part(v_key,':',1)<>v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_INVALID' using errcode='P0001';
    end if;

    if not public.is_shopping_url(p_official_url) then
      raise exception 'ONLINE_STORE_PLATFORM_HOST_INVALID' using errcode='P0001';
    end if;

    return v_key;
  end if;

  raise exception 'ONLINE_STORE_TYPE_INVALID' using errcode='P0001';
end;
$$;

revoke all on function private.canonical_online_store_key(text,text,text,text)
  from public, anon, authenticated;

-- Store identity is fixed once created. Only official_url may be refreshed.
create or replace function private.guard_online_store_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_type is distinct from old.store_type
     or new.host is distinct from old.host
     or new.platform is distinct from old.platform
     or new.store_key is distinct from old.store_key
  then
    raise exception 'ONLINE_STORE_IDENTITY_IMMUTABLE' using errcode='P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_online_store_identity()
  from public, anon, authenticated;

create trigger online_stores_guard_identity
before update of store_type, host, platform, store_key on public.online_stores
for each row execute function private.guard_online_store_identity();

-- ---------------------------------------------------------------------------
-- Provider/item invariants
-- ---------------------------------------------------------------------------

-- Once an item is provider-backed its brand is inherited through providers.
create or replace function private.guard_provider_item_brand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.brand_id is not null
     and exists (
       select 1 from public.item_providers ipr
       where ipr.item_id=new.id
     )
  then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_provider_item_brand()
  from public, anon, authenticated;

create trigger items_guard_provider_brand
before update of brand_id on public.items
for each row execute function private.guard_provider_item_brand();

-- Strengthen the PR 0a cross-table check:
-- * provider-backed items never own items.brand_id
-- * online mappings use onepick_provider
-- * offline mappings use onepick_place
-- * active/discontinued onepick_provider items cannot be orphaned
create or replace function private.assert_item_provider_consistency(
  p_item_id uuid,
  p_check_brand boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_provider_id uuid;
  v_kind text;
  v_place_id uuid;
begin
  select * into v_item
  from public.items i
  where i.id=p_item_id;

  if not found then
    return;
  end if;

  select pr.id, pr.kind, pr.place_id
  into v_provider_id, v_kind, v_place_id
  from public.item_providers ipr
  join public.providers pr on pr.id=ipr.provider_id
  where ipr.item_id=p_item_id;

  if v_provider_id is null then
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ITEM_PROVIDER_REQUIRED' using errcode='23514';
    end if;
    if v_item.external_source='onepick_provider'
       and v_item.status in ('active','discontinued')
    then
      raise exception 'ONLINE_PROVIDER_ITEM_ORPHANED' using errcode='23514';
    end if;
    return;
  end if;

  if v_item.brand_id is not null then
    raise exception 'ITEM_PROVIDER_BRAND_CONFLICT' using errcode='23514';
  end if;

  if v_kind='offline_branch' then
    if v_item.external_source is distinct from 'onepick_place' then
      raise exception 'OFFLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if not exists (
      select 1 from public.item_places
      where item_id=p_item_id and place_id=v_place_id
    ) then
      raise exception 'ITEM_PROVIDER_PLACE_MISMATCH' using errcode='23514';
    end if;
  elsif v_kind='online_store' then
    if v_item.external_source is distinct from 'onepick_provider' then
      raise exception 'ONLINE_PROVIDER_ITEM_SOURCE_INVALID' using errcode='23514';
    end if;
    if exists (select 1 from public.item_places where item_id=p_item_id) then
      raise exception 'ONLINE_PROVIDER_ITEM_HAS_PLACE' using errcode='23514';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_item_provider_consistency(uuid,boolean)
  from public, anon, authenticated;

create or replace function private.check_item_row_provider_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_item_provider_consistency(new.id);
  return null;
end;
$$;

revoke all on function private.check_item_row_provider_consistency()
  from public, anon, authenticated;

create constraint trigger items_provider_consistency
after insert or update of brand_id, external_source, status, category_id on public.items
deferrable initially deferred
for each row execute function private.check_item_row_provider_consistency();

-- ---------------------------------------------------------------------------
-- Admin online provider upsert
-- ---------------------------------------------------------------------------

create or replace function private.admin_upsert_online_provider_item_impl(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'[[:space:]]+',' ','g'));
  v_type text := lower(btrim(coalesce(p_store_type,'')));
  v_url text := btrim(coalesce(p_official_url,''));
  v_host text;
  v_platform text := nullif(lower(btrim(coalesce(p_platform,''))),'');
  v_store_key text;
  v_store public.online_stores%rowtype;
  v_provider public.providers%rowtype;
  v_item public.items%rowtype;
  v_normalized text;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_category_id is null
     or not public.category_is_open_leaf(p_category_id)
  then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if char_length(v_name) not between 1 and 100 then
    raise exception 'PROVIDER_NAME_INVALID' using errcode='P0001';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  v_host := private.online_store_host(v_url);
  v_store_key := private.canonical_online_store_key(
    v_type,v_url,v_platform,p_store_key
  );

  perform pg_advisory_xact_lock(
    hashtextextended('online-store:'||v_store_key,0)
  );

  select * into v_store
  from public.online_stores
  where store_key=v_store_key
  for update;

  if found then
    if v_store.store_type<>v_type
       or v_store.host<>v_host
       or v_store.platform is distinct from v_platform
    then
      raise exception 'ONLINE_STORE_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if v_store.official_url is distinct from v_url then
      update public.online_stores
      set official_url=v_url
      where id=v_store.id
      returning * into v_store;
    end if;
  else
    insert into public.online_stores(
      store_type,host,platform,store_key,official_url
    )
    values(
      v_type,v_host,v_platform,v_store_key,v_url
    )
    returning * into v_store;
  end if;

  select * into v_provider
  from public.providers
  where online_store_id=v_store.id
  for update;

  if found then
    if v_provider.kind<>'online_store' then
      raise exception 'PROVIDER_IDENTITY_CONFLICT' using errcode='P0001';
    end if;

    if p_brand_id is not null
       and v_provider.brand_id is not null
       and v_provider.brand_id<>p_brand_id
    then
      raise exception 'PROVIDER_BRAND_CONFLICT' using errcode='P0001';
    end if;

    update public.providers
    set name=v_name,
        brand_id=coalesce(v_provider.brand_id,p_brand_id)
    where id=v_provider.id
    returning * into v_provider;
  else
    insert into public.providers(
      kind,name,brand_id,online_store_id,status,created_by
    )
    values(
      'online_store',v_name,p_brand_id,v_store.id,'active',v_actor
    )
    returning * into v_provider;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'provider-item:'||v_provider.id::text||':'||p_category_id::text,
      0
    )
  );

  select i.* into v_item
  from public.item_providers ipr
  join public.items i on i.id=ipr.item_id
  where ipr.provider_id=v_provider.id
    and ipr.category_id=p_category_id
  for update of i;

  if not found then
    v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

    insert into public.items(
      category_id,brand_id,name,normalized_name,status,
      external_source,external_id,created_by
    )
    values(
      p_category_id,null,v_name,v_normalized,'active',
      'onepick_provider',v_provider.id::text||':'||p_category_id::text,v_actor
    )
    returning * into v_item;

    insert into public.item_providers(item_id,category_id,provider_id)
    values(v_item.id,p_category_id,v_provider.id);
  end if;

  -- Existing provider items keep their item identity but follow the provider's
  -- current display name and official URL.
  if v_item.name is distinct from v_name then
    update public.items
    set name=v_name,
        normalized_name=lower(regexp_replace(v_name,'[[:space:]]','','g'))
    where id=v_item.id
    returning * into v_item;
  end if;

  insert into public.item_channels(item_id,channel,target_url,is_primary)
  values(v_item.id,'online',v_url,true)
  on conflict(item_id,channel) do update
  set target_url=excluded.target_url,
      is_primary=true,
      updated_at=now();

  provider_id := v_provider.id;
  online_store_id := v_store.id;
  item_id := v_item.id;
  category_id := p_category_id;
  return next;
end;
$$;

revoke all on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function private.admin_upsert_online_provider_item_impl(
  uuid,text,text,text,text,text,uuid
) to authenticated;

create or replace function public.admin_upsert_online_provider_item(
  p_category_id uuid,
  p_name text,
  p_store_type text,
  p_official_url text,
  p_platform text default null,
  p_store_key text default null,
  p_brand_id uuid default null
)
returns table(
  provider_id uuid,
  online_store_id uuid,
  item_id uuid,
  category_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.admin_upsert_online_provider_item_impl(
    p_category_id,p_name,p_store_type,p_official_url,
    p_platform,p_store_key,p_brand_id
  );
$$;

revoke all on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) from public, anon;
grant execute on function public.admin_upsert_online_provider_item(
  uuid,text,text,text,text,text,uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Brand and status administration
-- ---------------------------------------------------------------------------

create or replace function private.admin_set_provider_brand_impl(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if p_brand_id is not null
     and not exists(select 1 from public.brands where id=p_brand_id)
  then
    raise exception 'BRAND_NOT_FOUND' using errcode='P0001';
  end if;

  update public.providers
  set brand_id=p_brand_id
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_brand_impl(uuid,uuid)
  from public, anon;
grant execute on function private.admin_set_provider_brand_impl(uuid,uuid)
  to authenticated;

create or replace function public.admin_set_provider_brand(
  p_provider_id uuid,
  p_brand_id uuid
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_brand_impl(p_provider_id,p_brand_id);
$$;

revoke all on function public.admin_set_provider_brand(uuid,uuid)
  from public, anon;
grant execute on function public.admin_set_provider_brand(uuid,uuid)
  to authenticated;

create or replace function private.admin_set_provider_status_impl(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
begin
  if not private.is_admin_mfa() then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  if v_status not in ('pending','active','hidden') then
    raise exception 'PROVIDER_STATUS_INVALID' using errcode='P0001';
  end if;

  update public.providers
  set status=v_status
  where id=p_provider_id
  returning * into v_provider;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode='P0001';
  end if;

  return v_provider;
end;
$$;

revoke all on function private.admin_set_provider_status_impl(uuid,text)
  from public, anon;
grant execute on function private.admin_set_provider_status_impl(uuid,text)
  to authenticated;

create or replace function public.admin_set_provider_status(
  p_provider_id uuid,
  p_status text
)
returns public.providers
language sql
security invoker
set search_path = ''
as $$
  select private.admin_set_provider_status_impl(p_provider_id,p_status);
$$;

revoke all on function public.admin_set_provider_status(uuid,text)
  from public, anon;
grant execute on function public.admin_set_provider_status(uuid,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Pending-item merge guard
-- ---------------------------------------------------------------------------

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

  if exists(select 1 from public.picks where item_id=v_source.id) then
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

revoke all on function public.admin_merge_pending_item(uuid,uuid)
  from public, anon;
grant execute on function public.admin_merge_pending_item(uuid,uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin audit
-- ---------------------------------------------------------------------------

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_entity_type_check,
  add constraint admin_audit_logs_entity_type_check
  check (
    entity_type in (
      'category','brand','item','content_report','provider','online_store'
    )
  );

create or replace function private.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_actor uuid := auth.uid();
  v_entity_type text := tg_argv[0];
  v_entity_id uuid;
  v_row jsonb;
  v_summary jsonb := '{}'::jsonb;
begin
  if tg_op='DELETE' then
    v_entity_id := old.id;
    v_row := to_jsonb(old);
  else
    v_entity_id := new.id;
    v_row := to_jsonb(new);
  end if;

  if not private.is_admin(v_actor) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_entity_type='item' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status',
      'category_id',v_row->>'category_id'
    );
  elsif v_entity_type='category' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'status',v_row->>'status'
    );
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'is_active',v_row->'is_active'
    );
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  elsif v_entity_type='provider' then
    v_summary := jsonb_build_object(
      'name',v_row->>'name',
      'kind',v_row->>'kind',
      'status',v_row->>'status',
      'brand_id',v_row->>'brand_id',
      'place_id',v_row->>'place_id',
      'online_store_id',v_row->>'online_store_id'
    );
  elsif v_entity_type='online_store' then
    v_summary := jsonb_build_object(
      'store_type',v_row->>'store_type',
      'host',v_row->>'host',
      'platform',v_row->>'platform',
      'store_key',v_row->>'store_key',
      'official_url',v_row->>'official_url'
    );
  end if;

  insert into public.admin_audit_logs(
    actor_user_id,entity_type,entity_id,action,summary
  )
  values(
    v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.log_admin_audit()
  from public, anon, authenticated;

create trigger providers_admin_audit
after insert or update or delete on public.providers
for each row execute function private.log_admin_audit('provider');

create trigger online_stores_admin_audit
after insert or update or delete on public.online_stores
for each row execute function private.log_admin_audit('online_store');

commit;
