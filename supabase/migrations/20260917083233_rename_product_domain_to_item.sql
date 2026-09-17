
begin;

-- Remove dependent RPCs, helpers, triggers, and storage policies first.
drop policy if exists product_photos_own_insert on storage.objects;
drop policy if exists product_photos_own_select on storage.objects;
drop policy if exists product_photos_unused_delete on storage.objects;

drop trigger if exists prepare_product_alias on public.product_aliases;
drop trigger if exists products_admin_audit on public.products;

drop function if exists public.search_products(text, uuid[], integer);
drop function if exists public.submit_product(uuid, text, text, text, text);
drop function if exists public.register_pick(uuid, uuid, text, text, text, text, text);
drop function if exists public.change_pick(uuid, uuid, text);

drop function if exists private.register_pick_impl(uuid, uuid, text, text, text, text, text);
drop function if exists private.submit_product_impl(uuid, text, text, text, text);
drop function if exists private.change_pick_impl(uuid, uuid, text);
drop function if exists private.prepare_product_alias();
drop function if exists private.canonical_product_name(text, text);
drop function if exists private.can_upload_product_photo();
drop function if exists private.is_unused_product_photo(text);

-- Rename the core domain model without copying or deleting rows.
alter table public.products rename to items;
alter table public.product_aliases rename to item_aliases;
alter table public.items rename column merged_into_product_id to merged_into_item_id;
alter table public.item_aliases rename column product_id to item_id;
alter table public.picks rename column product_id to item_id;

-- Keep database object names aligned with the Item model.
alter table public.items rename constraint products_pkey to items_pkey;
alter table public.items rename constraint products_brand_id_fkey to items_brand_id_fkey;
alter table public.items rename constraint products_category_id_fkey to items_category_id_fkey;
alter table public.items rename constraint products_created_by_fkey to items_created_by_fkey;
alter table public.items rename constraint products_id_category_unique to items_id_category_unique;
alter table public.items rename constraint products_image_pair to items_image_pair;
alter table public.items rename constraint products_merge_state_consistent to items_merge_state_consistent;
alter table public.items rename constraint products_merged_into_product_id_fkey to items_merged_into_item_id_fkey;
alter table public.items rename constraint products_not_self_merged to items_not_self_merged;
alter table public.items rename constraint products_status_check to items_status_check;

alter table public.item_aliases rename constraint product_aliases_pkey to item_aliases_pkey;
alter table public.item_aliases rename constraint product_aliases_alias_length to item_aliases_alias_length;
alter table public.item_aliases rename constraint product_aliases_normalized_length to item_aliases_normalized_length;
alter table public.item_aliases rename constraint product_aliases_product_id_fkey to item_aliases_item_id_fkey;
alter table public.item_aliases rename constraint product_aliases_product_normalized_unique to item_aliases_item_normalized_unique;

alter table public.picks rename constraint picks_product_category_fk to picks_item_category_fk;

alter index public.products_brand_idx rename to items_brand_idx;
alter index public.products_category_normalized_name_idx rename to items_category_normalized_name_idx;
alter index public.products_category_status_idx rename to items_category_status_idx;
alter index public.products_created_by_idx rename to items_created_by_idx;
alter index public.products_image_path_unique rename to items_image_path_unique;
alter index public.products_merged_into_product_id_idx rename to items_merged_into_item_id_idx;
alter index public.products_normalized_name_idx rename to items_normalized_name_idx;
alter index public.products_normalized_name_trgm_idx rename to items_normalized_name_trgm_idx;
alter index public.products_thumbnail_path_unique rename to items_thumbnail_path_unique;
alter index public.product_aliases_normalized_trgm_idx rename to item_aliases_normalized_trgm_idx;
alter index public.product_aliases_product_id_idx rename to item_aliases_item_id_idx;
alter index public.picks_product_category_idx rename to picks_item_category_idx;
alter index public.picks_product_started_idx rename to picks_item_started_idx;

alter trigger products_set_updated_at on public.items rename to items_set_updated_at;
alter trigger set_product_aliases_updated_at on public.item_aliases rename to set_item_aliases_updated_at;

