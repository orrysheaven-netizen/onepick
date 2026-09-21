-- 주류 카테고리의 취향 차원 매핑. docs/dangol-entry-direction.md 참조.
--
-- 확인하는 것 셋: 맥주·소주가 food 차원에 하나씩 붙는가, 취향 구성이 주류
-- 원픽을 이제 세는가, 그리고 열려 있고 선택 가능한 카테고리에 매핑이 빠진
-- 것이 남아 있지 않은가.
--
-- 마지막 검사가 이 누락의 재발을 막는 자리다. 취향 평가에서 일부러 제외할
-- 카테고리(단골 등)를 열 때는 이 검사를 의식적으로 고쳐야 하며, 그것이
-- 의도된 마찰이다. 매핑 유무가 취향 평가 포함 여부의 스위치이므로
-- 매핑을 빼먹은 카테고리는 조용히 평가에서 사라진다.
begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- 매핑 -------------------------------------------------------------------

-- primary는 category_taste_dimensions_one_primary_idx가 카테고리당 하나로
-- 제한하므로 스칼라 하위질의로 읽는다.
select is(
  (select td.dimension_code
   from public.category_taste_dimensions td
   join public.categories c on c.id = td.category_id
   where c.slug = 'beer' and td.is_primary),
  'food',
  '맥주의 primary 취향 차원은 food다'
);

select is(
  (select td.dimension_code
   from public.category_taste_dimensions td
   join public.categories c on c.id = td.category_id
   where c.slug = 'soju' and td.is_primary),
  'food',
  '소주의 primary 취향 차원은 food다'
);

select is(
  (select count(*)::int
   from public.categories c
   where c.status = 'open'
     and c.is_visible
     and c.is_pickable
     and not exists (
       select 1
       from public.category_taste_dimensions td
       where td.category_id = c.id and td.is_primary
     )),
  0,
  '열려 있고 선택 가능한 카테고리에 취향 차원 매핑이 빠진 것이 없다'
);

-- 취향 구성 ---------------------------------------------------------------

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('39393939-3939-4939-8939-393939393939', 'authenticated', 'authenticated',
        'alcohol-taste@example.com', '', now(), now());

insert into public.profiles (id, username, onboarding_completed)
values ('39393939-3939-4939-8939-393939393939', 'alcohol_taste_user', true);

insert into public.items (id, category_id, name, normalized_name, status)
select '39b39b39-b39b-4b39-8b39-b39b39b39b39', c.id, '테스트 맥주', '테스트맥주', 'active'
from public.categories c where c.slug = 'beer';

insert into public.picks (user_id, category_id, item_id, one_line_review, status, started_at)
select '39393939-3939-4939-8939-393939393939', c.id,
       '39b39b39-b39b-4b39-8b39-b39b39b39b39', '여름에 가장 먼저 꺼낸다', 'active', now()
from public.categories c where c.slug = 'beer';

-- 역할을 바꾸지 않고 검사한다. 이 파일이 확인하는 것은 매핑이며 공개 범위가
-- 아니다. 비로그인 조회 조건은 023_people_home_feed.sql 등이 이미 다룬다.

select is(
  (public.profile_taste_composition('39393939-3939-4939-8939-393939393939')->>'mapped_pick_count')::int,
  1,
  '주류 원픽이 취향 구성의 분모에 들어간다'
);

select is(
  (public.profile_taste_composition('39393939-3939-4939-8939-393939393939')->>'unmapped_pick_count')::int,
  0,
  '주류 원픽은 더 이상 미분류로 남지 않는다'
);

select is(
  (select d->>'code'
   from jsonb_array_elements(
     public.profile_taste_composition('39393939-3939-4939-8939-393939393939')->'dimensions'
   ) d
   where exists (
     select 1
     from jsonb_array_elements(d->'categories') cat
     where cat->>'category_slug' = 'beer'
   )),
  'food',
  '맥주 원픽은 food 차원 아래에 나타난다'
);

select * from finish();
rollback;
