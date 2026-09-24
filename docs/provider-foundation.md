# Provider 기반 모델 (PR 0a)

상태: 구현됨 (DB만, UI 없음)
기준일: 2026-09-24
관련: `restaurant-mvp-foundation.md`

## 관계

```
brands (기존)                        같은 업체의 상위 그룹 (선택, 관리자만)
  └─ providers                       사용자가 보는 지점/온라인몰 프로필
       kind = offline_branch  → places (위치·외부 장소 데이터)
       kind = online_store    → online_stores (공식 판매 프로필 식별자)
       └─ item_providers             item = provider × 세부 category
            └─ items (기존)          원픽 연결점. id, picks, 댓글, 사진, /item/{id} 공유 그대로
```

- `item_providers(item_id PK, category_id, provider_id)`: `unique(provider_id, category_id)`와 복합 FK `(item_id, category_id) → items(id, category_id)`로 묶여 있습니다.
- `provider_categories` 테이블은 따로 만들지 않습니다. provider가 제공하는 카테고리 목록은 `item_providers where provider_id = X`입니다.
- `items`에는 컬럼을 추가하지 않습니다. `search_items` 등 여러 SQL 함수가 `public.items` 행 타입을 명시적 컬럼 목록으로 반환하기 때문에, 컬럼을 추가하면 그 함수들이 깨집니다.

## 불변식

| 규칙 | 강제 방식 |
|---|---|
| kind와 대상(place / online_store) 조합 일치 | `providers_kind_target` CHECK |
| place 하나에 offline provider 하나, online_store 하나에 provider 하나 | unique |
| provider 생성 후 kind, place, store 변경 불가 | `providers_guard_identity` 트리거 (`PROVIDER_IDENTITY_IMMUTABLE`) |
| 같은 provider와 같은 category에는 item 하나 | `item_providers` unique |
| 장소 기반 item에는 provider가 있어야 함 | deferred 트리거 (`ITEM_PROVIDER_REQUIRED`) |
| offline provider item의 `item_places.place_id`는 provider의 place와 같아야 함 | deferred 트리거 (`ITEM_PROVIDER_PLACE_MISMATCH`) |
| online provider item에는 `item_places`가 없어야 함 | `item_places` insert 시 즉시 검사하는 동기화 트리거 (`ITEM_PROVIDER_MISMATCH`), 그 밖의 경로는 deferred 트리거 (`ONLINE_PROVIDER_ITEM_HAS_PLACE`) |
| brand가 있는 item에는 provider 연결을 새로 만들 수 없음 (brand는 provider를 통해서만) | `item_providers` 쓰기 시 deferred 트리거 (`ITEM_PROVIDER_BRAND_CONFLICT`). 기존 관리자의 `items.brand_id` 수정 동작은 바꾸지 않았으므로, 연결된 item에 brand를 붙이지 않는 것은 운영 규칙입니다 |
| 사용자 × category 현재 원픽 1개 | 기존 `picks_one_current_per_category` (변경 없음) |

- deferred 트리거는 커밋 시점에 검사합니다. 기존 장소 함수가 item을 먼저 넣고 `item_places`를 나중에 넣기 때문입니다.
- pgTAP에서 검증하려면 `set constraints all immediate`를 사용합니다.

## 쓰기 경로

- **오프라인:** 기존 `select_place_catalog_item`과 `admin_upsert_place_item`을 그대로 씁니다. `item_places`에 insert되면 `item_places_sync_provider` 트리거가 place의 provider를 만들거나 재사용하고 `item_providers`를 연결합니다.
- **온라인:** PR 0b의 관리자 RPC로 만듭니다. item은 `external_source='onepick_provider'`, `external_id='<provider_id>:<category_id>'`로 생성됩니다.
- 클라이언트(anon, authenticated)에는 `providers`, `online_stores`, `item_providers`에 대한 쓰기 권한이 없습니다.
- provider item은 `external_source`가 반드시 `onepick_place`(오프라인)나 `onepick_provider`(온라인)여야 합니다. 이름 중복 검사에서 이 값으로 제외됩니다.
- migration은 backfill 동안 `places`와 `item_places`를 잠급니다. 동시에 들어온 장소 선택이 provider 없이 커밋되는 일을 막기 위해서입니다.

## 원픽 게이트 (`private.item_accepts_pick`)

- provider가 있는 item은 provider가 `active`이고, offline이면 place도 `is_visible`이어야 원픽할 수 있습니다. 이때 `item_channels`는 보지 않습니다.
- provider가 없는 item(콘텐츠, 기존 식품)은 이전 규칙 그대로입니다.
- 게이트는 새 원픽 등록만 막습니다. 이미 있는 원픽은 provider를 숨겨도 유지됩니다.

## 공개 읽기 (RLS)

- `providers`: `status='active'`이고, offline이면 place가 visible일 때 공개됩니다. MFA 관리자는 전부 볼 수 있습니다.
- `online_stores`: active provider가 쓰는 store만 공개됩니다.
- `item_providers`: item이 active 또는 discontinued이고 provider가 공개일 때 공개됩니다.
- brand가 `is_active=false`면 brand 행만 비공개가 되고, provider는 그대로 공개됩니다.

## Backfill

- `private.backfill_place_providers()`는 여러 번 실행해도 같은 결과를 냅니다 (idempotent).
- place 하나당 offline provider를 하나 만들고, 항상 `active`로 둡니다. place를 숨기거나 다시 공개할 때 공개 여부와 원픽 가능 여부는 기존처럼 `places.is_visible`만 따릅니다. provider의 `hidden`·`pending`은 관리자가 명시적으로 검수할 때만 씁니다.
- `item_places` 행 하나당 `item_providers`를 하나 연결합니다.
- `items`, `picks`, `comments`, `categories`는 수정하지 않습니다.

## PR 0b로 미룬 것

- 관리자 RPC: 온라인 store와 provider upsert, 온라인 provider item 생성, brand 연결, 상태 변경.
- `admin_merge_pending_item`의 provider 가드.
- 온라인 provider 자격 검증. 인정 대상은 브랜드 공식몰, 생산자 직영몰, 업체 직영 스토어, 업체가 직접 운영하는 플랫폼 내 스토어입니다. 제3자 리셀러, 마켓플레이스 자체, 개별 상품 URL은 거부합니다 (`shopping_domains` 기준 판별).
- provider 변경에 대한 관리자 감사 로그.
