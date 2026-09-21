-- 홈·팔로잉 피드가 구매처와 쇼핑꿀팁을 싣는다. docs/pick-purchase-link.md 참조.
--
-- 컬럼을 더하면서 기존 공개 조건이 헐거워지지 않았는지 함께 본다: 자기 원픽
-- 제외, 팔로우하지 않은 사람 제외, 저장 시 제휴 파라미터 제거.
begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('39393939-3939-4939-8939-393939393939', 'authenticated', 'authenticated', 'feed-author@example.com', '', now(), now()),
  ('39a39a39-a39a-4a39-8a39-a39a39a39a39', 'authenticated', 'authenticated', 'feed-viewer@example.com', '', now(), now());

insert into public.profiles (id, username, onboarding_completed)
values
  ('39393939-3939-4939-8939-393939393939', 'feed_author', true),
  ('39a39a39-a39a-4a39-8a39-a39a39a39a39', 'feed_viewer', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values ('39b39b39-b39b-4b39-8b39-b39b39b39b39', '라면 피드 테스트', 'feed-purchase-link-test', 'open', true, true);

insert into public.items (id, category_id, name, normalized_name, status)
values ('39c39c39-c39c-4c39-8c39-c39c39c39c39', '39b39b39-b39b-4b39-8b39-b39b39b39b39', '신라면', '신라면', 'active');

-- 작성자가 링크와 팁을 남긴다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '39393939-3939-4939-8939-393939393939', true);
select lives_ok(
  $$ select public.change_pick(
       '39b39b39-b39b-4b39-8b39-b39b39b39b39', '39c39c39-c39c-4c39-8c39-c39c39c39c39',
       '10년째 이것만', 'https://www.coupang.com/vp/products/7?itemId=3&wpuid=aff', '6개입이 낱개보다 싸요') $$,
  '작성자가 링크와 팁을 남긴다'
);

-- 읽는 사람의 홈 피드에 그대로 실린다.
select set_config('request.jwt.claim.sub', '39a39a39-a39a-4a39-8a39-a39a39a39a39', true);

select is(
  (select purchase_url from public.home_pick_feed_page()
    where username = 'feed_author'),
  'https://www.coupang.com/vp/products/7?itemId=3',
  '홈 피드는 제휴 파라미터가 제거된 링크를 싣는다'
);

select is(
  (select purchase_tip from public.home_pick_feed_page()
    where username = 'feed_author'),
  '6개입이 낱개보다 싸요',
  '홈 피드는 팁을 싣는다'
);

-- 팔로우하기 전에는 팔로잉 피드에 없다.
select is(
  (select count(*)::int from public.home_following_feed_page() where username = 'feed_author'),
  0, '팔로우하지 않은 사람은 팔로잉 피드에 없다'
);

insert into public.user_follows (follower_id, followee_id)
values ('39a39a39-a39a-4a39-8a39-a39a39a39a39', '39393939-3939-4939-8939-393939393939');

select is(
  (select purchase_tip from public.home_following_feed_page() where username = 'feed_author'),
  '6개입이 낱개보다 싸요',
  '팔로잉 피드도 같은 팁을 싣는다'
);

-- 작성자 본인의 홈 피드에는 자기 원픽이 보이지 않는다(기존 규칙 유지).
select set_config('request.jwt.claim.sub', '39393939-3939-4939-8939-393939393939', true);
select is(
  (select count(*)::int from public.home_pick_feed_page() where username = 'feed_author'),
  0, '자기 원픽은 홈 둘러보기에서 계속 제외된다'
);

-- 링크를 지우면 피드에서도 사라진다.
select lives_ok(
  $$ select public.change_pick(
       '39b39b39-b39b-4b39-8b39-b39b39b39b39', '39c39c39-c39c-4c39-8c39-c39c39c39c39',
       '10년째 이것만', '', '') $$,
  '작성자가 링크를 지운다'
);

reset role;
select * from finish();
rollback;
