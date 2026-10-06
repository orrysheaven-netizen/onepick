begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public', 'search_item_pick_counts', array['uuid[]'],
  'search_item_pick_counts(uuid[]) exists');
select function_lang_is('public', 'search_item_pick_counts', array['uuid[]'], 'sql');
select volatility_is('public', 'search_item_pick_counts', array['uuid[]'], 'stable');
select is_definer('public', 'search_item_pick_counts', array['uuid[]'], false,
  'search aggregate is security invoker');

select ok(has_function_privilege('anon', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'anon can execute public search aggregate');
select ok(has_function_privilege('authenticated', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'authenticated can execute public search aggregate');
select ok(has_function_privilege('service_role', 'public.search_item_pick_counts(uuid[])', 'EXECUTE'),
  'service role can execute public search aggregate');

select is(
  (select count(*) from public.search_item_pick_counts(array[]::uuid[])),
  0::bigint,
  'empty item list returns no rows'
);

select * from finish();
rollback;
