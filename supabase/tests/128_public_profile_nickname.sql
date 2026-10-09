begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,raw_user_meta_data,created_at,updated_at) values
  ('fa040000-0000-4000-8000-000000000001','authenticated','authenticated','nickname-a@example.invalid','', '{"name":"OAuth name","nickname":"OAuth nickname"}',now(),now()),
  ('fa040000-0000-4000-8000-000000000002','authenticated','authenticated','nickname-b@example.invalid','', '{}',now(),now()),
  ('fa040000-0000-4000-8000-000000000003','authenticated','authenticated','nickname-s@example.invalid','', '{}',now(),now()),
  ('fa040000-0000-4000-8000-000000000004','authenticated','authenticated','nickname-block@example.invalid','', '{}',now(),now()),
  ('fa040000-0000-4000-8000-000000000005','authenticated','authenticated','nickname-new@example.invalid','', '{}',now(),now());

insert into public.profiles(id,username,onboarding_completed) values
  ('fa040000-0000-4000-8000-000000000001','nickname_a',true),
  ('fa040000-0000-4000-8000-000000000002','nickname_b',true),
  ('fa040000-0000-4000-8000-000000000003','nickname_s',true),
  ('fa040000-0000-4000-8000-000000000004','nickname_block',true);

select is((select nickname from public.profiles where username='nickname_a'), null::text,
  'nickname is optional and is not copied from username or OAuth metadata');
select ok(has_column_privilege('authenticated','public.profiles','nickname','UPDATE'),
  'authenticated has nickname column UPDATE');
select ok(not has_table_privilege('authenticated','public.profiles','UPDATE'),
  'nickname does not grant table-wide UPDATE');
select ok(not has_column_privilege('authenticated','public.profiles','nickname','INSERT'),
  'signup INSERT allowlist is unchanged');
select ok(not has_column_privilege('authenticated','public.profiles','id','UPDATE'),
  'ownership cannot be rewritten');
select ok(not has_column_privilege('anon','public.profiles','nickname','UPDATE'),
  'anon has no nickname write permission');
select ok(has_column_privilege('anon','public.profiles','nickname','SELECT'),
  'existing public profile read grant covers nickname');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000001',true);
select lives_ok($$update public.profiles set nickname='오리 🍜' where id='fa040000-0000-4000-8000-000000000001'$$,
  'ordinary owner can save a Unicode nickname without admin MFA');
select is((select nickname from public.profiles where id='fa040000-0000-4000-8000-000000000001'),'오리 🍜',
  'nickname round-trips');
select is((select username from public.profiles where id='fa040000-0000-4000-8000-000000000001'),'nickname_a',
  'saving nickname preserves username and profile URL identifier');
with changed as (update public.profiles set nickname='forged' where id='fa040000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from changed),0,
  'another visible user cannot be edited');
select lives_ok($$update public.profiles set nickname=repeat('가',15) where id='fa040000-0000-4000-8000-000000000001'$$,
  'approved 15-character nickname is accepted');
select is((select char_length(nickname) from public.profiles where id='fa040000-0000-4000-8000-000000000001'),15,
  '15-character nickname is stored intact');
select throws_ok($$update public.profiles set nickname=repeat('가',16) where id='fa040000-0000-4000-8000-000000000001'$$,
  '23514',null,'16-character nickname is rejected by DB');
select is((select char_length(nickname) from public.profiles where id='fa040000-0000-4000-8000-000000000001'),15,
  'rejected update preserves previous nickname');
select throws_ok($$update public.profiles set nickname=repeat('가',1001) where id='fa040000-0000-4000-8000-000000000001'$$,
  '23514',null,'oversized nickname is rejected');
select lives_ok($$update public.profiles set nickname='🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜🍜' where id='fa040000-0000-4000-8000-000000000001'$$,
  '15 single-codepoint emoji are accepted');
select lives_ok($$update public.profiles set nickname=null where id='fa040000-0000-4000-8000-000000000001'$$,
  'owner can clear their nickname');
select is((select nickname from public.profiles where id='fa040000-0000-4000-8000-000000000001'),null::text,
  'clearing leaves nickname unset');
update public.profiles set nickname='같은 이름' where id='fa040000-0000-4000-8000-000000000001';
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000002',true);
select is((select nickname from public.profiles where id='fa040000-0000-4000-8000-000000000002'),null::text,
  'attempted cross-account update left the target unchanged');
select lives_ok($$update public.profiles set nickname='같은 이름' where id='fa040000-0000-4000-8000-000000000002'$$,
  'different users may choose the same display name');
reset role;

-- A profile can still be created with the existing signup columns only.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000005',true);
select lives_ok($$insert into public.profiles(id,username,onboarding_completed) values ('fa040000-0000-4000-8000-000000000005','nickname_new',true)$$,
  'existing signup works without nickname');
select lives_ok($$update public.profiles set nickname='새 사용자' where id='fa040000-0000-4000-8000-000000000005'$$,
  'new account can set nickname after profile creation');
reset role;

-- Seed moderation as a fixture owner, then create the reverse block as its
-- authenticated owner, as required by the existing prepare_user_block trigger.
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','',true);
update public.profiles set nickname='숨겨진 이름' where id in
  ('fa040000-0000-4000-8000-000000000003','fa040000-0000-4000-8000-000000000004');
insert into private.user_moderation(user_id,reason,suspended_at)
values ('fa040000-0000-4000-8000-000000000003','nickname security fixture',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000004',true);
insert into public.user_blocks(blocker_user_id,blocked_user_id,blocked_username_snapshot)
values ('fa040000-0000-4000-8000-000000000004','fa040000-0000-4000-8000-000000000001','ignored');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000001',true);
select is((select nickname from public.profiles where id='fa040000-0000-4000-8000-000000000002'),'같은 이름',
  'authenticated viewer can read a visible public nickname');
select is((select count(*)::integer from public.profiles where id='fa040000-0000-4000-8000-000000000003'),0,
  'suspended target nickname stays hidden');
select is((select count(*)::integer from public.profiles where id='fa040000-0000-4000-8000-000000000004'),0,
  'reverse-blocked target nickname stays hidden');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa040000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','fa040000-0000-4000-8000-000000000003',true);
select throws_ok($$update public.profiles set nickname='정지 중 수정' where id='fa040000-0000-4000-8000-000000000003'$$,
  '42501','USER_SUSPENDED','suspended owner cannot change nickname');
select throws_ok($$update public.profiles set nickname=null where id='fa040000-0000-4000-8000-000000000003'$$,
  '42501','USER_SUSPENDED','suspended owner cannot clear nickname');
reset role;

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.jwt.claim.sub','',true);
select is((select nickname from public.profiles where id='fa040000-0000-4000-8000-000000000002'),'같은 이름',
  'anon can read an already-public profile nickname');
select is((select count(*)::integer from public.profiles where id='fa040000-0000-4000-8000-000000000003'),0,
  'anon cannot read suspended profile nickname');
select throws_ok($$update public.profiles set nickname='anon edit' where id='fa040000-0000-4000-8000-000000000002'$$,
  '42501',null,'anon cannot write nickname');
reset role;

select * from finish();
rollback;