alter policy products_admin_insert on public.items rename to items_admin_insert;
alter policy products_admin_update on public.items rename to items_admin_update;
alter policy products_anon_read on public.items rename to items_anon_read;
alter policy products_authenticated_read on public.items rename to items_authenticated_read;
alter policy product_aliases_admin_delete on public.item_aliases rename to item_aliases_admin_delete;
alter policy product_aliases_admin_insert on public.item_aliases rename to item_aliases_admin_insert;
alter policy product_aliases_admin_update on public.item_aliases rename to item_aliases_admin_update;
alter policy product_aliases_anon_read on public.item_aliases rename to item_aliases_anon_read;
alter policy product_aliases_authenticated_read on public.item_aliases rename to item_aliases_authenticated_read;

-- Rename the empty photo bucket to match the Item model.
update storage.buckets
set id='item-photos', name='item-photos'
where id='product-photos';

-- Audit logs use Item terminology from now on.
update public.admin_audit_logs
set entity_type='item'
where entity_type='product';

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_entity_type_check,
  add constraint admin_audit_logs_entity_type_check
  check (entity_type in ('category','brand','item','content_report'));

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
    v_summary := jsonb_build_object('name',v_row->>'name','status',v_row->>'status');
  elsif v_entity_type='brand' then
    v_summary := jsonb_build_object('name',v_row->>'name','is_active',v_row->'is_active');
  elsif v_entity_type='content_report' then
    v_summary := jsonb_build_object(
      'status',v_row->>'status',
      'target_type',v_row->>'target_type',
      'target_id',v_row->>'target_id'
    );
  end if;

  insert into public.admin_audit_logs(actor_user_id,entity_type,entity_id,action,summary)
  values (v_actor,v_entity_type,v_entity_id,lower(tg_op),v_summary);

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create trigger items_admin_audit
after insert or update or delete on public.items
for each row execute function private.log_admin_audit('item');

create or replace function private.canonical_item_name(p_name text,p_slug text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare v_name text := regexp_replace(btrim(p_name),'[[:space:]]+',' ','g');
begin
  if p_slug not in ('ramen','beer','soju','snacks') then return v_name; end if;
  v_name := regexp_replace(v_name,'[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(kg|ml|g|l|개입|입|개|팩|봉|병|캔)(?=[[:space:]]|$|[×xX])',' ','gi');
  v_name := regexp_replace(v_name,'[[:space:]]*[×xX][[:space:]]*[0-9]+[[:space:]]*$','','g');
  if p_slug='ramen' then
    v_name := regexp_replace(v_name,'[[:space:]]*(봉지면|컵라면|큰사발면|작은사발면|사발면|컵면|큰사발|작은사발|봉지|큰컵|작은컵|컵|용기)(?=[[:space:]]|$)',' ','g');
  elsif p_slug in ('beer','soju') then
    v_name := regexp_replace(v_name,'[[:space:]]*(페트병|페트|캔|병)(?=[[:space:]]|$)',' ','g');
  end if;
  return regexp_replace(btrim(v_name),'[[:space:]]+',' ','g');
end;
$$;

create or replace function private.can_upload_item_photo()
returns boolean
language sql
security definer
set search_path to ''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles where id=auth.uid())
    and (select count(*) from storage.objects
         where bucket_id='item-photos'
           and owner_id=auth.uid()::text
           and created_at>now()-interval '1 day') < 20;
$$;

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
    );
$$;

create or replace function private.prepare_item_alias()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_category_id uuid;
  v_alias text;
  v_normalized text;
