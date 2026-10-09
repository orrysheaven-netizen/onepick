# OnePick iOS·Android 테스트 빌드 준비

Refs #846 · 점검일 2026-10-08 · 기준 main `ff0b60f2ae7ad15a282fd1bca90123607c384b8f`

## 목적과 현재 단계

기존 `mobile/` Expo 프로젝트를 설치형 앱으로 확장하기 위한 **설정 준비**다. 서명된 APK/IPA 생성, 설치, 실제 OAuth, 스토어 제출 완료를 의미하지 않는다. 웹/PWA의 화면·라우팅·배포 설정은 유지한다.

`mobile/package-lock.json`과 설치된 모듈에서 Expo `57.0.22`, React Native `0.86.3`, Expo Router `57.0.21`, ImagePicker `57.0.18`을 확인했다. EAS Node 버전은 기존 `.node-version`/CI와 같은 `22.13.1`이다. 의존성 업그레이드는 하지 않는다. SDK 57의 공식 기준은 Node `22.13.x` 이상, Android 7+, iOS 16.4+, Xcode 26.4+다.[1]

## 1. 이 변경이 준비하는 것

| 파일 | 역할 |
| --- | --- |
| `mobile/app.config.js` | 기존 `app.json`을 그대로 받아 확정된 계정 소유자 값만 환경변수에서 추가한다. 값이 없으면 기존 설정과 같다. |
| `mobile/eas.json` | 테스트용 `preview`와 `preview-simulator`만 정의한다. |
| `mobile/scripts/check-native-build.cjs` | 계정값 누락·플랫폼/프로필 불일치·잘못된 공개 키 형식을 로컬에서 확인한다. 빌드나 업로드는 실행하지 않는다. |
| `mobile/scripts/test-native-build-config.cjs` | 웹 설정 보존, 프로필 상속, 미확정 식별자, secret/service-role 키 거부를 검증한다. |
| `mobile/.env.example` | 미확정 네이티브 계정값의 이름만 안내하며 값은 비워 둔다. |

| 프로필 | 용도 | 결과물 / 전제 |
| --- | --- | --- |
| `preview` + Android | 기기에 직접 설치하는 내부 테스트 | APK. Google Play 가입 없이 테스트 가능. |
| `preview` + iOS | 등록된 iPhone 내부 테스트 | ad hoc 서명 빌드. 유료 Apple Developer 개인 계정과 기기 UDID 필요. |
| `preview-simulator` + iOS | Mac의 iOS Simulator | 시뮬레이터용 앱. 실제 iPhone 설치 파일이 아니며 Apple 유료 가입 불필요. |

두 프로필은 EAS `preview` 환경을 사용한다. `EXPO_PUBLIC_SHARE_BASE_URL`만 현재 웹 주소 `https://onepick-5cl.pages.dev`로 고정해 네이티브 공유 링크 수신자가 웹으로 접근할 수 있게 한다. 웹 빌드는 EAS 프로필을 사용하지 않으므로 기존 프리뷰의 현재 origin을 계속 사용한다. `expo-dev-client`, EAS Update, production/submit 프로필은 추가하지 않는다.[2][3]

## 2. 사용자/계정 소유자가 확정할 값

| 환경변수 | Expo 설정 | 결정 또는 확인할 내용 |
| --- | --- | --- |
| `ONEPICK_IOS_BUNDLE_IDENTIFIER` | `ios.bundleIdentifier` | Apple 계정에 등록할 영구 Bundle ID. 이미 등록한 값이 있으면 재사용한다. |
| `ONEPICK_ANDROID_PACKAGE` | `android.package` | Android의 영구 application ID. 이미 앱이 있으면 그 값을 재사용한다. |
| `ONEPICK_EXPO_OWNER` | `owner` | 사용자가 소유한 Expo 계정/조직의 정확한 이름. |
| `ONEPICK_EAS_PROJECT_ID` | `extra.eas.projectId` | 그 소유자의 EAS 프로젝트에서 확인한 실제 UUID. |
| `EXPO_PUBLIC_SUPABASE_URL` | 앱의 백엔드 origin | 테스트에 사용할 백엔드. 현재 소스 예시는 `https://ygoipwzakzdnkaaxyrgb.supabase.co`. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 앱에 포함될 공개 키 | 위 프로젝트의 publishable/legacy anon 키. 서비스 키·OAuth secret·서명 키를 넣지 않는다. |
| `EXPO_PUBLIC_SHARE_BASE_URL` | 공유 링크의 웹 origin | EAS 테스트 프로필에 현재 웹 주소가 이미 지정돼 있다. |

