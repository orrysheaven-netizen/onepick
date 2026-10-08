-- Figma 75-1 store search pagination.
-- Keep the existing search_store_catalog(text, integer) contract unchanged for
-- current consumers. This additive RPC gives the registration flow a complete,
-- deterministic store result set split into 20-row cursor pages.
--
-- Confirmed order:
--   headquarters -> Seoul -> metropolitan cities -> Gyeonggi -> all others,
--   then branch name in Korean lexical order, with name + catalog_id as the
--   final stable tie-breakers.
--
-- Search covers the store name plus branch_name. The cursor is opaque to the
-- client and bound to the normalized query so stale cursors cannot be reused
-- after the search text changes.

begin;

create or replace function private.store_catalog_search_text(
  p_normalized_name text,
  p_branch_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_normalized_name,'')
       || lower(regexp_replace(btrim(coalesce(p_branch_name,'')),'[[:space:]]+','','g'));
$$;

revoke all on function private.store_catalog_search_text(text,text)
  from public, anon, authenticated;

-- Existing normalized_name indexes cannot satisfy "store + branch" queries.
-- Reuse the proven 2-character bigram strategy without imposing a candidate
-- cap: the index narrows substring candidates, while keyset pagination keeps
-- each response bounded to 20 rows.
create index place_catalog_store_search_bigrams
  on public.place_catalog using gin (
    private.place_name_bigrams(
      private.store_catalog_search_text(normalized_name,branch_name)
    )
  )
  where business_status='open';

create or replace function public.search_store_catalog_page(
  p_query text,
  p_cursor text default null,
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
  map_url text,
  next_cursor text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+','','g'));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),20);
  v_grams text[];
  v_cursor jsonb;
  v_cursor_query text;
  v_cursor_rank integer;
  v_cursor_branch text;
  v_cursor_name text;
  v_cursor_id uuid;
begin
  if char_length(v_query) not between 2 and 100 then
    return;
  end if;

  v_grams := private.place_name_bigrams(v_query);

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor,'hex'),'UTF8')::jsonb;
      v_cursor_query := v_cursor->>'q';
      v_cursor_rank := (v_cursor->>'r')::integer;
      v_cursor_branch := v_cursor->>'b';
      v_cursor_name := v_cursor->>'n';
      v_cursor_id := (v_cursor->>'i')::uuid;

      if v_cursor_query is distinct from v_query
         or v_cursor_rank not between 0 and 4
         or v_cursor_branch is null
         or v_cursor_name is null
         or v_cursor_id is null then
        raise exception 'INVALID_CURSOR' using errcode='22023';
      end if;
    exception when others then
      raise exception 'INVALID_CURSOR' using errcode='22023';
    end;
  end if;

  return query
  with matched as (
    select
      pc.id as catalog_id,
      pc.name,
      pc.branch_name,
      pc.road_address,
      pc.address,
      pc.region_1,
      pc.region_2,
      pc.provider_category,
      p.map_url,
      case
        when strpos(
          lower(regexp_replace(btrim(coalesce(pc.branch_name,'')),'[[:space:]]+','','g')),
          '본점'
        ) > 0
          or right(pc.normalized_name,2)='본점'
          then 0
        when btrim(coalesce(pc.region_1,'')) in ('서울','서울특별시')
          then 1
        when btrim(coalesce(pc.region_1,'')) like '%광역시'
          or btrim(coalesce(pc.region_1,'')) in ('부산','대구','인천','광주','대전','울산')
          then 2
        when btrim(coalesce(pc.region_1,'')) in ('경기','경기도')
          then 3
        else 4
      end as sort_rank,
      coalesce(nullif(btrim(pc.branch_name),''),pc.name) as sort_branch
    from public.place_catalog pc
    cross join lateral (
      select private.store_catalog_search_text(pc.normalized_name,pc.branch_name) as search_text
    ) s
    left join public.places p
      on p.place_provider=pc.place_provider
     and p.provider_place_id=pc.provider_place_id
     and p.is_visible
    where pc.business_status='open'
      and private.place_name_bigrams(s.search_text) @> v_grams
      and strpos(s.search_text,v_query) > 0
  ),
  page_plus as (
    select m.*
    from matched m
    where v_cursor_id is null
       or m.sort_rank > v_cursor_rank
       or (
         m.sort_rank = v_cursor_rank
         and m.sort_branch collate "C" > v_cursor_branch collate "C"
       )
       or (
         m.sort_rank = v_cursor_rank
         and m.sort_branch collate "C" = v_cursor_branch collate "C"
         and m.name collate "C" > v_cursor_name collate "C"
       )
       or (
         m.sort_rank = v_cursor_rank
         and m.sort_branch collate "C" = v_cursor_branch collate "C"
         and m.name collate "C" = v_cursor_name collate "C"
         and m.catalog_id > v_cursor_id
       )
    order by
      m.sort_rank,
      m.sort_branch collate "C",
      m.name collate "C",
      m.catalog_id
    limit (v_limit + 1)
  ),
  page_rows as (
    select p.*
    from page_plus p
    order by
      p.sort_rank,
      p.sort_branch collate "C",
      p.name collate "C",
      p.catalog_id
    limit v_limit
  )
  select
    r.catalog_id,
    r.name,
    r.branch_name,
    r.road_address,
    r.address,
    r.region_1,
    r.region_2,
    r.provider_category,
    r.map_url,
    case
      when exists(select 1 from page_plus offset v_limit)
      then (
        select encode(
          convert_to(
            jsonb_build_object(
              'q',v_query,
              'r',lr.sort_rank,
              'b',lr.sort_branch,
              'n',lr.name,
              'i',lr.catalog_id
            )::text,
            'UTF8'
          ),
          'hex'
        )
        from page_rows lr
        order by
          lr.sort_rank desc,
          lr.sort_branch collate "C" desc,
          lr.name collate "C" desc,
          lr.catalog_id desc
        limit 1
      )
      else null
    end as next_cursor
  from page_rows r
  order by
    r.sort_rank,
    r.sort_branch collate "C",
    r.name collate "C",
    r.catalog_id;
end;
$$;

revoke all on function public.search_store_catalog_page(text,text,integer)
  from public, anon, authenticated;
grant execute on function public.search_store_catalog_page(text,text,integer)
  to anon, authenticated;

comment on function public.search_store_catalog_page(text,text,integer) is
  'Figma 75-1 store search: name+branch substring search, deterministic headquarters/region/branch ordering, max 20 rows per opaque query-bound cursor page; next_cursor null means end.';

commit;
