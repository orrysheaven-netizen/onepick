begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'comment-owner@example.com',
    '',
    now(),
    now()
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'authenticated',
    'authenticated',
    'comment-author@example.com',
    '',
    now(),
    now()
  );

insert into public.profiles (id, username, onboarding_completed)
values
  ('33333333-3333-3333-3333-333333333333', 'comment_owner', true),
  ('44444444-4444-4444-4444-444444444444', 'comment_author', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '댓글 테스트', 'comment-test', 'open', true, true);

insert into public.items (id, category_id, name, normalized_name, status)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '제품 A', '제품 a', 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '제품 B', '제품 b', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select public.change_pick(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '댓글 테스트 원픽'
);

create temporary table comment_test_state as
select id as pick_id
from public.picks
where user_id = '33333333-3333-3333-3333-333333333333'
  and status = 'active';

-- Only the temporary fixture is shared with anonymous test queries.
grant select on comment_test_state to anon;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

select lives_ok(
  $$
    insert into public.comments (pick_id, user_id, body)
    select pick_id, '44444444-4444-4444-4444-444444444444', '좋은 선택이에요'
    from comment_test_state
  $$,
  'authenticated user can comment on an active pick'
);

select results_eq(
  $$select count(*)::int from public.comments where pick_id = (select pick_id from comment_test_state)$$,
  array[1],
  'comment author can read the comment on an active pick'
);

select throws_ok(
  $$
    insert into public.comments (pick_id, user_id, body)
    select pick_id, '33333333-3333-3333-3333-333333333333', '작성자 위조'
    from comment_test_state
  $$,
  '42501',
  'new row violates row-level security policy for table "comments"',
  'comment author cannot spoof another user id'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select results_eq(
  $$select count(*)::int from public.comments where pick_id = (select pick_id from comment_test_state)$$,
  array[1],
  'anonymous users can read comments on an active pick'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select public.change_pick(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '새 원픽'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select results_eq(
  $$select count(*)::int from public.comments where pick_id = (select pick_id from comment_test_state)$$,
  array[0],
  'anonymous users cannot read comments on a historical pick'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select results_eq(
  $$select count(*)::int from public.comments where pick_id = (select pick_id from comment_test_state)$$,
  array[1],
  'pick owner can read comments on their historical pick'
);

select * from finish();
rollback;
