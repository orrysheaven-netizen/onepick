begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public', 'home_daily_question', array[]::text[], 'Daily question RPC exists');
select ok(has_function_privilege('anon', 'public.home_daily_question()', 'EXECUTE'), 'Guests may read the daily question');
select ok(has_function_privilege('authenticated', 'public.home_daily_question()', 'EXECUTE'), 'Members may read the same daily question');
select ok(not exists (
  select 1 from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.home_daily_question()'::regprocedure and a.grantee = 0
), 'No blanket PUBLIC execute grant');

select ok(exists (select 1 from public.categories c where public.category_is_open_leaf(c.id) and private.category_is_food(c.id)),
  'Seed catalog contains an eligible food menu');
select set_config('test.daily_menu', public.home_daily_question()::text, true);
select ok(public.category_is_open_leaf(current_setting('test.daily_menu')::uuid)
  and private.category_is_food(current_setting('test.daily_menu')::uuid), 'Result is a public open food leaf');

-- Existing administrator configuration is deliberately irrelevant.
update public.home_settings set daily_question_category_id = null where id;
select is(public.home_daily_question()::text, current_setting('test.daily_menu'), 'No administrator configuration is required');

set local role anon;
select is(public.home_daily_question()::text, current_setting('test.daily_menu'), 'Guest sees the same draw');
set local timezone = 'America/Los_Angeles';
select is(public.home_daily_question()::text, current_setting('test.daily_menu'), 'Session timezone cannot change the Korean day');
set local timezone = 'Asia/Seoul';
select is(public.home_daily_question()::text, current_setting('test.daily_menu'), 'Korean session sees the same draw');
select is((select count(distinct public.home_daily_question())::integer from generate_series(1, 20)), 1,
  'Reloading does not redraw during the day');
reset role;
set local role authenticated;
select is(public.home_daily_question()::text, current_setting('test.daily_menu'), 'Authenticated users share the guest draw');
reset role;

select is(public.home_daily_question(), (
  select c.id from public.categories c
  where public.category_is_open_leaf(c.id) and private.category_is_food(c.id)
  order by md5(to_char(current_timestamp at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ':' || c.id::text), c.id limit 1
), 'Server date and category ID seed the daily draw');

-- Exercise the real taxonomy helpers: hiding a leaf must immediately exclude it.
savepoint visible_menu;
update public.categories set is_visible = false
where id = current_setting('test.daily_menu')::uuid;
select ok(public.home_daily_question() is distinct from current_setting('test.daily_menu')::uuid,
  'A hidden menu is no longer selected');
rollback to savepoint visible_menu;

-- No food branch is eligible when its root is hidden, even if leaves remain open.
savepoint visible_food_root;
update public.categories set is_visible = false where slug = 'food';
select is(public.home_daily_question(), null::uuid,
  'Hidden food ancestry produces no daily question');
rollback to savepoint visible_food_root;
select is(public.home_daily_question()::text, current_setting('test.daily_menu'),
  'Restoring catalog visibility restores the same daily draw');

select * from finish();
rollback;
