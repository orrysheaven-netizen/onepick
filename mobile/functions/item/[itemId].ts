import { injectShareMeta, itemShareMeta, validShareUuid } from '../_lib/share-meta';
import { isMvpPublicItem } from '../_lib/mvp-scope';

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
type Context = {
  request: Request;
  env: Env;
  params: { itemId?: string | string[] };
  next(): Promise<Response>;
};

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

export async function onRequest(context: Context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  const itemId = typeof context.params.itemId === 'string' ? context.params.itemId : '';
  if (!validShareUuid(itemId)) return context.next();

  const supabaseUrl = context.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = context.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) return fallback(context);

  try {
    const query = new URL(`${supabaseUrl}/rest/v1/items`);
    query.searchParams.set('select', 'id,name,status,image_path,thumbnail_path,image_source_url,external_source,item_channels(channel),category:categories!items_category_id_fkey(name,status,is_visible,category_taste_dimensions(dimension_code,is_primary))');
    query.searchParams.set('id', `eq.${itemId}`);
    query.searchParams.set('status', 'in.(active,discontinued)');
    query.searchParams.set('limit', '1');
    const result = await fetch(query, {
      headers: { apikey: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!result.ok) return fallback(context);
    const rows = await result.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return fallback(context);
    const rawCategory = row.category as Record<string, unknown> | Record<string, unknown>[] | null;
    const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
    if (!category || category.status !== 'open' || category.is_visible !== true) return fallback(context);
    if (!isMvpPublicItem(category, row)) return fallback(context);

    const image = storageImage(supabaseUrl, row.thumbnail_path ?? row.image_path) ?? row.image_source_url;
    const meta = itemShareMeta({
      origin: new URL(context.request.url).origin,
      itemId,
      itemName: row.name,
      categoryName: category.name,
      image,
    });
    if (!meta) return fallback(context);

    const shell = await appShell(context.request, context.env);
    if (!shell.ok) return context.next();
    const html = injectShareMeta(await shell.text(), meta);
    const responseHeaders = new Headers(shell.headers);
    responseHeaders.set('content-type', 'text/html; charset=utf-8');
    responseHeaders.set('cache-control', 'no-store, max-age=0');
    responseHeaders.set('x-onepick-share-meta', 'dynamic');
    return new Response(method === 'HEAD' ? null : html, { status: 200, headers: responseHeaders });
  } catch {
    return fallback(context);
  }
}
