import { robotsHeader } from './_lib/share-meta';

type Context = { request: Request; next(): Promise<Response> };

/**
 * The test host (*.pages.dev) stays unindexed, matching public/_headers; a
 * custom domain gets the public routes plus the sitemap.
 */
export async function onRequest(context: Context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  const url = new URL(context.request.url);
  const indexable = robotsHeader(url.hostname) !== 'noindex';
  const body = indexable
    ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /auth\nDisallow: /settings\nDisallow: /notifications\n\nSitemap: ${url.origin}/sitemap.xml\n`
    : `User-agent: *\nDisallow: /\n`;
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
