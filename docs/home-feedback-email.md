# 의견 수신 이메일

사용자 요청: 2026-10-08 “이메일을 적용할 수 있게 관리자 탭에 만들어주세요.”
Refs #830, #762

- 관리자 → 앱 설정 → 의견 수신 이메일 (`/admin/data?tab=feedback`).
- 공개 수신 주소 한 개를 저장·변경하거나 비워서 연결을 해제한다. 초기값은 NULL이며 임의 주소를 넣지 않는다.
- `home_settings.feedback_email`만 갱신한다. 기존 singleton, 공개 SELECT, allowlist + AAL2 UPDATE RLS, updated_at trigger를 재사용한다. INSERT/upsert/새 정책/RPC 없음.
- 클라이언트와 DB가 단일 이메일 형식을 검사한다. 표준 ASCII unquoted mailbox(로컬 최대 64자, 전체 254자)를 지원한다. 표시명, mailto URL, 복수 주소, CRLF는 받지 않는다.
- 저장 결과를 `.select(...).single()`로 받아 RLS가 0행을 수정한 경우 성공으로 표시하지 않는다. 실패 시 입력 보존, 연속 클릭 중복 쓰기 차단, 계정 변경 시 폼 remount.
- `HomeFeedbackButton`은 저장된 주소로 `mailto:`를 연다. 주소와 제목을 인코딩하고 사용자 ID·토큰·진단 로그를 첨부하지 않는다. 메일 발송/자동 전송은 하지 않는다. 메일 앱 열기 실패 시 복사 가능한 수신 주소를 안내한다.
- 미설정·읽기 실패 시 홈 연결을 노출하지 않는다. 공개 캐시는 60초 staleTime과 기본 focus/reconnect 갱신을 사용하고 관리자 저장 성공 시 즉시 갱신한다.

## 홈 #777 연결

홈 책임 PR에서 `HomeFeedbackButton`을 import하고 기존 친구 초대 영역에 함께 배치한다. 홈 전체 파일은 이 PR에서 수정하지 않아 병렬 작업을 피한다. 설정 migration 운영 적용 후 연결하며, 등록된 이메일/미설정/실패 상태와 메일 작성 화면 열기를 검증한다.

## 릴리스

필수 CI, Claude 독립 DB/권한 리뷰, 사용자 main 병합 승인 → 공식 DB dry-run/apply 승인 → 운영 읽기/관리자 저장 QA → #777 통합 QA. 코드 구현은 운영 적용·실제 주소 설정 완료를 뜻하지 않는다.
