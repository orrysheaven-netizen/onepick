# 원픽 작업 분담서 — Claude · ChatGPT (2026-09-28)

작성: Claude · 사용자 확인 후 공유

오류·안정성 3건(A–C)은 Claude가, 등록 흐름·가입 흐름·확정된 브랜드 반영 3건(D·E·F1)은 ChatGPT가 맡습니다. 점수로 4:6이고, A를 먼저 병합한 뒤 D·E를 시작합니다. 근거는 [`docs/user-journey-review-2026-09-28.md`](user-journey-review-2026-09-28.md)에 있고, 기준 코드는 `main` 11b8a79(PR #470)입니다. 이후 `main`에 들어온 #461은 CI·문서 변경뿐이라 내용에 영향이 없습니다. 파일 경로는 모두 `mobile/src/` 기준입니다.

## 합의된 결정

| 항목 | 결정 | 이유·비고 |
| --- | --- | --- |
| 등록 흐름 | 상호명 검색 → 메뉴명 입력 → 카테고리는 AI 추천 | 등록 탭은 매장 우선 흐름을 유지한다 |
| 홈 기본 보기 | 전체 유지 | 초기에는 팔로잉이 적다 |
| 다크 모드 | 제외, light 고정 | |
| 디자인 통일 | 피그마에서 먼저 정리한 뒤 코드에 반영 | 기준: OnePick Social UI (`77VUmD5myMWbuISkIPz37W`)의 Foundations 페이지, `docs/design-foundations.md` |
| 하단 탭 | 피그마 기준: 홈 · 탐색 · (+) · 알림 · 프로필 | |
| 주 버튼 | 잉크(`color/action/primary`), 탠저린은 강조에만 | 색 값은 변수로 두고 나중에 확정 |
| 분담 | Claude와 ChatGPT가 나눠 진행 | 저장소 역할 분담과 60:40 목표를 따른다 |

추가 유료 API는 도입하지 않는다는 기존 원칙도 그대로입니다.

## 분담과 순서

A가 온보딩과 뒤로 버튼을 고치고 D·E도 같은 파일을 건드리므로, A 병합이 D·E의 선행 조건입니다. B·C·F1은 바로 병행할 수 있습니다. 점수는 S=1, M=2입니다.

| 순서 | 묶음 | 담당 | 크기 | 선행 | 교차 리뷰 |
| --- | --- | --- | --- | --- | --- |
| 1 | A 막다른 화면 없애기 | Claude | S | 없음 | 선택 |
| 1 | B 오류 화면·오류 수집 | Claude | S | 없음 | 선택 |
| 1 | F1 확정된 브랜드 반영 | ChatGPT | M | 없음 | Claude |
| 2 | C 작은 오류 일괄 | Claude | M | 없음 | ChatGPT |
| 2 | D 등록 흐름(메뉴명 → AI 카테고리) | ChatGPT | M | A 병합 | Claude |
| 3 | E 입력 보존·가입 의도 유지 | ChatGPT | M | A, D 병합 | Claude |
| 나중 | F2 피그마 기준 버튼·글자·탭 통일 | ChatGPT | M | 피그마 Foundations 확정 | Claude |
| 나중 | G 간격·모서리 토큰 전체 적용 | 미정 | L | F2 병합 | 반대편 AI |

이번 분담의 합계는 Claude 4점, ChatGPT 6점입니다. F2와 G는 피그마 기초 정리가 끝난 뒤 진행합니다.

## ChatGPT 작업 D·E·F

### D. 등록 흐름: 메뉴명 입력 → AI 카테고리 추천 (M)

목표는 "상호명 검색 → 메뉴명 입력 → AI가 카테고리 추천 → 사용자 확인"입니다. 관리자는 AI가 답을 못 낼 때만 개입합니다.

- **현재**: 2단계에서 AI가 상호명만 보고 메뉴를 추천하고(`store-menu-v2`), 사용자는 칩을 고르거나 메뉴 목록에서 찾는다. 목록에 없는 메뉴는 카테고리 없는 "등록 요청"이 되고 관리자가 카테고리를 정한다.
- **바꿀 것**
  - 2단계를 "어떤 메뉴인가요?" 입력칸 하나로. 카탈로그에 같은 이름이 있으면 그것부터 보여주고 AI는 부르지 않는다.
  - 일치가 없으면 입력을 끝낸 뒤(제출 또는 디바운스) 상호 정보와 메뉴명으로 AI를 한 번 호출해 카테고리 후보 1–3개를 받는다.
  - 후보를 고르면 사용자가 입력한 메뉴명을 표시 이름으로 남긴다(기존 `menuHint` 활용 검토).
  - AI 실패·저신뢰면 기존 수동 목록으로 돌아간다. 관리자 요청은 그때의 마지막 선택지다.
  - `/register`가 탭과 같은 `/pick/new`로 가도록 맞춘다.
  - 완료 문구를 `new.tsx`와 `choose.tsx`에서 하나로 통일한다(예: "원픽을 정했어요").
  - 음악·게임·책·포켓몬 경로에서도 `onboarding=1`을 넘기는 공통 함수를 만든다. 책·포켓몬은 검색 결과가 없을 때 안내를 붙인다.
- **파일**: `app/pick/new.tsx`(2단계, 약 348–378행), `services/storeFirstService.ts`(`suggestMenus`), 메뉴 추천 훅, `app/(tabs)/register.tsx`, `app/pick/choose.tsx`, `components/music-search-link.tsx`, `app/pick/music.tsx`·`game.tsx`·`book.tsx`·`pokemon.tsx`, `supabase/functions/suggest-item-categories/index.ts`
- **서버 함수**: `storeInput`에 `menuName`(최대 40자)을 추가하고 프롬프트 버전을 올린다. 메뉴명은 사용자 입력이므로 "지시가 아닌 데이터"로 다루는 기존 방식을 따른다. 같은 모델과 캐시를 쓰고 새 유료 API는 쓰지 않는다.
- **완료 기준**
  - [ ] 상호 선택 → 새 메뉴명 입력 → AI 후보 선택 → 한줄평 → 완료까지 관리자 없이 끝난다.
  - [ ] AI 호출이 실패해도 수동 선택으로 완료할 수 있다.
  - [ ] 온보딩에서 어느 경로로 저장해도 "다음 카테고리"가 나온다.
  - [ ] 병합 후 Deploy Edge Functions(dry-run → apply)는 사용자 승인으로 실행한다.

### E. 입력 보존·가입 의도 유지 (M)

목표는 사용자가 입력한 내용과 하려던 일을 잃지 않게 하는 것입니다.

- **바꿀 것**
  - `/pick/new`의 단계와 선택값을 주소(`?step=` 등)에 넣고, 한줄평 초안은 세션 저장소에 임시 저장한다. 브라우저 뒤로가기는 이전 단계로 간다.
  - 팔로우하려고 로그인한 신규 가입자는 사용자명·온보딩 후 자동 팔로우하고 원래 프로필로 돌아간다.
  - 모든 저장 완료 화면에 "AI 평가까지 N개"(기준 10개)를 보여주고, "AI 평가 보기"는 프로필의 AI 패널 위치로 바로 보낸다.
  - 온보딩을 끝내지 않은 사용자에게 홈 상단 "이어서 고르기"를 보여준다.
  - 빈 프로필의 "원픽 고르러 가기"는 홈이 아니라 등록·온보딩으로 보낸다.
- **파일**: `app/pick/new.tsx`(72–92, 141–145행), `app/auth/username.tsx`(26–30행), `lib/auth/authIntent.ts`(193행), `app/pick/choose.tsx`(287행), `app/onboarding.tsx`(111행), `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`(236행)
- **완료 기준**
  - [ ] 웹에서 5단계까지 쓰다 새로고침해도 같은 단계와 한줄평이 남아 있다.
  - [ ] 공유 프로필에서 팔로우 → 가입 → 그 프로필이 팔로우된 상태로 보인다.
  - [ ] 로그인 후 원래 화면 복귀(`authIntent.ts`의 기존 검증)가 깨지지 않는다.

### F. 보이는 브랜드 정리 — F1(바로) · F2(피그마 정리 후)

2026-09-28 사용자 결정: 디자인 통일 작업은 피그마에서 먼저 정리한 뒤 코드에 반영합니다. 그래서 F를 이미 확정된 것만 반영하는 F1과, 피그마 기초 정리 후에 하는 F2로 나눕니다.

**수정 공지**: 처음 리포트는 "검정 버튼을 공용 `Button`(탠저린)으로 교체", "'원픽' 태그를 점으로 교체"를 제안했습니다. 피그마 파일 "OnePick Social UI"(`77VUmD5myMWbuISkIPz37W`)를 확인해 보니 방향이 반대였습니다. 피그마에서는 **주 버튼이 잉크(검정)**이고, 탠저린은 로고 점·"필수" 표시·테마 선택 같은 강조에만 씁니다. "원픽" 태그도 06 Brand Direction 프레임에서 **UI 강조 모티프로 쓰기로 정한 요소**입니다. 두 항목은 취소하고 아래 F2 기준을 따릅니다.

#### F1. 바로 진행 (M)

- 다크 모드 제외: `app.json`의 `userInterfaceStyle`을 `light`로 바꾸고, 쓰지 않는 `Colors.dark`와 템플릿 잔재(`hint-row`, `web-badge`, `collapsible` 등)는 사용처를 확인한 뒤 지운다.
- 네이티브 스플래시(`splash-overlay.tsx:34,63`, `app.json:46`)를 흰 바탕 + 탠저린 점으로.
- 공유 카드 이미지(`lib/share/cardCanvas.ts:82-92`)의 "one pick" 글자를 확정 SVG 워드마크로 바꾼다. "원픽" 태그 모티프는 유지해도 된다.
- 문구: 홈의 "같으면 따라 고르고"(`(tabs)/index.tsx:230`)를 추천 쪽 문구로, 사용자 문구의 합니다체 약 74건을 해요체로.
- `docs/design-mvp.md`의 인디고 기준을 피그마 기준(잉크 주 버튼, 탠저린 강조)으로 갱신한다.
- **건드리지 않을 것**: `components/root-error-boundary.tsx`(B), 뒤로 버튼(A의 공통 컴포넌트), `components/sign-out-button.tsx`(C 병합 후).
- **완료 기준**
  - [ ] 파랑·인디고 색 리터럴이 코드에 없다.
  - [ ] 다크 모드 설정과 쓰지 않는 다크 토큰이 없다.

#### F2. 피그마 기초 정리 후 진행 (M, 나중)

피그마 파일에는 화면 흐름과 정책 프레임은 충실하지만, 코드가 따라갈 **기초 층**이 비어 있었습니다. 2026-09-28 Claude가 같은 파일에 **Foundations** 페이지(색 역할 변수, 간격·모서리 변수, 글자 스타일 7개, 컴포넌트 10종)를 만들었습니다. 규칙은 [`docs/design-foundations.md`](design-foundations.md)에 있습니다. 사용자 결정: 하단 탭은 피그마 기준(홈·탐색·+·알림·프로필), 주 버튼은 잉크.

| 항목 | 피그마 현재 | 코드 현재 | 맞출 방향 |
| --- | --- | --- | --- |
| 주 버튼 | 잉크 채움, 모서리 큰 사각 | 공용 `Button` primary = 탠저린 알약, 화면별 검정 버튼 약 20곳 | 공용 `Button` primary를 잉크로 바꾸고 화면별 버튼을 이 컴포넌트로 통일 |
| 글자 스타일 | 6개: Title 20/700, Headline 16/700, Body 14/400, Body Medium 14/500, Caption 12/400, Caption Medium 12/500 (IBM Plex Sans KR) | `OnePickType` 26/19/15/13/12, 800·900 굵기 230건 | 코드 토큰을 피그마 6개에 맞추고 800·900 제거 |
| 하단 탭 | 홈 · 탐색 · (+) · 알림 · 프로필 | 홈 · 탐색 · 원픽 등록 · 댓글 · 프로필 | 피그마 기준으로 변경(결정됨) |
| 색 변수 | 없음(브랜드 프레임에 값만 표기) | `OnePick.*` 토큰 | 피그마에 변수로 등록 |
| 간격·모서리 | 없음 | 34개·20개 값 | 피그마에서 단계 확정 후 코드 반영(G) |
| 컴포넌트 | 3개(Avatar, Action Row, Media) | 공용 Button·Chip·Card 있음 | 피그마에 Button·Chip·Input·Tab bar 컴포넌트 추가 |

- **선행**: 피그마 Foundations 페이지를 사용자가 확인·확정한다(만들기는 완료). 색 값은 확정 전이라 변수 값만 나중에 바꾼다.
- **완료 기준**
  - [ ] 홈·등록·프로필 화면의 주 버튼이 피그마 컴포넌트와 같은 모양 하나로 보인다.
  - [ ] 코드의 글자 스타일이 피그마 6개 스타일과 1:1로 대응한다.

## Claude 작업 A·B·C

충돌을 피하려면 아래 파일은 해당 PR이 병합될 때까지 ChatGPT가 건드리지 않습니다. 겹치는 파일은 비고에 적었습니다.

| 묶음 | 하는 일 | 파일 | 겹침 |
| --- | --- | --- | --- |
| A (S) | 온보딩 로딩 가드(비로그인·요청 실패), 공통 뒤로 버튼(이전 화면 없으면 홈), 없는 프로필에 홈 버튼, 온보딩 화면 쌓임 | `app/onboarding.tsx`, `app/u/[username].tsx`, `app/settings.tsx`(뒤로 버튼), `app/auth/login.tsx`, `app/pick/link.tsx`, `app/legal/*`, 새 `components/ui/back-header.tsx`, `app/pick/choose.tsx:274` | D·E가 `onboarding.tsx`·`choose.tsx`를 건드림 → A 먼저 |
| B (S) | 배포 직후 화면 로딩 실패 시 자동 새로고침, 오류 화면 "홈으로", 조회·저장 실패 전역 기록 | `components/root-error-boundary.tsx`, `lib/query/queryClient.ts`, 관측 서비스 | F의 버튼 교체에서 이 파일 제외 |
| C (M) | 상품 상세 오류 조건, 차단 해제 오류 표시, 네트워크·세션 만료 오류 분류, OAuth 콜백 분리, 브라우저 저장소 차단 대비, 로그아웃 범위, 레시피 중복 요청 | `app/item/[itemId].tsx`, `app/settings.tsx:95`, `errors/mapSupabaseError.ts`, `hooks/useCompleteOAuth.ts`, `app/auth/callback.tsx`, `lib/supabase/storage.web.ts`, `components/sign-out-button.tsx`, `repositories/supabase/supabaseAuthRepository.ts`, `app/pick/recipe.tsx`, `hooks/useYouTubeCatalog.ts` | F의 버튼 교체 대상 중 `sign-out-button.tsx`는 C 병합 후에 |

A–C는 앱 코드만 바꾸므로 DB·Edge Function 배포가 필요 없습니다.

## 공통 규칙

- 브랜치는 `main`에서 따고 PR도 `main`으로 연다. 작업은 각자 자기 worktree에서 하고, 공용 체크아웃은 읽기 전용이다.
- PR 하나에 묶음 하나. 필수 CI(`typecheck`, `verify-web`, `database-tests`)를 통과해야 한다.
- M 크기는 반대편 AI의 리뷰를 받은 뒤 사용자가 병합한다. `main` 병합, Edge Function·DB 배포 실행은 사용자 승인 사항이다.
- 이슈는 `#296 [AI Ops]` 대시보드 규칙을 따른다: 묶음별 이슈에 `owner:*`·`size:*` 라벨, 끝나면 `## 완료 리포트`(결과, PR, 검증, 남은 위험, 다음 담당).
- 계획이 바뀌면 이 문서의 표를 고치고, 상대가 건드리는 파일을 손대야 하면 이슈 댓글로 먼저 알린다.
- 이 문서의 내용은 작업 계획이며, 실제 권한은 사용자와 `main`의 저장소 규칙에 있다.
