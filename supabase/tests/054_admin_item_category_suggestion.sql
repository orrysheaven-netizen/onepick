begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixture: one admin, one ordinary user who submitted an unclassified product,
-- and an AI suggestion row for that product.
insert into auth.users(id,aud,role,created_at,updated_at) values
  ('a3636363-3636-4636-8636-363636363631','authenticated','authenticated',now(),now()),
  ('a3636363-3636-4636-8636-363636363632','authenticated','authenticated',now(),now());
insert into public.profiles(id,username,onboarding_completed) values
  ('a3636363-3636-4636-8636-363636363631','suggestion_admin',true),
  ('a3636363-3636-4636-8636-363636363632','suggestion_user',true);
insert into private.admin_users(user_id) values ('a3636363-3636-4636-8636-363636363631');

set local role authenticated;
select set_config('request.jwt.claim.sub','a3636363-3636-4636-8636-363636363632',true);
create temporary table suggestion_fixture as
select id as item_id from public.submit_unclassified_item('추천 검수 테스트 상품');
reset role;

insert into public.item_category_ai_suggestions(
  item_id,user_id,item_name,category_fingerprint,payload,model_name,prompt_version
)
select
  item_id,
  'a3636363-3636-4636-8636-363636363632',
  '추천 검수 테스트 상품',
  'fixture-fingerprint',
  jsonb_build_object(
    'suggestions', jsonb_build_array(jsonb_build_object(
      'categoryId', (select id from public.categories where slug='keyboard'),
      'label', '테크 › 키보드',
      'reason', '키보드 제품명 패턴',
      'confidence', 'high'
    )),
    'needsNewCategory', false
  ),
  'fixture-model',
  'fixture-prompt'
from suggestion_fixture;

-- Admin with MFA reads the suggestion.
set local role authenticated;
select set_config('request.jwt.claim.sub','a3636363-3636-4636-8636-363636363631',true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','a3636363-3636-4636-8636-363636363631','role','authenticated','aal','aal2')::text,
  true
);
select is(
  (select (public.admin_item_category_suggestion((select item_id from suggestion_fixture)) -> 'suggestions' -> 0 ->> 'categoryId'))::uuid,
  (select id from public.categories where slug='keyboard'),
  'admin sees the suggested category for a pending item'
);
select is(
  (select public.admin_item_category_suggestion((select item_id from suggestion_fixture)) -> 'suggestions' -> 0 ->> 'confidence'),
  'high',
  'admin sees the suggestion confidence'
);
select is(
  (select public.admin_item_category_suggestion((select item_id from suggestion_fixture)) ->> 'model_name'),
  'fixture-model',
  'admin sees which model produced the suggestion'
);
select ok(
  (select public.admin_item_category_suggestion((select item_id from suggestion_fixture))) ? 'user_id' = false,
  'the response never carries the submitting user id'
);
select is(
  public.admin_item_category_suggestion('00000000-0000-4000-8000-000000000000'),
  null,
  'no suggestion row yields null rather than an error'
);

-- Admin without MFA is refused.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','a3636363-3636-4636-8636-363636363631','role','authenticated','aal','aal1')::text,
  true
);
select throws_ok(
  $$select public.admin_item_category_suggestion((select item_id from suggestion_fixture))$$,
  '42501', 'ADMIN_REQUIRED',
  'admin without MFA cannot read suggestions'
);

-- The submitting user is not an admin and is refused.
select set_config('request.jwt.claim.sub','a3636363-3636-4636-8636-363636363632',true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub','a3636363-3636-4636-8636-363636363632','role','authenticated','aal','aal2')::text,
  true
);
select throws_ok(
  $$select public.admin_item_category_suggestion((select item_id from suggestion_fixture))$$,
  '42501', 'ADMIN_REQUIRED',
  'ordinary users cannot read suggestions through the admin RPC'
);

select * from finish();
rollback;