이름 `OnePick`·scheme `onepick`·버전 `1.0.0`은 기존 값을 유지한다. 식별자에 계정 이메일/실명을 임의로 넣지 않으며, 후보값을 실제 등록값으로 취급하지 않는다. 테스트에 쓰인 `test.fixture.*`와 UUID는 자동검사 fixture일 뿐 앱 식별자 제안이 아니다. 앱 ID는 출시 후 바꾸면 업데이트/앱 정체성에 영향을 주므로 소유자 확인 후 고정한다.[4]

### 로컬 설정과 EAS 설정의 연결 순서

1. 사용자가 Expo 소유자와 기존/신규 프로젝트를 확인하고 실제 project ID를 확보한다. 이 작업에서 프로젝트·계정·결제는 생성하지 않았다.
2. **전용 네이티브 worktree**의 gitignored `mobile/.env.local`에 확인한 값을 설정한다. EAS 프로젝트를 조회하기 전에도 로컬에서 owner/project ID를 평가할 수 있어야 한다.
3. 동일한 값을 EAS의 `preview` 환경에도 설정한다. 동적 app config에 쓰는 네 가지 `ONEPICK_*` 값은 공개 메타데이터이므로 **plaintext**로 관리할 수 있다. EAS secret visibility는 로컬 설정 평가에서 읽을 수 없으므로 이 식별자들에 쓰지 않는다. 앱에 포함되는 `EXPO_PUBLIC_*` 값도 비밀 저장 수단이 아니다.[5]
4. 빌드 전에는 EAS의 preview 환경을 가져오거나 `eas env:exec`로 그 환경에서 검사를 실행해 로컬/서버 값을 대조한다. 프로젝트 연결 전 환경 조회부터 시도하지 않는다. 기존 웹용 환경을 덮어쓰지 않는다.

```bash
cd mobile
npm run check:native -- --platform android --profile preview
npm run check:native -- --platform ios --profile preview
npm run check:native -- --platform ios --profile preview-simulator
```

**검사의 한계:** 로컬 shell/dotenv와 `eas.json`의 현재 공통 profile env만 검사한다. EAS 서버, 소유권, 등록된 앱 ID, 공개 키의 진위/프로젝트 일치, 서명, 로그인 allowlist, 과금 잔량을 조회하지 않는다. 직접 `eas build`를 호출하면 자동 실행되는 hook도 아니다. 향후 플랫폼별 env를 추가하면 이 검사와 우선순위를 함께 갱신한다.

## 3. 로그인 콜백과 딥링크

### 현재 코드의 경로

`supabaseAuthRepository.ts`는 네이티브에서 `skipBrowserRedirect: true` + `openAuthSessionAsync`, 웹에서 같은 탭 OAuth를 사용한다. `client.ts`의 PKCE와 코드 교환을 유지한다. 네이티브 세션은 AES-GCM으로 암호화한 AsyncStorage와 SecureStore 키로 저장한다. `README.md`의 과거 SQLite 설명은 실제 코드에 맞춰 고쳤다.

| 구간 | 주소 / 의미 |
| --- | --- |
| 카카오·Apple → Supabase | 기존 `https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`. 공급자 설정에 쓰는 주소다. |
| Supabase → 기존 웹/PWA | 현재 HTTPS origin의 `/auth/callback`과 기존 웹/프리뷰 허용 목록. |
| Supabase → 설치된 앱 | `onepick://auth/callback` + 검증된 복귀 의도 query. |

표의 공급자 callback 주소는 기존 백엔드를 사용할 때의 값이다. 다른 확정된 테스트 프로젝트를 선택하면 그 프로젝트의 `/auth/v1/callback`과 해당 프로젝트에 맞는 카카오·Apple 공급자 설정을 함께 사용한다.

실제 로그인 호출은 `Linking.createURL('auth/callback', { queryParams: { ...intent } })`이며 **경로 앞 `/`가 없다**. 설치형 SDK 57 코드 평가에서 다음 URI가 생성되는 것을 확인했다.

