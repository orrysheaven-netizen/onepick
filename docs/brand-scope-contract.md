# 브랜드 전체·지점 범위와 브랜드 프로필 서버 계약 (2026-09-28)

#448 서버 인계 3번의 DB 계약이다. 마이그레이션
`20260928210000_add_brand_scope_and_user_places.sql`, pgTAP `105_brand_scope_and_user_places.sql`.
`register_item_pick`(`docs/immediate-pick-registration.md`) 위에 얹힌다. 앱 연결은 Codex 담당.

## 사용자 결정 (Figma 70/71, 73)

- 특정 지점을 우선 선택하되 **브랜드 전체**도 선택할 수 있다. 브랜드 전체와 각 지점은 **별도 제품**이라
  원픽 수·한줄평·댓글 작성 자격을 합산하지 않는다.
- 상호를 누르면 브랜드 프로필 안에 **원픽이 있는 모든 지점**(1~2명 지점 포함)이 나온다. 브랜드 전체
  섹션은 별도이며 선택이 0이면 숨긴다.
- 새 오프라인 매장을 검색으로 찾지 못하면 **지도 링크가 필수**다.
- 외부 링크(지도·공식 홈)는 제공처 프로필에서만 노출한다.

## 제품 범위

| 범위 | 식별 | 원픽 게이트 |
| --- | --- | --- |
| 지점 | `item_places`(place × menu) | 제공처 active + 장소 visible |
| 판매처 | `item_providers`(online provider × menu) | 제공처 active |
| **브랜드 전체** | `item_brand_scopes`(brand × menu), `items.external_source='onepick_brand'` | 브랜드 `is_active` |

`item_brands(item_ids)`는 브랜드 전체 제품에도 브랜드를 돌려준다(카드 표시).

## RPC

### `stage_brand_item(p_category_id, p_brand_id)` → `items`

브랜드×메뉴의 브랜드 전체 제품. 이미 공개된 것이면 그대로, 없으면 **내 대기 요청**(pending, 본인만
읽음)으로 만든다. 다른 사람의 대기 요청이면 `ITEM_ALREADY_PENDING`. 이어서
`register_item_pick(p_item_id => …, p_channel => 'offline', …)`로 원픽. 승인 시 공개.
에러: `BRAND_NOT_FOUND`, `CATEGORY_NOT_PICKABLE`, `RATE_LIMITED`, `USER_SUSPENDED`.

### `stage_user_place_item(p_category_id, p_name, p_road_address, p_map_url, p_branch_name)` → `items`

