begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_external_catalog_caller(text,uuid,text)',
    'execute'
  ),
  'clients cannot reserve public-catalog caller quota directly'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.external_catalog_caller_limits',
    'select'
  ),
  'clients cannot inspect caller quota subjects or counters'
);

set local role service_role;

select ok(
  (select bool_and(public.reserve_external_catalog_caller(
    'tmdb',
    'f9900000-0000-4000-8000-000000000001',
    null
  )) from generate_series(1,60)),
  'first sixty searches per authenticated user/provider/hour are allowed'
);
select ok(
  not public.reserve_external_catalog_caller(
    'tmdb',
    'f9900000-0000-4000-8000-000000000001',
    null
  ),
  'sixty-first search for one user/provider is denied'
);

delete from public.external_catalog_caller_limits;

select ok(
  (select bool_and(public.reserve_external_catalog_caller(
    'google_books',
    null,
    repeat('a',64)
  )) from generate_series(1,120)),
  'first 120 anonymous searches per hashed IP/provider/hour are allowed'
);
select ok(
  not public.reserve_external_catalog_caller(
    'google_books',
    null,
    repeat('a',64)
  ),
  '121st anonymous search for one hashed IP/provider is denied'
);
select ok(
  not public.reserve_external_catalog_caller(
    'igdb',
    null,
    '203.0.113.10'
  ),
  'raw IP strings are rejected by the DB reservation boundary'
);

insert into public.external_catalog_cache(provider,cache_key,payload,fetched_at) values
  ('tmdb',repeat('b',64),'[]'::jsonb,statement_timestamp()-interval '25 hours'),
  ('tmdb',repeat('c',64),'[]'::jsonb,statement_timestamp());

select lives_ok(
  $$select private.prune_external_catalog_cache()$$,
  'scheduled cache prune executes'
);
select ok(
  not exists(
    select 1 from public.external_catalog_cache
    where provider='tmdb' and cache_key=repeat('b',64)
  ),
  'search cache older than 24 hours is removed'
);
select ok(
  exists(
    select 1 from public.external_catalog_cache
    where provider='tmdb' and cache_key=repeat('c',64)
  ),
  'fresh search cache is retained'
);
select ok(
  exists(
    select 1 from cron.job
    where jobname='onepick-prune-external-catalog-cache'
  ),
  'hourly external-catalog cache prune is scheduled'
);

reset role;

select * from finish();
rollback;
