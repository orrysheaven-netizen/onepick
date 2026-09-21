# 공유 H-1B — 동적 Open Graph 메타 설계

상태: 설계 확정 후보  
전제: H-1A 기본 메타는 이미 적용되어 있다. 이 단계는 DB migration 없이 웹 공유 미리보기만 확장한다.

## 1. 목적

현재 웹은 Expo `web.output: "single"` SPA이므로 모든 URL이 같은 기본 HTML 메타를 사용한다. 브라우저에서는 클라이언트 라우터가 정상 동작하지만, JavaScript를 실행하지 않는 카카오톡·메신저·SNS 크롤러는 Pick/프로필/아이템별 제목과 설명을 알 수 없다.

H-1B의 목표는 다음 세 공개 URL에만 동적 메타를 제공하는 것이다.

1. `/pick/:pickId` — 공유의 1순위. 사용자의 공개 원픽과 한줄평.
2. `/u/:username` — 공개 프로필과 취향 컬렉션.
3. `/item/:itemId` — 항목 상세.

카테고리별 동적 OG는 이번 범위에서 제외한다. 현재 Explore의 카테고리 선택은 화면 로컬 상태이며 공유 가능한 고정 카테고리 URL이 없으므로, URL 구조를 먼저 만든 뒤 별도 단계에서 추가한다.

## 2. 핵심 결정

### SPA는 그대로 유지한다

전체 앱을 SSR 프레임워크로 옮기지 않는다. Cloudflare Pages Functions를 `mobile/functions/` 아래에 두고 위 세 경로의 **HTML document 요청만** 가로챈다.

Function은 배포된 `index.html` 정적 asset을 읽고 H-1A의 기본 `<title>`, description, Open Graph, Twitter 메타를 공개 데이터에 맞게 치환한 뒤 같은 SPA body를 반환한다.

따라서:

- 일반 브라우저도 같은 URL과 같은 앱 shell을 받는다.
- 크롤러 전용 별도 페이지를 만들지 않는다.
- JS/CSS/image asset 요청은 기존 Pages 정적 asset 경로를 그대로 사용한다.
- `/pick/find`, `/pick/book`, `/pick/game` 같은 앱 내부 경로는 Pick UUID가 아니므로 H-1B 대상이 아니다.
- H-1A는 항상 최종 fallback으로 남는다.

Cloudflare Pages Functions는 프로젝트 루트의 `/functions` 파일 기반 라우팅을 사용하고, Function에서 다음 Function/asset server로 넘기거나 `ASSETS` binding으로 정적 asset을 읽을 수 있다.

## 3. 파일 구조

구현 단계의 권장 구조:

```
mobile/
  functions/
    _lib/
      share-meta.ts
      supabase-public.ts
      html-meta.ts
    pick/
      [pickId].ts
    u/
      [username].ts
    item/
      [itemId].ts
  public/
    index.html          # H-1A 기본 메타 유지
```

세 route Function은 thin adapter만 두고, 공개 데이터 조회·문자열 정리·HTML meta 주입은 공용 모듈로 모은다.

## 4. 공개 데이터 원칙

새 DB 함수나 migration을 만들지 않는다. 현재 브라우저의 공개 화면이 이미 읽을 수 있는 Supabase 공개/RLS 계약만 재사용한다.

- Pick: 현재 `getPickById`가 사용하는 공개 Pick + profile + category + item 관계와 같은 범위.
- Profile: username으로 공개 profile을 찾고 active Pick만 읽는 현재 공개 프로필 범위.
- Item: 공개 item 상세 화면에서 노출 가능한 항목 범위.
- Pages Function에는 service-role key를 두지 않는다. 공개 publishable key만 사용한다.
- 로그인 세션, 이메일, 관리자 정보, pending/hidden/removed 데이터, 비공개 사용자 정보는 메타 생성에 사용하지 않는다.
- RLS에서 보이지 않는 데이터는 존재 여부를 구분하지 않고 H-1A 기본 메타로 떨어진다.

## 5. 메타 규칙

모든 사용자 입력은 HTML escape 후 길이를 제한하고 제어 문자를 제거한다.

### Pick

- title: `{itemName} · @{username}의 원픽 | OnePick`
- description: 공개 한줄평. 없거나 사용할 수 없으면 `{categoryName}에서 고른 @{username}의 원픽을 확인해보세요.`
- image: 해당 item의 공개 thumbnail/image/source URL → 없으면 `/og-default.png`
- type: `article`
- url: canonical share origin + `/pick/:pickId`

### Profile

- title: `@{username}의 OnePick | 취향 컬렉션`
- description: `현재 원픽 {N}개 · {대표 원픽 최대 3개}`
- image: 공개 원픽 중 첫 사용 가능한 thumbnail → 없으면 `/og-default.png`
- type: `profile`
- url: canonical share origin + `/u/:username`

초기 H-1B에서는 AI 취향평가 문장을 OG description에 넣지 않는다. 프로필 화면 공개 여부와 AI 최신성 규칙을 메타 계층까지 복제하면 정책 drift가 생기기 쉽기 때문이다.

### Item

- title: `{itemName} | OnePick`
- description: `{categoryName}에서 이 항목을 원픽으로 고른 사람들의 한줄평을 확인해보세요.`
- image: 공개 thumbnail/image/source URL → 없으면 `/og-default.png`
- type: `website`
- url: canonical share origin + `/item/:itemId`

Twitter title/description/image도 같은 값으로 맞춘다.

## 6. OG 이미지 범위

