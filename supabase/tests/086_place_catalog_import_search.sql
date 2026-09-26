begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

set local role service_role;

select is(
  (private.stage_place_import_batch(
    'sbiz',
    '2026-09-25T00:00:00Z',
    jsonb_build_array(
      jsonb_build_object(
        'provider_place_id','PGTAP-SBIZ-DAECHANG-OPEN',
        'payload',jsonb_build_object(
          'name','서울 대창 본점',
          'road_address','서울특별시 강남구 테스트로 1',
          'region_1','서울특별시',
          'region_2','강남구',
          'latitude',37.5001,
          'longitude',127.0001,
          'provider_category','곱창·막창·양',
          'business_status','open'
        )
      ),
      jsonb_build_object(
        'provider_place_id','PGTAP-SBIZ-DAECHANG-CLOSED',
        'payload',jsonb_build_object(
          'name','서울 대창 폐점',
          'road_address','서울특별시 마포구 테스트로 2',
          'region_1','서울특별시',
          'region_2','마포구',
          'latitude',37.5501,
          'longitude',126.9501,
          'provider_category','곱창·막창·양',
          'business_status','closed'
        )
      )
    )
  )->>'inserted_count')::integer,
  2,
  'SBIZ import batch stages open and closed rows'
);

select is(
  (
    select count(*)::integer
    from private.place_import_raw
    where place_provider='sbiz'
      and provider_place_id in (
        'PGTAP-SBIZ-DAECHANG-OPEN',
        'PGTAP-SBIZ-DAECHANG-CLOSED'
      )
      and source_updated_at='2026-09-25T00:00:00Z'
  ),
  2,
  'raw staging contains the test snapshot'
);

select is(
  private.promote_place_imports('sbiz'),
  2,
  'promotion writes the two latest SBIZ rows'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.search_place_catalog(
      (select id from public.categories where slug='daechang' limit 1),
      '대창',
      20
    )
    where name='서울 대창 본점'
  ),
  1,
  'search_place_catalog returns the open daechang row'
);

select is(
  (
    select count(*)::integer
    from public.search_place_catalog(
      (select id from public.categories where slug='daechang' limit 1),
      '대창',
      20
    )
    where name='서울 대창 폐점'
  ),
  0,
  'search_place_catalog excludes closed rows'
);

set local role service_role;

select is(
  (private.stage_place_import_batch(
    'sbiz',
    '2026-09-25T00:00:00Z',
    jsonb_build_array(
      jsonb_build_object(
        'provider_place_id','PGTAP-SBIZ-DAECHANG-OPEN',
        'payload',jsonb_build_object('name','replayed open row')
      ),
      jsonb_build_object(
        'provider_place_id','PGTAP-SBIZ-DAECHANG-CLOSED',
        'payload',jsonb_build_object('name','replayed closed row')
      )
    )
  )->>'existing_count')::integer,
  2,
  'replaying the same provider snapshot is idempotent'
);

select is(
  private.promote_place_imports('sbiz'),
  0,
  're-promoting an unchanged snapshot is idempotent'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.place_catalog
    where place_provider='sbiz'
      and provider_place_id in (
        'PGTAP-SBIZ-DAECHANG-OPEN',
        'PGTAP-SBIZ-DAECHANG-CLOSED'
      )
  ),
  2,
  'promotion preserves one catalog row per provider identity'
);

select * from finish();
rollback;
