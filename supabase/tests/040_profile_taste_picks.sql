-- 취향 평가가 읽는 원픽 한 벌. docs/life-service-entry-direction.md 참조.
--
-- profile_taste_picks는 profile-ai-status의 자격 판정과
-- analyze-profile-taste의 재료를 같은 정의로 묶는다. 그래서 여기서 확인할
-- 것은 "취향 차원 매핑이 없는 카테고리의 원픽은 이 함수를 통과하지 못한다"
-- 하나다. 그것이 온라인·오프라인 생활 서비스를 취향 평가에서 빼는 방법이며,
-- 자격 개수와 재료가 같은 분모를 쓴다는 보장이다.
--
-- 기존 두 질의가 갖고 있던 조건(본인, active 픽, 보이는 카테고리,
-- active/discontinued 아이템)도 함께 지킨다. 하나라도 느슨해지면 취향이
-- 아닌 것이 AI 재료로 들어가거나 공개되지 않아야 할 픽이 새어나간다.
begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- 취향 카테고리 하나와, 매핑이 없는 생활 서비스 카테고리 하나.
insert into public.categories (id, name, slug, status, is_visible, is_pickable)
values
  ('40a04040-a040-4040-8040-a04040404040', '취향 테스트', 'taste-picks-test', 'open', true, true),
  ('40b04040-b040-4040-8040-b04040404040', '서비스 테스트', 'taste-picks-service', 'open', true, true),
  ('40c04040-c040-4040-8040-c04040404040', '숨은 테스트', 'taste-picks-hidden', 'open', false, true);

insert into public.category_taste_dimensions (category_id, dimension_code, weight, is_primary)
values ('40a04040-a040-4040-8040-a04040404040', 'food', 100, true);
-- 숨은 카테고리는 매핑은 있으나 비공개다. 두 조건이 독립임을 보이기 위한 것.
insert into public.category_taste_dimensions (category_id, dimension_code, weight, is_primary)
values ('40c04040-c040-4040-8040-c04040404040', 'food', 100, true);

insert into public.items (id, category_id, name, normalized_name, status, original_name, release_year, creator_name, collection_name)
values
  ('40d04040-d040-4040-8040-d04040404041', '40a04040-a040-4040-8040-a04040404040', '취향 아이템', '취향아이템', 'active', '원제', 2024, '만든이', '모음'),
  ('40d04040-d040-4040-8040-d04040404042', '40a04040-a040-4040-8040-a04040404040', '단종 아이템', '단종아이템', 'discontinued', null, null, null, null),
  ('40d04040-d040-4040-8040-d04040404043', '40a04040-a040-4040-8040-a04040404040', '숨긴 아이템', '숨긴아이템', 'hidden', null, null, null, null),
  ('40d04040-d040-4040-8040-d04040404044', '40b04040-b040-4040-8040-b04040404040', '동네 정비소', '동네정비소', 'active', null, null, null, null),
  ('40d04040-d040-4040-8040-d04040404045', '40c04040-c040-4040-8040-c04040404040', '숨은 아이템', '숨은아이템', 'active', null, null, null, null);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('40404040-4040-4040-8040-404040404041', 'authenticated', 'authenticated', 'taste-picks-a@example.com', '', now(), now()),
  ('40404040-4040-4040-8040-404040404042', 'authenticated', 'authenticated', 'taste-picks-b@example.com', '', now(), now());

insert into public.profiles (id, username, onboarding_completed)
values
  ('40404040-4040-4040-8040-404040404041', 'taste_picks_a', true),
  ('40404040-4040-4040-8040-404040404042', 'taste_picks_b', true);

-- A: 취향 픽 하나(단종 아이템), 생활 서비스 픽 하나, 숨은 카테고리 픽 하나,
--    숨긴 아이템 픽 하나, 그리고 교체된 과거 픽 하나.
insert into public.picks (user_id, category_id, item_id, one_line_review, status, started_at, ended_at)
values
  ('40404040-4040-4040-8040-404040404041', '40a04040-a040-4040-8040-a04040404040',
   '40d04040-d040-4040-8040-d04040404042', '단종됐지만 계속 쓴다', 'active', now(), null),
  ('40404040-4040-4040-8040-404040404041', '40b04040-b040-4040-8040-b04040404040',
   '40d04040-d040-4040-8040-d04040404044', '8년째 여기서만 받는다', 'active', now(), null),
  ('40404040-4040-4040-8040-404040404041', '40c04040-c040-4040-8040-c04040404040',
   '40d04040-d040-4040-8040-d04040404045', '숨은 카테고리', 'active', now(), null),
  ('40404040-4040-4040-8040-404040404041', '40a04040-a040-4040-8040-a04040404040',
   '40d04040-d040-4040-8040-d04040404043', '숨긴 아이템', 'replaced', now() - interval '2 days', now());

-- B: 취향 픽 하나. A의 결과에 섞이지 않아야 한다.
insert into public.picks (user_id, category_id, item_id, one_line_review, status, started_at)
values
  ('40404040-4040-4040-8040-404040404042', '40a04040-a040-4040-8040-a04040404040',
   '40d04040-d040-4040-8040-d04040404041', '다른 사람의 이유', 'active', now());

-- 이 함수가 존재하는 이유: 두 Edge Function이 같은 정의를 쓴다 ----------

select is(
  (select count(*)::int from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')),
  1,
  'A의 취향 원픽만 남는다'
);

select is(
  (select one_line_review from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')),
  '단종됐지만 계속 쓴다',
  '단종된 아이템의 원픽은 취향 재료로 남는다'
);

select ok(
  not exists (
    select 1 from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')
    where category_id = '40b04040-b040-4040-8040-b04040404040'
  ),
  '취향 차원 매핑이 없는 카테고리의 원픽은 빠진다'
);

select ok(
  not exists (
    select 1 from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')
    where category_id = '40c04040-c040-4040-8040-c04040404040'
  ),
  '매핑이 있어도 보이지 않는 카테고리는 빠진다'
);

select ok(
  not exists (
    select 1 from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')
    where item_id = '40d04040-d040-4040-8040-d04040404043'
  ),
  '교체된 과거 픽과 숨긴 아이템은 빠진다'
);

select ok(
  not exists (
    select 1 from public.profile_taste_picks('40404040-4040-4040-8040-404040404041')
    where one_line_review = '다른 사람의 이유'
  ),
  '다른 사용자의 원픽이 섞이지 않는다'
);

select is(
  (select count(*)::int from public.profile_taste_picks('40404040-4040-4040-8040-404040404042')),
  1,
  'B의 결과는 B의 원픽만 센다'
);

-- Edge Function이 읽는 필드가 실제로 채워지는지. 하나라도 null이면
-- analyze-profile-taste의 buildSnapshot이 그 행을 버린다.
select ok(
  (select bool_and(
     pick_id is not null and category_id is not null and category_name is not null
     and item_id is not null and item_name is not null and one_line_review is not null
     and updated_at is not null)
   from public.profile_taste_picks('40404040-4040-4040-8040-404040404042')),
  'buildSnapshot이 요구하는 필드가 모두 채워진다'
);

-- 아이템 메타데이터는 카탈로그에 따라 비어 있을 수 있고, 있으면 그대로 온다.
select is(
  (select item_creator_name from public.profile_taste_picks('40404040-4040-4040-8040-404040404042')),
  '만든이',
  '아이템 메타데이터가 그대로 전달된다'
);

select * from finish();
rollback;
