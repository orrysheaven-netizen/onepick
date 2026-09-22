# OnePick logo revision

A proposal for the brand mark. Nothing here is applied yet — pick a candidate first.

Visual comparison (all six candidates at 96 / 48 / 24 / 16px, app icon, lockup, single colour,
dark): <https://claude.ai/artifact/NfauXiGiFJwuVDUQnqUarq>. Candidate sources live in
`docs/assets/logo/`.

## Why revise

Today's logo is the indigo `원픽` tag (`mobile/src/components/onepick-brand.tsx`,
`mobile/src/components/ui/brand-mark.tsx`) followed by `one pick`. It reads at header size,
but five things are broken:

- **Letters do not shrink.** `원픽` is two stroke-heavy glyphs. At favicon (16px), tab bar and
  notification-icon size the glyphs fill in. A logo needs a shape that survives without type.
- **It is Korean-only.** The App Store / Play icon, OG thumbnails and any non-Korean screen get
  a mark that does not carry the name.
- **It says the name twice.** `원픽` tag + `one pick` repeats one name in two languages and
  spends header width doing it.
- **There is no single-colour form.** The Android monochrome layer
  (`android-icon-monochrome.png`), iOS tinted icons and greyscale print have nothing to use.
- **The brand is missing where it is seen first.** `mobile/assets/images/icon.png`,
  `splash-icon.png` and `favicon.png` are still the Expo defaults (blue `#208AEF`), and
  `app.json` sets the splash background to `#208AEF` and the Android icon background to
  `#E6F4FE`. The first square a user sees after installing has no OnePick indigo in it.

`docs/design-mvp.md` also still describes the mark as "an indigo rounded square with a white
`1`", which no longer matches the code. That line needs updating whichever candidate wins.

## Candidates

All six are drawn on the same 24 × 24 grid with the tokens in
`mobile/src/constants/onepick.ts`.

| | Candidate | Idea | Strength | Risk |
| --- | --- | --- | --- | --- |
| A | **원 · 픽** — the ring and the dot (`mark-a-ring.svg`) | An open ring with one dot lifted out of the gap: the ring is the whole, the dot is the one you chose. `원` also means circle, so the Korean name is in the geometry. | Holds at 16px, works in one colour and as negative space. The dot becomes a motif the UI can reuse (selection, my-pick badge, empty slot). | Open centre makes it visually light at the smallest sizes; the app icon fills that back in with an indigo ground. |
| B | **킵** — the keeper ribbon (`mark-b-keep.svg`) | Not "saved" but "I am keeping this one". The pick dot returns as a cut-out. | Filled silhouette, so it is among the sturdiest at 16px and in one colour; doubles as a my-pick badge. | A bookmark is every app's save icon. As a logo it collides with a function icon and is the least distinctive. |
| C | **하나만** — three quiet, one chosen (`mark-c-many.svg`, `mark-c-many-mono.svg`) | Three muted dots and one chosen dot: the most literal reading of "많은 것보다, 마음에 드는 하나" and of one pick per category. | Language-independent and needs no explanation. Best of the six for OG images, onboarding and marketing. | Depends on two tones, so single colour needs the outline variant. A 2 × 2 grid can also read as a launcher or menu icon. |
| D | **Refine what exists** — the `원픽` tag | Keep the tag; fix its metrics (radius `0.3125h`, side padding `0.28h`) and collapse `one pick` to `onepick`. | Cheapest by far; no asset or component work. | Fixes only the third finding above. It still collapses at 16px, and the app icon and single-colour gaps stay open. |
| E | **하나** — the numeral on a tile (`mark-e-one.svg`, `mark-e-one-cut.svg`) | The tile is the icon. What `docs/design-mvp.md` already described — "an indigo rounded square with a white `1`" — drawn properly, with the numeral's flag cut on the pick dot's angle. | The one that most certainly works: a filled face reads best at 16px, the app icon needs no separate ground, and the knocked-out version is the single-colour and tinted form. Language-independent. | A numeral in a square is the most crowded space in logo design. The safest and the least memorable. It says "one", not "why". |
| F | **태그** — the tag as a silhouette (`mark-f-tag.svg`) | Today's `원픽` tag with the letters taken out. A tag is what you attach to the one thing you keep; the punch hole is candidate A's pick dot. | One connected face, so the hole survives 16px, and one knock-out covers single colour and tinted. The only symbol that keeps a formal link to the current brand. | A label/tag silhouette is a common category icon — the same weakness as B — and can read as coupons or discounts, which pulls against taste curation. |

