# OnePick MVP visual direction

Reference: the “대량 데이터 수집 전략” conversation and its ONE PICK · 나의 단 하나 mockup (Site `appgprj_6aa7fca80fec81919827a633894d2b2b`).

Use a quiet, light interface with a clear primary action. The home page leads with “많은 것보다, 마음에 드는 하나.” and the user's collection, with an adjacent “원픽 등록” button.

- Brand: an indigo rounded square with a white `1`, followed by `ONE PICK`.
- Collection cards use category labels, existing representative images, item names and personal reasons. “MY PICK” is reserved for the signed-in user's own selections.
- The dashed add card remains an actionable entry to the existing item finder.
- Desktop collections use three columns, medium screens two, and small screens one. Forms stay narrow enough to read comfortably.
- Use actual database content and administrator-controlled categories. Mockup examples and sample counts are not production data.
- Keep existing authentication, request/approval, Pick, profile and administration routes intact. Future screens should follow this palette and avoid decorative sections without a clear purpose.

## Tokens

All colors live in `mobile/src/constants/onepick.ts` as `OnePick.*`. Screens and
components reference tokens by role; no screen file carries a hex literal. Native
navigation and web branding use the same values, and `Colors.light` in
`mobile/src/constants/theme.ts` is derived from them.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Surface | `background` | `#F5F6F8` | screen canvas |
| | `surface` | `#FFFFFF` | cards, sheets, inputs |
| | `sunken` | `#EEF0F4` | image placeholders, disabled fills, quiet chips |
| | `border` / `hairline` | `#E3E5EA` / `#F1F2F6` | card borders / in-card dividers |
| Ink | `text` | `#1B1D22` | titles, body, dark fills |
| | `muted` | `#5C6270` | descriptions and meta (5.9:1 on white) |
| | `hint` | `#8A909C` | placeholders and timestamps only, never body copy |
| Accent | `accent` | `#4945ED` | primary action, selection, brand mark |
| | `accentDeep` | `#3733B8` | pressed state, text on `accentSoft` |
| | `accentSoft` | `#EFEEFF` | selected fills, badges, “my pick” |
| | `onAccent` | `#FFFFFF` | text and icons on accent fills |
| Status | `danger` / `dangerSoft` | `#B4432A` / `#FBEFEB` | delete, failure notices |
| | `success` / `successSoft` | `#1F7A4D` / `#E8F5EE` | saved, approved |
| | `warning` / `warningSoft` | `#8A5A00` / `#FFF3CD` | pending review |
| Kakao | `kakao` / `kakaoText` | `#FEE500` / `#191919` | Kakao login button only |

Soft status cards (notices, the AI taste comment, “my pick” highlights) use the
soft fill without a separate border color.

`OnePickType` (display 26/34, title 19/26, body 15/22, label 13/18, caption 12/16),
`OnePickRadius` (12 / 20 / 999) and `OnePickSpace` (4 · 8 · 12 · 16 · 24 · 32) are
the scales new components should use. Korean body copy does not go below `body`;
`caption` is the only 12px style.

Regression checks that load screen sources through a module map hand back the real
tokens via `mobile/scripts/design-tokens.cjs`.
