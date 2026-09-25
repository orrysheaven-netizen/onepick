import { BodyFont } from './font-family';

// OnePick design tokens. Screens reference these by name; hex values live only here.
// Roles: surfaces → ink (text) → accent → status. See docs/design-mvp.md.
export const OnePick = {
  // Surfaces
  background: '#FAFAF7', // approved paper canvas
  surface: '#FFFFFF', // cards, sheets, inputs
  sunken: '#EEF0F4', // image placeholders, disabled fills, quiet chips
  border: '#E3E5EA',
  hairline: '#F1F2F6', // in-card dividers

  // Ink
  text: '#141416', // approved ink
  muted: '#5C5C63', // approved secondary text
  hint: '#8A909C', // placeholders and timestamps only — not body copy

  // Brand: fills/decorations only; never use brand for small text on white.
  brand: '#FF8A00',
  onBrand: '#141416',
  // Legacy accent serves both links and fills. Keep its text/fill pair readable
  // until individual components opt into brand/onBrand together.
  accent: '#141416',
  accentDeep: '#141416',
  accentSoft: '#FFF0DC',
  onAccent: '#FFFFFF',

  // Status (semantic feedback, not brand colors)
  danger: '#B4432A',
  dangerSoft: '#FBEFEB',
  success: '#1F7A4D',
  successSoft: '#E8F5EE',
  warning: '#8A5A00',
  warningSoft: '#FFF3CD',

  // Third-party brand (login button guidelines: Kakao, Apple)
  kakao: '#FEE500',
  kakaoText: '#191919',
  apple: '#000000',
  appleText: '#FFFFFF',

  maxWidth: 480,
} as const;

// Typeface names; platform-specific Text families live in font-family(.web).ts.
export const OnePickFont = {
  body: 'IBM Plex Sans KR',
  english: 'Outfit',
} as const;

// Type scale: five steps. Korean body copy never goes below `body`; `caption` is the only 12px.
export const OnePickType = {
  display: { fontFamily: BodyFont, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontFamily: BodyFont, fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontFamily: BodyFont, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontFamily: BodyFont, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontFamily: BodyFont, fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const;

export const OnePickRadius = {
  small: 12, // inputs, chips, images
  card: 20,
  pill: 999, // buttons, avatars
} as const;

export const OnePickSpace = {
  xs: 4,
  sm: 8,
  md: 12, // gap between cards
  lg: 16, // screen gutter, card padding
  xl: 24,
  xxl: 32,
} as const;


// Feature exposure gates. Database support can be ready while an MVP feature
// remains intentionally hidden until an explicit product rollout decision.
//
// follow: schema and code paths are ready, and the restaurant-first MVP
// explicitly exposes follow, the following feed, and follow notifications.
//
// followCounts: the relationship data remains available, but the early MVP hides
// follower/following numbers so the product does not optimize around popularity.
//
// purchaseLinks: schema is ready too, but the feed/profile surfaces that make
// purchase links useful are not fully rolled out yet.
export const OnePickFeatures = {
  follow: true,
  followCounts: false,
  purchaseLinks: false,
  // Keep both profile features implemented, but unmounted during the early MVP.
  tasteComposition: false,
  profileAi: false,
  // Ranking cards stay available; only their detail needs a minimum sample.
  exploreRankingDetail: true,
  // Restaurant-first MVP: Home and Explore show only OnePickMvp.browseGroupSlug,
  // so category chips add nothing. Flip on when more top-level groups launch.
  categoryChips: false,
} as const;

// While categoryChips is off, Home/Explore browse only this top-level group
// (see docs/restaurant-mvp-foundation.md "MVP 맛집 노출 제한"). Profiles are unaffected.
export const OnePickMvp = {
  browseGroupSlug: 'food',
} as const;

// Client-side exposure thresholds, not API limits or service-wide totals.
export const OnePickThresholds = {
  exploreRankingMinPicks: 3, // Number of people choosing the rank-1 item, not the sum.
  homeCategoryFilterMinPicks: 20, // Unfiltered Picks currently loaded in Home.
} as const;
