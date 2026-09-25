begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('f8000000-0000-4000-8000-000000000001','authenticated','authenticated','usage-admin@example.invalid','',now(),now()),
  ('f8000000-0000-4000-8000-000000000002','authenticated','authenticated','usage-user@example.invalid','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('f8000000-0000-4000-8000-000000000001','usage_admin',true),
  ('f8000000-0000-4000-8000-000000000002','usage_user',true);
insert into private.admin_users(user_id) values('f8000000-0000-4000-8000-000000000001');

insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('item-photos','f8000000-0000-4000-8000-000000000001/usage-a.jpg','f8000000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":1000}'::jsonb),
  ('item-photos','f8000000-0000-4000-8000-000000000001/usage-b.jpg','f8000000-0000-4000-8000-000000000001','{"mimetype":"image/jpeg","size":500}'::jsonb);

create temp table usage_result(before_bytes bigint, value jsonb);
insert into usage_result(before_bytes)
select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id='item-photos';
grant all on usage_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f8000000-0000-4000-8000-000000000002','role','authenticated','aal','aal2')::text, true);
select throws_ok($$select public.admin_database_usage()$$, '42501', 'ADMIN_REQUIRED', 'non-admin cannot read database usage');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f8000000-0000-4000-8000-000000000001','role','authenticated','aal','aal1')::text, true);
select throws_ok($$select public.admin_database_usage()$$, '42501', 'ADMIN_REQUIRED', 'admin without MFA cannot read database usage');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub','f8000000-0000-4000-8000-000000000001','role','authenticated','aal','aal2')::text, true);
update usage_result set value = public.admin_database_usage();

select ok((select (value->>'database_bytes')::bigint > 0 from usage_result), 'database size is reported');
select ok(
  (select jsonb_array_length(value->'tables') between 1 and 10 from usage_result),
  'at most ten largest tables are listed'
);
select ok(
  (select bool_and(t ? 'schema' and t ? 'name' and t ? 'total_bytes' and t ? 'row_estimate')
   from usage_result, jsonb_array_elements(value->'tables') t),
  'each table row carries schema, name, size and row estimate'
);
select is(
  (select (b->>'bytes')::bigint from usage_result, jsonb_array_elements(value->'buckets') b where b->>'bucket'='item-photos'),
  (select before_bytes from usage_result),
  'bucket bytes sum the object metadata sizes'
);
select ok(
  (select (value->>'storage_bytes')::bigint >= 1500 from usage_result),
  'storage total includes every bucket'
);

reset role;
select * from finish();
rollback;