```text
onepick://auth/callback?action=home
onepick://auth/callback?action=follow_profile&username=audit_user
```

### 호스팅 Supabase에 확인/추가할 허용 목록

운영 설정 변경 승인 후 Authentication → URL Configuration에서 기존 HTTPS Site URL과 웹/프리뷰 Redirect URLs를 유지하고 다음 두 항목을 확인한다.

```text
onepick://auth/callback
onepick://auth/callback\?**
```

Dashboard에 입력하는 두 번째 줄에는 `?` 앞에 **역슬래시 하나**가 있다. Supabase의 glob에서 `?`는 와일드카드이므로 `\?`로 query 구분자를 정확히 한정한다. 서버는 fragment만 제외하고 query까지 일치시킨다. 복귀 정보에 점이 포함될 수 있어 query 부분에는 `**`가 필요하다. 기본 주소 하나만 등록하면 `?action=...`이 붙은 현재 콜백을 포괄하지 못한다.[6]

이 점검은 **호스팅 프로젝트의 실제 allowlist를 조회·수정한 결과가 아니다.** `supabase/config.toml`은 로컬 설정이며 호스팅 상태를 입증하지 않는다. 공급자 callback을 `onepick://`로 바꾸거나, Site URL을 바꾸거나, `onepick://**` 전체를 허용할 필요는 없다. Expo Go가 아니라 설치된 테스트 앱에서 복귀를 검증한다.[7]

### Apple 로그인

현재 Apple 로그인도 Supabase의 브라우저 OAuth다. 해당 Services ID·키 만료 상태는 계정 소유자가 확인해야 한다. 네이티브 Apple 로그인으로 전환하려면 App ID capability, 네이티브 라이브러리, ID-token 검증과 웹/Android 보존을 별도 작업으로 다룬다. 이 준비에서 `usesAppleSignIn`이나 entitlement를 임의 추가하지 않는다. 세션 저장 코드가 AES-GCM을 사용하므로 수출 규정 검토 없이 `usesNonExemptEncryption: false`도 자동 입력하지 않는다.[8]

### HTTPS 공유 링크가 앱을 자동 실행하게 하는 후속 작업

현재 scheme은 앱 콜백/테스트 딥링크용이다. 기존 HTTPS 공유 링크를 눌렀을 때 앱이 열리는 Universal Links/App Links는 아직 구성하지 않았다. iOS는 실제 Team ID + Bundle ID와 AASA/associatedDomains, Android는 package + 실제 서명 인증서 SHA-256과 assetlinks/intentFilters가 필요하다. Play App Signing과 내부 테스트 인증서는 다를 수 있다. 확인 전에는 association 파일에 임시값을 게시하지 않는다. 첫 테스트에서는 HTTPS 공유의 웹 접근성과 `onepick://` 직접 진입을 각각 검증한다.[9]

## 4. 사진·화면·네이티브 동작 점검

사진 선택은 이미 `mediaTypes: ['images']`인 시스템 picker다. 한글 `photosPermission`, `cameraPermission: false`, `microphonePermission: false`도 기존 설정에 있다. 추가 카메라·마이크·광범위한 최신 미디어 권한을 넣지 않는다. SDK 57 introspection에서 iOS 사진 설명, Android CAMERA/RECORD_AUDIO 제거 지시, scheme 등록을 확인했다. Android의 기존 legacy READ/WRITE_EXTERNAL_STORAGE는 최대 SDK 32로 제한돼 있다. 최종 병합 Manifest는 실제 네이티브 빌드에서 재확인한다.[10]

선택한 사진은 ImageManipulator로 JPEG/썸네일을 만들고 ArrayBuffer로 업로드한다. 취소·권한 제한·HEIC·큰 사진·네트워크 실패와 복구는 기기에서 확인해야 한다. native 공유 카드 이미지 생성은 미지원이며 호출부의 링크 공유 fallback을 사용한다.

### 실기기 전 반드시 추적할 차이

