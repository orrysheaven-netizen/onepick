# AI 서버 규격과 재시도 안내

## 목적

앱이 단순히 Edge Function이 살아 있다는 이유로 생성 버튼을 활성화하지 않도록 서버 규격을 공개 상태 응답에 포함한다. 또한 생성 요청이 제한되었거나 모델 호출 이후 실패한 경우 서버가 남은 재시도 시간을 숫자로 돌려주고, 앱은 그 값을 보수적으로 표시한다.

## 공개 상태 규격

최신 개발 브랜치의 `GET /functions/v1/analyze-profile-taste/status`는 비밀값 없이 다음 항목을 반환한다.

- `contractVersion = profile-ai-v3-tones`
- `minimumPicks = 10`
- `promptVersion = taste-v5-no-age`
- `cooldownSeconds = 600`
- 기존 `configured` 불리언

구버전 서버처럼 규격 필드가 전혀 없으면 연결 오류로 위장하지 않고 **도달 가능하지만 호환되지 않는 서버**로 처리한다. 일부 규격 필드만 있거나 형식이 잘못되면 상태 응답 자체를 신뢰하지 않는다. 앱은 구성 완료와 규격 호환을 모두 만족할 때만 생성 버튼을 활성화한다.

이는 API 키 유효성, 모델 접근 권한, 결제 상태 또는 문장 품질을 증명하지 않는다.

## 재시도 시간

- 캐시된 동일 결과는 생성 슬롯을 사용하지 않는다.
- 생성 제한에 걸리면 가능한 경우 실제 남은 초를 `retryAfterSeconds`로 반환한다.
- 모델 공급자 실패나 생성 후 원본 변경처럼 이미 생성 슬롯을 확보한 뒤 실패한 경우에도 현재 슬롯의 남은 시간을 함께 반환한다.
- 숫자는 1~3600초의 안전한 정수만 앱에서 사용한다. 잘못된 값은 무시한다.
- 화면은 60초 미만은 초, 그 이상은 올림한 분 단위로 안내한다. 자동 재요청은 하지 않는다.

Supabase Edge Functions는 네트워크/중계/함수 HTTP 오류가 서로 다른 실패 종류일 수 있으므로, 앱은 단순 실패를 '저장되지 않음'이나 '즉시 재시도 가능'으로 단정하지 않는다. 서버의 OpenAI 요청에는 기존 20초 제한을 유지한다.

## 배포 상태

현재 onepick-dev 배포 서버는 이 규격을 반환한다. OpenAI secret이 없으면 `configured=false`이므로 최신 앱은 생성 요청을 막는다. 서버와 앱을 같은 릴리스 단위로 검증한 뒤 실제 생성 QA를 진행해야 한다.

## 검증

- `test-profile-ai-status.cjs`: 현재 규격, 구버전 서버, 부분/잘못된 규격, 생성 버튼 호환성 조건.
- `test-profile-ai-retry.cjs`: 남은 시간 입력 검증·표시와 서버 응답 경로.
- `test-profile-ai-minimum.cjs`: 최소 10개 규칙이 서버 계약 상수와 일치하는지 유지.
- `scripts/check-ai-function.mjs`: 실제 배포 서버가 release contract와 다르면 실패하고, 보고서에 `contractCompatible`을 기록한다.

참고:
- https://supabase.com/docs/guides/functions/error-handling
- https://supabase.com/docs/guides/functions/error-codes
- https://supabase.com/docs/guides/functions/limits
