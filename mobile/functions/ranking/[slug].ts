import { injectBody, injectShareMeta, rankingShareMeta, renderRankingBody, robotsHeader, validCategorySlug } from '../_lib/share-meta';

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
type Context = {
  request: Request;
  env: Env;
  params: { slug?: string | string[] };
  next(): Promise<Response>;
};

/** Same as OnePickThresholds.rankingPageSize in the app. */
const PAGE_SIZE = 20;

async function appShell(request: Request, env: Env) {
  const url = new URL(request.url);
  url.pathname = '/index.html'; url.search = ''; url.hash = '';
  return env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }));
}
async function fallback(context: Context) {
  try {
    const shell = await appShell(context.request, context.env);
    if (shell.ok) return shell;
  } catch {}
  return context.next();
}
function storageImage(base: string, path: unknown) {
  if (typeof path !== 'string' || !path) return null;
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/item-photos/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * /ranking/<slug>: the SPA shell with real title, description, OG tags and a
 * crawlable list in the body. The app replaces the body on mount, so the page
 * looks the same to people; crawlers and link previews get the content without
 * running JavaScript. Any failure falls back to the plain shell.
 */
export async function onRequest(context: Context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  const raw = typeof context.params.slug === 'string' ? context.params.slug : '';
  const slug = raw.trim().toLowerCase();
  if (!validCategorySlug(slug)) return context.next();

  const supabaseUrl = context.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = context.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) return fallback(context);

  try {
    const headers = { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json' };
    const categoriesQuery = new URL(`${supabaseUrl}/rest/v1/rpc/ranking_categories`);
    categoriesQuery.searchParams.set('slug', `eq.${slug}`);
    categoriesQuery.searchParams.set('limit', '1');
    const [categoryResult, rankingResult] = await Promise.all([
      fetch(categoriesQuery, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(2500) }),
      fetch(`${supabaseUrl}/rest/v1/rpc/category_ranking`, {
        method: 'POST', headers, body: JSON.stringify({ p_slug: slug, p_limit: PAGE_SIZE }), signal: AbortSignal.timeout(2500),
      }),
    ]);
    if (!categoryResult.ok || !rankingResult.ok) return fallback(context);
    const categories = await categoryResult.json() as Array<Record<string, unknown>>;
    const category = categories[0];
    if (!category) return fallback(context);
    const rows = await rankingResult.json() as Array<Record<string, unknown>>;

    const page = rankingShareMeta({
      origin: new URL(context.request.url).origin,
      slug,
      categoryName: category.name,
      categoryPath: category.category_path,
      rows: rows.map((row) => ({
        ...row,
        image: storageImage(supabaseUrl, row.thumbnail_path ?? row.image_path) ?? row.image_source_url,
      })),
    });
    if (!page) return fallback(context);

    const shell = await appShell(context.request, context.env);
    if (!shell.ok) return context.next();
    const html = injectBody(injectShareMeta(await shell.text(), page.meta), renderRankingBody(page));
    const responseHeaders = new Headers(shell.headers);
    responseHeaders.set('content-type', 'text/html; charset=utf-8');
    // Rankings move slowly; a short shared cache keeps crawler bursts off the database.
    responseHeaders.set('cache-control', 'public, max-age=60, s-maxage=300');
    responseHeaders.set('x-robots-tag', robotsHeader(new URL(context.request.url).hostname));
    responseHeaders.set('x-onepick-share-meta', 'dynamic');
    return new Response(method === 'HEAD' ? null : html, { status: 200, headers: responseHeaders });
  } catch {
    return fallback(context);
  }
}
