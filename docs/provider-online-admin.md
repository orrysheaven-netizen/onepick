# Online provider 관리자 쓰기 경로 설계 (PR 0b)

상태: 설계 명세 — 구현 전  
기준일: 2026-09-24  
선행 완료: PR #283 (PR 0a provider foundation) 병합, 이슈 #165 안정화 게이트 종료

## 1. 목적과 순서

PR 0b는 PR 0a의 provider 스키마 위에 **온라인 판매처를 AAL2 관리자만 안전하게 생성·연결·상태 변경할 수 있는 DB 쓰기 경로**를 추가한다.

PR 0a는 2026-09-24에 `main`에 병합되었고 #165 안정화 게이트도 종료되었다. 따라서 이 명세 승인 후 PR 0b migration 구현을 시작할 수 있다. 운영/테스트 DB 적용은 PR 병합과 별개의 표준 배포 절차로만 수행한다.

PR 0a의 핵심 모델은 그대로 유지한다.

```
brands (기존)
  └─ providers
       kind = offline_branch -> places
       kind = online_store   -> online_stores
       └─ item_providers
            └─ items (기존 Pick/댓글/사진/feed/share 연결점)
```

`items`에 provider 컬럼을 추가하지 않는다. `picks.item_id`, 댓글, 사진, feed, `/item/{id}` 공유 구조도 변경하지 않는다.

## 2. PR 0b의 구현 범위

다음 DB 쓰기 경로를 제공한다.

1. 온라인 store + provider + 첫 category item의 원자적 생성/재사용
2. provider ↔ brand 연결/해제
3. provider 상태 변경 (`pending | active | hidden`)
4. provider/online store 관리자 감사 로그
5. `onepick_provider` item과 provider 관계의 우회 방지
6. `admin_merge_pending_item`의 provider source guard
7. RPC 권한·원자성·중복·상태 회귀 pgTAP

관리자 화면 자체, 온라인/오프라인 통합 검색 UI, 일반 사용자 provider 제보/생성, SKU/상품 옵션, 탐색 taxonomy 개편은 범위 밖이다.

## 3. 관리자 권한 원칙

모든 공개 admin RPC는 기존 패턴을 따른다.

- public wrapper: `security invoker`
- private impl: `security definer set search_path = ''`
- private impl 첫 단계에서 `private.is_admin_mfa()` 확인
- AAL1 관리자, 일반 AAL2 사용자, 익명 사용자는 거부
- 클라이언트에 `providers`, `online_stores`, `item_providers` 직접 INSERT/UPDATE/DELETE 권한을 추가하지 않음
- service-role을 모바일/웹 클라이언트에 노출하지 않음

권한 실패는 기존 관리자 RPC와 동일하게 `ADMIN_REQUIRED` / SQLSTATE `42501`을 사용한다.

## 4. 온라인 provider 생성 RPC

### 4.1 공개 인터페이스

구현 시 다음 형태를 기준으로 한다.

```sql
public.admin_upsert_online_provider_item(
  p_category_id  uuid,
  p_name         text,
  p_store_type   text,
  p_official_url text,
  p_platform     text default null,
  p_store_key    text default null,
  p_brand_id     uuid default null
)
returns table (
  provider_id     uuid,
  online_store_id uuid,
  item_id         uuid,
  category_id     uuid
)
```

내부 구현은 `private.admin_upsert_online_provider_item_impl(...)`로 분리한다.

### 4.2 입력 검증

공통:

- category는 `public.category_is_open_leaf(...)`를 통과해야 함
- name은 trim/연속 공백 정규화 후 1~100자
- URL은 HTTPS만 허용, 공백·userinfo·비정상 host·과도한 길이 거부
- `p_brand_id`가 있으면 실제 brand 행이 존재해야 함

`official_site`:

- `p_platform is null`
- URL host를 소문자로 정규화
- canonical `store_key = 'site:' || host`
- 호출자가 임의의 다른 store_key를 주어 identity를 바꾸지 못함

`platform_store`:

- `p_platform` 필수
- `p_store_key` 필수
- `store_key`는 반드시 `<platform>:<merchant-identity>` 형식
- URL host는 승인된 쇼핑/플랫폼 host 규칙과 일치해야 함
- 개별 상품 URL을 store identity로 사용하지 않음

