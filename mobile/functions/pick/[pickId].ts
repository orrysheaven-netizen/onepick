import { injectShareMeta, pickShareMeta, validShareUuid } from '../_lib/share-meta';

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

type Context = {
  request: Request;
  env: Env;
  params: { pickId?: string | string[] };
  next(): Promise<Response>;
};

const SELECT = [
  'id,one_line_review,status',
  'profile:profiles!picks_user_id_fkey(username)',
  'category:categories!picks_category_id_fkey(name)',
  'item:items!picks_item_category_fk(name,image_path,thumbnail_path,image_source_url)',
].join(',');

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function publicStorageUrl(base: string, path: unknown) {
  if (typeof path !== 'string' || !path) return null;
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/item-photos/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function appShell(request: Request, env: Env) {
  const url = new URL(request.url);
  url.pathname = '/index.html';
  url.search = '';
  url.hash = '';
  return env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }));
}

async function fallback(context: Context) {
  try {
    const shell = await appShell(context.request, context.env);
    if (shell.ok) return shell;
  } catch { /* Preserve the existing Pages route when the asset binding is unavailable. */ }
  return context.next();
}

export async function onRequest(context: Context) {
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  const pickId = typeof context.params.pickId === 'string' ? context.params.pickId : '';
  if (!validShareUuid(pickId)) return context.next();

  const supabaseUrl = context.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const publishableKey = context.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return fallback(context);

  try {
    const query = new URL(`${supabaseUrl}/rest/v1/picks`);
    query.searchParams.set('select', SELECT);
    query.searchParams.set('id', `eq.${pickId}`);
    query.searchParams.set('status', 'eq.active');
    query.searchParams.set('limit', '1');

    const result = await fetch(query, {
      headers: { apikey: publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!result.ok) return fallback(context);
    const rows = await result.json() as unknown[];
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return fallback(context);

    const profile = first(row.profile as Record<string, unknown> | Record<string, unknown>[] | null);
    const category = first(row.category as Record<string, unknown> | Record<string, unknown>[] | null);
    const item = first(row.item as Record<string, unknown> | Record<string, unknown>[] | null);
    if (!profile || !category || !item) return fallback(context);

    const image = publicStorageUrl(supabaseUrl, item.thumbnail_path ?? item.image_path) ?? item.image_source_url;
    const origin = new URL(context.request.url).origin;
    const meta = pickShareMeta({
      origin, pickId,
      itemName: item.name,
      username: profile.username,
      categoryName: category.name,
      review: row.one_line_review,
      image,
    });
    if (!meta) return fallback(context);

    const shell = await appShell(context.request, context.env);
    if (!shell.ok) return context.next();
    const html = injectShareMeta(await shell.text(), meta);
    const headers = new Headers(shell.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-onepick-share-meta', 'dynamic');
    return new Response(method === 'HEAD' ? null : html, { status: 200, headers });
  } catch {
    return fallback(context);
  }
}
