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
select set_config('test.hdq_food_leaf',(select id::text from hdq_ids where key='food_leaf'),true);

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f1240000-0000-4000-8000-000000000001','authenticated','authenticated','hdq-admin@example.invalid','',now(),now()),
  ('f1240000-0000-4000-8000-000000000002','authenticated','authenticated','hdq-user@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f1240000-0000-4000-8000-000000000001','hdq_admin',true),
  ('f1240000-0000-4000-8000-000000000002','hdq_user',true);
insert into private.admin_users(user_id) values ('f1240000-0000-4000-8000-000000000001');

insert into public.categories(id,name,slug,status,is_visible,is_pickable)
values ('f1241000-0000-4000-8000-000000000001','HDQ non-food','hdq-non-food','open',true,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);

update public.home_settings
set daily_question_category_id=current_setting('test.hdq_food_leaf')::uuid
where id;
select is(
  (select daily_question_category_id from public.home_settings where id),
  current_setting('test.hdq_food_leaf')::uuid,
  'AAL2 admin can store a valid open food leaf'
);

select throws_ok(
  $sql$update public.home_settings set daily_question_category_id='f1241000-0000-4000-8000-000000000001'::uuid where id$sql$,
  'P0001','HOME_DAILY_QUESTION_CATEGORY_INVALID',
  'non-food category is rejected'
);

select set_config('request.jwt.claim.sub','f1240000-0000-4000-8000-000000000002',true);
select lives_ok(
  $sql$update public.home_settings set daily_question_category_id=null where id$sql$,
  'ordinary authenticated update is filtered by RLS without privilege error'
);
select is(
  (select daily_question_category_id from public.home_settings where id),
  current_setting('test.hdq_food_leaf')::uuid,
  'ordinary user cannot change the setting'
);

reset role;

delete from public.categories where id=current_setting('test.hdq_food_leaf')::uuid;
select is(
  (select daily_question_category_id from public.home_settings where id),
  null::uuid,
  'category deletion clears the setting via on delete set null'
);

select * from finish();
rollback;
