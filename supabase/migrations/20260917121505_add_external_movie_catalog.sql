alter table public.items
  add column external_source text,
  add column external_id text,
  add column original_name text,
  add column release_year smallint;

alter table public.items
  add constraint items_external_identity_pair_check
    check ((external_source is null) = (external_id is null)),
  add constraint items_external_source_check
    check (external_source is null or external_source ~ '^[a-z][a-z0-9_]{0,31}$'),
  add constraint items_external_id_check
    check (external_id is null or char_length(btrim(external_id)) between 1 and 100),
  add constraint items_original_name_check
    check (original_name is null or char_length(btrim(original_name)) between 1 and 200),
  add constraint items_release_year_check
    check (release_year is null or release_year between 1888 and 2200);

create unique index items_external_identity_unique
  on public.items (external_source, external_id);

comment on column public.items.external_source is
  'External catalog identifier namespace, for example tmdb.';
comment on column public.items.external_id is
  'Stable identifier within external_source. Never use a title as identity.';
comment on column public.items.original_name is
  'Original-language catalog title when it differs from the display name.';
comment on column public.items.release_year is
  'Release year used to distinguish items with the same display name.';

with content_category as (
  insert into public.categories (
    name,
    slug,
    status,
    is_visible,
    is_pickable,
    sort_order
  )
  values ('콘텐츠', 'content', 'open', true, false, 30)
  on conflict (slug) do update
    set name = excluded.name,
        status = excluded.status,
        is_visible = excluded.is_visible,
        is_pickable = excluded.is_pickable,
        sort_order = excluded.sort_order,
        updated_at = now()
  returning id
)
insert into public.categories (
  parent_id,
  name,
  slug,
  status,
  is_visible,
  is_pickable,
  sort_order
)
select id, '영화', 'movie', 'open', true, true, 31
from content_category
on conflict (slug) do update
  set parent_id = excluded.parent_id,
      name = excluded.name,
      status = excluded.status,
      is_visible = excluded.is_visible,
      is_pickable = excluded.is_pickable,
      sort_order = excluded.sort_order,
      updated_at = now();

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
    release_year
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;
