begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values (
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'onepick-test@example.com',
  '',
  now(),
  now()
);

insert into public.profiles (id, username, onboarding_completed)
values ('11111111-1111-1111-1111-111111111111', 'onepick_test', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '라면', 'ramen', 'open', true, true),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '중지 카테고리', 'paused-test', 'paused', true, false);

insert into public.products (id, category_id, name, normalized_name, status)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '신라면', '신라면', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '짜파게티', '짜파게티', 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '테스트 제품', '테스트제품', 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '숨김 제품', '숨김제품', 'hidden');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select public.change_pick(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '기본이 제일 좋음'
);

select is(
  (select count(*)::int from public.picks where user_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
  1,
  'first pick creates one active pick'
);

create temporary table test_state as
select id as first_pick_id
from public.picks
where user_id = '11111111-1111-1111-1111-111111111111'
  and status = 'active';

select public.change_pick(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '수정된 한줄평'
);

select is(
  (select id from public.picks where user_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
  (select first_pick_id from test_state),
  'same product keeps same pick id'
);

select is(
  (select one_line_review from public.picks where user_id = '11111111-1111-1111-1111-111111111111' and status = 'active'),
  '수정된 한줄평',
  'same product updates review'
);

select public.change_pick(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '오늘은 짜파게티'
);

select is(
  (select status from public.picks where id = (select first_pick_id from test_state)),
  'replaced',
  'old pick becomes replaced'
);

select is(
  (select count(*)::int from public.picks where user_id = '11111111-1111-1111-1111-111111111111' and category_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status = 'active'),
  1,
  'changing product leaves one active pick'
);

select throws_ok(
  $$select public.change_pick('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','잘못된 제품')$$,
  'P0001',
  'PRODUCT_CATEGORY_MISMATCH',
  'cross-category product is rejected'
);

select throws_ok(
  $$select public.change_pick('dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','선택 불가')$$,
  'P0001',
  'CATEGORY_NOT_PICKABLE',
  'paused category is rejected'
);

select throws_ok(
  $$select public.change_pick('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ffffffff-ffff-ffff-ffff-ffffffffffff','숨김 제품')$$,
  'P0001',
  'PRODUCT_NOT_ELIGIBLE',
  'hidden product is rejected'
);

select * from finish();
rollback;
