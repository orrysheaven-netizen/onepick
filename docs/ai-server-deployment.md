# AI 평가 서버 배포 기록

## 2026-09-19 첫 서버 배포

`onepick-dev` (`ygoipwzakzdnkaaxyrgb`)에 `analyze-profile-taste` Edge Function을 실제 배포했다. 배포 결과는 `ACTIVE`, 버전 1, 함수 ID `0d217e18-a08c-49b8-91ca-2b6deea4d27e`이다. 이 기록은 이전 기능 기획/검증 문서의 '함수 미배포' 상태를 갱신한다. 앱 프런트엔드 배포나 PR 병합을 뜻하지 않는다.

## 키가 없어도 안전하게 배포하는 방식

- `GET /functions/v1/analyze-profile-taste/status`는 서비스 이름, 상태, 필수 설정의 존재 여부를 나타내는 `configured` 불리언만 돌려준다.
- 상태 확인은 DB, 인증 서비스, AI 공급자를 호출하지 않는다. 계정 정보·원픽·API 키 이름/값을 응답하지 않는다.
- `configured=true`는 환경변수가 비어 있지 않다는 뜻일 뿐, 키 유효성·모델 접근 권한·잔액·실제 생성 성공을 검증한 것이 아니다.
- `configured=false`는 필수 설정 중 하나 이상이 비어 있다는 뜻이다. 이 응답만으로 어떤 설정이 빠졌는지 단정하지 않는다.
- 모델 생성 POST는 반드시 Supabase Auth의 `getUser(token)`으로 사용자를 검증한다. 익명 로그인 사용자, 비로그인 요청, 위조 토큰은 거부한다.
- 로그인 검증 뒤 OpenAI 키가 없으면 `AI_NOT_CONFIGURED`를 반환하며 모델을 호출하지 않는다.
- 공개 상태 확인을 위해 플랫폼 `verify_jwt=false`를 지정했다. 실제 생성의 JWT 검증은 함수 본문에서 수행한다. API 키만으로 생성할 수 없고, 요청 본문의 사용자 ID를 신뢰하지 않는다.

## 검증 범위

- 순수 요청 분기 테스트 7개를 추가했다. 설정값 비노출, 빈 설정 처리, CORS, 메서드 제한, 인증 헤더 누락/오류, 인증 검증 경계 등을 확인한다.
- `scripts/check-ai-function.mjs`는 배포된 개발 서버에 8개의 비파괴 요청을 보낸다. 실제 토큰을 사용하거나 사용자 데이터/생성 결과를 읽지 않으며 유료 AI 호출을 하지 않는다.
- `AI function smoke` 워크플로에서 위 테스트와 실제 HTTP 응답을 확인한다. 결과는 해당 실행 로그와 비민감 JSON 아티팩트에 남는다.
- 기존 Mobile CI, Web build, Database Tests의 최신 커밋 결과는 별도로 확인해야 한다.
- 서버가 응답하고 잘못된 요청을 차단한다는 사실과 로그인된 사용자의 실제 모델 생성 성공은 구분한다.

## 출시 전 남은 확인

Supabase Edge Functions > Secrets에서 `OPENAI_API_KEY`를 직접 등록한다. 키는 채팅/소스/프런트엔드 변수에 넣지 않는다. Supabase가 제공하는 서버 환경변수가 존재하는지도 확인한다. 키가 준비되면 로그인한 실제 계정으로 생성, 비공개 미리보기, 공개, 다른 계정 조회, 원픽 변경 후 자동 숨김, 재평가를 확인한다. 실제 출력의 품질·안전성 및 공급자 오류 시나리오 검증 후 앱을 배포한다.

## 공식 참고

- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/secrets
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
