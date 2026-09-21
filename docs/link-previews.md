# 공유 링크 미리보기

상태: 코드 준비 — 마이그레이션은 Git에만 있고 운영 DB에 적용하지 않았다. Cloudflare Pages의 Functions 사용은 아래 호스팅 조건을 확인한 뒤 결정한다.

## 왜 필요한가

- `mvp-launch-promotion.md`의 모든 경로가 링크 한 줄을 지난다. 지인에게 보내는 프로필 링크, 커뮤니티에 올리는 질문, `follow.md`의 팔로잉 피드를 채우는 프로필 공유가 모두 같은 링크다.
- 웹은 `web.output: "single"` 단일 페이지 내보내기라 라우트별 HTML이 없었고, 내보낸 `index.html`에는 Open Graph 태그가 아예 없었다. 카카오톡에 붙이면 제목도 설명도 없는 맨 주소로 보인다.
- 미리보기 없는 링크는 커뮤니티에서 거의 열리지 않는다. 받는 사람이 열기 전에 알 수 있는 것이 아무것도 없기 때문이다.

## 카드에 담는 것

이미지는 쓰지 않는다. 읽히는 것은 글이고, 로고 한 장은 읽을 것을 더하지 않는다.

| 링크 | 제목 | 설명 |
| --- | --- | --- |
| `/` | `OnePick · 많은 것보다, 마음에 드는 하나` | 서비스 한 줄 설명 |
| `/u/<username>` | `@<username>의 원픽 N개` | 최근 원픽 3개(`카테고리 아이템`)와 공개된 AI 키워드 3개 |
| `/pick/<id>` | `@<username>의 <카테고리> 원픽: <아이템>` | 그 사람의 한줄평 |

원픽이 없으면 설명은 등록을 권하는 문구가 되고, 원픽 줄을 만들 수 없을 때만 공개된 AI 요약이 대신 들어간다. 제목 80자, 설명 200자에서 자른다.

## 앱 구동 / 프런트

- `src/lib/share/linkPreview.ts`가 카드 문구와 `<head>` 조각을 모두 만든다. 의존성이 없어 빌드 후처리, 엣지 렌더러, 회귀 검사에서 같은 코드가 돈다.
- Expo의 `single` 출력은 자체 템플릿으로 문서를 만들기 때문에 `app/+html.tsx`가 실행되지 않는다. 그래서 기본 카드는 내보내기 **후에** `scripts/apply-link-preview-head.cjs`가 써넣는다. `build:web`과 `build:web:release` 양쪽에 붙어 있고, 같은 산출물에 두 번 돌려도 영역이 겹쳐 쌓이지 않는다.
- 태그는 `<meta name="onepick:preview" content="start">`와 `... content="end">` 사이에 들어간다. 엣지 렌더러는 이 구간만 바꾸고 나머지 문서는 그대로 내보낸다. 마커가 없는 산출물은 손대지 않는다.
- 문서의 `lang`은 `ko`로 바꾼다. Expo 기본값은 `en`이다.
- `EXPO_PUBLIC_SHARE_BASE_URL`이 있으면 `og:url`이 절대 주소로 들어가고, 없으면 `og:url`을 넣지 않는다. 상대 주소 `og:url`은 없는 것만 못하다.

## 백엔드 / 공개 범위

- `link_preview_profile(p_username)` / `link_preview_pick(p_pick_id)` 두 RPC. 둘 다 SECURITY INVOKER에 검색 경로를 고정했고, 엣지 렌더러는 공개 anon 키로 호출한다. 즉 **비로그인 방문자가 보는 것과 정확히 같은 범위**만 카드에 들어간다.
- 공개 조건은 홈 피드와 같은 것을 재사용한다: active 원픽, active/discontinued 상품, `category_is_open_leaf`, `private.user_is_suspended` 제외. 조건을 다시 손으로 적지 않는다.
- AI 요약과 키워드는 `profile_ai_reviews.is_visible`이 참일 때만 나간다. 생성만 되고 공개하지 않은 해석은 카드에도 없다.
- 사용자 간 차단은 로그인 세션의 개념이다. 링크 미리보기는 익명 호출이므로 차단 관계를 적용하지 않으며, 이는 비로그인 공개 프로필과 같은 범위다.
- 사용자명은 `lower(btrim(...))`으로 맞춘다. 공유 링크는 대소문자나 공백이 섞여 도착할 수 있다.

## 호스팅

- `mobile/functions/`의 Cloudflare Pages Functions가 `/u/:username`과 `/pick/:pickId`를 가로채 위 구간을 바꾼다. 디렉터리를 두면 다음 배포에서 Pages Functions가 켜진다.
- 런타임에 `EXPO_PUBLIC_SUPABASE_URL`과 `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 읽는다. 두 값은 이미 빌드 환경에 있는 공개 설정이며, 새로 만들어야 하는 비밀은 없다. 값이 없으면 조회를 시도하지 않고 기본 카드를 그대로 내보낸다.
- 조회 제한 시간은 1.2초다. 실패·시간 초과·없는 사용자·HTML이 아닌 응답은 모두 원래 응답을 그대로 돌려준다. 미리보기 때문에 페이지가 늦거나 깨지지 않는다.
- 크롤러와 사람을 구분하지 않는다. 같은 HTML을 모두에게 준다.
- Vercel 설정(`vercel.json`)에는 이 기능이 없다. 테스터 사이트는 Cloudflare Pages이고 Vercel 배포는 꺼져 있다.
- `_headers`의 CSP는 그대로다. 메타 태그만 바뀌고 새 출처를 부르지 않는다.

## 검증

- `mobile/scripts/test-link-preview.cjs`: 카드 문구, `<head>` 교체, 속성 이스케이프, 후처리 멱등성, 엣지 핸들러의 실패·미설정·잘못된 id 동작. 네트워크를 쓰지 않는다.
- `mobile/scripts/check-web-export.cjs`: 내보낸 산출물에 마커와 비어 있지 않은 `og:*`가 있는지 본다.
- `supabase/tests/038_link_previews.sql`: 정지 계정, 숨긴 상품, 숨긴 카테고리, 검토 대기 원픽, 공개하지 않은 AI 해석이 카드에 들어가지 않는지 CI 임시 DB에서 확인한다.
- 실제 확인은 배포 후에 한다. 카카오톡·트위터에 링크를 붙여 카드가 뜨는지, 사용자명을 바꾼 링크가 다른 카드를 주는지 본다.

## 하지 않는 것

- 카드 이미지 생성. 동적 이미지는 읽을 것을 더하지 않으면서 렌더러와 캐시를 따로 만들어야 한다.
- 크롤러 분기. 사람에게 주는 문서와 다른 문서를 주지 않는다.
- 엣지 캐시. 초기 규모에서 필요하지 않고, `web-deployment.md`의 "index.html을 오래 캐시하지 않는다"와 어긋날 수 있다.
- 검색 엔진 최적화. 테스트 호스트는 `_headers`에서 `noindex`다. 이 작업의 대상은 대화창에 붙는 링크다.
