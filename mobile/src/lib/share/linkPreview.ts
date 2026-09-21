// Link preview metadata for shared OnePick URLs.
//
// The web MVP is a single-page export: every route serves the same HTML, so a
// chat app or crawler following a shared link sees one card unless something
// rewrites the document head per route. This module owns that head, and it is
// deliberately dependency-free — it runs three times: in the Expo build (the
// default card baked into `index.html`), in the Cloudflare Pages Function that
// rewrites it per route, and in the regression checks.

export const PREVIEW_MARKER_NAME = 'onepick:preview';
export const PREVIEW_SITE_NAME = 'OnePick';
export const PREVIEW_LOCALE = 'ko_KR';

export const DEFAULT_PREVIEW_TITLE = 'OnePick · 많은 것보다, 마음에 드는 하나';
export const DEFAULT_PREVIEW_DESCRIPTION =
  '카테고리마다 가장 좋아하는 하나와 그 이유. 사람마다 다르게 고른 원픽을 읽어 보세요.';

const TITLE_LIMIT = 80;
const DESCRIPTION_LIMIT = 200;

export interface PreviewContent {
  title: string;
  description: string;
  /** Absolute canonical URL, when the caller knows the origin. */
  url?: string | null;
  type?: 'website' | 'profile' | 'article';
}

export interface PreviewTag {
  key: string;
  property?: string;
  name?: string;
  content: string;
}

export interface ProfilePreviewInput {
  username: string;
  pickCount?: number | null;
  aiSummary?: string | null;
  aiKeywords?: readonly string[] | null;
  picks?: readonly { categoryName?: string | null; itemName?: string | null; oneLineReview?: string | null }[] | null;
}

export interface PickPreviewInput {
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview?: string | null;
}

function collapse(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Cuts on a word boundary where one is near, so a card never ends mid-syllable run. */
export function clampText(value: string, limit: number) {
  const text = collapse(value);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Absolute URL, or null when no canonical origin is known: a relative `og:url` is worse than none. */
export function joinUrl(origin: string | null | undefined, path: string) {
  const base = collapse(origin).replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base)) return null;
  return `${base}${path}`;
}

export function defaultPreview(origin?: string | null): PreviewContent {
  return {
    title: DEFAULT_PREVIEW_TITLE,
    description: DEFAULT_PREVIEW_DESCRIPTION,
    url: joinUrl(origin, '/'),
    type: 'website',
  };
}

export function profilePreview(input: ProfilePreviewInput, origin?: string | null): PreviewContent {
  const username = collapse(input.username);
  const count = typeof input.pickCount === 'number' && input.pickCount > 0 ? input.pickCount : 0;
  const title = count > 0 ? `@${username}의 원픽 ${count}개` : `@${username}의 OnePick`;

  // The card carries the actual choices. A bare count tells a reader nothing
  // about whether the link is worth opening.
  const lines = (input.picks ?? [])
    .map((pick) => [collapse(pick?.categoryName), collapse(pick?.itemName)].filter(Boolean).join(' '))
    .filter(Boolean);
  const keywords = (input.aiKeywords ?? []).map(collapse).filter(Boolean).slice(0, 3);
  const summary = collapse(input.aiSummary);

  let description = lines.join(' · ');
  if (description && keywords.length) description = `${description} · ${keywords.map((word) => `#${word}`).join(' ')}`;
  if (!description) description = summary || keywords.map((word) => `#${word}`).join(' ');
  if (!description) description = '아직 고른 원픽이 없어요. 카테고리마다 하나씩 골라 보세요.';

  return {
    title: clampText(title, TITLE_LIMIT),
    description: clampText(description, DESCRIPTION_LIMIT),
    url: joinUrl(origin, `/u/${encodeURIComponent(username.toLowerCase())}`),
    type: 'profile',
  };
}

export function pickPreview(input: PickPreviewInput & { pickId?: string }, origin?: string | null): PreviewContent {
  const username = collapse(input.username);
  const review = collapse(input.oneLineReview);
  return {
    title: clampText(`@${username}의 ${collapse(input.categoryName)} 원픽: ${collapse(input.itemName)}`, TITLE_LIMIT),
    description: clampText(review ? `“${review}”` : DEFAULT_PREVIEW_DESCRIPTION, DESCRIPTION_LIMIT),
    url: input.pickId ? joinUrl(origin, `/pick/${encodeURIComponent(input.pickId)}`) : null,
    type: 'article',
  };
}

export function previewTags(content: PreviewContent): PreviewTag[] {
  const tags: PreviewTag[] = [
    { key: 'description', name: 'description', content: content.description },
    { key: 'og:site_name', property: 'og:site_name', content: PREVIEW_SITE_NAME },
    { key: 'og:type', property: 'og:type', content: content.type ?? 'website' },
    { key: 'og:locale', property: 'og:locale', content: PREVIEW_LOCALE },
    { key: 'og:title', property: 'og:title', content: content.title },
    { key: 'og:description', property: 'og:description', content: content.description },
    // No image: the card is the words. A logo tile would add nothing to read.
    { key: 'twitter:card', name: 'twitter:card', content: 'summary' },
    { key: 'twitter:title', name: 'twitter:title', content: content.title },
    { key: 'twitter:description', name: 'twitter:description', content: content.description },
  ];
  if (content.url) {
    tags.push({ key: 'og:url', property: 'og:url', content: content.url });
  }
  return tags;
}

export function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPreviewTags(content: PreviewContent) {
  return previewTags(content)
    .map((tag) => {
      const attribute = tag.property ? `property="${tag.property}"` : `name="${tag.name}"`;
      return `<meta ${attribute} content="${escapeAttribute(tag.content)}"/>`;
    })
    .join('');
}

const MARKER = (state: 'start' | 'end') =>
  new RegExp(`<meta\\s+name="${PREVIEW_MARKER_NAME}"\\s+content="${state}"\\s*/?>`, 'i');
const REGION = new RegExp(
  `${MARKER('start').source}[\\s\\S]*?${MARKER('end').source}`,
  'i',
);

/**
 * Swaps the default card in an exported `index.html` for this one. Returns the
 * document untouched when the markers are missing, so a stale or foreign build
 * degrades to its own default card instead of losing its head.
 */
export function replacePreviewRegion(html: string, content: PreviewContent) {
  const region = html.match(REGION);
  if (!region) return html;
  const replaced = html.replace(
    REGION,
    `<meta name="${PREVIEW_MARKER_NAME}" content="start"/>${renderPreviewTags(content)}` +
      `<meta name="${PREVIEW_MARKER_NAME}" content="end"/>`,
  );
  return replaced.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttribute(content.title)}</title>`);
}