### 4.3 `shopping_domains`의 사용 한계

`public.shopping_domains`와 `public.is_shopping_url`은 현재 **쇼핑 링크 UX 분류용**이다. 테이블 주석도 이를 명시하고 있으며 쿠팡·G마켓·Amazon 같은 marketplace 자체 host가 포함되어 있다.

따라서 PR 0b에서 이 목록을 **"공식 판매자임을 증명하는 allowlist"로 사용하면 안 된다.**

허용되는 사용은 다음 수준뿐이다.

- platform store URL이 알려진 shopping host에 있는지 확인하는 보조 신호
- 명백히 쇼핑 플랫폼이 아닌 host를 조기에 거부

최종 자격 판정은 AAL2 관리자가 수행한다.

인정 대상:

- 브랜드 공식몰
- 생산자/업체 직영몰
- 업체가 직접 운영하는 플랫폼 내 공식 스토어

거부 대상:

- 제3자 리셀러
- marketplace 자체를 하나의 provider로 등록
- 검색 결과/카테고리 페이지
- 개별 상품 URL을 provider identity로 사용

외부 URL을 서버가 fetch하여 자동 판별하지 않는다. SSRF/리다이렉트 추적을 PR 0b에 도입하지 않는다.

## 5. 원자적 생성 순서

한 RPC 호출 안에서 다음을 모두 처리한다.

1. AAL2 관리자 확인
2. category / brand / name / URL / store identity 검증
3. canonical store key 기준 advisory transaction lock
4. `online_stores` 조회 또는 생성
5. 해당 store의 `providers(kind='online_store')` 조회 또는 생성
6. provider-brand 일관성 검증/연결
7. `(provider_id, category_id)` 기준 advisory transaction lock
8. 기존 `item_providers` item 조회 또는 새 item 생성
9. 새 item은 반드시:
   - `brand_id = null`
   - `status = 'active'`
   - `external_source = 'onepick_provider'`
   - `external_id = '<provider_id>:<category_id>'`
10. `item_providers(item_id, category_id, provider_id)` 생성
11. `item_channels(item_id, 'online', official_url, true)` 생성/갱신
12. 결과 ID 반환

어느 단계에서든 실패하면 호출 전체가 rollback되어야 한다.

특히 다음 부분 상태를 허용하지 않는다.

- `onepick_provider` item만 있고 `item_providers`가 없는 상태
- online provider item에 `item_places`가 붙은 상태
- provider-backed item 자체에 `items.brand_id`가 설정된 상태

## 6. 재호출 / 중복 규칙

동일 canonical store + 동일 category 재호출은 기존 provider와 item을 재사용한다.

### online store

- `online_stores.store_key`가 identity key
- 같은 store_key면 같은 online store
- `store_type`, `host`, `platform`, `store_key`는 생성 후 identity 필드로 취급
- `official_url`은 같은 store identity 안에서 관리자에 의해 갱신 가능

PR 0b에서 online store identity 필드 변경을 막는 DB guard를 추가한다.

### provider

- `online_store_id` unique 규칙에 따라 store 하나당 online provider 하나
- 기존 provider가 `hidden` 또는 `pending`이면 upsert RPC가 묵시적으로 `active`로 되돌리지 않는다
- 재활성화는 별도 상태 RPC를 사용한다

### item

- PR 0a의 `unique(provider_id, category_id)`가 최종 중복 방지선
- display name만 같다는 이유로 다른 provider를 합치지 않는다

## 7. Brand 연결

provider의 brand는 `providers.brand_id`에서만 표현한다.

provider-backed item은 항상 `items.brand_id = null`이다.

### 생성 시

`p_brand_id`가 null이면 brand 없는 provider를 허용한다.

기존 provider의 `brand_id`가:

- null + 입력 brand 있음 → 연결 가능
- 입력 brand와 동일 → idempotent
- 다른 non-null brand → 자동 재연결하지 않고 `PROVIDER_BRAND_CONFLICT`

### 별도 RPC

