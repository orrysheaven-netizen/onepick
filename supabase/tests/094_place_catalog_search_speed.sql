begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create temporary table pss_ids(key text primary key, id uuid not null) on commit drop;
grant select on pss_ids to anon, authenticated;

do $fixtures$
declare
  v_cat uuid := gen_random_uuid();
  v_suffix text := substr(replace(gen_random_uuid()::text,'-',''),1,10);
begin
  insert into public.categories(id,name,slug,status,is_visible,is_pickable)
    values(v_cat,'검색 속도 테스트','pss-'||v_suffix,'open',true,true);
  insert into public.category_catalog_sources(category_id,mode,is_enabled,place_catalog_enabled,notes)
    values(v_cat,'internal',true,true,'search speed test');
  insert into public.place_catalog(place_provider,provider_place_id,name,normalized_name,road_address,business_status,closed_at) values
    ('psstest','exact-'||v_suffix,'뷁뛟곰탕','뷁뛟곰탕','서울 1','open',null),
    ('psstest','prefix-'||v_suffix,'뷁뛟곰탕 본점','뷁뛟곰탕본점','서울 2','open',null),
    ('psstest','contains-'||v_suffix,'원조뷁뛟곰탕','원조뷁뛟곰탕','서울 3','open',null),
    ('psstest','fuzzy-'||v_suffix,'뷁뛟곰탄','뷁뛟곰탄','서울 4','open',null),
    ('psstest','closed-'||v_suffix,'뷁뛟곰탕 폐점','뷁뛟곰탕폐점','서울 5','closed',now()),
    ('psstest','short-'||v_suffix,'뷁뛟','뷁뛟','서울 6','open',null);
  insert into pss_ids values ('cat',v_cat);
end;
$fixtures$;

select is(
  private.place_name_bigrams('속도곰탕'),
  array['곰탕','도곰','속도'],
  'Names are indexed by their distinct 2-character grams'
);

select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='place_catalog_name_bigrams'
         and indexdef like '%place_name_bigrams(normalized_name)%'),
  'The bigram GIN index backs substring search'
);

set local role anon;

select is(
  (select array_agg(split_part(s.provider_place_id,'-',1) order by s.ord)
     from public.search_place_catalog((select id from pss_ids where key='cat'),'뷁뛟 곰탕',20) with ordinality as s(
       catalog_id,place_provider,provider_place_id,name,branch_name,road_address,address,region_1,region_2,
       latitude,longitude,provider_category,existing_item_id,ord)
     where s.place_provider='psstest'),
  array['exact','prefix','contains','fuzzy','short'],
  'Exact, prefix, contains, then similar names by score — closed places never appear'
);

select is(
  (select array_agg(split_part(s.provider_place_id,'-',1) order by s.ord)
     from public.search_place_catalog((select id from pss_ids where key='cat'),'뷁뛟',20) with ordinality as s(
       catalog_id,place_provider,provider_place_id,name,branch_name,road_address,address,region_1,region_2,
       latitude,longitude,provider_category,existing_item_id,ord)
     where s.place_provider='psstest'),
  array['short','fuzzy','exact','prefix','contains'],
  '2-character queries use the bigram index; every name starting with the query ranks as a prefix match'
);

select is(
  (select count(*)::int from public.search_place_catalog((select id from pss_ids where key='cat'),'뷁뛟곰탕',2)),
  2,
  'The limit is still honoured'
);

select is(
  (select count(*)::int from public.search_place_catalog((select id from pss_ids where key='cat'),'뷁',20)),
  0,
  'One-character queries still return nothing'
);

select is(
  (select current_setting('pg_trgm.similarity_threshold', true)
     from (select count(*) from public.search_place_catalog((select id from pss_ids where key='cat'),'뷁뛟곰탄',20)) x),
  coalesce(current_setting('pg_trgm.similarity_threshold', true), '0.3'),
  'The trigram threshold used for fuzzy matches is restored after the call'
);

reset role;

select ok(
  has_function_privilege('anon','public.search_place_catalog(uuid,text,integer)','execute')
  and has_function_privilege('anon','private.place_name_bigrams(text)','execute'),
  'Guests can still search places'
);

select * from finish();
rollback;
