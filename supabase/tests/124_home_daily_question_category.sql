begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public','home_settings','daily_question_category_id',
  'home_settings has daily question category setting');

select ok(has_table_privilege('anon','public.home_settings','SELECT'),
  'anon can read home settings');
select ok(has_table_privilege('authenticated','public.home_settings','SELECT'),
  'authenticated can read home settings');
select ok(has_column_privilege('authenticated','public.home_settings','daily_question_category_id','UPDATE'),
  'authenticated role has column update grant; admin RLS still gates rows');

select ok(
  not has_function_privilege('anon','private.validate_home_daily_question_category()','EXECUTE'),
  'anon cannot execute validator directly'
);
select ok(
  not has_function_privilege('authenticated','private.validate_home_daily_question_category()','EXECUTE'),
  'authenticated cannot execute validator directly'
);

create temp table hdq_ids(key text primary key, id uuid not null) on commit drop;
insert into hdq_ids
select 'food_leaf', c.id
from public.categories c
where public.category_is_open_leaf(c.id)
  and private.category_is_food(c.id)
limit 1;

select ok((select count(*)=1 from hdq_ids), 'fixture has an open food leaf');

update public.home_settings
set daily_question_category_id=(select id from hdq_ids where key='food_leaf')
where id;
select is(
  (select daily_question_category_id from public.home_settings where id),
  (select id from hdq_ids where key='food_leaf'),
  'valid open food leaf can be stored'
);

delete from public.categories where id=(select id from hdq_ids where key='food_leaf');
select is(
  (select daily_question_category_id from public.home_settings where id),
  null::uuid,
  'category deletion clears the setting via on delete set null'
);

select * from finish();
rollback;
