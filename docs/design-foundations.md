# OnePick 디자인 기초 규칙 (Foundations v1)

기준 파일: 피그마 "OnePick Social UI"(`77VUmD5myMWbuISkIPz37W`)의 **Foundations** 페이지. 2026-09-28 Claude가 만들고 사용자 결정(하단 탭은 피그마 기준, 주 버튼은 잉크)을 반영했습니다.

2026-09-28 UI 안정화 단계에서는 **새 화면을 추가하지 않습니다.** 기존 "OnePick Social UI" 프레임만 다시 점검하며, 손대는 화면은 이 규칙과 공용 컴포넌트로 통일합니다.

## 원칙

- 색은 **역할 변수**로만 씁니다. 헥스 값을 직접 쓰지 않습니다. 색 값은 아직 확정 전이라, 확정하면 `OnePick Primitives` 값만 바꿉니다.
- 다크 모드는 쓰지 않습니다(Light 한 모드).
- 주 버튼은 화면당 하나, 색은 `color/action/primary`. 탠저린은 로고 점·테마 선택·강조 면에만 씁니다.
- "원픽" 태그는 UI 강조 모티프로 유지합니다(로고 대체 아님).

## 색 역할 (임시 값)

| 변수 | 쓰임 | 임시 값 |
| --- | --- | --- |
| `color/bg/default` | 화면 기본 배경 | #FFFFFF |
| `color/bg/subtle` | 입력칸·빈 영역 | #F6F6F8 |
| `color/bg/muted` | 기본 칩·구분 면 | #EEF0F4 |
| `color/bg/placeholder` | 이미지 없는 썸네일 | #F0E3CC |
| `color/bg/accent` | 브랜드 강조 면 | #FF8A00 |
| `color/bg/accent-subtle` | 연한 강조 면 | #FFF0DC |
| `color/bg/overlay` | 팝업 뒤 어둡게 | #000000 35% |
| `color/action/primary` | 주 버튼·선택된 칩·탭 + 버튼 | #141416 |
| `color/action/disabled` | 비활성 주 버튼 | #ADB0BA |
| `color/text/primary` | 본문·제목 | #141416 |
| `color/text/secondary` | 보조 설명 | #6B6E78 |
| `color/text/tertiary` | 힌트·플레이스홀더·비활성 탭 | #8A909C |
| `color/text/on-action` | 주 버튼 위 글자 | #FFFFFF |
| `color/text/accent` | "필수" 같은 작은 강조 글자 | #B84F00 |
| `color/text/danger` | 오류·삭제 | #B4432A |
| `color/border/default` | 카드·구분선 | #E8E8ED |
| `color/border/strong` | 보조 버튼 테두리 | #D5D7DE |

## 글자 스타일 (IBM Plex Sans KR)

| 스타일 | 크기/행간 | 굵기 | 쓰임 |
| --- | --- | --- | --- |
| Page Title | 22/30 | Bold | 화면 첫 줄 제목 |
| Title | 20/28 | Bold | 섹션 제목 |
| Headline | 16/24 | Bold | 헤더·카드 제목 |
| Body Medium | 14/21 | Medium | 버튼·강조 본문 |
| Body | 14/21 | Regular | 본문 |
| Caption Medium | 12/18 | Medium | 칩·탭·라벨 |
| Caption | 12/18 | Regular | 보조 정보 |

800·900 굵기와 이 7개 밖의 크기는 쓰지 않습니다.

## 간격·모서리

- 간격: `spacing/xs 4` · `sm 8` · `md 12` · `lg 16` · `xl 20` · `2xl 24` · `3xl 32`
- 화면 좌우 여백: `layout/gutter 16` (390 폭 화면에서 내용 폭 358)
- 모서리: `radius/sm 8`(태그·썸네일) · `md 12`(버튼·입력칸) · `lg 16`(카드·팝업) · `xl 24`(시트) · `full`(칩·아바타)

## 컴포넌트 v1

