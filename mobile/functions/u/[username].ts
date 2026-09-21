import { injectShareMeta, profileShareMeta, validShareUsername } from '../_lib/share-meta';

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
type Context = {
  request: Request;
  env: Env;
  params: { username?: string | string[] };
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
  const raw = typeof context.params.username === 'string' ? context.params.username : '';
  let username = '';
  try { username = decodeURIComponent(raw).trim().toLowerCase(); } catch { return context.next(); }
  if (!validShareUsername(username)) return context.next();

  const supabaseUrl = context.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = context.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) return fallback(context);
  const headers = { apikey: key, Accept: 'application/json' };

  try {
    const profileQuery = new URL(`${supabaseUrl}/rest/v1/profiles`);
    profileQuery.searchParams.set('select', 'id,username');
    profileQuery.searchParams.set('username', `eq.${username}`);
    profileQuery.searchParams.set('limit', '1');
    const profileResponse = await fetch(profileQuery, { headers, signal: AbortSignal.timeout(2500) });
    if (!profileResponse.ok) return fallback(context);
    const profiles = await profileResponse.json() as Array<{ id?: string; username?: string }>;
    const profile = profiles[0];
    if (!profile?.id || !profile.username) return fallback(context);

    const picksQuery = new URL(`${supabaseUrl}/rest/v1/picks`);
    picksQuery.searchParams.set('select', 'id,item:items!picks_item_category_fk(name,image_path,thumbnail_path,image_source_url)');
    picksQuery.searchParams.set('user_id', `eq.${profile.id}`);
    picksQuery.searchParams.set('status', 'eq.active');
    picksQuery.searchParams.set('order', 'updated_at.desc');
    picksQuery.searchParams.set('limit', '100');
    const picksResponse = await fetch(picksQuery, { headers, signal: AbortSignal.timeout(2500) });
    if (!picksResponse.ok) return fallback(context);
    const picks = await picksResponse.json() as Array<{ item?: Record<string, unknown> | Record<string, unknown>[] | null }>;
    const itemOf = (pick: typeof picks[number]) => Array.isArray(pick.item) ? pick.item[0] : pick.item;
    const items = picks.map(itemOf).filter((item): item is Record<string, unknown> => Boolean(item));
    const firstImageItem = items.find((item) => item.thumbnail_path || item.image_path || item.image_source_url);
    const image = firstImageItem
      ? storageImage(supabaseUrl, firstImageItem.thumbnail_path ?? firstImageItem.image_path) ?? firstImageItem.image_source_url
      : null;
    const meta = profileShareMeta({
      origin: new URL(context.request.url).origin,
      username: profile.username,
      pickCount: picks.length,
      representativeItems: items.map((item) => item.name),
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
