// OnePick design tokens. Screens reference these by name; hex values live only here.
// Roles: surfaces → ink (text) → accent → status. See docs/design-mvp.md.
export const OnePick = {
  // Surfaces
  background: '#F5F6F8', // screen canvas
  surface: '#FFFFFF', // cards, sheets, inputs
  sunken: '#EEF0F4', // image placeholders, disabled fills, quiet chips
  border: '#E3E5EA',
  hairline: '#F1F2F6', // in-card dividers

  // Ink
  text: '#1B1D22', // titles, body, dark fills
  muted: '#5C6270', // descriptions, meta (5.9:1 on white)
  hint: '#8A909C', // placeholders and timestamps only — not body copy

  // Accent
  accent: '#4945ED', // primary action, selection, brand mark
  accentDeep: '#3733B8', // pressed state, text on accentSoft
  accentSoft: '#EFEEFF', // selected fills, badges, "my pick"
  onAccent: '#FFFFFF', // text and icons on accent fills

  // Status
  danger: '#B4432A',
  dangerSoft: '#FBEFEB',
  success: '#1F7A4D',
  successSoft: '#E8F5EE',
  warning: '#8A5A00',
  warningSoft: '#FFF3CD',

  // Third-party brand (login button guidelines: Kakao, Google, Naver)
  kakao: '#FEE500',
  kakaoText: '#191919',
  google: '#FFFFFF',
  googleText: '#202124',
  googleBorder: '#D4D6DD',
  naver: '#03C75A',
  naverText: '#FFFFFF',

  maxWidth: 480,
} as const;

// Type scale: five steps. Korean body copy never goes below `body`; `caption` is the only 12px.
export const OnePickType = {
  display: { fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
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
} as const;
