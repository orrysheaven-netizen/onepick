# OnePick MVP visual direction

OnePick uses a quiet, light-only interface with one clear primary action per screen.
The product is about choosing and sharing a single favorite, so visual hierarchy should
support the content rather than add decorative competition.

## Brand

- The approved brand lockup is `mobile/public/brand/onepick-logo-horizontal.svg`:
  **tangerine dot + outlined ink wordmark**. Do not rebuild the wordmark with live fonts.
- The standalone mark is the **tangerine dot only**. Do not show a separate `원픽`
  pill/tag as a logo substitute.
- Primary actions use the tangerine `brand` fill and the shared pill-shaped
  `Button`. Secondary actions use the shared bordered `Button`.
- The MVP is **light mode only**. Native chrome and splash surfaces stay white/light;
  a dark palette is not maintained.
- Share-card images use the same approved horizontal SVG wordmark.
- Home discovery copy should invite users to 참고/발견 rather than make copying
  another person's Pick the core action.

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
| Brand | `brand` | `#FF8A00` | primary action, standalone dot |
| | `onBrand` | `#141416` | text/icons on tangerine |
| Quiet selection | `accentSoft` | `#FFF0DC` | selected fills, subtle highlights |
| Legacy ink alias | `accent` / `accentDeep` | `#141416` | old link/selection call sites while migrating |
| | `onAccent` | `#FFFFFF` | legacy text on ink fills only |
| Status | `danger` / `dangerSoft` | `#B4432A` / `#FBEFEB` | destructive/failure feedback |
| | `success` / `successSoft` | `#1F7A4D` / `#E8F5EE` | saved/success feedback |
| | `warning` / `warningSoft` | `#8A5A00` / `#FFF3CD` | pending/warning feedback |
| Kakao | `kakao` / `kakaoText` | `#FEE500` / `#191919` | Kakao login only |
| Apple | `apple` / `appleText` | `#000000` / `#FFFFFF` | Apple login only |

`OnePickType` (display 26/34, title 19/26, body 15/22, label 13/18,
caption 12/16), `OnePickRadius` (12 / 20 / 999), and `OnePickSpace`
(4 · 8 · 12 · 16 · 24 · 32) are the shared scales.

## UI kit

`mobile/src/components/ui/` contains the shared visual primitives. Screens should
compose these instead of restyling buttons/cards independently.

| Component | Role |
| --- | --- |
| `Button` | `primary` (one per screen) · `secondary` · `soft` · `ghost` · `danger`; pill radius and shared heights |
| `BrandMark` | standalone tangerine dot; no text tag |
| `Chip` | category/filter selections |
| `SectionHeader` | title, optional count/description/action |
| `StateCard` | empty/loading/error states |
| `Avatar` | profile initial/avatar |
| `PickCard` | person → channel/provider → item → reason |

### MVP consistency checks

- Home, registration, and profile use the same primary `Button` shape.
- A screen should not present multiple competing primary fills.
- No blue/indigo brand literal should be introduced. Third-party brand colors and
  semantic status colors are exceptions only where explicitly tokenized.
- The approved SVG lockup is the only wordmark. Standalone brand marks are dots.
- User-facing product copy should prefer natural 해요체; legal/admin copy can retain
  the formality required by its context.