| 컴포넌트 | 변형·속성 | 규칙 |
| --- | --- | --- |
| Button | Style=Primary/Secondary/Text × State=Default/Disabled, Label | 높이 52, radius/md, 하단 주요 액션은 가로 채움 |
| Chip | State=Default/Selected, Label | 높이 32, radius/full, 선택=action/primary |
| Tag | Style=Ink/Soft, Label | "원픽" 모티프, 높이 24, radius/sm |
| Field Label | Label, Required | "필수"는 text/accent |
| Input | Type=Single/Multiline × State=Empty/Filled, Value | 높이 52/120, bg/subtle, 테두리 없음 |
| Header | Title, Action, Show Back, Show Action | 높이 56, 뒤로 ‹ + 가운데 제목 + 오른쪽 텍스트 동작 |
| List Row | Title, Meta | 썸네일 36 + 제목 + 보조 정보 |
| Tab Bar | Active=Home/Explore/Notifications/Profile | 홈 · 탐색 · (+) · 알림 · 프로필 |
| Dialog | Title, Body | 폭 300, radius/lg, 뒤 배경 bg/overlay |
| Empty State | Title, Description, Show Action | 막다른 화면 방지를 위해 다음 행동 버튼 기본 포함 |
| Result Card | Title, Meta | 검색 결과 한 건(상호·지점 + 주소) |
| App Header | Theme | 메인 탭 상단: 로고 + 테마 선택(bg/accent) |
| Section Header | Title, Action, Show Action | 섹션 제목(Headline) + 오른쪽 이동 링크 |
| Menu Tile | Name, Count | 홈 메뉴 2열 격자 한 칸, 사진 없으면 bg/placeholder |
| Feed Card | Username, Item, Provider, Review, Meta | 피드 한 건, 채널 태그는 Tag/Soft |
| Progress Banner | Title, Caption, Action, Show Action | 온보딩 미완료 시 홈 상단에 다음 행동을 안내. 초기 MVP에서는 AI 평가 수치·CTA를 표시하지 않음 |
| Category Card | Category, Question (+ Parent 태그) | 온보딩 카테고리 제안: 원픽 고르기(주 버튼) / 넘기기 |
| Profile Header | Username, Bio, Stats | 프로필 상단: 아바타 64 + 사용자명 + 소개 + 원픽·팔로워·팔로잉 |
| Toast | Message | 짧은 완료 알림, 하단 가운데, action/primary 바탕 |
| Notification Row | Actor, Message, Quote, Time, Unread (+ Kind 태그) | 알림 한 건, 안 읽음은 탠저린 점 |
| Settings Row | Label, Show Chevron | 설정 목록 한 줄, 위험 동작은 text/danger |
| My Pick Row | Item, Provider, Review (+ Channel 태그) | 내 프로필 원픽 한 줄 + ⋯ 관리 메뉴 |
| Confirm Dialog | Title, Body (+ Cancel/Confirm 버튼) | 되돌리기 어려운 동작 확인 |

예외: 로그인 버튼(카카오 노랑 #FEE500, Apple 검정)은 각 사 가이드 색을 그대로 씁니다.

Button·Chip·Tag는 글자에 맞춰 폭이 늘어납니다(hug). 화면 하단 주요 버튼만 가로 채움입니다. Text 버튼은 좌우 여백이 없어 본문과 왼쪽 정렬됩니다.

## 기존 화면 통일 순서

신규 화면을 만들지 않고 아래 기존 화면을 순서대로 점검합니다.

1. 홈
2. 탐색
3. 원픽 등록 — 기존 75번을 기준으로 유지
4. 개인/공개 프로필 — 공개 프로필은 기존 40번이 기준이며, 별도 78번은 통합 후 제거
5. 알림
6. 상품 상세
7. 설정 및 기타

각 화면은 KEEP / UPDATE / MERGE / DELETE로 판정합니다. 디자인 통일 과정에서 라우팅·인증 의도·딥링크·입력 상태·로딩/오류/빈 상태·저장 동작을 임의로 바꾸지 않습니다. 기능 변경이 필요한 경우 별도 PR로 분리합니다.

## 코드 반영 (F2)

코드의 `mobile/src/constants/onepick.ts` 토큰을 위 역할 이름에 맞춰 옮기고, 공용 `components/ui/*`가 이 컴포넌트와 1:1로 대응하게 합니다. 특히 공용 `Button` primary를 탠저린에서 `color/action/primary`(잉크)로, `OnePickType`을 위 7개 스타일로 바꿉니다. 하단 탭은 "댓글" 대신 "알림"으로 바뀝니다.