begin
  v_alias := regexp_replace(btrim(new.alias),'[[:space:]]+',' ','g');
  v_normalized := lower(regexp_replace(v_alias,'[[:space:]]+','','g'));

  if char_length(v_alias) not between 1 and 100
     or char_length(v_normalized) not between 1 and 100 then
    raise exception 'ALIAS_INVALID' using errcode='P0001';
  end if;

  select category_id into v_category_id from public.items where id=new.item_id;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('item-alias:'||v_category_id::text||':'||v_normalized,0)
  );

  if exists(
    select 1 from public.items i
    where i.id=new.item_id and i.normalized_name=v_normalized
  ) then
    raise exception 'ALIAS_REDUNDANT' using errcode='P0001';
  end if;

  if exists(
    select 1 from public.items i
    where i.id<>new.item_id
      and i.category_id=v_category_id
      and i.status not in ('merged','rejected')
      and i.normalized_name=v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  if exists(
    select 1
    from public.item_aliases ia
    join public.items i on i.id=ia.item_id
    where ia.id<>new.id
      and ia.item_id<>new.item_id
      and i.category_id=v_category_id
      and i.status not in ('merged','rejected')
      and ia.normalized_alias=v_normalized
  ) then
    raise exception 'ALIAS_CONFLICT' using errcode='P0001';
  end if;

  new.alias := v_alias;
  new.normalized_alias := v_normalized;
  return new;
end;
$$;

create trigger prepare_item_alias
before insert or update on public.item_aliases
for each row execute function private.prepare_item_alias();

create or replace function private.change_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text
)
returns public.picks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review text := btrim(p_one_line_review);
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text||':'||p_category_id::text,0)
  );

  select * into v_current
  from public.picks
  where user_id=v_user_id
    and category_id=p_category_id
    and status in ('active','needs_review')
  for update;

  if not found then
    insert into public.picks(
      id,user_id,category_id,item_id,one_line_review,
      status,started_at,ended_at,replaced_by_pick_id
    ) values (
      v_new_pick_id,v_user_id,p_category_id,p_item_id,v_review,
      'active',now(),null,null
    )
    returning * into v_result;
    return v_result;
  end if;

  if v_current.item_id=p_item_id then
    update public.picks
    set one_line_review=v_review,status='active',ended_at=null,updated_at=now()
    where id=v_current.id
    returning * into v_result;
    return v_result;
  end if;

  update public.picks
  set status='replaced',ended_at=now(),replaced_by_pick_id=v_new_pick_id,updated_at=now()
  where id=v_current.id;

  insert into public.picks(
    id,user_id,category_id,item_id,one_line_review,
    status,started_at,ended_at,replaced_by_pick_id
  ) values (
    v_new_pick_id,v_user_id,p_category_id,p_item_id,v_review,
    'active',now(),null,null
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function private.register_pick_impl(
  p_category_id uuid,
  p_item_id uuid,
  p_item_name text,
  p_one_line_review text,
  p_image_path text,
  p_thumbnail_path text,
  p_image_source_url text
)
returns public.picks
language plpgsql
security definer
set search_path to ''
as $$
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
  if p_one_line_review is null
     or char_length(btrim(p_one_line_review)) not between 1 and 100 then
    raise exception 'REVIEW_INVALID' using errcode='P0001';
  end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found or not v_category.is_visible or not v_category.is_pickable
     or v_category.status<>'open'
     or exists(select 1 from public.categories where parent_id=p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  if p_item_id is null then
    raise exception 'ITEM_SELECTION_REQUIRED' using errcode='P0001';
  end if;

  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode='P0001'; end if;
  if v_item.category_id<>p_category_id then
    raise exception 'ITEM_CATEGORY_MISMATCH' using errcode='P0001';
  end if;
  if v_item.status not in ('active','discontinued') then
    raise exception 'ITEM_NOT_ELIGIBLE' using errcode='P0001';
  end if;

  if v_item.image_path is null and (p_image_path is not null or p_thumbnail_path is not null) then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text
       or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and (metadata->>'size')::bigint between 1 and 786432
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and (metadata->>'size')::bigint between 1 and 98304
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    if p_image_source_url is not null
       and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    update public.items
    set image_path=p_image_path,
        thumbnail_path=p_thumbnail_path,
        image_source_url=p_image_source_url
    where id=v_item.id;
  end if;

  v_result := private.change_pick_impl(
    p_category_id,v_item.id,btrim(p_one_line_review)
  );
  return v_result;
end;
$$;

create or replace function private.submit_item_impl(
  p_category_id uuid,
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_category public.categories%rowtype;
  v_name text;
  v_normalized text;
  v_item public.items%rowtype;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='P0001'; end if;
  if not exists(select 1 from public.profiles where id=v_user) then
    raise exception 'PROFILE_NOT_FOUND' using errcode='P0001';
  end if;

  select * into v_category from public.categories where id=p_category_id;
  if not found or not private.category_accepts_picks(p_category_id) then
    raise exception 'CATEGORY_NOT_PICKABLE' using errcode='P0001';
  end if;

  v_name := private.canonical_item_name(p_item_name,v_category.slug);
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception 'ITEM_NAME_INVALID' using errcode='P0001';
  end if;
  v_normalized := lower(regexp_replace(v_name,'[[:space:]]','','g'));

  perform pg_advisory_xact_lock(
    hashtextextended('item:'||p_category_id::text||':'||v_normalized,0)
  );

  select * into v_item
  from public.items
  where category_id=p_category_id
    and normalized_name=v_normalized
    and (status in ('active','discontinued') or (status='pending' and created_by=v_user))
  order by case status when 'active' then 0 when 'discontinued' then 1 else 2 end,
           created_at,id
  limit 1
  for update;

  if found then return v_item; end if;

  if (select count(*) from public.items
      where created_by=v_user and created_at>now()-interval '1 day')>=20 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;

  if p_image_path is not null or p_thumbnail_path is not null then
    if p_image_path is null or p_thumbnail_path is null or p_image_path=p_thumbnail_path
       or split_part(p_image_path,'/',1)<>v_user::text
       or split_part(p_thumbnail_path,'/',1)<>v_user::text then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_image_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and (metadata->>'size')::bigint between 1 and 786432
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    perform 1 from storage.objects
    where bucket_id='item-photos' and name=p_thumbnail_path and owner_id=v_user::text
      and metadata->>'mimetype'='image/jpeg'
      and (metadata->>'size')::bigint between 1 and 98304
    for share;
    if not found then raise exception 'PHOTO_INVALID' using errcode='P0001'; end if;

    if p_image_source_url is not null
       and (char_length(p_image_source_url)>2048 or p_image_source_url !~ '^https://') then
      raise exception 'PHOTO_INVALID' using errcode='P0001';
    end if;
  end if;

  insert into public.items(
    category_id,name,normalized_name,status,created_by,
    image_path,thumbnail_path,image_source_url
  ) values (
    p_category_id,v_name,v_normalized,'pending',v_user,
    p_image_path,p_thumbnail_path,p_image_source_url
  )
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function public.change_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_one_line_review text
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.change_pick_impl(p_category_id,p_item_id,p_one_line_review);
$$;

create or replace function public.register_pick(
  p_category_id uuid,
  p_item_id uuid,
  p_item_name text,
  p_one_line_review text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.picks
language sql
set search_path to ''
as $$
  select private.register_pick_impl(
    p_category_id,p_item_id,p_item_name,p_one_line_review,
    p_image_path,p_thumbnail_path,p_image_source_url
  );
$$;

create or replace function public.submit_item(
  p_category_id uuid,
  p_item_name text,
  p_image_path text default null,
  p_thumbnail_path text default null,
  p_image_source_url text default null
)
returns public.items
language sql
set search_path to ''
as $$
  select private.submit_item_impl(
    p_category_id,p_item_name,p_image_path,p_thumbnail_path,p_image_source_url
  );
$$;

create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.items
language sql
stable
set search_path to ''
as $$
  with params as (
    select
      lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g')) as q,
      least(greatest(coalesce(p_limit,20),1),50) as safe_limit
  ),
  ranked as (
    select
      i.*,
      case
        when i.normalized_name=params.q then 0
        when coalesce(alias_match.exact_match,false) then 1
        when i.normalized_name like params.q||'%' then 2
        when coalesce(alias_match.prefix_match,false) then 3
        when i.normalized_name like '%'||params.q||'%' then 4
        when coalesce(alias_match.contains_match,false) then 5
        else 6
      end as match_rank,
      greatest(
        extensions.similarity(i.normalized_name,params.q),
        coalesce(alias_match.best_similarity,0)
      ) as similarity_score
    from public.items i
    join public.categories c on c.id=i.category_id
    left join public.categories parent on parent.id=c.parent_id
    cross join params
    left join lateral (
      select
        bool_or(ia.normalized_alias=params.q) as exact_match,
        bool_or(ia.normalized_alias like params.q||'%') as prefix_match,
        bool_or(ia.normalized_alias like '%'||params.q||'%') as contains_match,
        max(extensions.similarity(ia.normalized_alias,params.q)) as best_similarity
      from public.item_aliases ia
      where ia.item_id=i.id
        and (
          ia.normalized_alias like '%'||params.q||'%'
          or ia.normalized_alias operator(extensions.%) params.q
        )
    ) alias_match on true
    where params.q<>''
      and i.status in ('active','discontinued')
      and (p_category_ids is null or i.category_id=any(p_category_ids))
      and c.status='open'
      and c.is_visible=true
      and c.is_pickable=true
      and not exists(select 1 from public.categories child where child.parent_id=c.id)
      and (
        c.parent_id is null
        or (
          parent.parent_id is null
          and parent.status='open'
          and parent.is_visible=true
          and parent.is_pickable=false
        )
      )
      and (
        i.normalized_name like '%'||params.q||'%'
        or i.normalized_name operator(extensions.%) params.q
        or coalesce(alias_match.exact_match,false)
        or coalesce(alias_match.prefix_match,false)
        or coalesce(alias_match.contains_match,false)
        or coalesce(alias_match.best_similarity,0)>=0.2
      )
  )
  select
    id,category_id,brand_id,name,normalized_name,model_code,official_url,status,
    merged_into_item_id,created_by,created_at,updated_at,image_path,
    thumbnail_path,image_source_url
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;

-- Recreate Storage policies using the Item bucket and helpers.
create policy item_photos_own_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='item-photos'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
  and lower(storage.extension(name))='jpg'
  and (select private.can_upload_item_photo())
);

create policy item_photos_own_select
on storage.objects for select to authenticated
using (
  bucket_id='item-photos'
  and owner_id=(select auth.uid()::text)
);

create policy item_photos_unused_delete
on storage.objects for delete to authenticated
using (
  bucket_id='item-photos'
  and owner_id=(select auth.uid()::text)
  and private.is_unused_item_photo(name)
);

-- Explicit execution grants; SECURITY DEFINER helpers are not public endpoints.
revoke all on function private.canonical_item_name(text,text) from public,anon,authenticated;
revoke all on function private.prepare_item_alias() from public,anon,authenticated;
revoke all on function private.change_pick_impl(uuid,uuid,text) from public,anon;
revoke all on function private.register_pick_impl(uuid,uuid,text,text,text,text,text) from public,anon;
revoke all on function private.submit_item_impl(uuid,text,text,text,text) from public,anon;
revoke all on function private.can_upload_item_photo() from public,anon;
revoke all on function private.is_unused_item_photo(text) from public,anon;

grant execute on function private.change_pick_impl(uuid,uuid,text) to authenticated;
grant execute on function private.register_pick_impl(uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function private.submit_item_impl(uuid,text,text,text,text) to authenticated;
grant execute on function private.can_upload_item_photo() to authenticated;
grant execute on function private.is_unused_item_photo(text) to authenticated;

revoke all on function public.change_pick(uuid,uuid,text) from public,anon;
revoke all on function public.register_pick(uuid,uuid,text,text,text,text,text) from public,anon;
revoke all on function public.submit_item(uuid,text,text,text,text) from public,anon;
revoke all on function public.search_items(text,uuid[],integer) from public;

grant execute on function public.change_pick(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.register_pick(uuid,uuid,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.submit_item(uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.search_items(text,uuid[],integer) to anon,authenticated,service_role;

commit;
