# 즉시 등록·원픽 교체 서버 계약 (2026-09-28)

#448 서버 인계 1번의 DB 계약이다. 마이그레이션
`20260928190000_add_immediate_pick_registration.sql`, pgTAP `104_register_item_pick.sql`.
앱 연결은 Codex 담당이다.

## 사용자 결정

- 채널 → 상호 → 필요한 링크 → 메뉴 → 필수 사진 → 1~100자 한줄평을 **한 번의 호출**로
  저장하고 item/pick ID를 돌려준다.
- 새 제품은 **본인에게만 보이다가 승인 후 공개**된다(09-28 결정). 등록 즉시 본인의 현재
  원픽이 되며, 승인/검토 중/등록 완료 상태는 사용자에게 노출하지 않는다.
- 같은 메뉴·채널의 기존 선택이 있으면 앱이 변경 확인을 받은 뒤 교체한다. 취소/실패에는
  기존 선택이 보존된다(서버는 성공 시에만 교체).
- 내부 검토에서 수정이 필요할 때만 알림(사유 포함) → 기존 값 수정 → 재요청 → 홈.

## `register_item_pick(...)` → `jsonb`

| 인자 | 설명 |
| --- | --- |
| `p_category_id` | 메뉴(음식 leaf, pickable) |
| `p_channel` | `offline` / `online` / `recipe` |
| `p_one_line_review` | 1~100자 |
| `p_item_id` | 기존 제품(공개된 것, 또는 내 대기 요청). 레시피는 youtube-catalog가 만든 item |
| `p_catalog_id` | offline: 매장 카탈로그 id. 처음 고르는 매장은 내 대기 요청으로 생성 |
| `p_provider_id` | online: 판매처 provider id. 처음인 판매처×메뉴는 내 대기 요청으로 생성 |
| `p_link_url` | online 새 제품의 **개별 구매 링크**(https, 필수). 판매처 홈 주소는 그대로 둔다 |
| `p_image_path`, `p_thumbnail_path`, `p_image_source_url` | 제품에 사진이 없을 때 필수. 내 `item-photos` 업로드(JPEG) |
| `p_expected_previous_pick_id` | 앱이 보여준 그 메뉴·채널의 현재 원픽 id. 없으면 `null` |
| `p_request_id` | 클라이언트 생성 uuid. 재시도 시 같은 값 |

반환: `{item_id, pick_id, published, replaced_pick_id, retried}`.
`published=false`면 검토 전이라 본인에게만 보인다(앱은 "승인 대기" 문구를 쓰지 않는다).

에러(`P0001`, message): `PICK_CHANNEL_INVALID`, `CATEGORY_NOT_PICKABLE`, `REVIEW_INVALID`,
`ITEM_SELECTION_REQUIRED`, `ITEM_NOT_FOUND`, `ITEM_CATEGORY_MISMATCH`, `ITEM_NOT_ELIGIBLE`,
`ITEM_ALREADY_PENDING`(다른 사람이 먼저 요청한 매장/판매처), `ITEM_LINK_REQUIRED`,
`LINK_INVALID`, `PICK_CHANNEL_MISMATCH`, `PHOTO_REQUIRED`, `PHOTO_INVALID`,
`ITEM_ALREADY_PICKED`(같은 제품을 다른 채널로 이미 선택), `RATE_LIMITED`(하루 20건 요청),
**`PICK_CHANGED_ELSEWHERE`**(DETAIL에 실제 현재 원픽 id, 없으면 빈 문자열 → 앱은 다시 확인),
`USER_SUSPENDED`(`42501`).

동작:
- 같은 제품을 다시 등록하면 한줄평만 갱신하고 같은 `pick_id`를 돌려준다.
- `p_request_id`가 이미 저장된 원픽과 일치하면 아무것도 만들지 않고 `retried=true`로 돌려준다.
- 기존 현재 원픽은 `replaced`로 끝나고 `replaced_by_pick_id`가 새 원픽을 가리킨다. 한줄평·댓글은
  남는다(#467 계약).
- 새 제품의 원픽 상태는 `needs_review`다. `picks` RLS상 본인만 읽고, 홈·탐색 피드(`status='active'`)에는
  나오지 않는다. 프로필의 내 원픽 목록은 `statuses:['active','needs_review']`로 읽어야 본인에게 보인다.
  `item_review_page`는 제품이 공개된 뒤부터 보여준다.
- 사진 검증은 `attach_item_photo`와 같다(첫 유효 사진이 채택).

## `revise_item_request(p_item_id, p_link_url, p_image_path, p_thumbnail_path, p_image_source_url, p_remove_photo)` → `items`

수정 필요 알림(`item_review_notifications.outcome='rejected'`, `reason`) 뒤에 내 요청(pending/rejected)의
링크(offline은 네이버 지도 링크, 그 외 https)와 사진을 바꾸고 다시 검토 줄에 넣는다.
내 `needs_review` 원픽은 그대로 현재 원픽이다. 한줄평 수정은 기존 `update_pick_review`.

## 검토 결과가 원픽에 미치는 영향 (트리거)

- 승인 → 요청에 걸린 `needs_review` 원픽이 `active`가 되어 공개된다.
- 병합 → 대상 제품으로 옮겨 `active`. 대상 메뉴·채널에 이미 현재 원픽이 있으면 그것이 `replaced`,
  이미 대상 제품을 갖고 있으면 요청 원픽이 `replaced`. `admin_merge_pending_item`은 `needs_review`
  원픽이 있는 요청도 병합할 수 있다(그 외 상태의 원픽이 있으면 `SOURCE_ITEM_IN_USE` 그대로).
- 반려 → 원픽은 `needs_review`로 남아 본인만 본다. 사유는 기존 반려 알림으로 전달된다.
- 기존 `pending_item_picks`(의도 저장) 경로는 그대로 동작한다.

## 앱 연결 체크리스트 (Codex)

1. 등록 플로우 저장 버튼 → `register_item_pick` 한 번. 저장 전 그 메뉴·채널의 현재 원픽 id를 읽어
   `p_expected_previous_pick_id`로 넘기고, `PICK_CHANGED_ELSEWHERE`면 최신 선택으로 다시 확인.
2. 재시도는 같은 `p_request_id`.
3. 사진 업로드 → 경로를 인자로. 기존 제품(`hasPhoto`)이면 생략.
4. 프로필 내 원픽 읽기에 `needs_review` 포함. "승인 대기/등록 요청 내역" UI 없음.
5. 수정 필요 알림 → 수정 화면 → `revise_item_request` → 홈.
6. `database.types.ts` 재생성(`register_item_pick`, `revise_item_request`, `picks.client_request_id`).

## 배포

병합 후 Actions **Deploy Database Migrations**(dry-run → apply). 앱 연결 PR은 배포 후.
