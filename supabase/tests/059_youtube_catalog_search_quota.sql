begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_function_privilege('authenticated','public.reserve_youtube_catalog_search(uuid,text)','execute'),
  'authenticated clients cannot invoke the YouTube quota reservation directly'
);
select ok(
  not has_table_privilege('authenticated','public.youtube_catalog_search_limits','select'),
  'authenticated clients cannot inspect YouTube quota subjects or counters'
);

set local role service_role;

select ok(
  (select bool_and(public.reserve_youtube_catalog_search(
    'f9300000-0000-4000-8000-000000000001', null
  )) from generate_series(1,20)),
  'first twenty searches per user/hour are allowed'
);
select ok(
  not public.reserve_youtube_catalog_search(
    'f9300000-0000-4000-8000-000000000001', null
  ),
  'twenty-first search for one user is denied'
);

delete from public.youtube_catalog_search_limits;

select ok(
  (select bool_and(public.reserve_youtube_catalog_search(
    gen_random_uuid(), repeat('a',64)
  )) from generate_series(1,50)),
  'first fifty searches per hashed caller IP/hour are allowed'
);
select ok(
  not public.reserve_youtube_catalog_search(
    gen_random_uuid(), repeat('a',64)
  ),
  'fifty-first search for one hashed caller IP is denied'
);
select ok(
  not public.reserve_youtube_catalog_search(
    gen_random_uuid(), '203.0.113.10'
  ),
  'raw or malformed caller addresses are rejected by the reservation boundary'
);

update public.youtube_catalog_search_limits
set window_started_at=statement_timestamp()-interval '2 hours'
where scope='ip' and subject=repeat('a',64);

select ok(
  public.reserve_youtube_catalog_search(
    gen_random_uuid(), repeat('a',64)
  ),
  'IP quota resets after one hour'
);

reset role;

select * from finish();
rollback;