| 우선순위 | 소스 근거 | 후속 확인/수정 |
| --- | --- | --- |
| 높음 | `src/components/app-tabs.tsx`의 등록 `NativeTabs.Trigger`가 `disabled`이면서 `tabPress`에 의존 | SDK 57의 disabled는 비활성 탭이다. 실제 등록 버튼이 열리는지 먼저 검증하고, 탭 선택/복귀 의미를 보존하는 별도 수정이 필요하다.[11] |
| 높음 | `pick/new.tsx`의 내부 단계 뒤로가기는 웹용 handler에 연결되지만 native `SwipeBackEdge`는 null이며 OS back 연결이 없음 | Android 시스템 뒤로가기·iOS swipe가 메뉴→매장, 사진→메뉴, 한줄평→사진 순서를 따르도록 네이티브 연결을 검증/보완한다. 현재 웹 구현이 네이티브 단계 이동까지 보장하지 않는다. |
| 높음 | 네이티브 브라우저 반환과 `/auth/callback`이 각각 PKCE code를 교환할 수 있음 | 켜진/꺼진 앱의 실제 OAuth 복귀, 중복 교환 여부와 실패 복구를 검증한다. 이는 코드상 경합 가능성이고 실측 장애로 확정한 것은 아니다. |
| 중간 | native `useSocialSignIn`의 profile 조회는 callback의 재시도/복구와 다르고 Auth AppState refresh 연결 없음 | 느린 응답, 토큰 만료 후 foreground 복귀를 검증하고 필요한 최소 Auth 보완을 독립 리뷰한다. |
| 중간 | `pickDraft.ts`와 `followProfileIntent.ts`의 native 상태는 프로세스 메모리; Android picker 복원 API 미연결 | 프로세스 종료 후 초안/로그인 후 작업 복구의 현재 한계를 확인한다. 계정 바인딩·만료·취소 정리를 보존하는 별도 작업으로 다룬다. |
| 배포 전 | `assets/expo.icon/icon.json`, 공통/Android 아이콘·splash 경로에 Expo 시작 템플릿 자산이 남음 | 이미 승인된 `public/brand` 원픽 원본을 네이티브 규격으로 연결·시각 검증한다. 임의 브랜드를 새로 만들지 않는다. |

이번 구성 PR은 위 Auth/UI 동작을 변경하지 않는다. 핵심 흐름이 통과하기 전에는 기능 동등성/출시 준비 완료로 보고하지 않는다. NativeTabs의 OS 기본 형상과 시스템 글꼴 fallback은 웹의 플로팅 탭/웹폰트와 다르다. 기기 Safe Area·키보드·한글 줄바꿈을 확인하되 웹 계약을 임의로 네이티브에 복제하지 않는다.

## 5. 두 플랫폼 테스트 빌드 순서

### A. 비용 없는 소스/설정 점검

전용 worktree에서 Node `22.13.1`과 lockfile을 기준으로 준비한다. 같은 lockfile의 공유 의존성이 있으면 `CLAUDE.md`에 따라 재사용한다. **공유 `node_modules` 심볼릭 링크가 있는 상태에서 `npm ci`를 실행하지 않는다.** 새 설치가 필요하면 공유 링크가 없는 독립 디렉터리에서 실행하고, 링크를 분리할 때는 링크 자체만 제거해 공유 대상을 보존한다. Metro가 공유 모듈 경로를 다른 worktree로 해석하면 독립된 모듈 복사본을 사용한다. 네트워크가 가능한 환경에서 `npx expo install --check` 및 `npx expo-doctor`를 실행하고 결과를 검토한다. 자동 `--fix`나 SDK 업그레이드는 이 준비 범위가 아니다.

```bash
cd mobile
npm run typecheck
npm test
npx expo config --type public
npx expo config --type introspect
npm run build:web
npm run check:web
npx expo export --platform all
```

설정 출력에는 공개 구성값이 포함되므로 secret을 app config에 넣지 않는다. `expo config --type introspect`는 native 프로젝트를 쓰지 않고 modifier 결과를 보여준다. JS/Hermes export와 설정 검사는 Xcode/Gradle 컴파일이나 설치 검사를 대체하지 않는다. `ios/`·`android/`는 현재 Git에서 제외되어 있으며 EAS CNG가 생성한다. 수동 native 디렉터리를 추가할 경우 app config 변경이 자동 prebuild된다고 가정하지 않는다.[12]

### B. 계정·서명·과금 확인

