# 프로필 SNS 링크 (MVP)

## 사용자 이용 / UX
- 내 프로필과 공개 프로필의 SNS 영역에서 본인만 연결·수정·해제한다.
- Instagram, YouTube, X, Threads, 네이버 블로그를 각 1개씩 연결한다.
- 사용자명 또는 프로필 주소를 입력한다. YouTube는 한글 핸들과 `/channel/UC...` 주소도 지원한다.
- 입력은 선택사항이다. 저장 전에 공개 링크라는 안내를 표시한다.
- SNS 로그인, 계정 소유 인증, 게시물 가져오기 기능이 아니다. 인증된 계정 표시를 하지 않는다.
- 등록하지 않은 SNS는 방문자에게 표시하지 않는다. 웹에서는 외부 링크를 별도 탭으로 연다.

## 프런트 / 백엔드
- `ProfileSocialLinks` → `useSocialLinks` → `SocialLinksService` 구조.
- 읽기 캐시는 방문자와 프로필 사용자별로 분리하고, 계정 변경 시 편집 상태를 초기화한다.
- 저장 전 서버 인증 사용자와 수정 대상 사용자를 비교한다. DB RLS에서 소유권을 다시 강제한다.
- 기존 세션 클라이언트를 재사용하며 추가 패키지나 비밀키는 필요하지 않다.
- `profile_social_links`는 사용자/플랫폼 복합 기본키, URL 제약, 프로필 삭제 시 cascade를 적용한다.
- 공개 조회는 기존 profiles RLS를 따라 정지 및 사용자 차단 규칙을 유지한다.
- 저장, 조회 및 외부 링크 실행 시 검증한다. HTTPS와 허용한 SNS 호스트/프로필 경로만 사용한다.

## 검증
- `node mobile/scripts/test-social-links.cjs`: URL 검증, CRUD/권한 오류, 계정별 캐시, 공개/본인 UI.
- `supabase/tests/017_profile_social_links.sql`: RLS, CRUD, URL 제약, 차단, 익명 접근, 삭제 cascade.
- 운영 DB 검증은 임시 계정/데이터를 트랜잭션 안에서 생성한 뒤 전부 rollback한다.

댓글 알림은 기존 앱 내 알림 기능을 유지한다. 휴대폰 푸시는 포함하지 않는다.
