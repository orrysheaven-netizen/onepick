-- Place search scanned every place_catalog row: the fuzzy
-- `similarity(...) >= 0.25` branch of an OR cannot use an index. With Seoul +
-- Gyeonggi + Incheon (≈368k rows) a search took 1–3 s on the free plan and anon
-- calls hit the 3 s statement_timeout.
--
-- Same results, same order, indexed:
--   1. substring matches (exact → prefix → contains) through a GIN index on the
--      name's 2-character grams, so 2-character queries ("국밥") are indexed too
--      (pg_trgm cannot index a 2-character LIKE '%..%').
--   2. only when that leaves room below the limit, fuzzy matches through the
--      existing trigram index (`%` prefilter at 0.24, then similarity >= 0.25 as before;
--      `%` alone means strictly greater than the threshold).
--   3. the places/items join for existing_item_id runs on the final ≤20 rows.

begin;

-- Distinct 2-character grams of an already normalized name. IMMUTABLE so it can
-- back an expression index; a 1-character name yields itself.
create or replace function private.place_name_bigrams(p_name text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_name is null or p_name = '' then '{}'::text[]
    when char_length(p_name) = 1 then array[p_name]
    else array(
      select distinct substr(p_name, i, 2)
      from generate_series(1, char_length(p_name) - 1) as i
    )
  end;
$$;

revoke all on function private.place_name_bigrams(text) from public;
grant execute on function private.place_name_bigrams(text) to anon, authenticated, service_role;

create index if not exists place_catalog_name_bigrams
  on public.place_catalog
  using gin (private.place_name_bigrams(normalized_name))
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
security invoker
set search_path = ''
as $$
declare
  v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g'));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),20);
  v_grams text[];
  v_prev_threshold text;
begin
  if p_category_id is null
     or char_length(v_query) not between 2 and 100
     or not public.category_uses_place_catalog(p_category_id) then
    return;
  end if;

  v_grams := private.place_name_bigrams(v_query);

  -- `%` reads pg_trgm.similarity_threshold. A function-level SET needs superuser
  -- on Supabase, so set it for this call only and restore it afterwards.
  perform extensions.similarity('', '');  -- make sure pg_trgm's settings are loaded
  v_prev_threshold := current_setting('pg_trgm.similarity_threshold', true);
  perform set_config('pg_trgm.similarity_threshold', '0.24', true);

  return query
  with substring_hits as (
    select
      pc.id,
      case
        when pc.normalized_name = v_query then 0
        when left(pc.normalized_name, char_length(v_query)) = v_query then 1
        else 2
      end as match_rank,
      extensions.similarity(pc.normalized_name, v_query) as score,
      pc.name as sort_name,
      coalesce(pc.branch_name,'') as sort_branch,
      pc.provider_place_id as sort_id
    from public.place_catalog pc
    where pc.business_status = 'open'
      and private.place_name_bigrams(pc.normalized_name) @> v_grams
      and strpos(pc.normalized_name, v_query) > 0
    order by 2, 3 desc, 4, 5, 6
    limit v_limit
  ),
  fuzzy_hits as (
    select
      pc.id,
      3 as match_rank,
      extensions.similarity(pc.normalized_name, v_query) as score,
      pc.name as sort_name,
      coalesce(pc.branch_name,'') as sort_branch,
      pc.provider_place_id as sort_id
    from public.place_catalog pc
    where (select count(*) from substring_hits) < v_limit
      and pc.business_status = 'open'
      and pc.normalized_name operator(extensions.%) v_query
      and extensions.similarity(pc.normalized_name, v_query) >= 0.25
      and strpos(pc.normalized_name, v_query) = 0
    order by 3 desc, 4, 5, 6
    limit v_limit
  ),
  picked as (
    select * from substring_hits
    union all
    select * from fuzzy_hits
    order by match_rank, score desc, sort_name, sort_branch, sort_id
    limit v_limit
  )
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
  from picked h
  join public.place_catalog pc on pc.id = h.id
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
  order by h.match_rank, h.score desc, h.sort_name, h.sort_branch, h.sort_id;

  perform set_config('pg_trgm.similarity_threshold', coalesce(v_prev_threshold, '0.3'), true);
end;
$$;

revoke all on function public.search_place_catalog(uuid,text,integer) from public;
grant execute on function public.search_place_catalog(uuid,text,integer) to anon, authenticated;

commit;
