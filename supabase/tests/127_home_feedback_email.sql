begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'home_settings', 'feedback_email', 'public feedback address exists');
select ok(has_column_privilege('authenticated','public.home_settings','feedback_email','UPDATE'), 'column grant exists');
select ok(not has_column_privilege('anon','public.home_settings','feedback_email','UPDATE'), 'anon has no update grant');
select ok(not has_table_privilege('authenticated','public.home_settings','INSERT'), 'no singleton insert grant');
select ok(not has_table_privilege('authenticated','public.home_settings','DELETE'), 'no singleton delete grant');

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
 ('f1270000-0000-4000-8000-000000000001','authenticated','authenticated','feedback-admin@example.invalid','',now(),now()),
 ('f1270000-0000-4000-8000-000000000002','authenticated','authenticated','feedback-user@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
 ('f1270000-0000-4000-8000-000000000001','feedback_admin',true),
 ('f1270000-0000-4000-8000-000000000002','feedback_user',true);
insert into private.admin_users(user_id) values ('f1270000-0000-4000-8000-000000000001');
update public.home_settings set feedback_email=null where id;

set local role anon;
select is((select feedback_email from public.home_settings where id), null::text, 'anon reads unconfigured value');
select throws_ok($$update public.home_settings set feedback_email='other@example.com' where id$$,
 '42501', null, 'anon cannot update');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1270000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
update public.home_settings set feedback_email='OnePick+feedback@example.com' where id;
select is((select feedback_email from public.home_settings where id), 'OnePick+feedback@example.com', 'AAL2 admin saves');
select throws_ok($$update public.home_settings set feedback_email='a@example.com?bcc=other@example.com' where id$$,
 '23514', null, 'header injection rejected');
select throws_ok($$update public.home_settings set feedback_email=E'a@example.com\r\nBcc: other@example.com' where id$$,
 '23514', null, 'CRLF rejected');
select throws_ok($$update public.home_settings set feedback_email='a@example.com,b@example.com' where id$$,
 '23514', null, 'multiple recipients rejected');
select throws_ok($$update public.home_settings set feedback_email='mailto:a@example.com' where id$$,
 '23514', null, 'URI rejected');
select throws_ok($$update public.home_settings set feedback_email='a..b@example.com' where id$$,
 '23514', null, 'empty local segment rejected');
select throws_ok($$update public.home_settings set feedback_email='a@-example.com' where id$$,
 '23514', null, 'invalid domain rejected');
select throws_ok($$update public.home_settings set feedback_email='' where id$$,
 '23514', null, 'empty string rejected (use NULL)');
select throws_ok($$update public.home_settings set feedback_email=repeat('a',65)||'@example.com' where id$$,
 '23514', null, 'oversized local part rejected');

select set_config('request.jwt.claims','{"aal":"aal1"}',true);
update public.home_settings set feedback_email='other@example.com' where id;
select is((select feedback_email from public.home_settings where id), 'OnePick+feedback@example.com', 'AAL1 admin cannot modify');
select set_config('request.jwt.claims','{}',true);
update public.home_settings set feedback_email=null where id;
select is((select feedback_email from public.home_settings where id), 'OnePick+feedback@example.com', 'missing AAL cannot clear');
select set_config('request.jwt.claim.sub','f1270000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
update public.home_settings set feedback_email=null where id;
select is((select feedback_email from public.home_settings where id), 'OnePick+feedback@example.com', 'ordinary AAL2 user cannot clear');
reset role;
set local role anon;
select is((select feedback_email from public.home_settings where id), 'OnePick+feedback@example.com', 'saved address is public');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1270000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
update public.home_settings set feedback_email=null where id;
select is((select feedback_email from public.home_settings where id), null::text, 'AAL2 admin can clear');
reset role;
select * from finish();
rollback;
