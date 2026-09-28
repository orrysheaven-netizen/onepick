# OnePick MVP visual direction

OnePick uses a quiet, light-only interface with one clear primary action per screen.
The product is about choosing and sharing a single favorite, so visual hierarchy should
support the content rather than add decorative competition.

## Brand

- The approved logo lockup is `mobile/public/brand/onepick-logo-horizontal.svg`:
  a tangerine dot with the outlined ink wordmark. Share-card images use this SVG
  instead of rebuilding the wordmark with live fonts.
- The existing standalone `원픽` tag remains an **UI emphasis motif**. It is not
  replaced by the tangerine dot and should not be treated as the logo itself.
- The MVP is **light mode only**. Native chrome and splash surfaces stay white/light;
  a dark palette is not maintained.
- The native splash uses a white surface with the tangerine dot.
- Home discovery copy should invite users to 참고/발견 rather than make copying
  another person's Pick the core action.
- Primary actions are designed to use **ink** (`color/action/primary`) and tangerine
  is reserved for brand/emphasis. The code-level shared Button migration is **F2**,
  based on `docs/design-foundations.md`; F1 does not change existing buttons.

Collection and feed cards use real database content: category/channel context,
representative images when available, item/provider names, and the user's reason.
Do not add popularity metrics or mock counts as decoration.

## Tokens

All product colors live in `mobile/src/constants/onepick.ts` as `OnePick.*`.
Screens and components reference role tokens instead of introducing hex literals.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Surface | `background` | `#FAFAF7` | paper-like screen canvas |
| | `surface` | `#FFFFFF` | cards, sheets, inputs, splash |
| | `sunken` | `#EEF0F4` | image placeholders, quiet chips |
| | `border` / `hairline` | `#E3E5EA` / `#F1F2F6` | card borders / dividers |
| Ink | `text` | `#141416` | titles and body |
| | `muted` | `#5C5C63` | descriptions and meta |
| | `hint` | `#8A909C` | placeholders/timestamps only |
| Brand emphasis | `brand` | `#FF8A00` | logo dot and approved emphasis |
| | `onBrand` | `#141416` | readable ink on tangerine |
| Ink action alias | `accent` / `accentDeep` | `#141416` | legacy links/selection during migration |
| Quiet selection | `accentSoft` | `#FFF0DC` | selected/soft emphasis |
| | `onAccent` | `#FFFFFF` | text on ink fills |
| Status | `danger` / `dangerSoft` | `#B4432A` / `#FBEFEB` | destructive/failure feedback |
| | `success` / `successSoft` | `#1F7A4D` / `#E8F5EE` | saved/success feedback |
| | `warning` / `warningSoft` | `#8A5A00` / `#FFF3CD` | pending/warning feedback |
| Kakao | `kakao` / `kakaoText` | `#FEE500` / `#191919` | Kakao login only |
| Apple | `apple` / `appleText` | `#000000` / `#FFFFFF` | Apple login only |

`OnePickType` (display 26/34, title 19/26, body 15/22, label 13/18,
caption 12/16), `OnePickRadius` (12 / 20 / 999), and `OnePickSpace`
(4 · 8 · 12 · 16 · 24 · 32) remain the current code scales until F2/G.

## UI kit

`mobile/src/components/ui/` contains the shared visual primitives.

| Component | Current F1 rule |
| --- | --- |
| `Button` | No F1 visual migration. F2 will align primary with the Foundations ink action token and component geometry. |
| `BrandMark` | Keep the existing `원픽` tag motif; do not replace it with a dot in F1. |
| `Chip` | Category/filter selections |
| `SectionHeader` | Title + optional count/description/action |
| `StateCard` | Empty/loading/error states |
| `Avatar` | Profile initial/avatar |
| `PickCard` | Person → channel/provider → item → reason |

### F1 / F2 boundary

F1 covers light-only cleanup, splash branding, share-card SVG branding, discovery
copy, and removal of confirmed-unused Expo template remnants. It does **not**
standardize button color/shape, typography, tab layout, or replace `BrandMark`.

F2 follows the Figma Foundations rules in `docs/design-foundations.md`:
primary action = ink, tangerine = emphasis, and the `원픽` tag remains an UI motif.
