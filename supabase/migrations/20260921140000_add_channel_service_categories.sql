-- 온라인·오프라인 서비스 카테고리를 연다.
--
-- 지금까지의 카테고리는 도메인 축(먹을것·콘텐츠·테크·스타일)이었다. 이 두
-- 묶음은 채널 축이다. 같은 성격의 선택이라도 온라인은 어디서든 같은 곳을
-- 고를 수 있고, 오프라인은 생활권과 이동 의사에 묶인다. 그 차이가 홈에서
-- 무엇이 읽히는지를 가르므로 축을 나눈다.
--
-- 온라인은 대개 쇼핑몰 하나로 모인다. 오프라인은 종류가 다양해서 등록할
-- 때마다 해당 말단을 고른다. 여는 순서는 멀어도 갈 값어치가 있는 쪽부터다.
-- 생활권에만 묶이는 것(세탁소·열쇠·이사)은 아직 열지 않는다.
--
-- 의료(치과·병원)와 법률(변호사·세무사)은 넣지 않는다. 의료광고 주체 제한과
-- 환자 유인·알선 규정에 걸릴 수 있어 별도 확인이 필요하다.
-- docs/life-service-entry-direction.md 참조.
--
-- **취향 차원 매핑을 만들지 않는다.** 이것이 이 카테고리들을 AI 취향 평가에서
-- 빼는 방법이다. profile_taste_picks(20260921130000)가 primary 매핑이 없는
-- 카테고리를 걸러내므로, 매핑을 두지 않는 것만으로 자격 개수·재평가 변경
-- 건수·AI 재료 세 곳에서 모두 빠진다. 화면이나 함수에 카테고리를
-- 하드코딩하지 않는다.
--
-- 주의: 기존 `먹을것 → 쇼핑몰(slug=shopping-mall)`은 상품 분류 트리다.
-- 온라인 서비스용 쇼핑몰은 `online-shopping-mall`로 별도 생성해 기존 노드의
-- parent_id나 자식 카테고리를 절대 이동시키지 않는다.

insert into public.categories (
  id, parent_id, name, slug, status, is_visible, is_pickable, sort_order
)
values
  (gen_random_uuid(), null, '온라인',   'online',  'open', true, false, 60),
  (gen_random_uuid(), null, '오프라인', 'offline', 'open', true, false, 70)
on conflict (slug) do update
set
  name = excluded.name,
  status = 'open',
  is_visible = true,
  is_pickable = false,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.categories (
  id, parent_id, name, slug, status, is_visible, is_pickable, sort_order
)
select gen_random_uuid(), p.id, v.name, v.slug, 'open', true, true, v.sort_order
from (
  values
    ('online',  '쇼핑몰',        'online-shopping-mall',  61),
    ('offline', '정비소',        'auto-repair',           71),
    ('offline', '안경원',        'optician',              72),
    ('offline', '수리 기사',     'repair-technician',     73),
    ('offline', '인테리어·시공', 'interior-construction', 74)
) as v(parent_slug, name, slug, sort_order)
join public.categories p on p.slug = v.parent_slug
on conflict (slug) do update
set
  parent_id = excluded.parent_id,
  name = excluded.name,
  status = 'open',
  is_visible = true,
  is_pickable = true,
  sort_order = excluded.sort_order,
  updated_at = now();

-- 내부 카탈로그로 둔다. 외부 제공자가 없는 것이 이유의 절반이고, 나머지
-- 절반이 더 중요하다. prevent_internal_catalog_duplicates(20260919142411)는
-- mode='internal'인 카테고리에서만 같은 이름의 중복 등록을 막는다. 행이
-- 없으면 그 가드가 조용히 꺼진다. 같은 이름의 가게가 흔한 오프라인에서
-- 이 가드는 상품보다 더 필요하다.
insert into public.category_catalog_sources (
  category_id, mode, provider, edge_function_slug, external_source, notes
)
select c.id, 'internal', null, null, null, 'OnePick master catalog'
from public.categories c
where c.slug in (
  'online-shopping-mall', 'auto-repair', 'optician', 'repair-technician', 'interior-construction'
)
on conflict (category_id) do update
set
  mode = excluded.mode,
  provider = excluded.provider,
  edge_function_slug = excluded.edge_function_slug,
  external_source = excluded.external_source,
  notes = excluded.notes,
  updated_at = now();
