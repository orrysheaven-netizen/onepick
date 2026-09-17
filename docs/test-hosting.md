# 소수 테스터용 호스팅 준비

현재 상태: **Cloudflare 계정 인증·GitHub 연결 및 빌드 설정 완료. 최신 코드 배포와 로그인 검증 진행 중**.
공개 기본 주소: https://onepick-5cl.pages.dev (Cloudflare 프로젝트: onepick).

목표는 테스터가 휴대폰 브라우저에서 고정 링크를 열고 원픽을 사용해 보는 것이다.
앱스토어 등록이나 별도 도메인 구매는 필요하지 않다. Cloudflare Pages의 기본
`pages.dev` 주소를 사용하고, 코드는 계속 `orrysheaven-netizen/onepick`에서 관리한다.
현재 프런트엔드는 기존 `onepick-dev` Supabase 프로젝트에 연결한다. 테스트에서
등록한 아이템 요청·원픽·댓글은 그 DB에 저장되며, 별도 운영 DB를 생성하는 작업은 아니다.

## 1. 계정과 GitHub 연결

1. [Cloudflare](https://dash.cloudflare.com/sign-up)에 가입하고 이메일 인증을 완료한다.
2. Workers & Pages에서 **Pages → Connect to Git** 흐름을 선택한다.
3. GitHub 연결 시 `orrysheaven-netizen/onepick` 저장소를 선택한다.
4. 아래 설정과 공개 환경변수를 입력한다. 처음 저장·배포하면 외부 접속 가능한
   사이트가 만들어지므로 설정을 확인한 뒤 실행한다.

빌드 파일을 매번 수동 업로드하기보다 Git 연결을 사용한다. 수정 내용은 같은
저장소와 브랜치에서 관리하고, 이후 배포도 같은 테스트 주소를 갱신한다.

## 2. 입력할 빌드 설정

| 항목 | 값 |
| --- | --- |
| 프로젝트 이름 | `onepick` (주소: `onepick-5cl.pages.dev`) |
| Production branch | `feature/pick-core` |
| Framework preset | None |
| Root directory | `mobile` |
| Build command | `npm ci --include=dev && npm run typecheck && npm test && npm run build:web:release` |
| Build output directory | `dist-release` |
| Preview deployments | None — 처음에는 고정 테스트 주소 하나 사용 |

Cloudflare의 “Production branch”는 이 **테스트 사이트의 기본 주소를 갱신할
브랜치**라는 뜻이다. GitHub `main` 병합이나 원픽 정식 출시를 의미하지 않는다.
이 브랜치의 새 커밋은 자동 배포를 유발한다. 위 명령은 검사 실패 시 종료하여
실패한 빌드가 새 테스트 버전으로 게시되는 것을 막는다. DB 마이그레이션은
이 명령에서 실행하지 않는다.

빌드 환경변수는 **Production** 영역에 입력한다.

| 변수 | 값 |
| --- | --- |
| `NODE_VERSION` | `22.13.1` (`mobile/.node-version`에도 고정) |
| `SKIP_DEPENDENCY_INSTALL` | `1` — 위 명령의 `npm ci`로 한 번만 설치 |
| `EXPO_NO_DOTENV` | `1` — 호스팅에 입력한 설정만 사용 |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://ygoipwzakzdnkaaxyrgb.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 기존 onepick-dev 프로젝트의 `sb_publishable_...` 공개 키 |
| `EXPO_PUBLIC_SHARE_BASE_URL` | 처음에는 설정하지 않음 — 열어 둔 테스트 주소로 공유 |

공개 키는 기존 로컬 설정 또는 [Supabase API Keys](https://supabase.com/dashboard/project/ygoipwzakzdnkaaxyrgb/settings/api-keys)에서 확인한다.
`sb_secret_...`, service-role 키, Kakao client secret은 브라우저용 변수에 넣지 않는다.
공개 키 값을 이 문서나 GitHub에 복사할 필요는 없다.

## 3. 주소가 만들어지면 로그인 연결

배포 결과에 표시되는 실제 기본 주소를 기록한다. `<실제주소>.pages.dev`는
설명용 표기이며, `onepick-test.pages.dev`가 확보되었다고 가정하지 않는다.
임의의 배포별 해시 주소보다 프로젝트 기본 주소를 테스터에게 전달한다.

Supabase Authentication → URL Configuration에서:

- Site URL: 실제 테스트 사이트의 HTTPS origin.
- Redirect URLs: 기존 로컬 주소를 보존하고 아래 두 패턴을 추가한다.
  - `https://<실제주소>.pages.dev/auth/callback`
  - `https://<실제주소>.pages.dev/auth/callback?*`

두 번째 패턴은 로그인 후 원픽 선택/댓글 화면으로 돌아가는 query parameter를
허용하기 위한 것이다. 실제 주소에서 홈 로그인과 아이템 선택 후 로그인을 각각
검증한다. 다른 프로젝트까지 허용하는 `https://**.pages.dev/**`는 추가하지 않는다.

Kakao Developers의 OAuth Redirect URI는 원픽 화면 주소와 다르다. 기존 값인
`https://ygoipwzakzdnkaaxyrgb.supabase.co/auth/v1/callback`을 사용한다.
닉네임만 요청하는 현재 동의 항목을 유지한다. 실제 다른 테스터 계정의 로그인까지
확인한 뒤 링크를 전달한다.

## 4. 주소를 전달하기 전 확인

- 홈, 탐색, 아이템 상세, 원픽 상세, 공개 프로필을 직접 열고 새로고침한다.
- JS/CSS/이미지가 HTML로 바뀌지 않고 정상 로드되는지 확인한다. Pages의 기본 SPA
  처리를 사용하므로 전체 경로를 `/index.html`로 보내는 규칙을 추가하지 않는다.
- `X-Robots-Tag: noindex` 응답 헤더를 확인한다. 이는 검색 수집 제한이며,
  초대한 사람만 접속하게 만드는 기능은 아니다. 현재 초대 제한은 구현하지 않았다.
- 카카오 로그인 → 사용자명 설정 → 아이템 선택 → 원픽 저장 → 공유 링크 열기를 확인한다.
- 한 테스터가 아이템 요청을 제출하고 운영자가 Admin에서 승인한 뒤 선택 가능한지 확인한다.
- 테스터에게 Admin 권한을 부여하지 않는다. 기존 관리자 계정을 공유하지 않는다.
- iPhone Safari와 Android Chrome 중 실제 참여자의 환경에서 적어도 한 번씩 확인한다.

실제 HTTPS 사이트가 동작하기 전까지 로컬 경로 검사 통과를 외부 접속 검증으로
기록하지 않는다. 로그인·카카오 인앱 브라우저·기기 사진 선택도 별도 검증 항목이다.

## 5. 테스터에게 전달할 안내

[테스터 안내문](tester-guide.md)의 `[테스트 링크]`와 `[피드백 전달처]`를 채운다.
우선 3~5명에게 10~15분 정도 핵심 흐름을 사용해 보도록 요청한다.
전달한 Cloudflare 배포의 커밋 번호와 날짜를 기록하면 이후 오류를 추적하기 쉽다.
필요하면 Cloudflare의 이전 정상 배포로 롤백한다. 프런트엔드 롤백은 DB에 저장한
테스트 데이터를 되돌리지 않는다.

## 확인한 공식 문서

- [Git 연결](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Node 및 설치 설정](https://developers.cloudflare.com/pages/configuration/build-image/)
- [브랜치 배포 제어](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
- [SPA 기본 처리](https://developers.cloudflare.com/pages/configuration/serving-pages/) · [리다이렉트 우선순위](https://developers.cloudflare.com/pages/configuration/redirects/)
- [검색 제외 헤더](https://developers.cloudflare.com/pages/configuration/headers/)
- [Supabase 로그인 복귀 주소](https://supabase.com/docs/guides/auth/redirect-urls)