H-1B 1차는 **이미 존재하는 공개 이미지 URL**을 사용한다. 현재 공유 카드 PNG는 브라우저 canvas에서 생성되어 사용자의 기기에 공유/저장되는 파일이므로, SNS 크롤러가 접근할 영구 HTTP URL이 아니다.

브랜드가 들어간 1200×630 동적 이미지는 H-1B 2차로 분리한다.

- 1차: 동적 title/description/url + 기존 item image/default image.
- 2차: `/og/pick/:id`, `/og/profile/:username` 형태의 서버 생성 이미지 endpoint를 검토.

이 분리로 먼저 “모든 링크가 똑같은 미리보기” 문제를 해결하고, 이미지 렌더링 인프라는 필요성이 확인된 뒤 추가한다.

## 7. 요청 처리

Function이 동적 처리하는 조건:

- method가 GET 또는 HEAD
- HTML document 요청
- 경로 형식이 유효
- Pick/Item ID는 UUID 형식
- username은 앱의 현재 username 규칙과 일치

그 외 요청은 즉시 기존 asset/SPA 흐름으로 넘긴다.

동적 처리 순서:

1. 경로 검증
2. 공개 Supabase 조회
3. 공개 데이터가 정상일 때 meta model 생성
4. 배포된 `index.html` asset 읽기
5. H-1A meta를 H-1B 값으로 치환
6. HTML 200 응답
7. 조회 실패/timeout/not-found/visibility 거부 시 H-1A index를 그대로 반환

오류 상세나 Supabase 메시지를 HTML에 출력하지 않는다.

## 8. 캐시

테스터 단계에서는 정확성과 삭제/차단 반영을 우선한다.

- 첫 배포: 동적 HTML은 `Cache-Control: no-store`
- 실제 미리보기 안정화 후: 최대 60초 edge cache를 검토
- asset 캐시는 현재 정책을 건드리지 않는다.

사용자 생성 콘텐츠를 장시간 캐시하지 않는다. 제거·차단된 콘텐츠의 과거 메타가 오래 남는 것을 피하기 위함이다.

## 9. 실패 시 동작

H-1B는 앱 접근의 단일 장애점이 되면 안 된다.

- Supabase timeout/5xx → H-1A 기본 HTML
- 데이터 없음/RLS 비노출 → H-1A 기본 HTML
- meta formatter 예외 → H-1A 기본 HTML
- asset 읽기 실패 → 기존 Pages 흐름으로 pass-through
- Function 장애가 발생해도 앱 본문에 서버 오류 스택을 노출하지 않는다.

선택적으로 응답 헤더에 `X-OnePick-Share-Meta: dynamic|fallback`을 넣어 QA에서만 상태를 확인한다. 개인정보나 내부 오류는 헤더에 넣지 않는다.

## 10. 테스트

### 단위 테스트

`mobile/scripts/test-share-meta.cjs`

- Pick/Profile/Item meta 문자열
- HTML escaping
- 길이 제한
- 제어 문자 제거
- 잘못된 UUID/username은 동적 조회 전에 거절
- 이미지 없음 → default image
- 비정상/부분 데이터 → H-1A fallback
- 한줄평에 HTML 문자열이 들어가도 tag가 생성되지 않음

### route 테스트

- `/pick/<uuid>` HTML에 해당 Pick title/description
- `/u/<username>` HTML에 해당 profile title
- `/item/<uuid>` HTML에 item title
- `/pick/find`, `/pick/book`, JS/CSS/image asset은 H-1B가 가로채지 않음
- 존재하지 않는 ID는 H-1A
- HEAD 요청도 정상
- 앱 브라우저에서 직접 열기/새로고침 시 기존 Expo Router 화면이 그대로 부팅

### 실제 배포 QA

1. 공유 Pick URL을 JavaScript 비실행 HTTP 클라이언트로 읽어 `og:title`, `og:description`, `og:image`, `og:url` 확인.
2. 같은 URL을 일반 브라우저에서 열어 Pick 상세 진입 확인.
3. 공개 프로필/아이템도 같은 방식으로 확인.
4. 삭제/숨김/차단 또는 잘못된 URL에서 개인 데이터가 메타에 남지 않는지 확인.
5. 카카오톡 등 실제 공유 대상에서 새 URL의 미리보기를 확인.
6. H-1A 기본 홈 미리보기와 정적 asset 응답이 바뀌지 않았는지 확인.

## 11. 완료 조건

H-1B 1차 완료는 다음을 모두 만족할 때로 한다.

- Pick/Profile/Item URL의 HTML source에 서로 다른 동적 OG가 들어간다.
- JS를 실행하지 않는 클라이언트에서도 메타가 보인다.
- 일반 브라우저의 SPA 라우팅과 새로고침이 유지된다.
- DB migration이 없다.
- service-role secret이 없다.
- 공개/RLS 범위를 넘어선 데이터가 없다.
- H-1B 실패 시 H-1A로 안전하게 복구된다.
- CI의 기존 `typecheck`, `verify-web`, 회귀 테스트가 통과한다.

## 12. 구현 순서

1. pure meta formatter + 단위 테스트
2. Pick route Function
3. Profile route Function
4. Item route Function
5. H-1A fallback/asset pass-through 회귀 테스트
6. Cloudflare preview 배포에서 HTML source 검증
7. 실제 메신저 미리보기 검증
8. main 병합
9. 필요 시 H-1B 2차 branded OG image 설계

이 순서는 현재 SPA/배포 구조를 유지하면서 가장 많이 공유되는 Pick과 프로필부터 위험을 작게 나눠 적용한다.
