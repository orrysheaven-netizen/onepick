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
-- 빼는 방법이다. profile_taste_picks(20260921211000)가 primary 매핑이 없는
-- 카테고리를 걸러내므로, 매핑을 두지 않는 것만으로 자격 개수·재평가 변경
-- 건수·AI 재료 세 곳에서 모두 빠진다. 화면이나 함수에 카테고리를
-- 하드코딩하지 않는다.
--
-- 주의: 기존 `먹을것 → 쇼핑몰(slug=shopping-mall)`은 상품 분류 트리다.
-- 온라인 서비스용 쇼핑몰은 `online-shopping-mall`로 별도 생성해 기존 노드의
-- parent_id나 자식 카테고리를 절대 이동시키지 않는다.

-- 가드: 이 마이그레이션이 쓰는 슬러그가 이미 **다른 모양으로** 존재하면 멈춘다.
--
-- shopping-mall 충돌은 슬러그를 online-shopping-mall로 바꿔 피했지만, 그것은
-- 알려진 한 건을 피한 것이고 계열을 막은 것이 아니다. 운영 DB에는 관리자
-- 화면으로 만든 카테고리가 있어 마이그레이션만으로 트리를 재현할 수 없다.
-- online·offline·optician 같은 슬러그가 이미 다른 자리에 있으면 아래 upsert가
-- 같은 방식으로 그 노드를 입양한다.
--
-- 상위와 이름이 모두 기대와 같으면 이 마이그레이션의 재실행이다. 하나라도
-- 다르면 다른 용도의 노드이므로 db push를 멈추고 슬러그를 알려준다.
do $guard$
declare
  v_conflict text;
begin
  select string_agg(
           format('%s (현재 상위: %s, 이름: %s)', c.slug, coalesce(p.slug, '최상위'), c.name),
           ', ' order by c.slug
         )
    into v_conflict
  from public.categories c
  left join public.categories p on p.id = c.parent_id
  join (
    values
      ('online',                null::text, '온라인'),
      ('offline',               null,       '오프라인'),
      ('online-shopping-mall',  'online',   '쇼핑몰'),
      ('auto-repair',           'offline',  '정비소'),
      ('optician',              'offline',  '안경원'),
      ('repair-technician',     'offline',  '수리 기사'),
      ('interior-construction', 'offline',  '인테리어·시공')
  ) as expected(slug, parent_slug, name) on expected.slug = c.slug
  where coalesce(p.slug, '') <> coalesce(expected.parent_slug, '')
     or c.name <> expected.name;

  if v_conflict is not null then
    raise exception
      '이 마이그레이션이 쓰려는 슬러그가 다른 카테고리에 이미 쓰이고 있습니다: %. 기존 노드를 옮기면 그 아래 말단이 선택 불가가 되므로 중단합니다. 슬러그를 바꾸거나 기존 노드를 먼저 정리한 뒤 다시 적용하세요.',
      v_conflict
      using errcode = 'P0001';
  end if;
end
$guard$;

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
-- parent_id는 갱신하지 않는다. 위 가드가 상위 일치를 이미 확인했고, 갱신
-- 대상에 남겨 두면 기존 노드를 옮기는 경로가 그대로 열려 있다.
on conflict (slug) do update
set
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
-- 슬러그로 직접 찾지 않고 온라인·오프라인의 자식으로 한정한다. 같은 슬러그가
-- 트리의 다른 자리에 있어도 그 행에 카탈로그 소스를 붙이지 않는다.
select c.id, 'internal', null, null, null, 'OnePick master catalog'
from public.categories c
join public.categories p on p.id = c.parent_id
where p.slug in ('online', 'offline')
on conflict (category_id) do update
set
  mode = excluded.mode,
  provider = excluded.provider,
  edge_function_slug = excluded.edge_function_slug,
  external_source = excluded.external_source,
  notes = excluded.notes,
  updated_at = now();
