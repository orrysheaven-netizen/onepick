-- A user whose AI taste review is published must still be able to register,
-- change and remove picks. The pick trigger marks the review stale but keeps it
-- visible; that combination used to violate a leftover check constraint and
-- rolled the pick write back.
begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('37373737-3737-4737-8737-373737373737', 'authenticated', 'authenticated', 'onepick-ai-visible@example.com', '', now(), now());

insert into public.profiles (id, username, onboarding_completed)
values ('37373737-3737-4737-8737-373737373737', 'onepick_ai_visible', true);

insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values ('37a37a37-a37a-4a37-8a37-a37a37a37a37', '라면 AI 테스트', 'ai-visible-review-test', 'open', true, true);

insert into public.items (id, category_id, name, normalized_name, status)
values
  ('37b37b37-b37b-4b37-8b37-b37b37b37b37', '37a37a37-a37a-4a37-8a37-a37a37a37a37', '신라면', '신라면', 'active'),
  ('37c37c37-c37c-4c37-8c37-c37c37c37c37', '37a37a37-a37a-4a37-8a37-a37a37a37a37', '진라면', '진라면', 'active');

-- A published (visible, fresh) review, as the analysis Edge Function leaves it.
insert into public.profile_ai_reviews
  (profile_id, actor_id, summary, body, keywords, pick_snapshot, source_fingerprint, model_name, prompt_version, is_visible, is_stale)
values (
  '37373737-3737-4737-8737-373737373737',
  (select id from public.system_actors where slug = 'onepick_ai'),
  '따뜻한 취향', '익숙한 맛을 오래 고르는 사람', '{"익숙함"}', '[]'::jsonb,
  'fingerprint-visible-review', 'test-model', 'test-prompt', true, false
);

select is(
  (select count(*)::int from public.profile_ai_reviews
    where profile_id = '37373737-3737-4737-8737-373737373737' and is_visible and not is_stale),
  1, 'Setup: the profile has a visible, fresh AI review'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '37373737-3737-4737-8737-373737373737', true);

select lives_ok(
  $$ select public.register_pick('37a37a37-a37a-4a37-8a37-a37a37a37a37', '37b37b37-b37b-4b37-8b37-b37b37b37b37', null, '처음 고른 원픽', null, null, null) $$,
  'register_pick succeeds while the AI review is visible'
);

select is(
  (select count(*)::int from public.picks
    where user_id = '37373737-3737-4737-8737-373737373737' and item_id = '37b37b37-b37b-4b37-8b37-b37b37b37b37' and status = 'active'),
  1, 'The pick was created'
);

reset role;
select is(
  (select is_stale from public.profile_ai_reviews where profile_id = '37373737-3737-4737-8737-373737373737'),
  true, 'The pick write marked the review stale'
);
select is(
  (select is_visible from public.profile_ai_reviews where profile_id = '37373737-3737-4737-8737-373737373737'),
  true, 'The stale review stays visible'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '37373737-3737-4737-8737-373737373737', true);

select lives_ok(
  $$ select public.change_pick('37a37a37-a37a-4a37-8a37-a37a37a37a37', '37c37c37-c37c-4c37-8c37-c37c37c37c37', '바꾼 원픽') $$,
  'change_pick succeeds while the AI review is visible and stale'
);

select is(
  (select item_id from public.picks
    where user_id = '37373737-3737-4737-8737-373737373737' and category_id = '37a37a37-a37a-4a37-8a37-a37a37a37a37' and status = 'active'),
  '37c37c37-c37c-4c37-8c37-c37c37c37c37'::uuid, 'The active pick moved to the new item'
);

select lives_ok(
  $$ select public.remove_pick('37a37a37-a37a-4a37-8a37-a37a37a37a37') $$,
  'remove_pick succeeds while the AI review is visible and stale'
);

select * from finish();
rollback;
