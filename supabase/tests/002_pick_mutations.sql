begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values (
  '22222222-2222-2222-2222-222222222222',
  'authenticated',
  'authenticated',
  'onepick-mutations@example.com',
  '',
  now(),
  now()
);

insert into public.profiles (id, username, onboarding_completed)
values ('22222222-2222-2222-2222-222222222222', 'onepick_mutations', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '라면 테스트', 'pick-mutations-test', 'open', true, true);

insert into public.items (id, category_id, name, normalized_name, status)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '신라면', '신라면', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select public.change_pick(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '처음 리뷰'
);

create temporary table mutation_state as
select id as pick_id
from public.picks
where user_id = '22222222-2222-2222-2222-222222222222'
  and category_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and status = 'active';

select is(
  (public.update_pick_review((select pick_id from mutation_state), '수정된 리뷰')).one_line_review,
  '수정된 리뷰',
  'update_pick_review updates the current pick review'
);

select throws_ok(
  $$select public.update_pick_review((select pick_id from mutation_state), '')$$,
  'P0001',
  'REVIEW_INVALID',
  'empty review is rejected'
);

select ok(
  public.remove_pick('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'remove_pick removes the current pick'
);

select is(
  (
    select count(*)::int
    from public.picks
    where user_id = '22222222-2222-2222-2222-222222222222'
      and category_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and status in ('active', 'needs_review')
  ),
  0,
  'removed category has no current pick'
);

select is(
  public.remove_pick('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'remove_pick is idempotent when no current pick exists'
);

select throws_ok(
  $$select public.update_pick_review((select pick_id from mutation_state), '다시 수정')$$,
  'P0001',
  'PICK_NOT_FOUND',
  'removed pick cannot be edited'
);

select * from finish();
rollback;
