-- YouTube channel catalog metadata is Non-Authorized YouTube API Data.
-- It must be refreshed or removed before the 30-day policy limit.
alter table public.items
  add column external_refreshed_at timestamptz;

comment on column public.items.external_refreshed_at is
  'Last provider verification time for external metadata with provider-specific freshness obligations.';

do $$
declare parent_id uuid;
begin
  select id into parent_id from public.categories where slug='content';
  if parent_id is null then raise exception 'CONTENT_CATEGORY_REQUIRED'; end if;
  insert into public.categories(parent_id,name,slug,status,is_visible,is_pickable,sort_order)
    values(parent_id,'유튜브','youtube','open',true,true,36)
    on conflict(slug) do nothing;
end;
$$;

create or replace function private.scrub_stale_youtube_api_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.items
  set
    name='YouTube 채널 · 정보 갱신 필요',
    normalized_name='youtube채널정보갱신필요',
    official_url=null,
    image_source_url=null,
    external_source=null,
    external_id=null,
    original_name=null,
    release_year=null,
    creator_name=null,
    collection_name=null,
    external_refreshed_at=null,
    status='discontinued',
    updated_at=now()
  where external_source='youtube_channel'
    and (external_refreshed_at is null or external_refreshed_at < now()-interval '25 days');
  get diagnostics v_count = row_count;

  delete from public.external_catalog_cache
  where provider='youtube'
    and fetched_at < now()-interval '25 days';

  return v_count;
end;
$$;

revoke all on function private.scrub_stale_youtube_api_data() from public,anon,authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'onepick-youtube-api-data-scrub',
  '17 3 * * *',
  $cron$select private.scrub_stale_youtube_api_data();$cron$
);

-- search_items returns SETOF items, so keep the exact composite row order after adding
-- external_refreshed_at at the end of the items table.
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
    id,category_id,brand_id,name,normalized_name,model_code,official_url,status,
    merged_into_item_id,created_by,created_at,updated_at,image_path,thumbnail_path,
    image_source_url,external_source,external_id,original_name,release_year,
    creator_name,collection_name,external_refreshed_at
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;

