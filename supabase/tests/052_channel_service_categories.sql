-- 온라인·오프라인 서비스 카테고리. docs/life-service-entry-direction.md 참조.
--
-- 지금 열려 있는 것은 온라인·쇼핑몰뿐이다. 오프라인 말단은 장소 식별자가
-- 없어서 멈춘 상태다(20260921213000). 아이템 이름이 같으면
-- submit_item_impl이 기존 아이템을 그대로 돌려주므로, 프랜차이즈 안경원에서
-- 다른 지점을 자기 원픽으로 갖게 되는 조용한 오류가 난다.
--
-- 확인하는 것.
--   1. 쇼핑몰은 원픽을 등록할 수 있는 열린 말단인가. 묶음은 아닌가.
--   2. 오프라인 말단은 status='paused'로 멈춰 있는가. **is_visible=false만으로는
--      부족하다**: change_pick의 카테고리 검사는 is_visible을 보지 않으므로
--      숨기기만 하면 카테고리 ID를 아는 호출이 계속 저장할 수 있다.
--   3. 취향 차원 매핑이 없는가. 이것이 AI 취향 평가에서 빠지는 방법이므로,
--      누군가 나중에 매핑을 붙이면 이 검사가 잡아야 한다.
--   4. 내부 카탈로그 소스가 붙어 중복 이름 가드가 켜지는가. 행이 없으면
--      prevent_internal_catalog_duplicates가 조용히 꺼진다.
--
-- 의료·법률 카테고리가 열리지 않았다는 것도 함께 고정한다. 여는 결정은
-- 외부 확인을 거쳐야 하므로 마이그레이션만으로 열리면 안 된다.
begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 트리 모양 --------------------------------------------------------------

select is(
  (select count(*)::int
   from public.categories c
   where c.slug in ('online', 'offline')
     and not c.is_pickable and c.parent_id is null),
  2,
  '온라인·오프라인은 선택 불가인 최상위 묶음이다'
);

select ok(
  (select c.is_visible from public.categories c where c.slug = 'online')
  and not (select c.is_visible from public.categories c where c.slug = 'offline'),
  '온라인 묶음만 보인다. 오프라인은 말단이 멈춘 동안 탐색에 빈 칸으로 남지 않는다'
);

select is(
  (select count(*)::int
   from public.categories c
   join public.categories p on p.id = c.parent_id
   where p.slug = 'online' and c.status = 'open' and c.is_visible and c.is_pickable),
  1,
  '온라인 아래에는 선택 가능한 말단이 하나 있다'
);

select ok(
  not exists (
    select 1
    from public.categories c
    join public.categories p on p.id = c.parent_id
    where c.slug = 'shopping-mall' and p.slug = 'online'
  ),
  '기존 먹을것 쇼핑몰(slug=shopping-mall)은 온라인 아래로 이동하지 않는다'
);

-- change_pick의 카테고리 검사와 같은 조건. 멈춘 말단이 여기서 걸러져야 한다.
select is(
  (select count(*)::int
   from public.categories c
   where c.status = 'open' and c.is_pickable
     and not exists (select 1 from public.categories ch where ch.parent_id = c.id)
     and c.slug in (
       'online-shopping-mall', 'auto-repair', 'optician', 'repair-technician', 'interior-construction'
     )),
  1,
  'change_pick 조건(status·is_pickable·말단)을 통과하는 것은 쇼핑몰뿐이다'
);

select is(
  (select array_agg(c.slug order by c.sort_order)
   from public.categories c
   join public.categories p on p.id = c.parent_id
   where p.slug = 'offline'),
  array['auto-repair', 'optician', 'repair-technician', 'interior-construction'],
  '오프라인 말단은 멀어도 갈 값어치가 있는 순서로 트리에 남아 있다'
);

-- 멈춤은 status로 한다. is_visible만 내리면 change_pick이 통과시킨다.
select is(
  (select count(*)::int
   from public.categories c
   join public.categories p on p.id = c.parent_id
   where p.slug = 'offline' and c.status = 'paused' and not c.is_visible),
  4,
  '오프라인 말단은 status=paused로 멈춰 있고 보이지 않는다'
);

-- category_is_open_leaf는 원픽 등록이 실제로 통과하는지를 결정한다.
select ok(
  public.category_is_open_leaf(
    (select id from public.categories where slug = 'online-shopping-mall')
  ),
  '쇼핑몰은 원픽을 등록할 수 있는 열린 말단이다'
);

select ok(
  (select bool_and(not public.category_is_open_leaf(c.id))
   from public.categories c
   where c.slug in (
     'online', 'offline',
     'auto-repair', 'optician', 'repair-technician', 'interior-construction'
   )),
  '묶음과 멈춘 오프라인 말단에는 원픽을 등록할 수 없다'
);

-- 취향 평가에서 빠지는 방법 ----------------------------------------------

select is(
  (select count(*)::int
   from public.category_taste_dimensions td
   join public.categories c on c.id = td.category_id
   join public.categories p on p.id = c.parent_id
   where p.slug in ('online', 'offline')),
  0,
  '채널 서비스 말단에는 취향 차원 매핑이 없다'
);

-- 중복 이름 가드 ---------------------------------------------------------

select is(
  (select count(*)::int
   from public.category_catalog_sources s
   join public.categories c on c.id = s.category_id
   join public.categories p on p.id = c.parent_id
   where p.slug in ('online', 'offline')
     and s.mode = 'internal' and s.is_enabled),
  5,
  '다섯 말단 모두 내부 카탈로그라 같은 이름 중복 가드가 켜진다'
);

-- 열지 않기로 한 것 ------------------------------------------------------

select is(
  (select count(*)::int
   from public.categories c
   where c.slug in ('dentist', 'clinic', 'hospital', 'lawyer', 'accountant')),
  0,
  '의료·법률 카테고리는 열려 있지 않다'
);

select * from finish();
rollback;