```sql
public.admin_set_provider_brand(
  p_provider_id uuid,
  p_brand_id uuid -- null이면 연결 해제
)
returns public.providers
```

AAL2 관리자만 실행 가능하다.

brand를 연결/해제할 때 provider-backed item의 `items.brand_id`는 수정하지 않는다.

## 8. Provider 상태 변경

```sql
public.admin_set_provider_status(
  p_provider_id uuid,
  p_status text
)
returns public.providers
```

허용 값은 PR 0a와 동일하게 `pending | active | hidden`.

- `hidden`/ `pending`: 새 Pick 차단
- 기존 Pick 기록은 유지
- `active`: 다시 새 Pick 가능
- offline provider의 최종 Pick 가능 여부는 기존처럼 `places.is_visible`도 함께 만족해야 함

upsert RPC가 기존 hidden/pending provider를 자동 활성화하지 않으며, 상태 변화는 별도 관리자 의사결정으로 감사 로그에 남긴다.

## 9. `items.brand_id` 우회 방지

PR 0a는 `item_providers`를 새로 만들 때 brand conflict를 검사하지만, 이후 일반 관리자 item 수정 경로가 `items.brand_id`를 직접 설정할 수 있다.

PR 0b에서 이를 구조적으로 막는다.

규칙:

```
item_providers에 item_id가 존재
AND new.items.brand_id IS NOT NULL
=> ITEM_PROVIDER_BRAND_CONFLICT
```

즉, provider-backed item의 브랜드는 항상 provider를 통해서만 해석한다.

RPC도 같은 규칙을 명시적으로 검사하고, DB trigger가 direct table API 우회를 최종 차단한다.

## 10. `onepick_provider` orphan 방지

PR 0b migration에는 다음 invariant를 추가한다.

`external_source='onepick_provider'`인 active/discontinued item은 정확히 하나의 `item_providers` 행을 가져야 한다.

검사는 multi-statement 생성 흐름을 허용하도록 deferred constraint trigger로 구현한다.

반대 방향도 확인한다.

- online provider item → `external_source='onepick_provider'`
- offline provider item → `external_source='onepick_place'`

기존 provider 없는 콘텐츠/식품 item에는 적용하지 않는다.

## 11. `admin_merge_pending_item` guard

기존 일반 사용자 pending item을 provider-backed target으로 merge하는 것은 허용할 수 있다. target provider의 identity는 그대로 유지되며 source만 merged 상태가 된다.

반대로 **provider-backed source item을 merge source로 사용하면 안 된다.**

따라서 merge 시작 전에:

```sql
if exists (
  select 1 from public.item_providers
  where item_id = p_source_item_id
) then
  raise 'SOURCE_PROVIDER_ITEM_NOT_MERGEABLE';
end if;
```

target이 provider-backed인 것은 허용한다.

이 guard는 provider identity가 merge 처리로 고아/숨은 관계가 되는 것을 막는다.

## 12. 감사 로그

기존 `public.admin_audit_logs.entity_type`에 최소 다음 값을 추가한다.

- `provider`
- `online_store`

`private.log_admin_audit()`에 summary를 추가하고 다음 trigger를 설치한다.

- `providers`: insert/update/delete
- `online_stores`: insert/update/delete

provider summary에는 최소:

- name
- kind
- status
- brand_id
- place_id 또는 online_store_id

online_store summary에는 최소:

- store_type
- host
- platform
- store_key
- official_url

를 남긴다.

온라인 item 자체는 기존 `items_admin_audit` trigger가 기록한다.

## 13. 예상 migration 구조

PR 0b 구현 migration은 다음 책임을 한 파일에 묶는다.

```
supabase/migrations/<timestamp>_add_online_provider_admin_workflow.sql
```

포함 항목:

1. URL/store identity helper
2. online store identity immutability guard
3. provider-backed item brand guard
4. onepick_provider orphan/identity invariant
5. private admin upsert impl
6. public admin upsert wrapper
7. provider brand RPC
8. provider status RPC
9. admin_merge_pending_item provider guard
10. admin audit entity 확장 + triggers
11. 권한 revoke/grant

PR 0a migration 파일을 수정하지 않는다. PR 0b는 #283 병합 뒤 새 additive migration으로 추가한다.

