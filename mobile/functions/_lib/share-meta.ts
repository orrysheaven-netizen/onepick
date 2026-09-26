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


export function itemShareMeta(input: {
  origin: string;
  itemId: string;
  itemName: unknown;
  categoryName: unknown;
  image: unknown;
}): ShareMeta | null {
  if (!validShareUuid(input.itemId)) return null;
  let origin: string;
  try {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const itemName = clean(input.itemName, 100);
  const categoryName = clean(input.categoryName, 80);
  if (!itemName) return null;
  return {
    title: `${itemName} | OnePick`,
    description: `${categoryName || '이 카테고리'}에서 이 항목을 원픽으로 고른 사람들의 한줄평을 확인해보세요.`,
    image: absoluteImage(input.image, origin),
    type: 'website',
    url: `${origin}/item/${encodeURIComponent(input.itemId)}`,
  };
}


// ---- Category ranking pages (/ranking/<slug>) ----

const SLUG = /^[a-z0-9-]{1,64}$/;

export function validCategorySlug(value: string) {
  return SLUG.test(value);
}

export type RankingRow = { name: string; pickCount: number; rank: number; isTied: boolean; itemId: string; image: string | null };

export type RankingPage = {
  meta: ShareMeta;
  categoryName: string;
  categoryPath: string;
  slug: string;
  rows: RankingRow[];
  /** Same rule as the app: rank numbers appear once the leader has this many choices. */
  showRankingDetail: boolean;
};

/** Same value as OnePickThresholds.exploreRankingMinPicks in the app. */
export const RANKING_MIN_PICKS = 3;

export function rankingShareMeta(input: {
  origin: string;
  slug: string;
  categoryName: unknown;
  categoryPath: unknown;
  rows: Array<{ item_id?: unknown; name?: unknown; pick_count?: unknown; rank?: unknown; is_tied?: unknown; image?: unknown }>;
}): RankingPage | null {
  if (!validCategorySlug(input.slug)) return null;
  let origin: string;
  try {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }
  const categoryName = clean(input.categoryName, 80);
  if (!categoryName) return null;
  const categoryPath = clean(input.categoryPath, 200) || categoryName;
  const rows: RankingRow[] = [];
  for (const row of input.rows.slice(0, 50)) {
    const name = clean(row.name, 100);
    const itemId = typeof row.item_id === 'string' && validShareUuid(row.item_id) ? row.item_id : '';
    const pickCount = Number(row.pick_count);
    const rank = Number(row.rank);
    if (!name || !itemId || !Number.isSafeInteger(pickCount) || pickCount < 0 || !Number.isSafeInteger(rank) || rank < 1) continue;
    const image = clean(row.image, 2048);
    let safeImage: string | null = null;
    if (image) {
      try { const url = new URL(image, origin); if (url.protocol === 'https:') safeImage = url.toString(); } catch { /* no image */ }
    }
    rows.push({ name, itemId, pickCount, rank, isTied: row.is_tied === true, image: safeImage });
  }
  const leader = rows.find((row) => row.rank === 1);
  const showRankingDetail = (leader?.pickCount ?? 0) >= RANKING_MIN_PICKS;
  const top = rows.slice(0, 3).map((row) => row.name);
  const description = showRankingDetail && top.length
    ? `${categoryName}에서 사람들이 원픽으로 고른 순위: ${top.map((name, index) => `${index + 1}위 ${name}`).join(' · ')}. 한 사람은 카테고리마다 하나만 고를 수 있어요.`
    : `${categoryName}에서 사람들이 하나만 고른 원픽을 모아 보여드려요. 원픽이 모이면 순위가 표시돼요.`;
  return {
    meta: {
      title: `${categoryName} 원픽 랭킹 | OnePick`,
      description,
      image: absoluteImage(leader?.image ?? null, origin),
      type: 'website',
      url: `${origin}/ranking/${encodeURIComponent(input.slug)}`,
    },
    categoryName,
    categoryPath,
    slug: input.slug,
    rows,
    showRankingDetail,
  };
}

/**
 * Crawlable body for the SPA shell. It goes inside #root so the app replaces it
 * on mount; only inline styles are used because the CSP allows no inline scripts
 * (JSON-LD is data, not script, and is not blocked).
 */
export function renderRankingBody(page: RankingPage) {
  const h = escapeHtml;
  const items = page.rows.map((row) => {
    const label = page.showRankingDetail
      ? `${row.isTied ? '공동 ' : ''}${row.rank}위 ${row.name} · ${row.pickCount.toLocaleString('ko-KR')}명이 선택`
      : row.name;
    return `<li><a href="/item/${h(row.itemId)}" style="color:#141416">${h(label)}</a></li>`;
  }).join('');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${page.categoryName} 원픽 랭킹`,
    description: page.meta.description,
    url: page.meta.url,
    numberOfItems: page.rows.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: page.rows.map((row, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: row.name,
      url: `${new URL(page.meta.url).origin}/item/${row.itemId}`,
    })),
  }).replace(/</g, '\\u003c');
  return `<main style="max-width:480px;margin:0 auto;padding:24px 20px;font-family:sans-serif;color:#141416">`
    + `<p style="font-size:12px;color:#5C5C63;margin:0">${h(page.categoryPath)}</p>`
    + `<h1 style="font-size:26px;margin:4px 0 8px">${h(page.categoryName)} 원픽 랭킹</h1>`
    + `<p style="font-size:13px;color:#5C5C63;margin:0 0 18px">${h(page.meta.description)}</p>`
    + (items ? `<ol style="padding-left:20px;line-height:1.8">${items}</ol>` : `<p>아직 선택된 원픽이 없어요.</p>`)
    + `<p style="font-size:13px"><a href="/ranking" style="color:#141416">다른 카테고리 랭킹 보기</a></p>`
    + `</main>`
    + `<script type="application/ld+json">${jsonLd}</script>`;
}

export function injectBody(html: string, body: string) {
  return html.replace(/<div id="root"><\/div>/, `<div id="root">${body}</div>`);
}

/**
 * public/_headers marks every *.pages.dev host noindex, but Cloudflare does not
 * apply _headers to Function responses. Mirror that rule here so the test host
 * stays out of search results until a custom domain is attached.
 */
export function robotsHeader(hostname: string) {
  return /\.pages\.dev$/i.test(hostname) ? 'noindex' : 'index, follow';
}
