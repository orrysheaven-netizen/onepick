-- 오프라인 서비스 말단을 장소 식별자가 생길 때까지 멈춘다.
--
-- 20260921212000이 이 말단들을 열었지만, 아이템 모델이 장소를 식별하지
-- 못한다는 전제조건이 아직 풀리지 않았다. 그 결과가 에러가 아니라 **조용히
-- 잘못된 데이터**다.
--
-- private.submit_item_impl(20260919142411)은 같은 normalized_name
-- (공백 제거·소문자)인 아이템이 이미 있으면 그것을 **그대로 돌려준다**.
-- 그래서 강남 사용자가 '다비치안경'을 등록하면 마포 사람이 만든
-- '다비치안경'을 받는다. 경고도, 선택지도 없이 다른 사업장을 자기 원픽으로
-- 갖게 된다. 프랜차이즈가 흔한 안경원에서는 거의 확실히 일어난다.
-- items_prevent_internal_duplicate 트리거는 그 반환 경로보다 뒤에 있어
-- 이것을 막지 못한다.
--
-- 온라인은 해당하지 않는다. 쇼핑몰 이름은 전역에서 고유하므로 지금 모델로
-- 정확하게 동작한다. 그래서 온라인·쇼핑몰은 그대로 열어 둔다.
--
-- **왜 is_visible만으로는 부족한가.** change_pick(20260921110000)의 카테고리
-- 검사는 status·is_pickable·말단 여부만 본다. is_visible을 보지 않는다.
-- 숨기기만 하면 화면에서 사라질 뿐 카테고리 ID를 아는 호출은 계속 원픽을
-- 저장할 수 있다. status='paused'는 change_pick과
-- category_is_open_leaf(=category_accepts_picks) 양쪽이 모두 막으므로
-- 이것이 실제로 멈추는 스위치다. is_visible=false는 탐색에서 빈 묶음이
-- 보이지 않게 하는 별개의 목적으로 함께 둔다.
--
-- 되돌리는 방법: 이 네 행을 status='open', is_visible=true로 올린다.
-- 그 전에 docs/life-service-entry-direction.md의 "카테고리를 여는 전제 조건"
-- 1번(장소 식별자)을 설계해야 한다. 039의 취향 매핑 면제는 최상위
-- 슬러그(offline)에 걸려 있으므로 다시 열 때 검사를 고칠 필요는 없다.

-- 슬러그로 직접 찾지 않고 `오프라인`의 자식으로 한정한다. 같은 슬러그가
-- 트리의 다른 자리에 있어도 그 행을 멈추지 않는다. 20260921212000이 기존
-- 노드를 입양하던 것과 같은 계열의 실수를 여기서도 막는다.
update public.categories c
set status = 'paused',
    is_visible = false,
    updated_at = now()
where c.parent_id = (select id from public.categories where slug = 'offline')
  and c.slug in ('auto-repair', 'optician', 'repair-technician', 'interior-construction');

-- 말단이 모두 멈췄으므로 묶음은 탐색에서 빈 칸으로 남는다. 트리에서는
-- 지우지 않는다. 다시 여는 것이 플래그 몇 개여야 한다.
update public.categories
set is_visible = false,
    updated_at = now()
where slug = 'offline'
  and parent_id is null;
