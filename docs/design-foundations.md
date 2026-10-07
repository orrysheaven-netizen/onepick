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
| `color/text/secondary` | 닉네임·메타 등 읽어야 하는 보조 텍스트 | #55596A |
| `color/text/tertiary` | 비활성 아이콘·셰브론 전용. 일반 텍스트·입력 placeholder 금지 | #8A909C |
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

기본 공용 스케일은 위 7개를 유지합니다. 홈 피드는 전역 Body/Caption을 바꾸지 않고 아래 역할별 semantic style을 추가합니다.

| Feed 스타일 | 크기/행간 | 굵기 | 쓰임 |
| --- | --- | --- | --- |
| Feed / Store Branch | 14/21 | Medium | 상호명 + 지점명 |
| Feed / Nickname | 13/20 | Medium | 작성자 닉네임 |
| Feed / Review | 15/22 | Regular | 한줄평 |
| Feed / Meta | 13/20 | Regular | 시간·카운트 등 읽어야 하는 메타 |

메뉴명은 기존 Title 20/28 Bold를 재사용합니다. 이 Feed 예외 외에 임의 크기나 800·900 굵기를 추가하지 않습니다.

## 간격·모서리

- 간격: `spacing/xs 4` · `sm 8` · `md 12` · `lg 16` · `xl 20` · `2xl 24` · `3xl 32`
- 화면 좌우 여백: `layout/gutter 16` (390 폭 화면에서 내용 폭 358). 홈 피드 콘텐츠 surface만 `layout/home-feed-gutter 20` (내용 폭 350)을 사용하며 헤더·팝업·다른 화면으로 확대하지 않습니다.
- 모서리: `radius/sm 8`(태그·썸네일) · `md 12`(버튼·입력칸) · `lg 16`(카드·팝업) · `xl 24`(시트) · `full`(칩·아바타)

## 컴포넌트 v1

| 컴포넌트 | 변형·속성 | 규칙 |
| --- | --- | --- |
| Button | Figma=Primary/Secondary/Text/Danger × State=Default/Disabled/Loading. 앱 보조=Soft/Ghost/DangerText | 기본 높이 52, 실제 터치 영역 최소 44. Danger는 `text/danger` 배경 + 흰 글자, 앱의 DangerText는 텍스트형 위험 동작 |
| Chip | State=Default/Selected, Label | 높이 32, radius/full, 선택=action/primary |
| Tag | Style=Ink/Soft, Label | "원픽" 모티프, 높이 24, radius/sm |
| Field Label | Label, Required | "필수"는 text/accent |
| Input | Type=Single/Multiline × State=Empty/Filled, Value | 높이 52/120, bg/subtle, 테두리 없음 |
| Header | Title, Action, Show Back, Show Action | 높이 56, 뒤로 Icon/Back 24(터치 48×44) + 가운데 제목 + 오른쪽 텍스트 동작 |
| List Row | Title, Meta | 썸네일 36 + 제목 + 보조 정보 |
| Tab Bar | Active=Home/Explore/Notifications/Profile | 홈 · 탐색 · (+) · 알림 · 프로필 |
| Dialog | Title, Body | 폭 300, radius/lg, 뒤 배경 bg/overlay. 보조 버튼을 둘 때 기본 문구는 "닫기" |
| Empty State | Title, Description, Show Action | 사용자가 실행할 수 있는 기존 다음 행동이 있을 때만 버튼을 노출. 행동할 수 없는 빈 상태는 상태 설명만 표시 |
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
| My Pick Row | Item, Provider, Review (+ Channel 태그) | 내 프로필 원픽 한 줄. 행은 아이템 상세(36)로 이동하며 프로필에는 관리 더보기 메뉴를 두지 않음(컴포넌트의 More는 Icon/More 24 + 44 wrapper) |
| Avatar | Size=24/32/40/64/68/72 × Tone=Subtle/Accent | 프로필/댓글/목록 공용 아바타. 이미지가 없으면 이니셜 대체 |
| Tab Header | Title, Action, Show Action | 메인 탭 제목 + 오른쪽 텍스트 동작. 높이 56 |
| Menu Row | Title, Meta, Leading | 사진/자리 56 + 메뉴명 + 보조 정보 + 셰브론. 행 최소 76 |
| Review Row | Mode=Others/Mine | Body Medium 사용자명, 현재 원픽 표시, 댓글·공유. Others=신고, Mine=수정·원픽 해제·한줄평 삭제(삭제는 danger) |
| Comment Row | Mode=Comment/Reply, Show Reply | 댓글 아바타 32, 답글 24 + 들여쓰기. 시간·답글 동작 터치 44 |
| Pick Button | State=Default/Change/Mine | Default·Change=잉크 주 버튼 + ○(16), Mine=탠저린 면 + 잉크 글자 + Icon/Check 16(비활성 흐림 없음) |
| Loading State | Mode=Page/Inline | 첫 로드는 틀 유지 + 가운데 스피너/문구, 다음 페이지는 목록 끝 44 영역. 스켈레톤 미사용 |
| Confirm Dialog | Title, Body (+ Close/Confirm 버튼) | 되돌리기 어려운 동작 확인. 왼쪽 보조 버튼 기본 문구는 "닫기"(단순히 창을 닫음). 진행 중인 입력·작업을 실제로 취소할 때만 인스턴스에서 "취소"로 바꿈. 앱은 `components/ui/dialog-labels.ts`의 `DIALOG_CLOSE_LABEL`/`DIALOG_CANCEL_LABEL`로 같은 규칙을 공유 |

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

