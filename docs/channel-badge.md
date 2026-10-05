# 오프라인·온라인 배지 (Channel Badge)

최종 갱신: 2026-10-05
작성: Claude (사용자 확정안 정리)
상태: 디자인 확정 · 앱 반영 전

원픽이 어느 경로로 이용하는 곳인지(직접 방문 vs 온라인 구매)를 보여주는 보조 배지다. 사진·메뉴명·한줄평이 먼저 보이고, 배지는 필요할 때 읽히는 정도로 둔다.

## 1. 확정 내용 (2026-10-05 사용자 확정)

- 두 배지는 **같은 색·같은 규격**이며 **문구와 아이콘으로만** 구분한다.
- 문구: `오프라인` / `온라인` (대칭으로 맞춤. "매장"은 쓰지 않음)
- 아이콘: 오프라인 = 매장 외관, 온라인 = 장바구니
- 스타일: 연회색 채움 + 1px 경계선, 글자·아이콘은 기본 텍스트색(흐리게 하지 않음)
- 위치: **사진 위에 올리지 않는다.** 카테고리 줄 맨 앞에 둔다.
- 별도 강조색(초록·파랑 등)을 쓰지 않는다. 탠저린은 원픽 강조에만 쓴다.

## 2. 규격 (Figma Foundations 토큰 기준)

Figma: `OnePick Social UI` › Foundations › `OnePick / Channel Badge` (component set `810:4516`, variant `Type=Offline` / `Type=Online`)

| 항목 | 값 | 토큰 |
| --- | --- | --- |
| 높이 | 24px | — |
| 좌우 여백 | 8px | `spacing/sm` |
| 아이콘–글자 간격 | 4px | `spacing/xs` |
| 모서리 | 12px (알약형) | `radius/md` |
| 배경 | #EEF0F4 | `color/bg/muted` |
| 경계선 | 1px #D5D7DE (inside) | `color/border/strong` |
| 글자 | 12px Medium | 텍스트 스타일 `OnePick / Caption Medium` |
| 글자·아이콘 색 | #141416 | `color/text/primary` |
| 아이콘 크기 | 10×10px (글자 높이에 맞춤) | — |
| 아이콘 선 굵기 | 2.6 (24 viewBox 기준), round cap/join | — |

색·여백은 하드코딩하지 말고 앱의 기존 디자인 토큰(위 토큰에 대응하는 값)을 사용한다. 캔버스 시안에서 쓴 따뜻한 회색(#F1F0EC)은 탐색용이며, **Figma 토큰 값이 기준**이다.

### 아이콘 SVG (stroke = currentColor)

오프라인 — 매장 외관 (`viewBox="2 3 20 18"`)

```svg
<svg width="10" height="10" viewBox="2 3 20 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5L4.5 4h15L21 9.5z"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/></svg>
```

온라인 — 장바구니 (`viewBox="1 2 21 21"`)

```svg
<svg width="10" height="10" viewBox="1 2 21 21" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11.5l2-8H6.2"/></svg>
```

## 3. 사용 기준

- 음식점·카페 등 직접 방문하거나 포장·배달로 먹는 곳 → **오프라인**
- 배달앱 주문도 오프라인에 포함
- 택배·온라인몰로 주문하는 상품 → **온라인**
- 같은 브랜드가 둘 다 운영해도, 그 원픽이 등록된 유형의 배지 **하나만** 표시
- 배지는 카테고리 줄 맨 앞에 고정: `[배지] 일식 · 라멘`
- 크기·글자·모서리·여백은 앱 전체에서 동일 (화면별로 크기를 바꾸지 않음)
- 배지는 정보 표시용이다. 누를 수 있는 요소로 만들지 않는다(필터 칩과 혼동 방지).
- 접근성: 아이콘은 `aria-hidden`, 의미는 글자로 전달한다.

## 4. 적용 위치 (예)

- 홈 카드: 사진 아래 메타 줄 맨 앞
- 프로필 원픽 리스트: 썸네일 옆 텍스트 묶음 첫 줄 맨 앞
- Figma 사용 예: Foundations › `오프라인·온라인 배지 사용 예 (클로드 10-05)` (`810:4517`)

## 5. 미결정 / 확인 필요

- **노출 범위**: `docs/pm/current-priorities.md`·`current-status.md` 기준 온라인 공개 롤아웃은 후순위다. 공개 MVP에서 온라인 배지를 노출할지, 오프라인 배지만 노출할지는 사용자/PM 결정 후 반영한다. 컴포넌트는 두 유형을 모두 지원하도록 만든다.
- 데이터상 유형 필드(오프라인/온라인)를 어디서 읽을지는 구현 시 기존 스키마를 확인해 정한다. 새 컬럼·마이그레이션이 필요하면 별도 PR로 분리하고 Production migration은 사용자 승인 전까지 적용하지 않는다.

## 6. 구현 메모 (Codex)

- 새 브랜치 + PR로 진행, 필수 CI·리뷰 절차 준수.
- 공용 배지 컴포넌트 1개(`type: 'offline' | 'online'`)로 만들고 화면에서는 이 컴포넌트만 사용한다.
- 기존 라우팅·딥링크·로딩/오류 상태 등 기능 계약은 바꾸지 않는다.
