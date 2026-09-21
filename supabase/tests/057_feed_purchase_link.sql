begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

select ok(
  has_function_privilege('anon', 'public.home_pick_feed_page(timestamptz,uuid)', 'execute'),
  'public home feed remains callable by guests'
);
select ok(
  has_function_privilege('service_role', 'public.home_pick_feed_page(timestamptz,uuid)', 'execute'),
  'service_role execution privilege is preserved across drop/recreate'
);
select ok(
  not has_function_privilege('anon', 'public.home_following_feed_page(timestamptz,uuid)', 'execute'),
  'following feed remains unavailable to guests'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '39393939-3939-4939-8939-393939393939', true);
select lives_ok(
  $$ select public.change_pick(
       '39b39b39-b39b-4b39-8b39-b39b39b39b39',
       '39c39c39-c39c-4c39-8c39-c39c39c39c39',
       '10년째 이것만',
       'https://www.coupang.com/vp/products/7?itemId=3&wpuid=aff',
       '6개입이 낱개보다 싸요') $$,
  'author stores a purchase link and tip'
);

select set_config('request.jwt.claim.sub', '39a39a39-a39a-4a39-8a39-a39a39a39a39', true);

select is(
  (select purchase_url from public.home_pick_feed_page() where username = 'feed_author'),
  'https://www.coupang.com/vp/products/7?itemId=3',
  'public feed returns the normalized non-affiliate purchase URL'
);
select is(
  (select purchase_tip from public.home_pick_feed_page() where username = 'feed_author'),
  '6개입이 낱개보다 싸요',
  'public feed returns the buying tip'
);
select is(
  (select count(*)::int from public.home_following_feed_page() where username = 'feed_author'),
  0,
  'author is absent from following feed before follow'
);

insert into public.user_follows (follower_id, followee_id)
values ('39a39a39-a39a-4a39-8a39-a39a39a39a39', '39393939-3939-4939-8939-393939393939');

select is(
  (select purchase_tip from public.home_following_feed_page() where username = 'feed_author'),
  '6개입이 낱개보다 싸요',
  'following feed returns the same buying tip after follow'
);

select set_config('request.jwt.claim.sub', '39393939-3939-4939-8939-393939393939', true);
select is(
  (select count(*)::int from public.home_pick_feed_page() where username = 'feed_author'),
  0,
  'own Pick remains excluded from public Home feed'
);

select lives_ok(
  $$ select public.change_pick(
       '39b39b39-b39b-4b39-8b39-b39b39b39b39',
       '39c39c39-c39c-4c39-8c39-c39c39c39c39',
       '10년째 이것만', '', '') $$,
  'author can clear purchase link and tip'
);

reset role;
select * from finish();
rollback;
