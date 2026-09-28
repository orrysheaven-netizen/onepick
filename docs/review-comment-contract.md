# 한줄평·댓글 서버 계약 (2026-09-28)

#448 서버 인계 2번(한줄평·댓글 보존/삭제와 쓰기 권한)의 DB 계약이다. 마이그레이션
`20260928140000_add_item_review_thread_rpcs.sql`(#456)과
`20260928170000_add_comment_threads_and_review_deletion.sql`이 구현하고,
pgTAP `100`~`103`이 검증한다. 앱 연결은 Codex 담당이며, 아래 표가 연결 기준이다.

## 사용자 결정 (09-27 19:52 인계 + 09-28 답변)

- 원픽 해제·교체 후에도 한줄평과 댓글은 남고 `✓ 이 집 원픽` 깃발만 사라진다.
- 한줄평 삭제는 별도 동작이다. 현재 한줄평을 삭제하면 원픽도 해제된다.
  댓글이 달린 한줄평은 작성자·본문·깃발을 지운 자리(`is_deleted`)로 남고 대화가
  유지된다. 댓글이 없으면 상품 상세에서 사라진다.
- 댓글은 한 단계 답글을 가진다. 답글이 있는 댓글 삭제는 자리를 남기고, 마지막
  답글이 지워지면 자리도 사라진다.
- 새 댓글/답글은 **작성자가 지금 정확히 같은 제품·채널을 현재 원픽으로 가진 경우**
  또는 **그 한줄평의 작성자**만 쓸 수 있다. 끝난 한줄평에도 쓸 수 있고, 삭제된
  한줄평·숨김 스레드는 읽기 전용이다.
- 종료 시각, 교체 대상, 이전 선택은 어떤 응답에도 없다. 사람 단위로 과거 원픽을
  나열하는 경로는 없다.

## RPC

### `item_review_page(p_item_id, p_after_is_current, p_after_started_at, p_after_id, p_limit)` → `setof jsonb`

상품 상세 한줄평. 현재(`is_current`) 먼저, 끝난 것 뒤. 커서는 마지막 행의
`(is_current, started_at, id)` 세 값(셋 다 null이거나 셋 다 값, 아니면 `22023`).
anon/authenticated 실행 가능.

| 키 | 설명 |
| --- | --- |
| `id`, `category_id`, `item_id`, `channel`, `started_at` | 항상 |
| `user_id`, `one_line_review`, `profile` | 삭제된 한줄평이면 `null` |
| `is_current` | 현재 원픽 여부. 삭제된 한줄평은 항상 `false` |
| `is_deleted` | 삭제 자리 여부. 댓글이 하나라도 살아 있을 때만 행이 나온다 |
| `comment_count` | 살아 있는 댓글+답글 수(삭제 자리 제외) |
| `can_comment` | 호출자가 이 한줄평 아래에 쓸 수 있는지 |
| `can_manage` | 호출자가 작성자이고 삭제되지 않았는지(수정·삭제 버튼) |
| `category`, `item` | 임베드 행 |

`status`, `ended_at`, `replaced_by_pick_id`, `updated_at`, `created_at`, `purchase_*`,
`review_deleted_at`은 반환하지 않는다.

### `pick_comment_page(p_pick_id, p_after_time, p_after_id, p_limit)` → `setof jsonb`

한 한줄평 아래 **최상위 댓글**을 오래된 순으로. 각 행에 `replies`(답글 배열, 오래된 순)와
`reply_count`가 들어 있다. 커서는 최상위 댓글의 `(created_at, id)`. 보이지 않는
스레드는 빈 결과(존재 여부 비노출).

댓글/답글 행 키: `id`, `pick_id`, `parent_comment_id`, `created_at`, `is_deleted`,
`user_id`·`body`·`updated_at`·`author`(삭제 자리면 `null`),
`author_current_pick_matches_item`(`✓ 이 집 원픽`; 삭제 자리는 `false`),
`can_edit`, `can_delete`(호출자 기준. 정지된 작성자는 삭제만 가능해 `can_edit=false`).

### `can_comment_on_pick(p_pick_id)` → `boolean`

입력창 표시 여부. `item_review_page.can_comment`와 같은 규칙.

### 댓글 쓰기 (테이블 직접 insert/update, 기존과 동일 경로)

- `insert into comments(pick_id, user_id, body[, parent_comment_id])`. RLS가 위 자격을
  검사한다(위반 시 `42501`). `parent_comment_id`는 같은 한줄평의 **최상위**, 살아 있는
  댓글이어야 한다(`COMMENT_PARENT_INVALID`). `deleted_at`은 서버가 항상 null로 만든다.
- 수정은 본인 댓글의 `body`만, 스레드가 보일 때. 삭제 자리는 수정 불가.
- 분당 10회 쓰기 제한은 그대로(`RATE_LIMITED`).

### `delete_comment(p_comment_id)` → `'removed' | 'tombstoned'`

본인 댓글만(`COMMENT_NOT_FOUND`). 살아 있는 답글이 있으면 자리를 남기고
`tombstoned`, 아니면 `removed`. 마지막 답글 삭제 시 부모 자리도 자동 제거.
기존 `delete from comments`도 같은 동작을 한다(자리를 남기면 영향 행 0).

### `delete_pick_review(p_pick_id)` → `jsonb`

본인 한줄평만(`PICK_NOT_FOUND`; 숨김·이미 삭제 포함). 현재 원픽이면 함께 해제한다.

| 키 | 설명 |
| --- | --- |
| `pick_id`, `category_id`, `item_id`, `channel` | 대상 |
| `was_current` | 삭제 전 현재 원픽이었는지(해제됨) |
| `outcome` | `tombstoned`(댓글이 있어 자리 유지) / `removed` |

삭제 후 같은 제품을 다시 고르면 새 행이 생긴다. 삭제된 한줄평 아래에는 새 댓글을
쓸 수 없다. 정지된 계정은 본인 댓글 삭제는 가능하지만, 원픽·한줄평 변경은 기존 AI 평가
쿼터 가드(`reject_suspended_quota_owner`)가 막는다(`remove_pick`과 동일한 기존 동작).

### `comment_locate(p_comment_id)` → `jsonb | null`

알림·프로필에서 특정 댓글로 이동할 때. `root_comment_id`(답글이면 부모), `pick_id`,
`item_id`, `category_id`, `channel`, `review_is_current`, `review_is_deleted`,
`page_after_time`/`page_after_id`(둘 다 null이면 첫 페이지; 아니면 이 커서로
`pick_comment_page`를 부르면 첫 행이 `root_comment_id`). 볼 수 없으면 `null`.

### `my_comment_page(p_after_time, p_after_id, p_limit)` → `setof jsonb`

내 댓글 전체(삭제한 것 제외), 최신순, 커서 `(created_at, id)`. 끝난·삭제된 한줄평의
댓글도 포함한다. 행: `comment`(위 댓글 행), `pick`(`id`, `item_id`, `category_id`,
`channel`, `is_current`, `is_deleted`, `user_id`·`one_line_review`·`profile`은 삭제 시
`null`), `item`, `category`, `thread_visible`(상품 상세에서 아직 보이는지).
기존 `comments` 테이블 직접 조회(`getCommentsByUser`)는 끝난 타인 원픽의 내 댓글도
읽히지만 한줄평 컨텍스트는 RLS로 비어 있으므로 이 RPC로 교체한다.

## 알림 (기존 `notification_page` 유지, PR 4에서 그룹화 예정)

- 최상위 댓글 → 한줄평 작성자에게 `kind='comment'`(원픽이 끝났어도).
- 답글 → 부모 댓글 작성자에게만 `kind='reply'`(한줄평 작성자에게 중복 발송 없음).
  자기 댓글에 단 답글은 한줄평 작성자에게 `comment`로 간다.
- 본인 이벤트·차단 관계는 제외. `comment_notifications.kind`로 구분한다.
  `notification_page`의 `kind` 열은 앱 호환을 위해 아직 `'comment'`다.
- 삭제된(자리만 남은) 댓글의 알림은 목록·미읽음에서 사라진다.
- 알림 수신자가 작성자를 차단하거나 스레드가 더 이상 보이지 않으면, 과거 알림 행이 있어도
  댓글 직접 조회·목록·미읽음에서 모두 사라진다.

## 앱 연결 체크리스트 (Codex)

1. `itemService.getPicks({itemId, statuses:['active']})` → `item_review_page`. `ItemReviewCard`는
   `is_current`/`is_deleted`/`can_comment`/`can_manage`로 판단하고 `status`를 보지 않는다.
2. `getCommentsByPickId` → `pick_comment_page`(답글 중첩). 댓글 입력창은 `can_comment`.
3. 댓글 삭제 → `delete_comment`; 한줄평 삭제 → `delete_pick_review`; 원픽 해제(`remove_pick`)는
   그대로 별개 동작.
4. 프로필 내 댓글 → `my_comment_page`; 댓글 위치 이동 → `comment_locate` 후 `pick_comment_page`.
5. `database.types.ts` 재생성(새 RPC 5개, `comments.parent_comment_id/deleted_at`,
   `picks.review_deleted_at`, `comment_notifications.kind`).

## 배포

병합 후 GitHub Actions **Deploy Database Migrations**(dry-run → apply). 앱 연결 PR은
배포 성공 후 진행한다.
