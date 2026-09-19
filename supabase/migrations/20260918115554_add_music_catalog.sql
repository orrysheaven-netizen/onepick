-- Add the first music category and structured catalog metadata.
-- MusicBrainz recording MBIDs are stored in items.external_id under
-- external_source='musicbrainz_recording'. Search never writes item rows.
alter table public.items
  add column creator_name text,
  add column collection_name text;

alter table public.items
  add constraint items_creator_name_check
    check (creator_name is null or char_length(btrim(creator_name)) between 1 and 300),
  add constraint items_collection_name_check
    check (collection_name is null or char_length(btrim(collection_name)) between 1 and 300);

comment on column public.items.creator_name is
  'Primary creator display text for external catalogs, for example a recording artist.';
comment on column public.items.collection_name is
  'Containing release/collection display text for external catalogs, for example an album.';

do $$
declare parent_id uuid;
begin
  select id into parent_id from public.categories where slug='content';
  if parent_id is null then raise exception 'CONTENT_CATEGORY_REQUIRED'; end if;
  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(parent_id,'음악','music','open',true,true,33)
    on conflict(slug) do nothing; -- Never reopen an existing admin-disabled category.
end;
$$;

-- Server-only cache and a shared request reservation keep multiple Edge Function
-- instances from exceeding MusicBrainz's default source-IP request rate.
create table public.external_catalog_cache (
  provider text not null,
  cache_key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key(provider,cache_key),
  constraint external_catalog_cache_provider_check check (provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint external_catalog_cache_key_check check (cache_key ~ '^[0-9a-f]{64}$')
);
alter table public.external_catalog_cache enable row level security;
revoke all on table public.external_catalog_cache from public, anon, authenticated;
grant select,insert,update,delete on table public.external_catalog_cache to service_role;

create table public.external_catalog_request_limits (
  provider text primary key,
  next_allowed_at timestamptz not null default now(),
  constraint external_catalog_request_limits_provider_check check (provider ~ '^[a-z][a-z0-9_]{0,31}$')
);
alter table public.external_catalog_request_limits enable row level security;
revoke all on table public.external_catalog_request_limits from public, anon, authenticated;
grant select,insert,update on table public.external_catalog_request_limits to service_role;

create or replace function public.reserve_external_catalog_slot(
  p_provider text,
  p_interval_ms integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_slot timestamptz;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_]{0,31}$'
     or p_interval_ms not between 100 and 10000 then
    raise exception 'CATALOG_RATE_INPUT_INVALID' using errcode='P0001';
  end if;

  insert into public.external_catalog_request_limits(provider,next_allowed_at)
  values(p_provider,v_now)
  on conflict(provider) do nothing;

  select greatest(next_allowed_at,v_now) into v_slot
  from public.external_catalog_request_limits
  where provider=p_provider
  for update;

  update public.external_catalog_request_limits
  set next_allowed_at=v_slot + make_interval(secs => p_interval_ms / 1000.0)
  where provider=p_provider;

  return ceil(greatest(0,extract(epoch from (v_slot-v_now))*1000))::integer;
end;
$function$;

revoke execute on function public.reserve_external_catalog_slot(text,integer) from public, anon, authenticated;
grant execute on function public.reserve_external_catalog_slot(text,integer) to service_role;

-- items gained two columns, so redefine the SETOF-items search projection with
-- the exact composite row shape. Ranking/visibility semantics stay unchanged.
create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.items
language sql
stable
set search_path = ''
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
    id,
    category_id,
    brand_id,
    name,
    normalized_name,
    model_code,
    official_url,
    status,
    merged_into_item_id,
    created_by,
    created_at,
    updated_at,
    image_path,
    thumbnail_path,
    image_source_url,
    external_source,
    external_id,
    original_name,
    release_year,
    creator_name,
    collection_name
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;
