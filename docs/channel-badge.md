# 오프라인·온라인 배지 (Channel Badge)

최종 갱신: 2026-10-05
작성: Claude (사용자 확정안 정리)
상태: 디자인 확정 · Claude가 앱 반영 진행 (사용자 지시, 2026-10-05)

원픽이 어느 경로로 이용하는 곳인지(직접 방문 vs 온라인 구매)를 보여주는 보조 배지다. 사진·메뉴명·한줄평이 먼저 보이고, 배지는 필요할 때 읽히는 정도로 둔다.

## 1. 확정 내용 (2026-10-05 사용자 확정)

- 두 배지는 **같은 색·같은 규격**이며 **문구와 아이콘으로만** 구분한다.
- 문구: `오프라인` / `온라인` (대칭으로 맞춤. "매장"은 쓰지 않음)
- 아이콘: 오프라인 = 매장 외관, 온라인 = 장바구니
- 스타일: 흰 배경 + 1px 경계선, 글자·아이콘은 기본 텍스트색(흐리게 하지 않음)
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
| 배경 | #FFFFFF | `color/bg/default` |
| 경계선 | 1px #D5D7DE (inside) | `color/border/strong` |
| 글자 | 12px Medium | 텍스트 스타일 `OnePick / Caption Medium` |
| 글자·아이콘 색 | #141416 | `color/text/primary` |
| 아이콘 크기 | 10×10px (글자 높이에 맞춤) | — |
| 아이콘 선 굵기 | 2.6 (24 viewBox 기준), round cap/join | — |

색·여백은 하드코딩하지 말고 앱의 기존 디자인 토큰(위 토큰에 대응하는 값)을 사용한다. 캔버스 시안의 회색 배경은 탐색용이며, **Figma 토큰 값이 기준**이다. (2026-10-05 사용자 요청으로 배경을 흰색으로 변경)

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

## 5. 노출 범위 · 관련 컴포넌트

- **노출 범위 (2026-10-05 사용자 확정)**: 공개 MVP에서 오프라인·온라인 배지를 **둘 다** 노출한다.
- 유형 데이터는 기존 스키마에서 읽는다. 새 컬럼·마이그레이션이 필요하면 별도 PR로 분리하고 Production migration은 사용자 승인 전까지 적용하지 않는다.
- `OnePick / Store Badge`(28px 원형 매장 표시)도 최신 사항을 적용했다: 흰 원 + 1px 경계(`color/border/strong`) + 매장 외관 아이콘(이전: 스푼·포크). 오프라인 배지와 같은 아이콘을 쓴다.

## 6. 구현 (2026-10-05, Claude)

- 공용 컴포넌트: `mobile/src/components/ui/channel-badge.tsx` (`<ChannelBadge channel="offline" | "online" | "recipe" />`), 아이콘은 `ui/channel-glyph.web.tsx`.
- 기존에 화면마다 따로 그리던 채널 배지 7곳(홈 피드 카드·홈 행·메뉴 상세 카드·프로필 카드·내 프로필·공개 프로필·제공처 프로필)을 모두 이 컴포넌트로 교체했다. 채널별로 다르던 배경색은 없앴다.
- 문구는 `오프라인 / 온라인 / 레시피`. 등록 화면의 선택지 문구(`매장/온라인`, `PICK_CHANNEL_OPTIONS`)는 이번 범위에서 바꾸지 않았다.
- 레시피는 확정된 아이콘이 없어 같은 스타일의 글자 배지로 둔다.
- 네이티브 빌드는 SVG 렌더러가 없어 글자만 보이고, 웹 빌드에서 아이콘을 그린다.
- 회귀 테스트: `mobile/scripts/test-channel-badge.cjs`
