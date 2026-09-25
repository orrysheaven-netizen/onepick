# 문화예술 카테고리의 여러 원픽

상태: 구현됨. 마이그레이션은 `20260926140000_allow_multiple_culture_picks.sql`, DB 테스트는 `supabase/tests/080_multiple_culture_picks.sql`이다.

## 왜 필요한가
- 영화·책처럼 작품이 많은 분야는 하나만 고르면 취향 신호가 너무 적다. 여러 작품이 모여야 AI 취향 분석에서 공통점과 대비를 읽을 수 있다.
- 다른 카테고리는 "카테고리마다 단 하나"라는 원픽의 정체성을 그대로 지킨다.

## 규칙
- `categories.max_picks`로 카테고리마다 현재 원픽 상한을 정한다. 기본값은 1이다.
  - 5로 여는 카테고리: `movie`, `drama`, `music`, `game`, `book`, `youtube`
  - `pokemon`은 취향 차원이 `culture`여도 캐릭터 카테고리라 1개로 둔다.
  - 다른 카테고리를 열 때는 SQL로 `max_picks`를 바꾼다. 관리자 화면에서 편집하는 기능은 아직 없다.
- `picks.position`은 한 사람의 카테고리 안 순서다. 1번이 대표 원픽이다.
  - 현재 원픽의 순번은 1부터 빈칸 없이 이어진다.
  - 같은 순번은 하나만 있을 수 있다. 배타 제약 `picks_one_current_per_position`이 막는다.
  - 순번은 `max_picks`를 넘을 수 없다. 트리거 `check_pick_slot`이 막는다.
  - 두 조건 때문에 개수 상한은 따로 세지 않아도 지켜진다.
- 같은 아이템을 동시에 두 번 원픽할 수 없다. 고유 인덱스 `picks_one_current_per_item`이 막는다.
- 관리자가 `max_picks`를 낮춰도 이미 있는 원픽은 지우지 않는다. 다음 쓰기부터 새 상한이 적용된다.

## RPC
- `change_pick(..., p_replace_pick_id default null)`
  - 이미 가진 아이템을 다시 고르면 그 원픽의 한줄평과 링크만 고친다.
  - `p_replace_pick_id`가 있으면 그 원픽을 새 아이템으로 바꾼다. 새 원픽은 순번을 이어받고, 옛 원픽은 `replaced` 기록으로 남는다.
  - `p_replace_pick_id`가 없으면 빈 순번에 추가한다.
  - 빈 순번이 없을 때 1개 카테고리는 기존처럼 그 원픽을 바꾼다. 여러 개 카테고리는 `PICK_LIMIT_REACHED`를 낸다. 어느 원픽을 내릴지는 사용자가 정해야 한다.
- `remove_pick(p_category_id, p_pick_id default null)`
  - 해제할 원픽을 pick id로 받는다.
  - 카테고리만 넘기면 원픽이 하나일 때만 동작하고, 여럿이면 `PICK_ID_REQUIRED`를 낸다.
  - 해제한 뒤 남은 원픽의 순번을 당긴다. 대표 원픽을 해제하면 다음 원픽이 대표가 된다.
- `set_representative_pick(p_pick_id)`: 고른 원픽을 1번으로 올리고, 그 앞에 있던 원픽을 한 칸씩 뒤로 민다. `started_at`은 그대로라 피드 순서도 바뀌지 않는다.

## 집계
- 사람 수를 세는 집계는 대표 원픽(`position = 1`)만 센다. 한 사람은 카테고리당 한 번만 집계된다.
  - 대상: `category_top_items`, `category_top_items_v2`, `home_showcase`, `home_showcase_page`, `home_editorial_items`
- 홈·팔로잉 피드는 원픽을 하나하나 보여주므로 모든 현재 원픽이 나온다.
- 팔로우 알림은 추가와 교체 때 보낸다. 같은 카테고리 알림은 15분 안에 한 번으로 묶는다. 순서 변경과 해제는 알리지 않는다.
- 교체 쿼터는 1개 카테고리에서는 기존 규칙 그대로다. 여러 개 카테고리에서는 실제로 교체한 경우만 쿼터를 쓴다.

## AI 취향 분석
- `analyze-profile-taste`는 현재 원픽 전체를 입력으로 쓴다.
- 재분석 조건인 "의미 있는 변경 수"는 `_shared/pickChangeCount.ts`가 센다. `profile-ai-status`도 같은 코드를 쓴다.
  - 카테고리 안에서 아이템 단위로 비교한다.
  - 한줄평 수정은 1, 교체는 1, 짝 없는 추가나 해제는 각각 1이다. 순서 변경은 세지 않는다.
  - 1개 카테고리의 결과는 이전과 같다.
- `profile_ai_pick_popularity`의 분모는 "그 카테고리에 원픽이 있는 사람 수"다. 여러 개를 가진 사람도 한 번만 센다.
- `profile_taste_composition`의 비율은 카테고리 단위로 센다. 영화를 5개 고른 사람의 '문화' 비중이 다섯 배로 부풀지 않는다. `pick_count`는 표시용 실제 원픽 수로 남긴다.

## 앱
- 아이템 상세와 원픽 선택 화면은 상태를 다섯 가지로 나눈다.
  - `not_selected`: 이 카테고리에 원픽이 없다.
  - `selected_this`: 이 아이템을 이미 원픽했다. 한줄평 수정으로 이어진다.
  - `selected_other`: 1개 카테고리에 다른 원픽이 있다. 저장하면 교체된다.
  - `can_add`: 여러 개 카테고리에 빈 자리가 있다. 화면에 "지금 N개 · 5개까지"를 보여준다.
  - `category_full`: 여러 개 카테고리가 가득 찼다. 바꿀 원픽을 고르기 전에는 저장하지 않는다.
- 내 원픽 관리 화면
  - 2번 이후 원픽에는 `대표 원픽으로 지정` 버튼이 보인다.
  - 해제는 pick id로 한다.
  - 배지는 `내 원픽 N`이다.
- 프로필은 같은 카테고리 안에서 대표 원픽을 먼저 보여준다.

## 배포
머지 후 `supabase db push`를 먼저 하고, 그다음 `analyze-profile-taste`와 `profile-ai-status`를 `functions deploy`한다. 앱은 새 RPC 인자를 쓰므로 DB가 먼저 올라가야 한다.