## 14. 테스트 계획

PR 0a의 `069_provider_foundation.sql` 다음 별도 pgTAP 파일을 추가한다.

예상:

```
supabase/tests/070_online_provider_admin.sql
```

### 권한

- anonymous → upsert 실패
- 일반 AAL1 사용자 → 실패
- allowlisted AAL1 관리자 → 실패
- 일반 AAL2 사용자 → 실패
- allowlisted AAL2 관리자 → 성공

### 정상 생성

- official_site store/provider/item 생성
- platform_store store/provider/item 생성
- brand null 생성
- 기존 brand 연결 생성
- online item channel이 primary online URL을 가짐
- item.brand_id는 null
- item.external_source는 onepick_provider
- item.external_id는 provider/category identity와 일치

### idempotency / concurrency

- 동일 store/category 재호출 → 같은 store/provider/item
- 같은 store의 다른 category → 같은 provider, 다른 item
- 다른 store의 같은 이름 → 다른 provider/item
- 중복 동시 호출을 unique + advisory lock이 방어

### 거부

- non-HTTPS URL
- 잘못된 host
- official_site + platform 입력
- platform_store + platform/store_key 누락
- store_key prefix 불일치
- 존재하지 않는 brand
- 기존 provider와 다른 brand를 upsert로 강제 변경
- hidden/pending provider를 upsert로 자동 활성화
- provider-backed item에 items.brand_id 직접 설정
- onepick_provider orphan item
- online provider item에 item_places 추가
- provider-backed source를 admin_merge_pending_item source로 사용

### 상태

- active → hidden 후 새 Pick 거부
- 기존 Pick 유지
- hidden → active 후 새 Pick 가능
- 상태 변경 audit 생성

### 감사

- online_store insert audit
- provider insert audit
- provider brand update audit
- provider status update audit
- 클라이언트가 audit row 직접 위조 불가

### 회귀

기존:

- `admin_upsert_place_item`
- `select_place_catalog_item`
- content provider 없는 item Pick
- offline place visibility gate
- 일반 pending item → provider target merge

동작이 유지되어야 한다.

## 15. 구현 파일 범위

PR 0b 구현 시 예상 변경 파일:

```
supabase/migrations/<timestamp>_add_online_provider_admin_workflow.sql
supabase/tests/070_online_provider_admin.sql
docs/provider-online-admin.md
mobile/src/lib/supabase/database.types.ts   # RPC/generated schema type 반영 시
```

PR 0b에는 관리자 화면을 추가하지 않는다. 관리자 UI/route와 `admin-api.ts` 호출 연결은 RPC가 안정화된 다음 PR에서 진행한다.

## 16. 완료 기준

- [x] PR #283이 먼저 병합되어 provider foundation이 main에 존재
- [x] #165 안정화 게이트 해제 조건 확인
- [ ] AAL2 admin만 온라인 provider 쓰기 RPC 실행 가능
- [ ] store → provider → item → item_providers → online channel 생성이 한 transaction
- [ ] 실패 시 부분 row가 남지 않음
- [ ] 같은 store/category 재호출이 idempotent
- [ ] provider-backed item의 `items.brand_id` 직접 설정 차단
- [ ] `onepick_provider` orphan item 차단
- [ ] provider-backed merge source 차단
- [ ] provider / online_store 감사 로그 생성
- [ ] PR 0a provider pgTAP + PR 0b pgTAP 전체 통과
- [ ] 기존 DB 전체 테스트 통과
- [ ] Web build / Mobile CI / Database Tests 통과
- [ ] 운영/테스트 DB migration apply는 별도 승인 전 실행하지 않음

## 17. PR 0b 이후

후속 PR에서 다음을 진행한다.

1. 관리자 provider 생성/검색 UI
2. 온라인/오프라인 provider 통합 검색/선택 UX
3. provider 프로필 화면
4. 일반 사용자 신규 provider 제보 흐름 + moderation
5. 다중 탐색 taxonomy / category group 확장

PR 0b는 **provider identity와 관리자 쓰기 경로를 안전하게 고정하는 DB 경계**까지만 담당한다.
