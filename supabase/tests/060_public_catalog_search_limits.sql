begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private','external_catalog_caller_limits','catalog caller quota table exists');
select has_function('public','consume_external_catalog_search',array['text','text'],'server quota function exists');
select ok(
  not has_function_privilege('authenticated','public.consume_external_catalog_search(text,text)','execute'),
  'clients cannot invoke the catalog quota RPC directly'
);
select ok(
  not has_table_privilege('authenticated','private.external_catalog_caller_limits','select'),
  'clients cannot inspect caller hashes or quota counters'
);

set local role service_role;
select ok(
  (select bool_and(public.consume_external_catalog_search('tmdb',repeat('a',64)))
   from generate_series(1,60)),
  'first sixty provider-search requests per caller/hour are allowed'
);
select ok(
  not public.consume_external_catalog_search('tmdb',repeat('a',64)),
  'sixty-first provider-search request is denied'
);
select ok(
  public.consume_external_catalog_search('igdb',repeat('a',64)),
  'provider quotas are isolated'
);
reset role;

insert into public.external_catalog_cache(provider,cache_key,payload,fetched_at) values
  ('tmdb',repeat('b',64),'[]'::jsonb,clock_timestamp()-interval '36 days'),
  ('tmdb',repeat('c',64),'[]'::jsonb,clock_timestamp());

select lives_ok(
  $$select private.cleanup_external_catalog_security_state()$$,
  'security cleanup can purge stale cache and caller quota state'
);
select ok(
  not exists(select 1 from public.external_catalog_cache where provider='tmdb' and cache_key=repeat('b',64)),
  'stale external catalog cache is removed'
);
select ok(
  exists(select 1 from public.external_catalog_cache where provider='tmdb' and cache_key=repeat('c',64)),
  'fresh external catalog cache is retained'
);
select ok(
  exists(select 1 from cron.job where jobname='onepick-external-catalog-security-cleanup'),
  'daily catalog security cleanup cron is scheduled'
);

select * from finish();
rollback;
