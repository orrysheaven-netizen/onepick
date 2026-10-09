begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  to_regprocedure('public.food_menu_pick_counts(text)') is not null,
  'food menu Pick count RPC exists'
);
select ok(
  not (select prosecdef from pg_proc where oid='public.food_menu_pick_counts(text)'::regprocedure),
  'food menu Pick counts use SECURITY INVOKER'
);
select ok(
  (select 'search_path=""'=any(proconfig) from pg_proc where oid='public.food_menu_pick_counts(text)'::regprocedure),
  'food menu Pick counts keep an empty search_path'
);
select ok(has_function_privilege('anon','public.food_menu_pick_counts(text)','execute'),'anon can execute');
select ok(has_function_privilege('authenticated','public.food_menu_pick_counts(text)','execute'),'authenticated can execute');
select ok(has_function_privilege('service_role','public.food_menu_pick_counts(text)','execute'),'service_role can execute');

-- Reuse existing database data to assert the function is callable and only returns open food leaves.
set local role anon;
select lives_ok($$ select * from public.food_menu_pick_counts('offline') $$,'offline-scoped count is callable');
select ok(
  not exists (
    select 1 from public.food_menu_pick_counts('offline') f
    join public.categories c on c.id=f.category_id
    where not public.category_is_open_leaf(c.id)
  ),
  'returned categories are open leaves'
);
reset role;

select * from finish();
rollback;
