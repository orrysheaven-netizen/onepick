begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select ok(
  exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and indexname='place_catalog_store_search_bigrams'
      and indexdef like '%store_catalog_search_text%'
  ),
  'Combined store + branch search has a bigram GIN index'
);

select ok(
  has_function_privilege('anon','public.search_store_catalog_page(text,text,integer)','execute')
  and has_function_privilege('authenticated','public.search_store_catalog_page(text,text,integer)','execute'),
  'Guests and members can use paged store search'
);

select ok(
  has_function_privilege('anon','public.search_store_catalog(text,integer)','execute')
  and has_function_privilege('authenticated','public.search_store_catalog(text,integer)','execute'),
  'The existing store search RPC remains callable for compatibility'
);

do $fixtures$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  -- 41 open rows for the same store name, spread across every confirmed region
  -- rank. One extra closed row proves the page contract is not leaking it.
  insert into public.place_catalog(
    place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,region_1,region_2,business_status,closed_at
  )
  select
    'ssp',
    'page-'||v_suffix||'-'||g,
    '페이징상호',
    '페이징상호',
    case
      when g=1 then '본점'
      when g between 2 and 11 then '서울'||lpad((g-1)::text,2,'0')||'점'
      when g between 12 and 21 then '광역'||lpad((g-11)::text,2,'0')||'점'
      when g between 22 and 31 then '경기'||lpad((g-21)::text,2,'0')||'점'
      else '기타'||lpad((g-31)::text,2,'0')||'점'
    end,
    '테스트 주소 '||g,
    case
      when g=1 then '경기도'
      when g between 2 and 11 then '서울특별시'
      when g between 12 and 21 then '부산광역시'
      when g between 22 and 31 then '경기도'
      else '강원특별자치도'
    end,
    '테스트구',
    'open',
    null
  from generate_series(1,41) g;

  insert into public.place_catalog(
    place_provider,provider_place_id,name,normalized_name,branch_name,
    road_address,region_1,region_2,business_status,closed_at
  ) values (
    'ssp','page-'||v_suffix||'-closed','페이징상호','페이징상호','폐점',
    '테스트 폐점','서울특별시','테스트구','closed',now()
  );

  -- Sorting fixture: branch_name can be absent in source data, so a store whose
  -- normalized name ends in "본점" must still lead.
  insert into public.place_catalog(
    place_provider,provider_place_id,name,normalized_name,branch_name,region_1,business_status
  ) values
    ('ssp','sort-'||v_suffix||'-hq','정렬상호 본점','정렬상호본점',null,'제주특별자치도','open'),
    ('ssp','sort-'||v_suffix||'-seoul-na','정렬상호','정렬상호','나점','서울특별시','open'),
    ('ssp','sort-'||v_suffix||'-seoul-ga','정렬상호','정렬상호','가점','서울특별시','open'),
    ('ssp','sort-'||v_suffix||'-metro','정렬상호','정렬상호','다점','인천광역시','open'),
    ('ssp','sort-'||v_suffix||'-gyeonggi','정렬상호','정렬상호','라점','경기도','open'),
    ('ssp','sort-'||v_suffix||'-other','정렬상호','정렬상호','마점','충청북도','open');
end;
$fixtures$;

select is(
  (select count(*)::int
   from public.search_store_catalog_page('정렬상호 나점',null,20)),
  1,
  'A query combining store and branch name finds the branch'
);

select is(
  (
    select array_agg(coalesce(s.branch_name,'본점') order by s.ordinality)
    from public.search_store_catalog_page('정렬상호',null,20) with ordinality as s
  ),
  array['본점','가점','나점','다점','라점','마점']::text[],
  'Results sort headquarters, Seoul, metropolitan city, Gyeonggi, then other; same-rank branches use Korean lexical order'
);

create temporary table ssp_page1 as
select * from public.search_store_catalog_page('페이징상호',null,20);

create temporary table ssp_page2 as
select * from public.search_store_catalog_page(
  '페이징상호',
  (select next_cursor from ssp_page1 limit 1),
  20
);

create temporary table ssp_page3 as
select * from public.search_store_catalog_page(
  '페이징상호',
  (select next_cursor from ssp_page2 limit 1),
  20
);

select is(
  (select count(*)::int from ssp_page1),
  20,
  'First page contains 20 rows'
);

select ok(
  (select count(distinct next_cursor)=1 and min(next_cursor) is not null from ssp_page1),
  'First page returns one non-null opaque next cursor'
);

select is(
  (select count(*)::int from ssp_page2),
  20,
  'Second page contains the next 20 rows'
);

select ok(
  (select count(distinct next_cursor)=1 and min(next_cursor) is not null from ssp_page2),
  'Second page returns a non-null next cursor'
);

select is(
  (select count(*)::int from ssp_page3),
  1,
  'Third page contains the 41st row'
);

select is(
  (select next_cursor from ssp_page3 limit 1),
  null,
  'The final page returns next_cursor=null'
);

select is(
  (
    select count(distinct catalog_id)::int
    from (
      select catalog_id from ssp_page1
      union all
      select catalog_id from ssp_page2
      union all
      select catalog_id from ssp_page3
    ) all_pages
  ),
  41,
  'Cursor pages contain all 41 open rows without duplicates'
);

select is(
  (select count(*)::int
   from public.search_store_catalog_page('페이징상호',null,100)),
  20,
  'Page size is clamped to 20 instead of becoming a total-result cap'
);

select is(
  (
    select count(*)::int
    from public.search_store_catalog_page('페이징상호',null,20) s
    join public.place_catalog pc on pc.id=s.catalog_id
    where pc.business_status='closed'
  ),
  0,
  'Closed catalog rows stay hidden'
);

select throws_ok(
  format(
    'select * from public.search_store_catalog_page(%L,%L,20)',
    '다른검색',
    (select next_cursor from ssp_page1 limit 1)
  ),
  '22023',
  'INVALID_CURSOR',
  'A cursor cannot be reused after the normalized query changes'
);

select is(
  (select branch_name from ssp_page1 order by catalog_id limit 1) is not null,
  true,
  'Paged rows retain branch data needed by the app'
);

select * from finish();
rollback;
