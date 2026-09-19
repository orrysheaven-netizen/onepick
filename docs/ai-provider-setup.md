# OnePick AI provider 설정

## 원칙

OnePick AI의 OpenAI 키는 앱 코드, GitHub, 채팅, 문서, `.env.example`에 값을 넣지 않는다.

저장소 루트 `.gitignore`는 `.env`와 `.env.*`를 제외하고 있어 실수로 로컬 secret 파일을 커밋하는 것을 막는다. 실제 hosted Edge Function은 Supabase Edge Function Secrets에서 `OPENAI_API_KEY`를 읽는다.

## OpenAI 쪽

OnePick 전용 OpenAI API 프로젝트를 사용한다. 프로젝트 설정의 API Keys에서 새 secret key를 만든다. 프로젝트 수준 키는 해당 프로젝트 범위로 관리할 수 있고, 프로젝트별 사용량/한도도 별도로 관리할 수 있다.

비밀 키는 생성 시에만 전체 값이 표시될 수 있으므로 안전한 비밀 저장 위치에서만 다룬다. 채팅이나 이 저장소에 붙여넣지 않는다.

현재 AI 서버 모델은 `gpt-5.6-terra`이고 Responses API를 사용한다.

## Supabase 쪽

프로젝트: `onepick-dev` / `ygoipwzakzdnkaaxyrgb`

Supabase Dashboard의 **Edge Functions → Secrets**에서 다음 이름으로 한 개의 secret을 추가한다.

```
OPENAI_API_KEY=<값>
```

Supabase hosted function의 기본 `SUPABASE_*` 변수는 플랫폼이 제공하므로 직접 만들지 않는다.

Supabase 문서 기준으로 hosted secret은 저장 후 함수에서 즉시 사용할 수 있으며, secret만 추가한 경우 Edge Function을 다시 배포할 필요가 없다.

## 등록 직후 검증

키 값을 읽거나 출력하지 않는다. 공개 `GET /functions/v1/analyze-profile-taste/status`와 live smoke만 사용한다.

필수 상태:

- `contractVersion = profile-ai-v3-tones`
- `minimumPicks = 10`
- `promptVersion = taste-v5-no-age`
- `cooldownSeconds = 600`
- `configured = true`

`configured=true`는 secret 값이 존재한다는 뜻일 뿐, 실제 OpenAI 인증·모델 권한·결제·출력 품질까지 증명하지 않는다.

## 실제 provider 검증

공개 health endpoint가 유료 모델 호출을 대신 실행하게 만들지 않는다. 실제 provider 검증은 승인된 로그인 테스트 계정으로 진행한다.

1. 분석 가능한 공개 원픽 10개 이상 준비.
2. direct 한 번 생성.
3. 비공개 미리보기와 성능 로그 확인.
4. 10분 제한 후 warm 생성 또는 별도의 허용된 테스트 프로필 사용.
5. 공개 → 숨김 → 원픽 변경 자동숨김 → 재평가 흐름 확인.
6. 생성 결과를 T/F 품질 검토표로 확인.

실패 시 자동 반복 호출하지 않는다. 실제 요청 비용과 품질을 확인한 뒤 반복 횟수를 늘린다.

## 참고

- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- OpenAI project/API key 관리: https://help.openai.com/en/articles/9186755
