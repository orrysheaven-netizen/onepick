/**
 * Client-side mirror of the specialty-shop rules enforced in
 * `20260920160000_add_specialty_shop_picks.sql`.
 *
 * The database is the authority: every rule here also runs in a trigger, so a
 * client that skips this file still cannot store an affiliate link or a
 * marketplace URL. These functions exist so the user sees the problem while
 * typing instead of after a failed save, and so cards can show a tidy domain.
 *
 * Keep both copies in step. `docs/specialty-shop-pick.md` describes the rules.
 */

/** Hosts where many shops share one host, so the first path segment is the shop. */
const SHARED_HOSTS = ['smartstore.naver.com', 'brand.naver.com', 'shop.naver.com'];

/** Representative "sells many kinds of things" hosts. The real boundary is the category copy. */
const MARKETPLACE_HOSTS = [
  'naver.com', 'shopping.naver.com', 'search.shopping.naver.com',
  'coupang.com', 'kurly.com', 'oliveyoung.co.kr', 'oliveyoung.com',
  'gmarket.co.kr', 'auction.co.kr', '11st.co.kr', 'ssg.com', 'emart.com',
  'lotteon.com', 'homeplus.co.kr', 'tmon.co.kr', 'wemakeprice.com',
  'interpark.com', 'danawa.com', 'musinsa.com', '29cm.co.kr',
  'ably.co.kr', 'zigzag.kr', 'aliexpress.com', 'amazon.com', 'temu.com',
];

const HOST_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HOST_TLD = /\.[a-z]{2,}$/;

/**
 * Returns the canonical shop URL, or null when the input is not a usable
 * http(s) address. Dropping the whole query string is what defeats affiliate
 * parameters (`ref`, `utm_*`, `partner`) and keeps one shop from splitting
 * into several items.
 */
export function normalizeShopUrl(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!/^https?:\/\//i.test(withScheme)) return null;

  const rest = withScheme.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = (rest.match(/^([^/?#]*)/)?.[1] ?? '')
    // Userinfo is dropped: https://real-shop.example@evil.example really goes to evil.example.
    .replace(/^.*@/, '');
  const path = rest.match(/^[^/?#]*(\/[^?#]*)/)?.[1] ?? '';

  const host = authority
    .replace(/:[0-9]*$/, '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');

  if (!HOST_SHAPE.test(host) || !HOST_TLD.test(host)) return null;

  if (SHARED_HOSTS.includes(host)) {
    const segment = path.toLowerCase().match(/^\/([^/]+)/)?.[1];
    if (!segment) return null;
    return `https://${host}/${segment}`;
  }

  return `https://${host}`;
}

/** True when a normalized URL points at a marketplace rather than a specialty shop. */
export function isMarketplaceShopUrl(normalizedUrl: string | null | undefined): boolean {
  if (!normalizedUrl) return false;
  const host = normalizedUrl.match(/^https:\/\/([^/]+)/)?.[1];
  if (!host) return false;
  // A shared host carries a path, which makes it one shop inside the platform.
  if (normalizedUrl.slice('https://'.length).includes('/')) return false;
  return MARKETPLACE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Short label for a shop card: `example.com` or `smartstore.naver.com/mybeans`. */
export function shopDisplayLabel(officialUrl: string | null | undefined): string | null {
  const normalized = normalizeShopUrl(officialUrl);
  if (!normalized) return null;
  return normalized.replace(/^https:\/\//, '');
}

const PROMOTION_LINK = /(https?:\/\/|\bwww\.)/i;
const PROMOTION_DOMAIN =
  /\b[a-z0-9][a-z0-9-]*\.(co\.kr|or\.kr|ne\.kr|com|net|org|kr|io|me|shop|store|xyz|biz|info)\b/i;
// A code-looking token is four or more characters and holds at least one letter,
// so "할인 3000원" stays allowed while "할인코드 SAVE20" does not.
const PROMOTION_CODE =
  /(쿠폰|프로모\s*션?|추천인|초대|할인\s*코드|적립\s*코드|coupon|promo|referral)\s*(코드|번호|code)?\s*[:：]?\s*(?=[a-z0-9]{4,}\b)[a-z0-9]*[a-z][a-z0-9]*\b/i;

/** True when a one-line review reads as an advertisement rather than a reason. */
export function reviewContainsPromotion(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  return PROMOTION_LINK.test(value) || PROMOTION_DOMAIN.test(value) || PROMOTION_CODE.test(value);
}

/**
 * Specialty-shop categories are the `specialty-shop` root and its leaves.
 * The database decides this by walking the category tree; the client only
 * needs the slug it already has on screen.
 */
export function isSpecialtyShopCategorySlug(slug: string | null | undefined): boolean {
  return (slug ?? '') === 'specialty-shop' || (slug ?? '').startsWith('specialty-shop-');
}
