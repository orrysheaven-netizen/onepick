begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create temporary table sss_ids(key text primary key, id uuid not null) on commit drop;
grant select on sss_ids to anon, authenticated;

do $fixtures$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  v_visible uuid := gen_random_uuid();
  v_hidden uuid := gen_random_uuid();
begin
  insert into public.place_catalog(place_provider,provider_place_id,name,normalized_name,road_address,business_status,closed_at) values
    ('ssstest','exact-'||v_suffix,'뷁뛟냉면','뷁뛟냉면','서울 1','open',null),
    ('ssstest','prefix-'||v_suffix,'뷁뛟냉면 본점','뷁뛟냉면본점','서울 2','open',null),
    ('ssstest','contains-'||v_suffix,'원조뷁뛟냉면','원조뷁뛟냉면','서울 3','open',null),
    ('ssstest','fuzzy-'||v_suffix,'뷁뛟냉멘','뷁뛟냉멘','서울 4','open',null),
    ('ssstest','closed-'||v_suffix,'뷁뛟냉면 폐점','뷁뛟냉면폐점','서울 5','closed',now()),
    ('ssstest','short-'||v_suffix,'뷁뛟','뷁뛟','서울 6','open',null),
    -- similarity to 뷁뛟냉면 is below 0.3: only the second (0.25–0.3) fuzzy pass finds it
    ('ssstest','weak-'||v_suffix,'뷁뛟면','뷁뛟면','서울 7','open',null);

  -- A visible place carries its map link; a hidden one must not leak it.
  insert into public.places(id,place_provider,provider_place_id,name,road_address,map_url,is_visible) values
    (v_visible,'ssstest','exact-'||v_suffix,'뷁뛟냉면','서울 1','https://naver.me/sss-visible',true),
    (v_hidden,'ssstest','prefix-'||v_suffix,'뷁뛟냉면 본점','서울 2','https://naver.me/sss-hidden',false);
end;
$fixtures$;

set local role anon;

select is(
  (select array_agg(split_part(pc.provider_place_id,'-',1) order by s.ord)
     from public.search_store_catalog('뷁뛟 냉면',20) with ordinality as s(
       catalog_id,name,branch_name,road_address,address,region_1,region_2,provider_category,map_url,ord)
     join public.place_catalog pc on pc.id = s.catalog_id and pc.place_provider = 'ssstest'),
  array['exact','prefix','contains','fuzzy','short','weak'],
  'Store search ranks exact, prefix, contains, then similar names — closed stores never appear'
);

select is(
  (select count(*)::int from public.search_store_catalog('뷁뛟냉면',2)),
  2,
  'The limit is honoured'
);

select is(
  (select count(*)::int from public.search_store_catalog('뷁',20)),
  0,
  'One-character queries return nothing'
);

select is(
  (select s.map_url from public.search_store_catalog('뷁뛟냉면',20) s
     join public.place_catalog pc on pc.id = s.catalog_id
     where pc.provider_place_id like 'exact-%' and pc.place_provider = 'ssstest'),
  'https://naver.me/sss-visible',
  'A visible place still supplies its map link'
);

select is(
  (select s.map_url from public.search_store_catalog('뷁뛟냉면',20) s
     join public.place_catalog pc on pc.id = s.catalog_id
     where pc.provider_place_id like 'prefix-%' and pc.place_provider = 'ssstest'),
  null,
  'Running as the owner never exposes a hidden place''s map link to guests'
);

select is(
  (select count(*)::int from public.search_store_catalog('뷁뛟냉면폐점',20) s
     join public.place_catalog pc on pc.id = s.catalog_id
     where pc.provider_place_id like 'closed-%'),
  0,
  'Running as the owner never exposes closed stores to guests'
);

select is(
  (select current_setting('pg_trgm.similarity_threshold', true)
     from (select count(*) from public.search_store_catalog('뷁뛟냉멘',20)) x),
  coalesce(current_setting('pg_trgm.similarity_threshold', true), '0.3'),
  'The trigram threshold used for fuzzy matches is restored after the call'
);

reset role;

select ok(
  (select prosecdef from pg_proc where oid='public.search_store_catalog(text,integer)'::regprocedure),
  'Store search runs as the owner so RLS does not block its index plans'
);

select ok(
  has_function_privilege('anon','public.search_store_catalog(text,integer)','execute')
  and has_function_privilege('authenticated','public.search_store_catalog(text,integer)','execute'),
  'Guests and members can search stores'
);

select ok(
  not has_function_privilege('anon','private.rank_open_place_catalog(text,integer)','execute')
  and not has_function_privilege('authenticated','private.rank_open_place_catalog(text,integer)','execute'),
  'The shared ranking helper is not callable directly'
);

-- More than the 200-row cap in the prefix tier: the call still answers from
-- the capped candidates, and the exact match still leads.
insert into public.place_catalog(place_provider,provider_place_id,name,normalized_name,road_address)
  select 'ssstest','bulkp-'||g,'뷁뛟냉면'||lpad(g::text,3,'0'),'뷁뛟냉면'||lpad(g::text,3,'0'),'서울' from generate_series(1,250) g;

set local role anon;
select is(
  (select array[count(*)::text, (array_agg(split_part(pc.provider_place_id,'-',1) order by s.ord))[1]]
     from public.search_store_catalog('뷁뛟냉면',20) with ordinality as s(
       catalog_id,name,branch_name,road_address,address,region_1,region_2,provider_category,map_url,ord)
     join public.place_catalog pc on pc.id = s.catalog_id),
  array['20','exact'],
  'With 250 prefix matches the search still fills the limit and the exact match leads'
);
reset role;

select * from finish();
rollback;
