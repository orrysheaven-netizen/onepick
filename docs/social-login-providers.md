# OnePick 소셜 로그인 설정 — Kakao / Apple

OnePick 계정은 Kakao와 Apple로만 만들 수 있다. 두 공급자는 같은 OAuth 콜백 흐름으로 처리한다.

- Kakao: Supabase 기본 provider `kakao`
- Apple: Supabase 기본 provider `apple`

Google과 Naver 로그인은 유령/자동 가입을 줄이기 위해 제거했다. 앱의 로그인 완료 주소는 `/auth/callback`이며, 로그인 직전에 저장한 원픽/댓글/프로필 복귀 intent도 그대로 유지한다.

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

## Apple

1. Apple Developer → Certificates, Identifiers & Profiles:
   - App ID에 **Sign in with Apple** capability를 켠다.
   - **Services ID**를 만들고 Sign in with Apple을 켠 뒤:
     - Domains: `ygoipwzakzdnkaaxyrgb.supabase.co`
     - Return URL: `https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`
   - **Key**를 만들고 Sign in with Apple을 켠 뒤 `.p8` 파일을 받는다. Team ID와 Key ID를 기록한다.
2. Supabase Dashboard → Authentication → Providers → Apple에서:
   - Enable Apple
   - Client IDs: Services ID (iOS 네이티브 로그인을 추가하면 앱 Bundle ID도 추가)
   - Secret Key (for OAuth): `.p8`, Team ID, Key ID, Services ID로 만든 client secret JWT
3. **Apple client secret은 최대 6개월 뒤 만료된다.** 만료되면 Apple 로그인이 전부 실패하므로, 만료일을 캘린더에 적어두고 그 전에 새로 만들어 Supabase에 다시 넣는다.
4. 저장 후 실제 Apple ID로 로그인 → OnePick `/auth/callback` → 사용자명/원래 작업 복귀를 확인한다.

현재 OnePick은 Kakao와 같은 `signInWithOAuth` + PKCE 흐름을 Apple에도 사용한다. Supabase는 React Native/Expo에서도 이 방식이 동작한다고 안내하지만 iOS에서는 네이티브 Sign in with Apple을 모범 사례로 권장한다. 네이티브 전환은 이번 범위에 포함하지 않으며, 추후 전환 시 앱 Bundle ID를 Apple provider의 Client IDs에 추가하고 `signInWithIdToken` 경로를 별도로 검증한다.

Apple은 사용자가 "이메일 가리기"를 고를 수 있다. OnePick은 이메일을 회원 식별 키로 쓰지 않으므로 이 경우에도 로그인은 그대로 동작한다.

## 가입 제한 (Before User Created 훅)

앱에서 버튼을 숨기는 것만으로는 부족하다. 공개 anon key만 있으면 `/auth/v1/signup`(이메일/전화)이나 익명 로그인을 직접 호출할 수 있다. 서버 훅을 먼저 검증한 뒤 provider를 정리한다.

호스팅 프로젝트 적용 순서는 다음과 같다.

1. **migration 적용**
   - `supabase/migrations/20260924235900_restrict_signup_providers.sql`을 정상 배포 절차로 적용한다.
2. **함수와 권한 확인**
   - `public.hook_before_user_created(jsonb)`가 존재하는지 확인한다.
   - `supabase_auth_admin`만 EXECUTE 가능하고 `anon`·`authenticated`는 불가능한지 확인한다.
3. **기존 계정 provider 확인**
   - 아래 쿼리로 Google/Naver 등 기존 계정 수를 먼저 확인한다.
4. **Apple provider 설정**
   - Apple Services ID/Key/Team ID를 설정하고 Apple provider를 켠다.
   - 이 단계에서는 기존 Google/Naver provider를 아직 끄지 않는다.
5. **Before User Created 훅 연결**
   - Authentication → Hooks → Before User Created에 `public.hook_before_user_created`를 연결한다.
   - provider가 `kakao`/`apple`이고 익명이 아닌 신규 사용자만 통과하며, 그 외 신규 가입은 403으로 거절한다.
   - 기존 사용자 로그인에는 영향이 없다. 새 `auth.users` row가 만들어질 때만 실행된다.
6. **스모크 테스트**
   - Kakao 신규 가입 성공
   - Apple 신규 가입 성공
   - 이메일/비밀번호 직접 신규 가입 → 403
   - 기존 QA 이메일/비밀번호 계정 로그인 성공
7. **불필요 provider 비활성화**
   - Kakao, Apple: 켬
   - Google, `custom:naver`: 끔
   - Phone: 끔
   - Allow anonymous sign-ins: 끔
   - Email: **켜둔다.** 새 이메일 가입은 훅이 막고 기존 QA 계정 로그인은 유지한다.

로컬 스택은 `supabase/config.toml`의 `[auth.hook.before_user_created]`로 같은 훅을 켠다.

Supabase Auth의 현재 Admin user creation 경로는 일반 클라이언트 signup과 별개인 관리자 경로다. Dashboard의 Add user 또는 신뢰된 Auth Admin API로 QA 이메일 계정을 만드는 경우에도 일반 클라이언트에 관리자 자격증명을 노출해서는 안 된다.

## 기존 Google/Naver 사용자

Google/Naver provider를 끄면 그 방식으로 가입한 기존 계정은 더 이상 로그인할 수 없다. 끄기 전에 SQL Editor에서 확인한다.

```sql
select raw_app_meta_data->>'provider' as provider, is_anonymous, count(*)
from auth.users group by 1, 2 order by 3 desc;
```

Supabase Auth는 검증된 동일 이메일이 있으면 OAuth identity를 자동 연결할 수 있지만, OnePick의 Kakao 로그인은 개인정보 최소화를 위해 이메일을 요청하지 않는다. 따라서 공급자 간 계정은 자동으로 합쳐지지 않는다. 로그인 화면에 "기존 계정은 처음 사용한 로그인 방식을 계속 사용" 안내를 유지하고, 이메일/이름 조합만으로 임의 계정 병합은 하지 않는다.

## 출시 체크

- Kakao 기존 로그인 회귀
- Apple 신규 로그인 (iPhone Safari, 데스크톱 브라우저)
- 각 provider 로그인 취소
- 로그인 실패 후 다시 시도
- 로그인 → 사용자명 생성
- 로그인 → 원픽 선택 복귀
- 로그인 → 제품 등록 요청 복귀
- 로그인 → 댓글 복귀
- 동일 브라우저 재로그인
- `/auth/v1/signup`에 이메일/비밀번호로 직접 가입 시도 → 403 확인
- iPhone Safari / Android Chrome
