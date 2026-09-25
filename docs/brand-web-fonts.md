# 브랜드 v1 웹 글꼴 제공

Refs #303, PR #309. Owner: codex. 기존 `docs/brand-v1-implementation.md`의 글꼴 미제공 상태를 보완하는 후속 구현이다. 병합 승인은 아니다.

## 출처와 원본의 구분

사용자 첨부 IBM Plex Sans KR / Outfit ZIP은 글꼴 선택과 원본 검증 기준으로 확인했다. 로고 SVG 6개는 변경하지 않는다. 로고 재조판이나 도현 글꼴 추가 로딩은 하지 않는다.

배포에는 **공식 저장소의 웹 배포용 파일**을 사용한다. 이 파일들이 사용자 ZIP의 TTF와 바이트 단위로 같다고 주장하지 않는다. IBM은 제공한 WOFF2를 그대로 사용하며 별도 서브셋 생성·이름 변경을 하지 않는다. Outfit은 Google Fonts의 고정된 가변 TTF를 사용한다.

- IBM/plex: `763c36ef9117782905ae010056dfbe8fd2653a25`, `packages/plex-sans-kr/fonts/complete/woff2/hinted/`의 Regular 400 / Medium 500 / SemiBold 600 / Bold 700.
- google/fonts: `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`, `ofl/outfit/Outfit[wght].ttf`, 100–900.
- 각 배포 출처에 동봉된 OFL을 함께 제공한다. URL·Git blob SHA·바이트 수는 `mobile/scripts/prepare-web-fonts.cjs`에 고정했다. 빌드 때 원본 바이트를 변경하지 않고 검사한 뒤 복사한다.
- 폰트 파일 자체는 저장소 변경에 포함하지 않는다. 별도 npm/Python 폰트 패키지나 원격 실행 코드를 추가하지 않는다.

## 빌드와 제공

`cd mobile && npm run build:web` 및 `npm run build:web:release`의 pre/post 훅이 파일 준비와 내보낸 결과 검증을 수행한다. `npm run web`도 먼저 준비한다. 기존 `check:web:release-env`는 계속 오프라인 환경 검사만 수행한다.

직접 `npx expo export`를 실행하는 경우에는 먼저 `node scripts/prepare-web-fonts.cjs`를 실행하고, 내보낸 후 `node scripts/prepare-web-fonts.cjs --check dist`로 검증해야 한다. 일반 npm 빌드 경로에서는 자동이다.

준비된 파일과 CSS는 `mobile/public/assets/onepick-fonts/`에 있으며 Git에서는 제외한다. 폰트 파일명에 전체 콘텐츠 SHA를 넣고 CSS 이름에도 내용의 SHA-256을 넣는다. 기존 `/assets/*`의 immutable 캐시 규칙을 그대로 사용하며 CSS 변경 시 새 URL을 만든다. 브라우저는 `/assets/onepick-fonts/fonts-<CSS SHA-256>.css`와 같은 출처의 상대 파일 URL만 요청한다. CSP/보안 헤더는 변경하지 않는다.

차가운 빌드는 공식 raw GitHub의 접근 가능성에 의존한다. 고정된 크기/해시/형식과 라이선스 검증에 실패하면 빌드를 실패시켜 부분 출력 배포를 막는다. 리다이렉트는 거부하고, 요청은 20초 제한과 크기 상한을 둔다. 검증된 캐시가 있으면 네트워크 없이 재사용한다. 캐시 손상은 다시 받아 검증한다. 앱 실행 중에는 외부 글꼴 서버로 접속하지 않는다.

## 적용 범위와 성능 경계

- `OnePickType`의 5개 공통 글자 크기 토큰에 웹 `fontFamily`를 연결했다. 이를 사용하는 Button, Chip 및 카드 등은 실제 Text 스타일에 적용된다.
- `ThemedText` 기본값은 IBM Plex Sans KR이며 `font="english"`는 Outfit / IBM Plex Sans KR 순서다. 코드용 고정폭 글꼴과 호출자가 넘기는 스타일은 우선권을 유지한다.
- 플랫폼별 모듈을 분리해 네이티브에는 등록하지 않은 글꼴을 지정하지 않는다. 네이티브 글꼴 로딩은 이번 웹 적용 범위 밖이다.
- 공통 토큰/컴포넌트를 사용하지 않는 기존 raw Text 전체를 자동 전환한 것은 아니다. 이들의 적용 범위는 실제 화면 점검에서 별도로 확인한다. DOM 클래스명 추측이나 전역 Text monkey patch는 하지 않았다.
- 폰트 5개 파일의 명세상 합계는 **1,794,216바이트**다. 모든 굵기를 강제 preload하지 않고 실제 사용하는 face만 브라우저가 요청한다. 문자 범위별 분할은 아직 하지 않는다.
- `font-display: optional`로 느린 첫 방문에서 시스템 글꼴을 유지할 수 있게 한다. 그 방문 중 뒤늦은 폰트 교체를 강제하지 않으며, 캐시된 다음 방문에서는 브랜드 글꼴 사용이 가능하다. 항상 즉시 브랜드 글꼴이 보인다는 의미가 아니다.
- 이 크기 계산은 라이브 LCP/CLS 측정이 아니다. 저속 네트워크에서의 실제 성능과 전 화면 글꼴 사용 확인은 별도 완료 조건이다.

## 검증

`cd mobile && node scripts/test-web-fonts.cjs`

새 오프라인 검사 13개는 고정 출처, 크기/해시/형식, HTTP 실패/초과 응답, CSS 공개 전 라이선스 확인, 검증 캐시, 손상 복구, 출력 누락/변조, 빌드 훅, 플랫폼별 공통 토큰 및 ThemedText의 실제 스타일/우선순위를 확인한다. 테스트 응답은 합성 fixture이며 실제 공식 폰트 다운로드나 브라우저 렌더링을 대신하지 않는다.

로컬 Node 22.16.0 / TypeScript 5.8.3에서 13/13 통과. 전체 앱 빌드와 저장소 TypeScript 버전 검증은 새 PR head의 CI로 확인한다. 로컬 실제 다운로드는 DNS 제한으로 미실행이다. 첫 CI(`4fec6436`)에서 공식 폰트·라이선스 다운로드, 검증, 웹 번들·글꼴 복사가 성공했다. 이후 기존 캐시 경로 검사에서 실패해 자산/CSS를 콘텐츠 해시가 있는 `/assets/` 경로로 옮겼고, 홈 화면 테스트의 새 font-family import 연결을 보완했다. 수정 후 head의 전체 CI 결과는 PR에 별도로 기록한다.

## 보존

승인 SVG/PNG/ICO, 로고 컴포넌트, manifest, 기존 컨트롤 색, 기능 플래그, DB/Auth/RLS/Storage, 보안 헤더/CSP, secrets, workflow 및 #247을 변경하지 않는다. main 직접 쓰기, 병합, 운영 데이터 변경을 수행하지 않는다. 화면/기기 확인과 독립 리뷰 전까지 Draft를 유지한다.
