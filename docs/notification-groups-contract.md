# 앱 안 알림 서버 계약 (2026-09-28)

#448 서버 인계 4번의 DB 계약이다. 마이그레이션 `20260928230000_add_grouped_notifications.sql`,
pgTAP `106_grouped_notifications.sql`. 앱 연결은 Codex 담당. 푸시 알림은 없다.

## 사용자 결정 (Figma 39, 명세 D)

- 종류: 내 원픽 새 한줄평 / 내 한줄평 댓글 / 내 댓글 답글 / 수정 필요 / 팔로잉 원픽.
- 그룹: 제품 / 한줄평 / 부모 댓글 / 수정 대상 요청 / 팔로잉 사용자+메뉴+채널.
- 본인 이벤트 제외, 댓글과 답글 중복은 답글만, 한줄평 수정은 팔로잉 알림 없음.
- 탭을 열어도 읽음 처리하지 않는다. 목적지 로드 성공 후 열었던 스냅샷까지만 읽음, 그 뒤 도착한
  알림은 남는다.
- 승인/검토 중/등록 완료 이벤트는 목록과 미읽음 집계에서 모두 제외(유령 점 없음).

## 새 원천

`pick_review_notifications(pick_id, recipient_id, created_at, read_at)`: 내가 현재 원픽으로 가진
제품(item + channel)을 다른 사람이 현재 원픽으로 고르면(등록 즉시 또는 승인 시) 트리거가 만든다.
차단 관계·정지 계정 제외, 한 번에 최대 1000명.

기존 원천은 그대로: `comment_notifications(kind comment|reply)`, `pick_change_notifications`,
`item_review_notifications`(이 중 `outcome='rejected'`만 이벤트).

## RPC (모두 authenticated, security definer, 본인 것만)

### `notification_unread_count()` → `bigint`

탭 아이콘의 점. `notification_group_page`가 보여주는 이벤트의 미읽음 수와 정확히 같다.

### `notification_group_page(p_before_activity, p_before_group_id, p_limit)` → `setof jsonb`

최신 활동순 그룹. 커서는 마지막 행의 `(latest_at, group_id)`(둘 다 null이거나 둘 다 값, 아니면 `22023`).

| 키 | 설명 |
| --- | --- |
| `group_id` | 안정적인 그룹 id. `review:<item>:<channel>` / `comment:<pick>` / `reply:<parent comment>` / `fix:<item>` / `follow:<user>:<category>:<channel>` |
| `kind` | `pick_review` / `comment` / `reply` / `fix_needed` / `followee_pick` |
| `latest_at`, `snapshot` | 최신 활동 시각. `snapshot`을 읽음 처리에 그대로 넘긴다 |
| `unread_count`, `total_count`, `actor_count` | 그룹 안 미읽음/전체 이벤트 수, 서로 다른 행위자 수 |
| `actor` | 최신 행위자 `{user_id, username, profile_image_url}` (`fix_needed`는 null) |
| `target` | 목적지: `item_id, item_name, category_id, category_name, channel, pick_id, comment_id, root_comment_id, user_id` |
| `reason` | `fix_needed`의 사유 |

목적지 규칙: `pick_review` → 제품 상세(`item_id`), `comment` → 내 한줄평(`pick_id`), `reply` → 부모 댓글
(`comment_locate(root_comment_id)` 후 `pick_comment_page`), `fix_needed` → 수정 화면(`item_id`, 이후
`revise_item_request`), `followee_pick` → 그 사람의 원픽(`pick_id`).

### `mark_notification_group_read(p_group_id, p_until)` → `integer`

목적지 로드가 **성공한 뒤** 호출한다. 그 그룹에서 `p_until`(열 때의 `snapshot`)까지의 이벤트만 읽음으로
바꾸고 바뀐 행 수를 돌려준다. 이후 도착한 이벤트는 미읽음으로 남아 점이 유지된다.

## 기존 RPC

`notification_page` / `notification_count`(행 단위, 승인·병합 포함)는 현재 앱 호환을 위해 남겨 두며
새 API로 대체한다. 앱이 새 API로 옮기면 승인·병합 행은 어디에도 나오지 않는다.

## 앱 연결 체크리스트 (Codex)

1. 탭 점: `notification_unread_count()` (기존 `notification_count` 대체).
2. 알림 목록: `notification_group_page` 무한 스크롤, 그룹당 한 줄(대표 행위자 + `actor_count`, 미읽음 표시).
3. 그룹 탭 → 목적지 로드 성공 → `mark_notification_group_read(group_id, snapshot)`. 실패/취소 시 호출하지 않음.
4. 승인/검토 중/등록 완료 문구·행은 앱에서 만들지 않는다.
5. `database.types.ts` 재생성.

## 배포

병합 후 Actions **Deploy Database Migrations**(dry-run → apply). PR #469, 브랜드·지점 PR 이후 순서.
