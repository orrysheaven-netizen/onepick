-- Very common short queries ("치킨", "카페") match thousands of places. Ranking
-- them read every matching row, so the first call on a cold free-plan cache
-- could exceed the 3 s anon statement_timeout (warm calls were ~60 ms).
--
-- Bound the rows a search can touch, tier by tier, keeping the ranking:
--   exact    normalized_name = q            (btree, all rows — usually few)
--   prefix   q ≤ name < q || U+10FFFF      (btree range, first 200 by name)
--   contains 2-char-gram GIN + strpos       (first 200 matches)
--   fuzzy    trigram `%`, only when the above leave room, in two passes:
--            similarity >= 0.3 first (cheap), then 0.25–0.3 only if slots remain.
--            Weaker matches always rank below stronger ones, so this returns the
--            same rows as one 0.25 pass; for common prefixes such as "대성" the
--            0.25 pass rechecks ~3,200 pages, the 0.3 pass ~220.
-- Each tier is still ordered by similarity, name, branch, provider id before the
-- final top-N. Results only differ for queries with more than 200 prefix or 200
-- contains matches, where the best of the capped candidates are shown.

begin;

create index if not exists place_catalog_normalized_name_pattern
  on public.place_catalog (normalized_name text_pattern_ops)
  where business_status = 'open';

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
-- Owner rights keep the index plans (RLS blocks non-leakproof quals); the body
-- applies every read policy a guest has (open rows, visible places, live items).
security definer
set search_path = ''
as $$
declare
  v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g'));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),20);
  v_cap constant integer := 200;
  v_grams text[];
  v_upper text;
  v_prev_threshold text;
  v_ids uuid[];
  v_weak uuid[];
begin
  if p_category_id is null
     or char_length(v_query) not between 2 and 100
     or not public.category_uses_place_catalog(p_category_id) then
    return;
  end if;

  v_grams := private.place_name_bigrams(v_query);
  -- Upper bound of the prefix range for text_pattern_ops (byte order).
  v_upper := v_query || chr(1114111);

  -- `%` reads pg_trgm.similarity_threshold. A function-level SET needs superuser
  -- on Supabase, so set it for this call only and restore it afterwards.
  perform extensions.similarity('', '');  -- make sure pg_trgm's settings are loaded
  v_prev_threshold := current_setting('pg_trgm.similarity_threshold', true);
  perform set_config('pg_trgm.similarity_threshold', '0.29', true);

  -- Pass 1: substring tiers (capped) + strong fuzzy matches, in final order.
  with exact_hits as (
    select pc.id, 0 as match_rank, extensions.similarity(pc.normalized_name, v_query) as score,
      pc.name as sort_name, coalesce(pc.branch_name,'') as sort_branch, pc.provider_place_id as sort_id
    from public.place_catalog pc
    where pc.business_status = 'open'
      and pc.normalized_name = v_query
    order by 3 desc, 4, 5, 6
    limit v_limit
  ),
  prefix_candidates as (
    select pc.id, pc.normalized_name, pc.name, pc.branch_name, pc.provider_place_id
    from public.place_catalog pc
    where pc.business_status = 'open'
      and pc.normalized_name operator(pg_catalog.~>=~) v_query
      and pc.normalized_name operator(pg_catalog.~<~) v_upper
      and pc.normalized_name <> v_query
    order by pc.normalized_name using operator(pg_catalog.~<~)
    limit v_cap
  ),
  prefix_hits as (
    select c.id, 1 as match_rank, extensions.similarity(c.normalized_name, v_query) as score,
      c.name as sort_name, coalesce(c.branch_name,'') as sort_branch, c.provider_place_id as sort_id
    from prefix_candidates c
    order by 3 desc, 4, 5, 6
    limit v_limit
  ),
  contains_candidates as (
    select pc.id, pc.normalized_name, pc.name, pc.branch_name, pc.provider_place_id
    from public.place_catalog pc
    where pc.business_status = 'open'
      and private.place_name_bigrams(pc.normalized_name) @> v_grams
      and strpos(pc.normalized_name, v_query) > 1
    limit v_cap
  ),
  contains_hits as (
    select c.id, 2 as match_rank, extensions.similarity(c.normalized_name, v_query) as score,
      c.name as sort_name, coalesce(c.branch_name,'') as sort_branch, c.provider_place_id as sort_id
    from contains_candidates c
    order by 3 desc, 4, 5, 6
    limit v_limit
  ),
  substring_hits as (
    select * from exact_hits
    union all select * from prefix_hits
    union all select * from contains_hits
    order by 2, 3 desc, 4, 5, 6
    limit v_limit
  ),
  strong_fuzzy_hits as (
    select pc.id, 3 as match_rank, extensions.similarity(pc.normalized_name, v_query) as score,
      pc.name as sort_name, coalesce(pc.branch_name,'') as sort_branch, pc.provider_place_id as sort_id
    from public.place_catalog pc
    where (select count(*) from substring_hits) < v_limit
      and pc.business_status = 'open'
      and pc.normalized_name operator(extensions.%) v_query
      and extensions.similarity(pc.normalized_name, v_query) >= 0.3
      and strpos(pc.normalized_name, v_query) = 0
    order by 3 desc, 4, 5, 6
    limit v_limit
  )
  select coalesce(array_agg(h.id order by h.match_rank, h.score desc, h.sort_name, h.sort_branch, h.sort_id), '{}')
  into v_ids
  from (
    select * from substring_hits
    union all
    select * from strong_fuzzy_hits
    order by 2, 3 desc, 4, 5, 6
    limit v_limit
  ) h;

  -- Pass 2: weaker fuzzy matches (0.25–0.3) only when slots remain.
  if cardinality(v_ids) < v_limit then
    perform set_config('pg_trgm.similarity_threshold', '0.24', true);
    select coalesce(array_agg(w.id order by w.score desc, w.sort_name, w.sort_branch, w.sort_id), '{}')
    into v_weak
    from (
      select pc.id, extensions.similarity(pc.normalized_name, v_query) as score,
        pc.name as sort_name, coalesce(pc.branch_name,'') as sort_branch, pc.provider_place_id as sort_id
      from public.place_catalog pc
      where pc.business_status = 'open'
        and pc.normalized_name operator(extensions.%) v_query
        and extensions.similarity(pc.normalized_name, v_query) >= 0.25
        and extensions.similarity(pc.normalized_name, v_query) < 0.3
        and strpos(pc.normalized_name, v_query) = 0
      order by 2 desc, 3, 4, 5
      limit v_limit - cardinality(v_ids)
    ) w;
    v_ids := v_ids || v_weak;
  end if;

  perform set_config('pg_trgm.similarity_threshold', coalesce(v_prev_threshold, '0.3'), true);

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
    i.id
  from unnest(v_ids) with ordinality as picked(id, ord)
  join public.place_catalog pc on pc.id = picked.id
  left join public.places p
    on p.place_provider = pc.place_provider
   and p.provider_place_id = pc.provider_place_id
   and p.is_visible
  left join public.item_places ip
    on ip.place_id = p.id
   and ip.category_id = p_category_id
  left join public.items i
    on i.id = ip.item_id
   and i.category_id = ip.category_id
   and i.status in ('active','discontinued')
  order by picked.ord;
end;
$$;

revoke all on function public.search_place_catalog(uuid,text,integer) from public;
grant execute on function public.search_place_catalog(uuid,text,integer) to anon, authenticated;

commit;
