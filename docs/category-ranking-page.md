# 카테고리 원픽 랭킹 공개 페이지 (`/ranking/<slug>`)

검색 유입을 위한 첫 공개 페이지. 카테고리별로 "지금 이걸 원픽으로 고른 사람 수" 순서를 로그인 없이 보여주고, 공유 링크·검색 결과·SNS 미리보기가 모두 같은 URL을 가리킨다.

## 구성

| 층 | 파일 | 역할 |
| --- | --- | --- |
| DB | `supabase/migrations/20260927120000_add_category_ranking.sql` | `category_ranking(p_slug, p_limit)` — 슬러그로 찾은 공개 리프 카테고리의 원픽 집계(최대 50, 기본 20). `ranking_categories()` — 랭킹 페이지가 있는 리프 목록과 경로. 둘 다 anon 실행 가능, 자격 규칙은 `category_top_items`와 동일. |
| 앱 | `mobile/src/app/ranking/[slug].tsx`, `mobile/src/app/ranking/index.tsx` | 랭킹 화면과 카테고리 목록. 순위 숫자는 Explore와 같은 최소 표본(`OnePickThresholds.exploreRankingMinPicks`)을 넘겨야 표시. 하단에 "원픽 고르기" CTA와 링크 공유. |
| 앱 | `(tabs)/explore.tsx` | 카테고리를 고르면 TOP 3 아래 "전체 랭킹 보기 ›" 링크. |
| 웹 | `mobile/functions/ranking/[slug].ts` | Cloudflare Pages Function. 제목·설명·OG 태그를 실제 값으로 바꾸고, `#root` 안에 크롤러가 읽을 목록과 JSON-LD(`ItemList`)를 넣는다. 앱이 마운트되면 목록을 대체하므로 사람 눈에는 다른 페이지와 같다. 실패 시 기본 셸로 폴백. |
| 웹 | `mobile/functions/sitemap.xml.ts`, `mobile/functions/robots.txt.ts` | 랭킹 URL 사이트맵과 robots. |

## 색인(indexing) 정책

`public/_headers`는 `*.pages.dev` 전체에 `X-Robots-Tag: noindex`를 붙이지만, Cloudflare는 `_headers`를 Function 응답에는 적용하지 않는다. 그래서 랭킹·사이트맵 Function은 `robotsHeader(hostname)`으로 같은 규칙을 직접 적용한다: `*.pages.dev`면 `noindex`, 그 외(커스텀 도메인)면 `index, follow`. **검색 노출은 커스텀 도메인을 연결해야 시작된다.** 도메인을 붙인 뒤 Google Search Console에 `https://<도메인>/sitemap.xml`을 제출한다.

기존 `pick/`, `u/`, `item/` Function은 이 헤더를 아직 붙이지 않는다(공유 미리보기 목적). 색인을 원치 않으면 같은 헬퍼를 붙이면 된다.

## 테스트

- `supabase/tests/087_category_ranking.sql` — 슬러그 조회, 전체 목록, limit 상·하한, 비공개/일시중지 제외, 카테고리 목록.
- `mobile/scripts/test-ranking-share-meta.cjs` — 메타/본문 생성, 이스케이프, 최소 표본 미만 처리, robots 규칙.
- `mobile/scripts/check-web-export.cjs` — `/ranking`, `/ranking/ramen` 직접 접근.
