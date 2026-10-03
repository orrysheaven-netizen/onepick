# OnePick 디자인 기초 규칙 (Foundations)

기준 파일: 피그마 "OnePick Social UI"(`77VUmD5myMWbuISkIPz37W`)의 **Foundations** 페이지. 2026-10-03 빌드업 기준(주 버튼=잉크, 접근성/상태 규칙 포함)을 앱 공용 UI와 함께 유지합니다.

현재 UI 안정화 단계에서는 **새 기능 화면을 임의로 추가하지 않습니다.** 기존 프레임과 관리자 승인으로 확정된 파생 상태를 기준으로 점검하며, 손대는 화면은 이 규칙과 공용 컴포넌트로 통일합니다.

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
| `color/text/tertiary` | 플레이스홀더·비활성 아이콘·셰브론 전용. 일반 텍스트 금지 | #8A909C |
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
| Button | Figma=Primary/Secondary/Text/Danger × State=Default/Disabled/Loading. 앱 보조=Soft/Ghost/DangerText | 기본 높이 52, 실제 터치 영역 최소 44. Danger는 `text/danger` 배경 + 흰 글자, 앱의 DangerText는 텍스트형 위험 동작 |
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
| App Header | Show Theme | 홈 상단 로고. 단일 테마 MVP에서는 테마 선택을 숨김 |
| Section Header | Title, Action, Show Action | 섹션 제목(Headline) + 오른쪽 이동 링크 |
| Menu Tile | Name, Count | 홈 메뉴 2열 격자 한 칸, 사진 없으면 bg/placeholder |
| Feed Card | Username, Item, Provider, Review, Meta | 피드 한 건, 채널 태그는 Tag/Soft |
| Progress Banner | Title, Caption, Action, Show Action | 온보딩 미완료 시 홈 상단에 다음 행동을 안내. 초기 MVP에서는 AI 평가 수치·CTA를 표시하지 않음 |
| Category Card | Category, Question (+ Parent 태그) | 온보딩 카테고리 제안: 원픽 고르기(주 버튼) / 넘기기 |
| Profile Header | Username, Bio, Stats | 프로필 상단: 아바타 64 + 사용자명 + 소개 + 원픽·팔로워·팔로잉 |
| Toast | Message | 짧은 완료 알림, 하단 가운데, action/primary 바탕 |
| Notification Row | Actor, Message, Quote, Time, Unread (+ Kind 태그) | 알림 한 건, 안 읽음은 탠저린 점 |
| Settings Row | Label, Show Chevron | 설정 목록 한 줄, 위험 동작은 text/danger |
| My Pick Row | Item, Provider, Review (+ Channel 태그) | 내 프로필 원픽 한 줄. 행은 아이템 상세(36)로 이동하며 프로필에는 관리 ⋯ 메뉴를 두지 않음 |
| Avatar | Size=24/32/40/64/68/72 × Tone=Subtle/Accent | 프로필/댓글/목록 공용 아바타. 이미지가 없으면 이니셜 대체 |
| Tab Header | Title, Action, Show Action | 메인 탭 제목 + 오른쪽 텍스트 동작. 높이 56 |
| Menu Row | Title, Meta, Leading | 사진/자리 56 + 메뉴명 + 보조 정보 + 셰브론. 행 최소 76 |
| Review Row | Mode=Others/Mine | Body Medium 사용자명, 현재 원픽 표시, 댓글·공유. Others=신고, Mine=수정·원픽 해제·한줄평 삭제(삭제는 danger) |
| Comment Row | Mode=Comment/Reply, Show Reply | 댓글 아바타 32, 답글 24 + 들여쓰기. 시간·답글 동작 터치 44 |
| Pick Button | State=Default/Change/Mine | Default·Change=잉크 주 버튼 + ○, Mine=탠저린 면 + 잉크 글자 + ✓(비활성 흐림 없음) |
| Loading State | Mode=Page/Inline | 첫 로드는 틀 유지 + 가운데 스피너/문구, 다음 페이지는 목록 끝 44 영역. 스켈레톤 미사용 |
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

## 접근성·상태 공통 규칙 (2026-10-03)

- `color/text/tertiary`는 읽어야 하는 일반 텍스트에 쓰지 않습니다. 일반 보조 글자는 `color/text/secondary` 이상을 사용합니다. tertiary는 플레이스홀더·비활성 아이콘·셰브론에만 사용합니다.
- 모든 동작의 실제 터치 영역은 최소 44×44입니다. 시각 크기가 작아도 상호작용 영역은 줄이지 않습니다.
- 하단 탭의 비활성 **라벨은 secondary**, 비활성 **아이콘은 tertiary**를 사용합니다.
- 탭 안 화면(40·41·67 포함)은 하단 탭을 유지하고, 36·45·68·75 같은 하위 흐름 화면은 하단 탭을 숨깁니다.
- 첫 불러오기는 기존 화면 틀을 유지한 채 가운데 스피너와 `{무엇}을 불러오고 있어요` 문구를 표시합니다. 0.3초 미만의 짧은 로딩은 표시하지 않습니다.
- 다음 페이지 로딩은 목록 끝 최소 44 영역에 스피너만 둡니다. 저장·삭제는 누른 버튼 자체만 로딩 상태로 바꿔 중복 제출을 막습니다.
- 데이터 모양을 미리 단정하는 스켈레톤 UI는 현재 MVP에서 사용하지 않습니다.

### Danger 사용 범위

- Danger 채움 버튼은 **되돌릴 수 없거나 데이터를 지우는 확인 동작**에만 사용합니다(예: 원픽 선택 해제, 한줄평 삭제, 계정 삭제 확인).
- 취소, 사진 빼기, 차단 해제, 원픽 변경처럼 되돌릴 수 있거나 단순 선택인 동작에는 Danger를 사용하지 않습니다.
- 한 화면/확인창에는 Danger 주요 동작을 하나만 둡니다.
- Figma의 Text 변형은 앱에서 `ghost`/`dangerText` 등 의미별 보조 변형으로 구현할 수 있으나, 시각적 위계와 semantic 색 규칙은 Foundations를 따릅니다.
