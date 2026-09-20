# OnePick 소셜 로그인 설정 — Kakao / Google / Naver

OnePick 앱 코드는 세 로그인 공급자를 같은 OAuth 콜백 흐름으로 처리한다.

- Kakao: Supabase 기본 provider `kakao`
- Google: Supabase 기본 provider `google`
- Naver: Supabase Custom OIDC provider `custom:naver`

앱의 로그인 완료 주소는 기존과 동일하게 `/auth/callback`이며, 로그인 직전에 저장한 원픽/댓글/프로필 복귀 intent도 그대로 유지한다.

## 공통 Supabase 값

현재 개발 프로젝트:

- Project: `onepick-dev`
- Project ref: `ygoipwzakzdnkaaxyrgb`
- Supabase provider callback:
  `https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`
- OnePick test origin:
  `https://onepick-5cl.pages.dev`
- OnePick app callback:
  `https://onepick-5cl.pages.dev/auth/callback`

Client Secret은 GitHub, Expo public env, 문서, 채팅에 저장하지 않는다. 공급자 Secret은 공급자 콘솔과 Supabase Auth provider 설정에만 저장한다.

## Google

1. Google Auth Platform에서 Web application OAuth client를 만든다.
2. Authorized JavaScript origin:
   `https://onepick-5cl.pages.dev`
3. Authorized redirect URI:
   `https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`
4. 최소 scopes:
   - `openid`
   - `userinfo.email`
   - `userinfo.profile`
5. Supabase Dashboard → Authentication → Providers → Google에서:
   - Enable Google
   - Google Client ID
   - Google Client Secret
6. 저장 후 실제 테스트 계정으로 로그인 → OnePick `/auth/callback` → 사용자명/원래 작업 복귀를 확인한다.

## Naver

네이버는 OIDC auto-discovery를 사용한다.

Naver Developers에서 애플리케이션을 만들고:

- 서비스 URL: `https://onepick-5cl.pages.dev`
- Callback URL:
  `https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`

Supabase Dashboard → Authentication → Providers → New Provider:

- Configuration: Auto-discovery (OIDC)
- Identifier: `custom:naver`
- Name: `Naver`
- Issuer URL: `https://nid.naver.com`
- Client ID: Naver Developers에서 발급
- Client Secret: Naver Developers에서 발급
- Scopes: `openid`, `profile`
- Email optional: **on**
- PKCE: 기본값 **on**

네이버 공식 OIDC discovery URL은
`https://nid.naver.com/.well-known/openid-configuration`이다.

OnePick 자체는 이메일을 회원 식별 키로 사용하지 않는다. Supabase Auth의 user UUID와 OnePick username/profile을 사용하므로 네이버 사용자가 이메일 제공을 거부해도 로그인 자체는 가능하도록 `email_optional`을 켠다.

## 기존 계정 주의

Supabase Auth는 검증된 동일 이메일이 있으면 OAuth identity를 자동 연결할 수 있다. 하지만 현재 OnePick의 Kakao 로그인은 개인정보 최소화를 위해 이메일을 요청하지 않는다.

따라서 기존 Kakao 사용자가 Google/Naver 버튼으로 새로 로그인하면 별도 Supabase user가 만들어질 수 있다. MVP에서는 로그인 화면에 “기존 계정은 처음 사용한 로그인 방식을 계속 사용” 안내를 유지한다.

정식 출시 전에 계정 설정 화면에서 명시적인 identity linking 기능을 추가할지 별도로 결정한다. 이메일/이름 조합만으로 임의 계정 병합은 하지 않는다.

## 출시 체크

- Kakao 기존 로그인 회귀
- Google 신규 로그인
- Naver 신규 로그인
- 각 provider 로그인 취소
- 로그인 실패 후 다시 시도
- 로그인 → 사용자명 생성
- 로그인 → 원픽 선택 복귀
- 로그인 → 제품 등록 요청 복귀
- 로그인 → 댓글 복귀
- 동일 브라우저 재로그인
- iPhone Safari / Android Chrome