- **사용자 결정:** 두 영구 앱 ID, Expo 소유자/프로젝트, 테스트 백엔드와 테스트 기기.
- **사용자 직접 수행:** 개인 개발자 가입·본인확인·약관/결제, Apple Account Holder 인증, 실제 서명 자격증명과 UDID 설정. 비밀번호/인증서 개인키를 채팅·GitHub로 전달하지 않는다.
- **설정 변경 승인:** EAS preview 환경 등록, 필요한 Supabase native redirect 추가, 서명 자격증명 등록/사용. 기존 웹 설정을 보존한다.
- **추가 비용:** EAS 실제 요금제와 남은 무료/포함 사용량을 확인한다. Free 한도 소진 시 대기 또는 로컬 빌드로 전환한다. 유료 요금제는 포함량 이후 종량 과금될 수 있으므로 자동 재시도/요금제 업그레이드를 하지 않는다.[13]

**Apple 개인 계정은 App Store Connect에서 개발자를 초대하더라도 서명 생성 권한이 동일하게 위임되지 않는다.** 개인 계정의 최초 서명 생성은 Account Holder가 해야 하며, 이후 적절히 등록된 자격증명을 재사용하는 흐름으로 진행한다.[14]

### C. Android APK → iOS Simulator → iPhone ad hoc

아래 명령은 **해당 플랫폼에 필요한 B 단계 조건**이 충족된 뒤 **하나씩** 실행하는 절차이며 이 작업에서는 실행하지 않았다. Android APK와 iOS Simulator는 Apple 유료 가입·UDID 준비를 기다릴 필요가 없다. EAS CLI는 실행 환경에서 버전/`--help`를 확인하고 기록한다. 빌드 성공 후 결과물의 실제 설치까지 확인한다.

```bash
# 1. Android 직접 설치용 APK
npm run check:native -- --platform android --profile preview
eas build --platform android --profile preview

# 2. Mac이 있을 때 iOS Simulator용 빌드
npm run check:native -- --platform ios --profile preview-simulator
eas build --platform ios --profile preview-simulator

# 3. Apple 개인 계정·서명·기기 등록 후 실제 iPhone
npm run check:native -- --platform ios --profile preview
eas build --platform ios --profile preview
```

Simulator 단계는 Mac이 없으면 건너뛰고 계정 준비 후 iPhone 검증으로 진행한다. ad hoc 프로필에 포함된 UDID만 설치할 수 있으며 기기를 추가하면 프로필 갱신·재빌드/재서명이 필요하다. Google Play 계정은 APK 직접 설치에 필요하지 않다. Xcode/Android SDK가 있는 로컬 개발환경에서는 Expo 로컬 native 빌드로 EAS 사용량을 소비하지 않고 검증할 수도 있다.[2][3]

### D. 기기별 수용 기준

1. 첫 실행/재실행, 앱명·아이콘, 홈·탐색·등록·알림·프로필 탭.
2. 카카오와 Apple: 로그인 성공/취소/실패·재시도, 앱 종료/실행 상태 복귀, 로그인 전 작업/프로필 팔로우 복귀, 코드 중복 교환 없이 세션 수립.
3. background에서 토큰 만료 후 복귀, 앱 재실행 세션 유지, 로그아웃/계정 전환 후 이전 상태 정리.
4. 등록 1/4→4/4, 메뉴 미입력/분류 실패 계약, 사진 선택/취소/제한/실패 복구, 한줄평 보존과 상세 이동.
5. Android OS back와 iOS swipe: 실제 이전 화면/등록 단계로 복귀, 루트 no-op, 앱 종료/이중 이동/빈 화면 없음.
6. 노치/하단 safe area/키보드/44px 터치 영역, native 등록 탭, 한글 폰트와 줄바꿈.
7. 원픽·공개 프로필·랭킹 링크의 cold/warm 진입 및 앱 없는 수신자의 HTTPS 웹 접근.
8. 같은 변경의 웹/PWA 로그인·사진·공유·새로고침·뒤로가기 회귀 없음.

실제 쓰기 QA는 저장소 규칙에 맞는 전용 일반 QA 계정과 승인된 데이터/범위만 사용한다. TestFlight/Google Play 테스트 트랙 업로드, 스토어 메타데이터/개인정보·암호화 신고와 제출은 이 검증 이후 별도 승인 단계다.

## 6. 이번 작업의 검증 기록