카탈로그 검색 실패 시 새 매장. 이름(1~100자), **네이버 지도 링크 필수**. 도로명 주소는 받지 않는다
(2026-09-30 사용자 결정, #593). `p_road_address`는 호환용으로 남은 선택 입력이며 앱은 `''`를 보낸다.
주소가 없으면 `places.road_address`는 `''`(사용자 등록 장소만 허용), `place_catalog.road_address`는 `null`이다.
**같은 정규화 이름 + 똑같은 지도 링크**는 같은 매장으로 재사용한다. 링크를 외부에서 펼치지 않으므로 다른
short link로 들어온 같은 가게는 별도 대기 요청이 된다. 서로 다른 지점을 잘못 합치는 것보다 안전한 쪽을 택했다.
사용자 등록 매장은 `item_places` → `item_providers` 트리거로 판매처가 연결되므로 `admin_merge_pending_item`이
`SOURCE_PROVIDER_ITEM_NOT_MERGEABLE`로 거부한다. 중복은 **하나만 승인하고 나머지는 반려**해서 정리한다. 만들어지는 것:

- `places` 행(`place_provider='user'`, **`is_visible=false`**), `place_catalog` 행(`business_status='pending'`, 검색 제외),
  pending item + `item_places` + `item_channels(offline, 지도 링크)`.
- 승인(`admin_review_pending_item … 'active'`) 시 트리거가 장소를 공개하고 카탈로그를 `open`으로 바꿔
  `search_store_catalog`에 나오고, 다른 사람은 `select_place_catalog_item`으로 같은 제품을 고른다.
  주소 없는 사용자 등록 장소도 선택할 수 있다(카탈로그에서 들여온 장소는 여전히 주소가 필요하다).
- 대기 중 `revise_item_request(p_link_url)`로 지도 링크를 바꾸면 장소의 `map_url`도 따라간다. 바꾼 링크가 같은 이름의
  다른 사용자 등록 매장과 겹치면 `PLACE_ALREADY_REGISTERED`로 거부한다(자동 병합하지 않음).

에러: `PLACE_NAME_INVALID`, `PLACE_ADDRESS_INVALID`(보낸 주소가 300자 초과), `ITEM_LINK_REQUIRED`, `LINK_INVALID`,
`ITEM_ALREADY_PENDING`, `CATEGORY_NOT_PICKABLE`, `RATE_LIMITED`.

### `brand_profile(p_brand_id)` → `jsonb | null`

```
{ brand: {id, name, logo_path},
  brand_wide: [{item_id, category_id, category_name, pick_count}],   -- 원픽 0이면 빈 배열(섹션 숨김)
  branch_count }                                                     -- 원픽 있는 지점·판매처 수
```

비활성/미존재 브랜드는 `null`. anon 실행 가능. `pick_count`는 그 제품을 현재 원픽으로 가진 사람 수
(정지 계정 제외)이며 지점끼리·브랜드 전체와 합산하지 않는다.

### `brand_branch_page(p_brand_id, p_after_pick_count, p_after_provider_id, p_limit)` → `setof jsonb`

원픽이 하나라도 있는 지점·판매처, 많이 고른 순. 커서는 마지막 행의 `(pick_count, provider_id)`
(둘 다 null이거나 둘 다 값, 아니면 `22023`). 행:
`provider_id, kind('offline_branch'|'online_store'), name, branch_name, region_1, region_2, road_address,
map_url, official_url, pick_count, menu_count`. 지점을 누르면 기존 제공처 프로필(`/provider/[providerId]`)로
간다. 외부 링크(`map_url`, `official_url`)는 거기서만 보여준다.

## 승인·병합 규칙

- 정체성이 있는 요청(지점 `item_places`, 판매처 `item_providers`, 브랜드 전체 `item_brand_scopes`)은
  승인 시 이름·메뉴를 그대로 유지하고 이름 중복 검사를 하지 않는다(지점·브랜드가 같은 상호를 쓰므로).
  이름만 있는 요청은 기존대로 중복 검사와 정규화를 거친다.
- 브랜드 전체 요청과 판매처 요청은 다른 제품으로 병합할 수 없다(`SOURCE_PROVIDER_ITEM_NOT_MERGEABLE`).

## 이번 PR에 없는 것

- 링크 미리보기(SSRF·크기·형식·재시도, 영상 썸네일 검증)는 Edge Function 영역이라 별도.
- 브랜드 자체의 생성·지점 소속 지정은 기존 관리자 RPC(`admin_set_provider_brand`) 그대로.
- 사용자가 만든 매장의 브랜드 소속은 관리자가 승인 후 연결한다.

## 앱 연결 체크리스트 (Codex)

1. 매장 선택 화면에 "브랜드 전체" 옵션(브랜드가 있는 매장일 때) → `stage_brand_item` → `register_item_pick(p_item_id)`.
2. 검색 결과 없음 → 새 매장 입력(이름·주소·지도 링크) → `stage_user_place_item` → 사진·한줄평 → `register_item_pick(p_item_id)`.
3. 상호 탭 → 브랜드 프로필: `brand_profile` + `brand_branch_page`(무한 스크롤). 브랜드 전체 섹션은 `brand_wide`가 비면 숨김.
4. 제공처 프로필의 외부 링크만 외부로 연다. 카드·아이템 상세는 내부 링크.
5. `database.types.ts` 재생성.

## 배포

병합 후 Actions **Deploy Database Migrations**(dry-run → apply). PR #469 이후 순서.