코드의 `mobile/src/constants/onepick.ts` 토큰을 위 역할 이름에 맞춰 옮기고, 공용 `components/ui/*`가 이 컴포넌트와 1:1로 대응하게 합니다. 기본 공용 타이포는 `OnePickType` 7종을 유지하고 홈 피드 역할은 `OnePickFeedType` 4종으로 분리합니다. `OnePickLayout.homeFeedGutter`는 홈 피드 surface에서만 사용합니다. 특히 공용 `Button` primary를 탠저린에서 `color/action/primary`(잉크)로 유지하며 하단 탭은 "댓글" 대신 "알림"을 사용합니다.

## 아이콘 (2026-10-06)

기준: 피그마 Foundations `OnePick / Icon`(Back · Chevron Right/Down/Up · Close · Clear · Plus · Search · Share · More · Check · Comment · Home · Explore · Bell · Profile) ↔ 앱 `components/ui/icon`(`icon-paths.ts` 단일 기하). 토스 UX 가이드 5번의 일관성 원칙을 OnePick에 맞게 적용하며, 사진·사용자 콘텐츠 중심 구조는 그대로 둡니다.

- 공용 크기는 `icon/size/md 24`(주요 액션)와 `icon/size/sm 16`(행 끝 셰브론·입력 지우기·보조 표시)을 기본으로 씁니다. 화면마다 21/22/23px 같은 임의 크기를 새로 만들지 않습니다.
- 아이콘 크기와 터치 영역은 별개입니다. 시각 크기가 16·24여도 실제 터치 wrapper는 최소 44×44를 유지합니다.
- `‹ › × ＋ ⋯ ✓ ⌄ ⌃ ⇪` 같은 문자 글리프를 UI 아이콘으로 쓰지 않습니다. 단, 카테고리 경로(`먹을것 › 라면`)나 문장 안 문장부호처럼 **텍스트 의미**로 쓰는 기호는 예외입니다.
- 같은 기능에는 같은 아이콘을 씁니다(뒤로=Back, 더보기=More, 지우기=Clear 등). 색은 기본 text/primary, 비활성 아이콘·셰브론은 text/tertiary, 카드 보조 동작은 text/secondary를 사용합니다.
- 하단 탭의 **웹 커스텀 탭** 아이콘은 24로 통일합니다. 하단바 높이 98·Safe Area 34·흰 배경·원픽 등록 32 원형 버튼 구조는 바꾸지 않습니다(UI-BOTTOM-001).
- **네이티브 iOS/Android 탭은 예외**입니다. Expo Router `NativeTabs`가 OS 탭바를 직접 그리므로 SF Symbols/Material Symbols를 유지합니다. Figma/Web과 아이콘 의미(Home/Explore/Bell/Profile), 선택 상태, 라벨, 색상 역할은 맞추되 픽셀 기하를 강제로 동일하게 만들지 않습니다. 이 예외는 하단 탭에만 적용하며 일반 화면의 OnePick UI 아이콘은 공용 Icon 체계를 사용합니다.
- 콘텐츠 이미지(음식·메뉴·매장 사진, 프로필 이미지, 피드 썸네일, 원픽 이미지)는 그래픽 제한 대상이 아닙니다. 제한은 장식 일러스트·강조 이펙트에만 적용합니다.
- Figma 메인 페이지의 기능성 문자 글리프는 공용 Icon 인스턴스로 교체하며, 앱 회귀 검사 `scripts/test-ui-icons.cjs`가 크기 토큰·생성 에셋 동기화·글리프 미사용·네이티브 탭 예외 의미를 확인합니다.

