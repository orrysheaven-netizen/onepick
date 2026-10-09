import { BodyFont } from './font-family';

// OnePick design tokens. Screens reference these by name; hex values live only here.
// Roles: surfaces → ink (text) → accent → status. See docs/design-mvp.md.
export const OnePick = {
  // Surfaces
  background: '#FFFFFF', // legacy screen-canvas alias; keep equal to bgDefault
  surface: '#FFFFFF', // cards, sheets, inputs
  sunken: '#EEF0F4', // image placeholders, disabled fills, quiet chips
  border: '#E3E5EA',
  hairline: '#F1F2F6', // in-card dividers

  // Ink
  text: '#141416', // approved ink
  muted: '#5C5C63', // approved secondary text
  hint: '#8A909C', // legacy auxiliary alias; do not use for user-facing placeholders or readable copy

  // Brand: fills/decorations only; never use brand for small text on white.
  brand: '#FF8A00',
  onBrand: '#141416',

  // Foundations semantic roles. New/updated screens migrate to these first;
  // legacy aliases above stay in place until each screen is reviewed.
  bgDefault: '#FFFFFF',
  bgSubtle: '#F6F6F8',
  bgMuted: '#EEF0F4',
  bgPlaceholder: '#F0E3CC',
  bgAccent: '#FF8A00',
  bgAccentSubtle: '#FFF0DC',
  bgOverlay: 'rgba(0,0,0,0.35)',
  actionPrimary: '#141416',
  actionDisabled: '#ADB0BA',
  onAction: '#FFFFFF',
  textPrimary: '#141416',
  textSecondary: '#55596A',
  textTertiary: '#8A909C', // inactive icons and chevrons only; never readable text
  textAccent: '#B84F00',
  textDanger: '#B4432A',
  borderDefault: '#E8E8ED',
  borderStrong: '#D5D7DE',
  // Current-Pick flag (10-04): the viewer's own current Pick vs anyone else's.
  flagMine: '#FF8500',
  flagOther: '#555555',

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

// Foundations base type scale: seven reusable IBM Plex Sans KR styles.
export const OnePickType = {
  pageTitle: { fontFamily: BodyFont, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  title: { fontFamily: BodyFont, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  headline: { fontFamily: BodyFont, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  bodyMedium: { fontFamily: BodyFont, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  body: { fontFamily: BodyFont, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  captionMedium: { fontFamily: BodyFont, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  caption: { fontFamily: BodyFont, fontSize: 12, lineHeight: 18, fontWeight: '400' },
} as const;

// Home Feed semantic text styles mirror the approved Figma roles without changing
// the global Body/Caption scale.
export const OnePickFeedType = {
  storeBranch: { fontFamily: BodyFont, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  nickname: { fontFamily: BodyFont, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  review: { fontFamily: BodyFont, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  meta: { fontFamily: BodyFont, fontSize: 13, lineHeight: 20, fontWeight: '400' },
} as const;

export const OnePickRadius = {
  // Foundations canonical scale.
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,

  // Legacy aliases. Migrate screen-by-screen instead of changing every radius at once.
  small: 12,
  card: 20,
  pill: 999,
} as const;

export const OnePickSpace = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 16,
} as const;

// Layout values that are not ordinary content spacing. Figma uses a 390×844
// reference frame with a 34px bottom safe area; real native devices still use
// their platform-provided inset when it is larger or otherwise different.
export const OnePickLayout = {
  homeFeedGutter: 20,
  safeAreaBottom: 34,
  tabBarContentHeight: 56,
  tabBarHeight: 64,
  tabBarHorizontalGutter: 16,
  tabBarRadius: 24,
  tabBarSafeAreaGap: 8,
  tabBarContentGap: 8,
  tabBarReferenceHeight: 114,
} as const;

// Icon sizes (Figma Foundations `icon/size/*`). Two shared sizes only:
// md 24 for primary actions (tabs, back, search, share, bell, add, close,
// profile actions, comments); sm 16 for supporting marks (row chevrons,
// badges, meta, in-card hints). Touch targets stay ≥ 44 regardless of size.
export const OnePickIcon = {
  sm: 16,
  md: 24,
  strokeWidth: 1.8,
} as const;


// Feature exposure gates. Database support can be ready while an MVP feature
// remains intentionally hidden until an explicit product rollout decision.
//
// Follow exposure is split by surface. The profile relationship itself is part
// of the MVP, while the following feed and follow-change notifications remain
// hidden until separately approved. Backend follow data remains intact.
//
// profileFollowConnections: approved public follower/following counts + list surface.
// The sanitized RPC is already deployed. #757 replaced the legacy own-profile count
// card (ProfileFollowCounts / followCounts) with the same public counts in ProfileIdentity.
//
// purchaseLinks: schema is ready too, but the feed/profile surfaces that make
// purchase links useful are not fully rolled out yet.
export const OnePickFeatures = {
  profileFollow: true,
  profileFollowConnections: true,
  followingFeed: false,
  followNotifications: false,
  purchaseLinks: false,
  // Keep both profile features implemented, but unmounted during the early MVP.
  tasteComposition: false,
  profileAi: false,
  // #757 (PM confirmed 2026-10-05): the own profile's private 기록 tab shows past
  // Picks and pending/rejected registration requests.
  profilePickHistory: true,
  profileItemRequests: true,
  // Hidden during the early MVP; the data and components stay in place.
  profileSocialLinks: false,
  // Ranking cards stay available; only their detail needs a minimum sample.
  exploreRankingDetail: true,
  // Initial food MVP exposes only the physical-store channel in registration.
  // Online/recipe flows remain implemented behind this gate for later rollout.
  foodChannelPicker: false,
  // Restaurant-first MVP: Home and Explore show only OnePickMvp.browseGroupSlug,
  // so category chips add nothing. Flip on when more top-level groups launch.
  categoryChips: false,
  // Restaurant-first MVP: themes other than OnePickMvp.mainThemeCode (CULTURE & ART,
  // TECH, STYLE, …) leave the main profile, onboarding and search for the 실험실 screen.
  lab: true,
} as const;

// While categoryChips is off, Home/Explore browse only this top-level group
// (see docs/restaurant-mvp-foundation.md "MVP 맛집 노출 제한"). Profiles split via `lab` instead.
export const OnePickMvp = {
  browseGroupSlug: 'food',
  // Initial MVP exposure: food Picks from physical stores only. Keep the full
  // offline|online|recipe data model so later rollout does not require redesign.
  publicPickChannel: 'offline' as const,
  // taste_dimensions.code shown on the main profile while OnePickFeatures.lab is on.
  mainThemeCode: 'food',
} as const;

// Client-side exposure thresholds, not API limits or service-wide totals.
export const OnePickThresholds = {
  exploreRankingMinPicks: 3, // Number of people choosing the rank-1 item, not the sum.
  homeCategoryFilterMinPicks: 20, // Unfiltered Picks currently loaded in Home.
  rankingPageSize: 20, // Rows on /ranking/[slug]; the RPC caps at 50. Mirrored in functions/ranking/[slug].ts.
} as const;