| 항목 | 결과 / 한계 |
| --- | --- |
| 기준 소스 | main의 1,132개 blob과 tree/commit 해시 확인, 전용 worktree 사용 |
| `typecheck` | 통과 |
| 기존 + 새 회귀 검사 | `180/180` 통과 |
| 웹 Expo public 설정 전후 | 미확정 계정값 없이 전체 JSON 동일 |
| 식별자 누락/fixture 검사 | 실제 CLI 누락 시 종료 1, fixture로 각 정상 프로필 통과, 잘못된 플랫폼/비공개 키 거부 |
| SDK 57 introspection | fixture 식별자로 schema/scheme/권한 결과 확인; 실계정 등록/서명 확인이 아님 |
| `expo install --check` | offline 결과 up to date; CLI가 offline 정확성 한계를 표시하므로 온라인 Expo Doctor 완료로 간주하지 않음 |
| iOS/Android/Web export | `expo export --platform all` 통과. iOS/Android Hermes 번들과 웹 파일 생성, 공개 fixture 백엔드 값 사용; 실제 백엔드 접속/서명 없음 |
| 웹 폰트/초기 JS | 배포 폰트·라이선스 검증 통과. 초기 JS gzip `494KB / 1500KB` 기준 통과 |
| 웹 HTTP 검사 | 환경 보정 후 통과: 직접 경로 16개, hashed 자산 4개, PWA 설치 자산 4개, manifest 아이콘, callback query와 SPA fallback |
| 네이티브 컴파일/설치/OAuth | 미실행. 이 환경에 Xcode/Android SDK·확정된 EAS 프로젝트/서명 없음 |
| EAS 과금/외부 환경·설정 | 조회/변경 및 빌드 실행 없음 |
| main/운영/스토어 | 병합·배포·업로드·제출 없음 |

로컬 검증 런타임은 Node `24.19.0`이며 EAS/CI의 고정값 `22.13.1`과 다르다. 실제 빌드 단계에서는 고정된 런타임의 CI 결과도 확인한다.

원본 `check-web-export.cjs` 실행은 이 컨테이너에서 `serve`의 LAN 주소 표시용 `os.networkInterfaces()` 호출이 `uv_interface_addresses` 오류로 중단됐다. 임시 로컬 preload에서 해당 열거 실패만 빈 목록으로 처리한 뒤 같은 원본 검사와 실제 loopback HTTP 서버를 다시 실행해 통과했다. 앱·검사 assertion·저장소 의존성 파일은 수정하지 않았다. 고정 CI 환경에서 보정 없는 원래 명령을 재확인한다.

## 공식 참고 문서

모든 링크는 2026-10-08 확인. 실제 호스팅 계정의 상태나 원픽 앱의 기기 통과를 보증하는 자료가 아니다.

1. [Expo SDK 57 지원 버전](https://docs.expo.dev/versions/v57.0.0/)
2. [EAS Build 프로필](https://docs.expo.dev/build/eas-json/), [내부 배포와 UDID](https://docs.expo.dev/build/internal-distribution/)
3. [iOS Simulator](https://docs.expo.dev/workflow/ios-simulator/), [EAS Build 시작](https://docs.expo.dev/build/setup/)
4. [Apple 앱 정보와 Bundle ID](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/), [Android application ID](https://developer.android.com/build/configure-app-module)
5. [EAS 환경변수와 config 평가](https://docs.expo.dev/eas/environment-variables/)
6. [Supabase redirect glob](https://supabase.com/docs/guides/auth/redirect-urls), [서버의 query 포함 검증](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)
7. [Expo SDK 57 Linking](https://docs.expo.dev/versions/v57.0.0/sdk/linking/), [인증과 Expo Go 제한](https://docs.expo.dev/guides/authentication/)
8. [Supabase Apple 로그인](https://supabase.com/docs/guides/auth/social-login/auth-apple)
9. [iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/), [Android App Links](https://docs.expo.dev/linking/android-app-links/)
10. [Expo SDK 57 ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/)
11. [Expo SDK 57 NativeTabs](https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs/)
12. [Config introspection](https://docs.expo.dev/config-plugins/development-and-debugging/), [CNG](https://docs.expo.dev/workflow/continuous-native-generation/)
13. [EAS 요금제·한도·종량 과금](https://docs.expo.dev/billing/faq/)
14. [Apple 개인 계정의 EAS 서명 권한](https://docs.expo.dev/app-signing/apple-developer-program-roles-and-permissions/)