## 접근성·상태 공통 규칙 (2026-10-03)

- `color/text/tertiary`는 읽어야 하는 일반 텍스트에 쓰지 않습니다. 일반 보조 글자와 입력 placeholder는 tertiary를 사용하지 않으며 충분한 대비의 역할을 사용합니다. tertiary는 비활성 아이콘·셰브론 같은 비텍스트 보조 UI에만 사용합니다.
- 모든 동작의 실제 터치 영역은 최소 44×44입니다. 시각 크기가 작아도 상호작용 영역은 줄이지 않습니다.
- 하단 탭의 비활성 **라벨은 secondary**, 비활성 **아이콘은 tertiary**를 사용합니다.
- 탭 안 화면(40·41·67 포함)은 하단 탭을 유지하고, 36·45·68·75 같은 하위 흐름 화면은 하단 탭을 숨깁니다.
- 첫 불러오기는 기존 화면 틀을 유지한 채 가운데 스피너와 `{무엇}을 불러오고 있어요` 문구를 표시합니다. 0.3초 미만의 짧은 로딩은 표시하지 않습니다.
- 다음 페이지 로딩은 목록 끝 최소 44 영역에 스피너만 둡니다. 저장·삭제는 누른 버튼 자체만 로딩 상태로 바꿔 중복 제출을 막습니다.
- 데이터 모양을 미리 단정하는 스켈레톤 UI는 현재 MVP에서 사용하지 않습니다.

### Danger 사용 범위

- Danger 채움 버튼은 **되돌릴 수 없거나 데이터를 지우는 확인 동작**에만 사용합니다(예: 원픽 해제하기, 한줄평 삭제하기, 계정 삭제하기).
- 취소, 사진 빼기, 차단 해제, 원픽 변경처럼 되돌릴 수 있거나 단순 선택인 동작에는 Danger를 사용하지 않습니다.
- 한 화면/확인창에는 Danger 주요 동작을 하나만 둡니다.
- Figma의 Text 변형은 앱에서 `ghost`/`dangerText` 등 의미별 보조 변형으로 구현할 수 있으나, 시각적 위계와 semantic 색 규칙은 Foundations를 따릅니다.

### CTA 문구 규칙 (2026-10-06)

버튼 문구만 보고도 눌렀을 때 무슨 일이 일어나는지 알 수 있어야 합니다. Figma와 앱 코드에 같은 문구를 씁니다.

- `확인`·`완료`·`적용`·`선택`·`진행`처럼 결과를 알 수 없는 문구는 쓰지 않습니다. 실제 행동을 동사형으로 씁니다: `등록하기`, `저장하기`, `삭제하기`, `해제하기`, `차단하기`, `검색하기`, `로그아웃하기`.
- 되돌리기 어려운 동작은 대상을 함께 씁니다: `원픽 해제하기`, `한줄평 삭제하기`, `댓글 삭제하기`, `계정 삭제하기`. 문맥에서 대상이 분명하면 짧은 쪽을 우선합니다.
- 공용 Confirm Dialog의 실행 버튼은 호출부에서 항상 명시합니다(`confirmLabel="삭제하기"`처럼). 기본값 `확인`에 기대지 않습니다. 정보 안내용 Dialog(Alert)의 단일 버튼은 `닫기`입니다.
- 왼쪽 보조 버튼: 단순히 창을 닫으면 `닫기`, 진행 중인 작업·입력을 실제로 취소할 때만 `취소`.
- 단계 이동(`다음`)은 온보딩·다단계 등록처럼 다음 단계로 간다는 뜻이 분명할 때만 씁니다. 마지막 단계는 `다음`·`완료` 대신 실제 최종 행동(`원픽 등록하기`)을 씁니다.
- 같은 행동은 같은 단어로 씁니다(아이템 상세·등록 화면 공통):

