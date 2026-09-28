# OnePick 디자인 기초 규칙 (Foundations v1)

기준 파일: 피그마 "OnePick Social UI"(`77VUmD5myMWbuISkIPz37W`)의 **Foundations** 페이지. 2026-09-28 Claude가 만들고 사용자 결정(하단 탭은 피그마 기준, 주 버튼은 잉크)을 반영했습니다.

새 화면은 피그마와 코드 모두 이 규칙으로만 만듭니다. 기존 "OnePick Social UI" 페이지의 프레임은 손댈 때마다 이 컴포넌트로 바꿔 끼웁니다.

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
| Progress Banner | Title, Caption, Action, Show Action | 온보딩 미완료 시 홈 상단·온보딩 화면, AI 평가까지 N/10. 진행률은 Track 오른쪽 여백으로 조정 |
| Category Card | Category, Question (+ Parent 태그) | 온보딩 카테고리 제안: 원픽 고르기(주 버튼) / 넘기기 |
| Profile Header | Username, Bio, Stats | 프로필 상단: 아바타 64 + 사용자명 + 소개 + 원픽·팔로워·팔로잉 |
| Toast | Message | 짧은 완료 알림, 하단 가운데, action/primary 바탕 |
| Notification Row | Actor, Message, Quote, Time, Unread (+ Kind 태그) | 알림 한 건, 안 읽음은 탠저린 점 |
| Settings Row | Label, Show Chevron | 설정 목록 한 줄, 위험 동작은 text/danger |
| My Pick Row | Item, Provider, Review (+ Channel 태그) | 내 프로필 원픽 한 줄 + ⋯ 관리 메뉴 |
| Confirm Dialog | Title, Body (+ Cancel/Confirm 버튼) | 되돌리기 어려운 동작 확인 |

예외: 로그인 버튼(카카오 노랑 #FEE500, Apple 검정)은 각 사 가이드 색을 그대로 씁니다.

Button·Chip·Tag는 글자에 맞춰 폭이 늘어납니다(hug). 화면 하단 주요 버튼만 가로 채움입니다. Text 버튼은 좌우 여백이 없어 본문과 왼쪽 정렬됩니다.

## 적용 화면

- 75. 원픽 등록 v6 — 상호명 검색 → 메뉴명 입력 + AI 카테고리 추천(추천 중·결과·실패) → 한줄평 → 완료 팝업. D 구현 기준.
- 76. 홈 v6 — 온보딩 진행 중(진행 배너), 로그아웃 첫 방문, 팔로잉 비었을 때, 불러오기 실패, 피드 스크롤. E(이어서 고르기 배너)·F2 기준.
- 77. 온보딩 v6 — 카테고리 제안(3/10), 저장 후 다음 카테고리, 10개 달성(AI 평가 보기), 모두 봤을 때, 불러오기 실패. E(N/10 진행 표시, AI 패널로 바로 이동) 기준.
- 78. 공유 프로필 첫 방문 v6 — 공유 링크 프로필, 팔로우 → 로그인 시트, 새 가입자 사용자명, 돌아와서 자동 팔로우 + 토스트, 없는 프로필. E(가입 의도 유지·자동 팔로우) 기준.
- 79. 탐색 v6 — 메뉴별 원픽, 선택이 적은 메뉴(3명 미만·0명), 검색 결과 없음.
- 80. 알림 v6 — 알림 목록(안 읽음 점·종류 태그), 알림 없음, 수정 필요 알림 → 수정 화면.
- 81. 내 프로필 · 설정 v6 — 내 프로필, 원픽 관리 메뉴(한줄평 수정 · 원픽 해제), 해제 확인, 설정(모든 기기에서 로그아웃, 회원 탈퇴).

## 코드 반영 (F2)

코드의 `mobile/src/constants/onepick.ts` 토큰을 위 역할 이름에 맞춰 옮기고, 공용 `components/ui/*`가 이 컴포넌트와 1:1로 대응하게 합니다. 특히 공용 `Button` primary를 탠저린에서 `color/action/primary`(잉크)로, `OnePickType`을 위 7개 스타일로 바꿉니다. 하단 탭은 "댓글" 대신 "알림"으로 바뀝니다.
