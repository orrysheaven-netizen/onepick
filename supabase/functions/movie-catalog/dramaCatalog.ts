import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeItemName, releaseYear, tmdbPosterUrl } from './movieCatalog.ts';

// TMDB movie and TV IDs occupy different namespaces. Never change existing movie IDs.
export const TMDB_TV_SOURCE = 'tmdb_tv' as const;
export type DramaEntry = {
  source: typeof TMDB_TV_SOURCE; externalId: string; title: string;
  originalTitle: string | null; releaseYear: number | null;
  posterUrl: string | null; existingItemId: string | null;
};
const narrativeGenres = new Set([18, 35, 80, 9648, 10759, 10765, 10766, 10768]);
const separateGenres = new Set([16, 99, 10763, 10764, 10767]);
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

/** Series-level scripted drama/comedy. Animation, documentary and unscripted TV remain separate future categories. */
export function mapTmdbDrama(value: unknown): DramaEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || Number(row.id) > 999999999999 || row.adult === true) return null;
  const genres = Array.isArray(row.genre_ids) ? row.genre_ids
    : Array.isArray(row.genres) ? row.genres.map((g) => g && typeof g === 'object' ? (g as { id?: unknown }).id : null) : [];
  if (!genres.some((id) => typeof id === 'number' && narrativeGenres.has(id))
    || genres.some((id) => typeof id === 'number' && separateGenres.has(id))) return null;
  // Details contain type; search results do not. Verify again at import, not just in the UI.
  if (row.type !== undefined && row.type !== 'Scripted' && row.type !== 'Miniseries') return null;
  const title = clean(row.name, 100) || clean(row.original_name, 100);
  if (!title) return null;
  return { source: TMDB_TV_SOURCE, externalId: String(row.id), title,
    originalTitle: clean(row.original_name, 200) || null,
    releaseYear: releaseYear(row.first_air_date), posterUrl: tmdbPosterUrl(row.poster_path), existingItemId: null };
}

const SEARCH_CACHE_MS = 10 * 60_000;

type Dependencies = {
  client: () => SupabaseClient | null;
  fetchTmdb: (url: URL, client: SupabaseClient) => Promise<{ data: Record<string, unknown> } | { error: Response }>;
  readCache: (client: SupabaseClient, key: string, maxAgeMs: number) => Promise<unknown | null>;
  writeCache: (client: SupabaseClient, key: string, payload: unknown) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
};

export function createDramaHandler({ client: makeClient, fetchTmdb, readCache, writeCache, json }: Dependencies) {
  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const text = clean(body.query, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (body.action === 'search' && (text.length < 2 || text.length > 60)) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !/^[1-9]\d{0,11}$/.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);
    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
    let importUserId: string | null = null;

    if (body.action === 'import') {
      // Authenticate BEFORE making a paid/rate-limited upstream request.
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return json({ error: 'AUTH_REQUIRED' }, 401);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
      importUserId = data.user.id;
      const suspended = await client.rpc('catalog_user_is_suspended', { p_user_id: data.user.id });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    const categoryResult = await client.from('categories').select('id,parent_id')
      .eq('slug', 'drama').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
    const category = categoryResult.data;
    if (categoryResult.error || !category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
    const children = await client.from('categories').select('id').eq('parent_id', category.id).limit(1);
    if (children.error || children.data?.length) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
    if (category.parent_id) {
      const parent = await client.from('categories').select('id,parent_id')
        .eq('id', category.parent_id).eq('status', 'open').eq('is_visible', true).eq('is_pickable', false).maybeSingle();
      if (parent.error || !parent.data || parent.data.parent_id) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
    }

    if (body.action === 'search') {
      const cacheKey = `search:tv:\n${text.toLocaleLowerCase('ko-KR')}`;
      const cached = await readCache(client, cacheKey, SEARCH_CACHE_MS);
      let sourceResults: unknown[] | null = Array.isArray(cached) ? cached : null;
      if (!sourceResults) {
        const url = new URL('https://api.themoviedb.org/3/search/tv');
        url.searchParams.set('query', text);
        url.searchParams.set('language', 'ko-KR');
        url.searchParams.set('include_adult', 'false');
        url.searchParams.set('page', '1');
        const remote = await fetchTmdb(url, client);
        if ('error' in remote) return remote.error;
        if (!Array.isArray(remote.data.results)) return json({ error: 'CATALOG_UNAVAILABLE' }, 502);
        sourceResults = remote.data.results.slice(0, 40);
        await writeCache(client, cacheKey, sourceResults);
      }
      const seen = new Set<string>();
      const dramas = sourceResults.map(mapTmdbDrama).filter((entry): entry is DramaEntry => {
        if (!entry || seen.has(entry.externalId)) return false;
        seen.add(entry.externalId); return true;
      }).slice(0, 20);
      if (!dramas.length) return json({ movies: [] });
      const known = await client.from('items').select('id,external_id')
        .eq('category_id', category.id).eq('external_source', TMDB_TV_SOURCE)
        .in('external_id', dramas.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const ids = new Map((known.data ?? []).map((item) => [item.external_id, item.id]));
      // Keep the endpoint's existing response envelope for the shared client.
      return json({ movies: dramas.map((entry) => ({ ...entry, existingItemId: ids.get(entry.externalId) ?? null })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status')
      .eq('external_source', TMDB_TV_SOURCE).eq('external_id', id).maybeSingle();
    const receipt = (item: { id: string; category_id: string; status: string }) =>
      item.category_id === category.id && ['active', 'discontinued'].includes(item.status)
        ? json({ itemId: item.id, categoryId: item.category_id, created: false })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) return receipt(existing.data); // Idempotent reselect; never resurrect hidden/merged rows.
    const url = new URL(`https://api.themoviedb.org/3/tv/${id}`);
    url.searchParams.set('language', 'ko-KR');
    const remote = await fetchTmdb(url, client);
    if ('error' in remote) return remote.error;
    const drama = mapTmdbDrama(remote.data);
    if (!drama || drama.externalId !== id) return json({ error: 'DRAMA_NOT_FOUND' }, 404);

    const quota = await client.rpc('reserve_external_catalog_import', { p_user_id: importUserId });
    if (quota.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (quota.data !== true) return json({ error: 'RATE_LIMITED' }, 429);
    const inserted = await client.from('items').insert({
      category_id: category.id, name: drama.title, normalized_name: normalizeItemName(drama.title),
      official_url: `https://www.themoviedb.org/tv/${id}`, image_source_url: drama.posterUrl,
      external_source: TMDB_TV_SOURCE, external_id: id,
      original_name: drama.originalTitle,
      release_year: drama.releaseYear, status: 'active',
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    // Database unique namespace/ID resolves simultaneous selections without title-based merging.
    const winner = await findExisting();
    return !winner.error && winner.data ? receipt(winner.data) : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
