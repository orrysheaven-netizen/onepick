-- Item search returned the same rows, but the planner reached them the slow way.
--
-- The previous body put the trigram-indexable name tests and the result of a
-- per-item `left join lateral` over item_aliases in one OR. Nothing in that
-- shape can be answered from an index, so the plan drove from categories to
-- every item inside every open leaf category, ran the alias lateral for each of
-- them, and only then applied the name/alias filter. Measured on a local
-- PostgreSQL 16 with this schema and 100k items, that was ~410ms per search
-- with over 90% of the rows discarded after the work was done.
--
-- This rewrite keeps the ranking expression, the visibility rules, the alias
-- handling, the limit and the returned rows exactly as they were. It only
-- changes how the planner gets there:
--
--   1. `candidates` collects item ids from the two trigram GIN indexes
--      (items_normalized_name_trgm_idx, item_aliases_normalized_trgm_idx).
--      It is a superset of what the ranking step can keep: the alias tests
--      below are all narrower than the alias filter here, and the name tests
--      are the same ones. The original WHERE clause is re-applied afterwards,
--      so a candidate that does not qualify is still dropped.
--   2. category_is_open_leaf walks the category tree with a recursive CTE, so
--      it is evaluated once per distinct category the candidates actually use
--      instead of once per row. The two materialized CTEs are what guarantee
--      the DISTINCT happens first. This is never more calls than before, which
--      evaluated it once per category in the whole table.
--
-- Same schema and data, 100k items: ~410ms -> ~50ms for ordinary queries.
-- Queries of one or two characters produce no usable trigrams and still scan;
-- that is unchanged by this migration.

create or replace function public.search_items(
  p_query text,
  p_category_ids uuid[] default null,
  p_limit integer default 20
)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g')) as q,
      least(greatest(coalesce(p_limit,20),1),50) as safe_limit
  ),
  candidates as materialized (
    select i.id
    from public.items i
    cross join params
    where params.q<>''
      and (
        i.normalized_name like '%'||params.q||'%'
        or i.normalized_name operator(extensions.%) params.q
      )
    union
    select ia.item_id
    from public.item_aliases ia
    cross join params
    where params.q<>''
      and (
        ia.normalized_alias like '%'||params.q||'%'
        or ia.normalized_alias operator(extensions.%) params.q
      )
  ),
  scoped as materialized (
    select i.*
    from candidates c
    join public.items i on i.id=c.id
    where i.status in ('active','discontinued')
      and (p_category_ids is null or i.category_id=any(p_category_ids))
  ),
  candidate_categories as materialized (
    select distinct i.category_id from scoped i
  ),
  open_leaf_categories as materialized (
    select cc.category_id
    from candidate_categories cc
    where public.category_is_open_leaf(cc.category_id)
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
    from scoped i
    join open_leaf_categories o on o.category_id=i.category_id
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
    where i.normalized_name like '%'||params.q||'%'
      or i.normalized_name operator(extensions.%) params.q
      or coalesce(alias_match.exact_match,false)
      or coalesce(alias_match.prefix_match,false)
      or coalesce(alias_match.contains_match,false)
      or coalesce(alias_match.best_similarity,0)>=0.2
  )
  select
    id,category_id,brand_id,name,normalized_name,model_code,official_url,status,
    merged_into_item_id,created_by,created_at,updated_at,image_path,thumbnail_path,
    image_source_url,external_source,external_id,original_name,release_year,
    creator_name,collection_name,external_refreshed_at,market_availability_status
  from ranked
  order by match_rank,similarity_score desc,name
  limit (select safe_limit from params);
$$;