| 행동 | 문구 |
| --- | --- |
| 원픽으로 고르기 / 바꾸기 | `원픽으로 고르기` · `원픽 바꾸기` · 목록 행은 `이 지점을 원픽으로 고르기 ›` |
| 등록 마지막 단계 | `원픽 등록하기` |
| 원픽 해제 확인 | `원픽 해제하기` |
| 한줄평 저장·삭제 확인 | `한줄평 저장하기` · `한줄평 삭제하기` |
| 댓글·답글 | `댓글 남기기` · `답글 남기기` · 삭제 확인 `댓글 삭제하기` |
| 사진 | 고르기 전 `사진 고르기`, 고른 뒤 `다른 사진 고르기` · `이 사진 등록하기` · `사진 빼기`, 아이템 상세 진입 `사진 올리기` |
| 팔로우 | `팔로우` · `팔로잉`(상태형 토글, 예외) · 해제 확인 `팔로우 취소` |
| 신고 | `신고하기`, 사유 패널 닫기 `닫기` |
| 차단 | `차단하기` · `차단 해제하기` |
| 로그아웃 | `모든 기기에서 로그아웃하기` |
| 검색 실행 | `검색하기` |
| 아이디 만들기 마지막 | `이 아이디로 시작하기` |
| 프로필·자기소개·SNS 저장 | `저장하기` |

## UX 라이팅 공통 원칙 (2026-10-06)

Figma와 앱의 모든 사용자 노출 문구(버튼·안내문·빈 상태·오류·온보딩·알림·다이얼로그·placeholder/helper·토스트·탭/메뉴/설정·상태 문구)에 공통 적용합니다.

1. 모든 문구는 해요체로 통일합니다. `준비 중입니다` → `준비 중이에요`, `등록되었습니다` → `등록했어요`.
2. 명사형보다 문장형을 우선합니다. `저장 완료` → `저장했어요`, `등록 실패` → `등록하지 못했어요`.
3. 수동형보다 능동형을 우선합니다. `선택되었습니다` → `선택했어요`. 단, 관리자 검수 결과처럼 사용자가 한 행동이 아닌 상태(`반려됐어요`, `보류됐어요`)는 행위 주체를 오해하지 않도록 수동형을 유지할 수 있습니다.
4. 과도한 경어를 쓰지 않습니다. `확인해주시기 바랍니다` → `확인해주세요`, `~하시겠습니까?` → `~할까요?`. 보조 용언은 붙여 씁니다(`해 주세요` → `해주세요`).
5. 짧고 직접적으로 씁니다. 같은 뜻을 두 문장으로 반복하지 않고, 필요한 정보와 다음 행동만 남깁니다.
6. 제품 용어(`원픽`, `한줄평`, `매장`, `메뉴`, `오프라인/온라인`)는 화면마다 다른 말로 바꾸지 않습니다. 같은 기능의 문구는 Figma에서 확정한 문구를 앱이 그대로 씁니다.
7. 다이얼로그의 왼쪽(보조) 버튼은 `취소`가 아니라 `닫기`입니다. 등록 흐름 헤더의 `취소`(흐름 자체를 중단)는 예외입니다.

법적 고지(이용약관·개인정보 처리방침) 본문과 사용자 작성 예시 문구(자기소개 예시 등)는 이 원칙의 대상이 아닙니다. 오류 원인·권한 제한·되돌릴 수 없는 동작 경고는 어투만 바꾸고 의미를 줄이지 않습니다.
