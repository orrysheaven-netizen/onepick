import { escapeHtml, robotsHeader, validCategorySlug } from './_lib/share-meta';

type Env = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
type Context = { request: Request; env: Env; next(): Promise<Response> };

/** Public entry points only: the ranking index and one URL per open leaf category. */
export async function onRequest(context: Context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  const origin = new URL(context.request.url).origin;
  const urls = [`${origin}/`, `${origin}/ranking`];

  const supabaseUrl = context.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = context.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (supabaseUrl && key) {
    try {
      const result = await fetch(`${supabaseUrl}/rest/v1/rpc/ranking_categories`, {
        method: 'POST', body: '{}', signal: AbortSignal.timeout(2500),
        headers: { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      if (result.ok) {
        const rows = await result.json() as Array<{ slug?: unknown }>;
        for (const row of rows) {
          if (typeof row.slug === 'string' && validCategorySlug(row.slug)) urls.push(`${origin}/ranking/${encodeURIComponent(row.slug)}`);
        }
      }
    } catch { /* The static entries are still a valid sitemap. */ }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join('\n')
    + `\n</urlset>\n`;
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
      'x-robots-tag': robotsHeader(new URL(context.request.url).hostname),
    },
  });
}
