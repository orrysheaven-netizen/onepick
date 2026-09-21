const CONTROL = /[\u0000-\u001f\u007f]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ShareMeta = {
  title: string;
  description: string;
  image: string;
  type: 'article' | 'website' | 'profile';
  url: string;
};

export function validShareUuid(value: string) {
  return UUID.test(value);
}

function clean(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function absoluteImage(value: unknown, origin: string) {
  const fallback = `${origin}/og-default.png`;
  const image = clean(value, 2048);
  if (!image) return fallback;
  try {
    const url = new URL(image, origin);
    return url.protocol === 'https:' ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function pickShareMeta(input: {
  origin: string;
  pickId: string;
  itemName: unknown;
  username: unknown;
  categoryName: unknown;
  review: unknown;
  image: unknown;
}): ShareMeta | null {
  if (!validShareUuid(input.pickId)) return null;
  let origin: string;
  try {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const itemName = clean(input.itemName, 100);
  const username = clean(input.username, 20).toLowerCase();
  const categoryName = clean(input.categoryName, 80);
  const review = clean(input.review, 180);
  if (!itemName || !/^[a-z0-9_]{3,20}$/.test(username)) return null;
  return {
    title: `${itemName} · @${username}의 원픽 | OnePick`,
    description: review || `${categoryName || '이 카테고리'}에서 고른 @${username}의 원픽을 확인해보세요.`,
    image: absoluteImage(input.image, origin),
    type: 'article',
    url: `${origin}/pick/${encodeURIComponent(input.pickId)}`,
  };
}

export function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function replaceMeta(html: string, selector: RegExp, tag: string) {
  return selector.test(html) ? html.replace(selector, tag) : html;
}

export function injectShareMeta(html: string, meta: ShareMeta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);
  const url = escapeHtml(meta.url);
  const type = escapeHtml(meta.type);
  let output = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  output = replaceMeta(output, /<meta\b[^>]*name=["']description["'][^>]*>/i, `<meta name="description" content="${description}" />`);
  output = replaceMeta(output, /<meta\b[^>]*property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${title}" />`);
  output = replaceMeta(output, /<meta\b[^>]*property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${description}" />`);
  output = replaceMeta(output, /<meta\b[^>]*property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${image}" />`);
  output = replaceMeta(output, /<meta\b[^>]*property=["']og:type["'][^>]*>/i, `<meta property="og:type" content="${type}" />`);
  output = replaceMeta(output, /<meta\b[^>]*name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${title}" />`);
  output = replaceMeta(output, /<meta\b[^>]*name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${description}" />`);
  output = replaceMeta(output, /<meta\b[^>]*name=["']twitter:image["'][^>]*>/i, `<meta name="twitter:image" content="${image}" />`);
  const canonical = `<meta property="og:url" content="${url}" />\n    <link rel="canonical" href="${url}" />`;
  return output.includes('property="og:url"')
    ? output.replace(/<meta\b[^>]*property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${url}" />`)
    : output.replace('</head>', `    ${canonical}\n  </head>`);
}


export function validShareUsername(value: string) {
  return /^[a-z0-9_]{3,20}$/.test(value.trim().toLowerCase());
}

export function profileShareMeta(input: {
  origin: string;
  username: unknown;
  pickCount: number;
  representativeItems: unknown[];
  image: unknown;
}): ShareMeta | null {
  let origin: string;
  try {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const username = clean(input.username, 20).toLowerCase();
  if (!validShareUsername(username)) return null;
  const count = Number.isSafeInteger(input.pickCount) && input.pickCount >= 0 ? Math.min(input.pickCount, 100) : 0;
  const items = input.representativeItems.map((value) => clean(value, 60)).filter(Boolean).slice(0, 3);
  const suffix = items.length ? ` · ${items.join(' · ')}` : '';
  return {
    title: `@${username}의 OnePick | 취향 컬렉션`,
    description: `현재 원픽 ${count}개${suffix}`,
    image: absoluteImage(input.image, origin),
    type: 'profile',
    url: `${origin}/u/${encodeURIComponent(username)}`,
  };
}
