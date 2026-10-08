# 홈 질문 메뉴 자동 선정

사용자 결정: 2026-10-08. 관리자가 질문 메뉴를 지정하지 않고 DB의 메뉴 중에서 매일 랜덤으로 가져옵니다.

- `home_daily_question()`이 공개된 열린 음식 메뉴 leaf 중 하나를 반환합니다.
- 한국 날짜(Asia/Seoul)와 메뉴 UUID를 섞은 해시 순서로 하루의 메뉴를 선정합니다. 같은 날짜·같은 대상 목록이면 로그인 여부, 새로고침, DB 세션 시간대에 관계없이 같은 메뉴를 반환합니다.
- 날짜마다 새로 추첨하므로 전날 메뉴가 다시 뽑힐 수 있습니다. 메뉴가 추가되거나 비공개/종료되면 유효한 목록을 다시 기준으로 삼습니다.
- 앱은 한국 자정 이후 다시 조회하고, 앱으로 복귀하거나 네트워크가 복구되면 서버 결과를 다시 확인합니다.
- 대상이 없으면 질문 카드를 숨깁니다. DB 오류는 재시도 상태로 표시하며 관리자 설정값이나 임의 메뉴로 대체하지 않습니다.
- 기존 `home_settings.daily_question_category_id`는 홈 질문에서 읽지 않습니다. 이미 배포된 컬럼과 과거 migration은 파괴적으로 삭제하지 않습니다.
- 관리자의 질문 메뉴 선택·저장·숨김 편집기는 제거합니다. 기존 구버전 상품 집계 설정은 별개로 유지합니다.

배포 의존성: `20261007232019_daily_random_home_question.sql`. 독립 DB 리뷰와 전체 DB 검사 후 사용자 승인으로 운영 적용합니다. 닉네임·질문 이미지와는 별도 계약입니다.

검증 상태: 실제 `category_is_open_leaf`와 `category_is_food` 함수 정의를 사용한 격리 PostgreSQL 실행에서 비음식 제외, 상위 음식 분류 숨김 시 null, 단일 후보 반환, 비회원·회원·세션 시간대 간 동일 결과를 확인했습니다. `125_home_daily_random_question.sql`에는 선택 메뉴 숨김·음식 루트 숨김·복구 검사를 추가했습니다. 격리 실행에 이어, PR #825의 head `9a684ba278dcfab88a10a1c7647b2be485de1e29`에서 전체 Supabase DB CI가 통과했습니다(129 files / 979 tests, [run 37703463302](https://github.com/orrysheaven-netizen/onepick/actions/runs/37703463302)). [Claude 독립 DB 리뷰](https://github.com/orrysheaven-netizen/onepick/pull/825#pullrequestreview-5449753995)는 High 0 / Medium 0 / Low 2로 완료됐습니다. Low 1인 검증 문서 상태를 이 변경으로 갱신하며, 미사용 관리자 설정 권한·트리거 정리(Low 2)는 #827에서 추적합니다. 이후 문서만 변경된 커밋의 CI 결과는 PR에서 별도로 확인합니다. main 병합과 운영 DB 적용은 아직 수행하지 않았으며 사용자 승인이 필요합니다.
