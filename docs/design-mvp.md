# OnePick MVP visual direction

OnePick MVP는 **light-only** 인터페이스를 사용합니다. 디자인의 기준은 Figma Foundations이며, 화면별 임의 스타일보다 공통 토큰과 컴포넌트를 우선합니다.

## Brand

- 승인된 워드마크는 `mobile/public/brand/onepick-logo-horizontal.svg`입니다. 공유 카드에서도 라이브 폰트로 로고를 다시 만들지 않습니다.
- **주 버튼은 잉크(검정) 채움**입니다.
- 탠저린은 로고 점, 필수 표시, 선택/테마 강조처럼 제한된 강조에 사용합니다.
- 기존 **`원픽` 태그는 UI 강조 모티프이므로 유지**합니다. 탠저린 점으로 일괄 치환하지 않습니다.
- MVP에서는 다크 모드를 제공하지 않습니다.

## Tokens

색상은 `mobile/src/constants/onepick.ts`의 `OnePick.*` 역할 토큰을 사용합니다.

| 역할 | 토큰 | 값 | 용도 |
| --- | --- | --- | --- |
| Surface | `background` / `bgDefault` | `#FFFFFF` | 화면 기본 배경 |
| | `surface` | `#FFFFFF` | 카드, 시트, 입력, 스플래시 |
| | `sunken` | `#EEF0F4` | 조용한 보조 배경 |
| Ink | `text` | `#141416` | 본문, 제목, 주 버튼 기반 |
| | `muted` | `#5C5C63` | 설명, 메타 |
| Brand | `brand` | `#FF8A00` | 제한된 탠저린 강조 |
| | `accentSoft` | `#FFF0DC` | 조용한 선택 강조 |
| Legacy ink alias | `accent`, `accentDeep` | `#141416` | 기존 링크/선택 호출부 |
| Status | `danger`, `success`, `warning` | semantic | 상태 피드백 |
| Third party | `kakao`, `apple` | provider brand | 로그인 버튼 |

파랑·인디고는 OnePick 브랜드 색으로 사용하지 않습니다. 제3자 브랜드 색과 의미 기반 상태 색은 예외입니다.

하단 탭의 Figma 기준 프레임은 **390×98**이며, 탭 콘텐츠 56px + 상단 8px + 하단 Safe Area 34px를 사용합니다. 웹은 실제 inset이 34px보다 작아도 34px을 확보하고, 네이티브는 시스템 Safe Area를 사용해 기기별 inset을 침범하지 않습니다.

## UI kit

`mobile/src/components/ui/`의 공용 컴포넌트를 우선 사용합니다.

- `Button`: Figma Foundations 확정 전까지 현재 구조를 유지합니다. **F1에서 탠저린 primary로 일괄 변경하지 않습니다.**
- `BrandMark`: 기존 `원픽` 태그 모티프를 유지합니다.
- `Chip`, `SectionHeader`, `StateCard`, `Avatar`, `PickCard`: 화면별 중복 스타일보다 공용 구현을 우선합니다.

## F1 / F2 boundary

F1은 light-only, 스플래시, 공유 카드 워드마크, 확정 문구와 브랜드 문서만 반영합니다.

버튼 모양, 6개 타이포그래피 스타일, 색 변수, Button·Chip·Input·Tab bar 컴포넌트 통일은 **F2**입니다. F2는 Figma Foundations가 사용자 확인으로 확정된 뒤 코드에 반영합니다. 간격·모서리 전체 토큰 정리는 그 다음 G 단계입니다.