A third sketch was drawn and dropped: **밑줄**, the pick dot with its one line underneath
(the one-line reason is the product's real rule). Rendered, a centred dot over a rounded bar
reads as a person / ID-card glyph, and at 16px two small shapes with a gap between them
disappear. The idea is sound and the form is not; it is not worth reviving as a symbol.

## Colour

**Keep `#4945ED`.** It is not the logo's colour, it is `OnePick.accent` itself — the primary
button, selection, chips, the my-pick badge and every `accentSoft` fill come from it.

- Moving it means re-deriving `accent`, `accentDeep`, `accentSoft` and `onAccent` and
  re-checking contrast. Moving it for the logo alone produces a logo that matches no button in
  the app.
- It also helps here: restaurant and commerce apps are dominated by warm reds, oranges and
  greens. Indigo stays quiet among them and reads as taste and curation rather than delivery or
  discounts — which suits the restaurant-first MVP.
- The one real weakness: `#4945ED` sits in the common "tech indigo" band, so at 16px on white
  it has a lot of company. That is a distinctiveness problem, and it can be solved without
  touching the palette.

One adjustment is worth making: leave the tokens alone and take **only the app icon and splash
ground** to `accentDeep` `#3733B8`, which is already in the palette. It separates the icon from
the bright-violet crowd on a home screen while the UI accent does not change by one character.
Adding a new secondary colour is not recommended — the palette already carries danger, success
and warning. If one is ever needed, scope it to brand graphics (OG images, onboarding), never
to the UI.

## Recommendation

**Candidate A as the logo, and the `원픽` tag stays — as a badge.**

The tag is already used more as a label than as a logo: `BrandMark` appears on state cards,
registration headers and the home footer, next to copy like "새로운 원픽의 시작" and
"카테고리마다 단 하나". That role is working and does not change. Only the job of representing
the name moves to the symbol. Splitting the roles lets each one work at its own size, and
`brand-mark.tsx` keeps its current behaviour.

The runner-up is **E**. It is the most certain to work and the least memorable of the six; if
getting every surface correct now matters more than building a mark, E is the right call. If the
current tag is already recognised by enough users, **F** keeps a formal link to it and is the
safer compromise.

### Geometry and rules

- Symbol: 24 × 24 grid. Ring centre `(11.8, 12.2)`, radius `7.8`, stroke `3.2` with round caps,
  gap centred on 45°. Dot centre `(17.88, 6.12)`, radius `3.6`.
- Colour: `OnePick.accent` `#4945ED` on light grounds, `OnePick.onAccent` white on accent
  grounds. One colour only — no gradients.
- Lockup: symbol, then the wordmark `onepick`, gap = 1/3 of the symbol width. The Korean lockup
  swaps the wordmark for `원픽` and keeps the same symbol.
- Minimum sizes: symbol alone 16px; lockup 96px wide. Below 24px use the symbol without the
  wordmark.
- Clear space: 1/4 of the symbol height on all sides.
- App icon: mark box = 68% of the canvas, centred, white on `#4945ED`.

## What changes when a candidate is chosen

| File | Today | Proposed |
| --- | --- | --- |
| `mobile/assets/images/icon.png` | Expo default, blue 1024px | Indigo ground + white symbol, 1024px (`appicon-a-1024.svg`); ground `#3733B8` if the deeper icon ground is approved |
| `mobile/assets/images/favicon.png` | Expo default, 48px | Symbol alone, 32 and 48px |
| `mobile/assets/images/splash-icon.png`, `app.json` | Expo default; splash background `#208AEF` | Symbol; background `#4945ED` (`OnePick.accent`) |
| `mobile/assets/images/android-icon-{foreground,background,monochrome}.png`, `app.json` | Expo defaults; background `#E6F4FE` | `android-foreground-a-512.svg`, indigo background, `android-monochrome-a-512.svg` |
| `mobile/src/components/onepick-brand.tsx` | Tag + `one pick` | Symbol + `onepick` wordmark |
| `mobile/src/components/ui/brand-mark.tsx` | Tag, doubling as the logo | Unchanged; documented as a label, not the logo |
| `og-default.png`, profile share cards | Text lockup | Symbol + Korean lockup (candidate C works as a secondary graphic here) |
| `docs/design-mvp.md` | "indigo rounded square with a white `1`" | The real mark definition |

Asset replacement should be one commit, separate from any screen code. The icon and splash are
only verifiable in a native build, not in the web export.

## Open decisions

1. Which candidate — A, B, C, D, E or F. Only the chosen one gets finalised geometry and a PNG
   export set.
2. Whether the wordmark becomes `onepick` as one word. The store listing name stays `OnePick`.
3. Whether the app icon and splash ground go to `accentDeep` `#3733B8`. Tokens and the UI accent
   stay as they are either way.
4. Whether candidate C is adopted as a secondary marketing graphic even if A wins as the logo.
