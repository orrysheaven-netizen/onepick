begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) values
('8a111111-1111-4111-8111-111111111111','authenticated','authenticated','ops-user@example.com','',now(),now()),
('8b222222-2222-4222-8222-222222222222','authenticated','authenticated','ops-admin@example.com','',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
('8a111111-1111-4111-8111-111111111111','ops_user',true),
('8b222222-2222-4222-8222-222222222222','ops_admin',true);
insert into private.admin_users(user_id) values('8b222222-2222-4222-8222-222222222222');

set local role authenticated;
-- Real administrator data access now also requires AAL2; model a stepped-up
-- session for the whole transaction (harmless for the ordinary user checked
-- first, since the AAL2 gate also requires admin-list membership).
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('request.jwt.claim.sub','8a111111-1111-4111-8111-111111111111',true);

select lives_ok($$insert into public.client_error_events(user_id,context,error_code,platform,app_version)
values('8a111111-1111-4111-8111-111111111111','root_error_boundary','UNEXPECTED_ERROR','ios','1.0.0')$$,'user can write own sanitized error event');
select is((select count(*)::int from public.client_error_events),0,'ordinary user cannot read client error events');
select is((select count(*)::int from public.admin_audit_logs),0,'ordinary user cannot read admin audit logs');
select throws_ok($$insert into public.client_error_events(user_id,context,error_code)
values('8b222222-2222-4222-8222-222222222222','root_error_boundary','UNEXPECTED_ERROR')$$,'42501',null,'user cannot write another user error event');
select throws_ok($$insert into public.admin_audit_logs(entity_type,entity_id,action)
values('category',gen_random_uuid(),'insert')$$,'42501',null,'client cannot forge admin audit logs');
select ok(not has_function_privilege('authenticated','private.log_admin_audit()','EXECUTE'),'audit trigger function is not client executable');

select set_config('request.jwt.claim.sub','8b222222-2222-4222-8222-222222222222',true);
select is((select count(*)::int from public.client_error_events),1,'admin can read client error events');
select lives_ok($$insert into public.categories(id,name,slug,status,is_visible,is_pickable,sort_order)
values('8c333333-3333-4333-8333-333333333333','Ops Category','ops-category','draft',false,false,9997)$$,'admin category insert succeeds');
select is((select count(*)::int from public.admin_audit_logs where entity_id='8c333333-3333-4333-8333-333333333333'),1,'admin change creates audit log');
select is((select summary->>'name' from public.admin_audit_logs where entity_id='8c333333-3333-4333-8333-333333333333' order by created_at limit 1),'Ops Category','audit log stores safe entity summary');

reset role;
select set_config('request.jwt.claim.sub','8b222222-2222-4222-8222-222222222222',true);
delete from public.categories where id='8c333333-3333-4333-8333-333333333333';
select is((select count(*)::int from public.admin_audit_logs where entity_id='8c333333-3333-4333-8333-333333333333' and action='delete'),1,'delete path is audited safely');

select * from finish();
rollback;
