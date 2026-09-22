begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  has_function_privilege('service_role','private.stage_place_import_batch(text,timestamptz,jsonb)','EXECUTE'),
  'service_role can stage provider batches'
);
select ok(
  not has_function_privilege('authenticated','private.stage_place_import_batch(text,timestamptz,jsonb)','EXECUTE'),
  'authenticated cannot stage provider batches'
);
select ok(
  not has_function_privilege('anon','private.stage_place_import_batch(text,timestamptz,jsonb)','EXECUTE'),
  'anon cannot stage provider batches'
);

set local role service_role;

select is(
  (private.stage_place_import_batch(
    'sbiz',
    '2026-09-01T00:00:00Z',
    jsonb_build_array(
      jsonb_build_object(
        'provider_place_id','S-1',
        'payload',jsonb_build_object(
          'name','테스트 곱창',
          'road_address','서울 테스트로 1',
          'region_1','서울특별시',
          'region_2','강남구',
          'latitude',37.5,
          'longitude',127.0,
          'provider_category','한식',
          'business_status','open'
        )
      ),
      jsonb_build_object(
        'provider_place_id','S-2',
        'payload',jsonb_build_object(
          'name','테스트 국밥',
          'road_address','서울 테스트로 2',
          'region_1','서울특별시',
          'region_2','마포구',
          'latitude',37.55,
          'longitude',126.95,
          'provider_category','한식',
          'business_status','open'
        )
      )
    )
  )->>'inserted_count')::integer,
  2,
  'two normalized rows are staged'
);

select is(
  (select count(*)::integer from private.place_import_raw where place_provider='sbiz'),
  2,
  'staging contains the two rows'
);

select is(
  (private.stage_place_import_batch(
    'sbiz',
    '2026-09-01T00:00:00Z',
    jsonb_build_array(
      jsonb_build_object('provider_place_id','S-1','payload',jsonb_build_object('name','ignored replay')),
      jsonb_build_object('provider_place_id','S-2','payload',jsonb_build_object('name','ignored replay'))
    )
  )->>'existing_count')::integer,
  2,
  'replaying the same provider snapshot is idempotent'
);

select is(
  (select count(*)::integer from private.place_import_raw where place_provider='sbiz'),
  2,
  'idempotent replay does not duplicate staging'
);

select throws_ok(
  $$select private.stage_place_import_batch(
    'sbiz',
    '2026-09-01T00:00:00Z',
    '[{"provider_place_id":"DUP","payload":{"name":"a"}},{"provider_place_id":"DUP","payload":{"name":"b"}}]'::jsonb
  )$$,
  'P0001',
  'PLACE_IMPORT_BATCH_DUPLICATE',
  'duplicate provider IDs inside one batch are rejected'
);

select throws_ok(
  $$select private.stage_place_import_batch(
    'sbiz',
    '2099-01-01T00:00:00Z',
    '[{"provider_place_id":"FUTURE","payload":{"name":"a"}}]'::jsonb
  )$$,
  'P0001',
  'SOURCE_UPDATED_AT_INVALID',
  'future source timestamps are rejected'
);

select throws_ok(
  $$select private.stage_place_import_batch(
    'sbiz',
    '2026-09-01T00:00:00Z',
    '[{"provider_place_id":"","payload":{"name":"a"}}]'::jsonb
  )$$,
  'P0001',
  'PLACE_IMPORT_ROW_INVALID',
  'blank provider IDs are rejected'
);

reset role;

select * from finish();
rollback;
