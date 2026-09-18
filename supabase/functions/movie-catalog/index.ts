import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { mapTmdbMovie, normalizeItemName, TMDB_SOURCE, type MovieCatalogEntry } from './movieCatalog.ts';
import { createDramaHandler } from './dramaCatalog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const TMDB_CACHE_PROVIDER = 'tmdb';
const TMDB_SEARCH_CACHE_MS = 10 * 60_000;
const TMDB_PROVIDER_INTERVAL_MS = 250;
const TMDB_MAX_QUEUE_MS = 1_500;

function tmdbHeaders() {
  const token = Deno.env.get('TMDB_READ_ACCESS_TOKEN')?.trim();
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readCache(client: SupabaseClient, key: string, maxAgeMs: number) {
  const hashed = await sha256(key);
  const { data, error } = await client.from('external_catalog_cache').select('payload,fetched_at')
    .eq('provider', TMDB_CACHE_PROVIDER).eq('cache_key', hashed).maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - Date.parse(data.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? data.payload : null;
}

async function writeCache(client: SupabaseClient, key: string, payload: unknown) {
  const hashed = await sha256(key);
  const { error } = await client.from('external_catalog_cache').upsert({
    provider: TMDB_CACHE_PROVIDER, cache_key: hashed, payload, fetched_at: new Date().toISOString(),
  });
  if (error) console.error('TMDB cache write failed', error.code);
}

async function waitForTmdb(client: SupabaseClient) {
  const { data, error } = await client.rpc('reserve_external_catalog_slot', {
    p_provider: TMDB_CACHE_PROVIDER,
    p_interval_ms: TMDB_PROVIDER_INTERVAL_MS,
  });
  if (error || typeof data !== 'number') {
    console.error('TMDB rate reservation failed', error?.code ?? 'invalid_result');
    return false;
  }
  if (data > TMDB_MAX_QUEUE_MS) return false;
  if (data > 0) await new Promise((resolve) => setTimeout(resolve, data));
  return true;
}

async function fetchTmdb(url: URL, client: SupabaseClient) {
  const headers = tmdbHeaders();
  if (!headers) return { error: json({ error: 'CATALOG_NOT_CONFIGURED' }, 503) } as const;
  if (!(await waitForTmdb(client))) return { error: json({ error: 'RATE_LIMITED' }, 429) } as const;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      console.error('TMDB request failed', response.status);
      return { error: json({ error: response.status === 429 ? 'RATE_LIMITED' : 'CATALOG_UNAVAILABLE' }, response.status === 429 ? 429 : 502) } as const;
    }
    return { data: await response.json() as Record<string, unknown> } as const;
  } catch (error) {
    console.error('TMDB request error', error instanceof Error ? error.message : 'unknown');
    return { error: json({ error: 'CATALOG_UNAVAILABLE' }, 502) } as const;
  }
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function searchMovies(query: unknown) {
  const searchText = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : '';
  if (searchText.length < 2 || searchText.length > 60) return json({ error: 'QUERY_INVALID' }, 400);
  const client = adminClient();
  if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
  const cacheKey = `search:movie:\n${searchText.toLocaleLowerCase('ko-KR')}`;
  const cached = await readCache(client, cacheKey, TMDB_SEARCH_CACHE_MS);
  let sourceMovies: unknown[] | null = Array.isArray(cached) ? cached : null;
  if (!sourceMovies) {
    const url = new URL('https://api.themoviedb.org/3/search/movie');
    url.searchParams.set('query', searchText);
    url.searchParams.set('language', 'ko-KR');
    url.searchParams.set('region', 'KR');
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('page', '1');
    const result = await fetchTmdb(url, client);
    if ('error' in result) return result.error;
    sourceMovies = Array.isArray(result.data.results) ? result.data.results.slice(0, 40) : [];
    await writeCache(client, cacheKey, sourceMovies);
  }
  const movies = sourceMovies
    .map((movie) => mapTmdbMovie(movie as Parameters<typeof mapTmdbMovie>[0]))
    .filter((movie): movie is MovieCatalogEntry => Boolean(movie)).slice(0, 20);
  if (!movies.length) return json({ movies: [] });
  const { data, error } = await client.from('items').select('id, external_id')
    .eq('external_source', TMDB_SOURCE).in('external_id', movies.map((movie) => movie.externalId))
    .in('status', ['active', 'discontinued']);
  if (error) {
    console.error('Existing movie lookup failed', error.code);
    return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  }
  const existing = new Map((data ?? []).map((item) => [item.external_id, item.id]));
  return json({ movies: movies.map((movie) => ({ ...movie, existingItemId: existing.get(movie.externalId) ?? null })) });
}

async function importMovie(externalId: unknown, req: Request) {
  const id = typeof externalId === 'string' ? externalId.trim() : '';
  if (!/^\d{1,12}$/.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);
  const client = adminClient();
  if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
  const authorization = req.headers.get('Authorization') ?? '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!accessToken) return json({ error: 'AUTH_REQUIRED' }, 401);
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !authData.user) return json({ error: 'AUTH_REQUIRED' }, 401);
  const suspended = await client.rpc('user_is_suspended', { p_user_id: authData.user.id });
  if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
  const url = new URL(`https://api.themoviedb.org/3/movie/${id}`);
  url.searchParams.set('language', 'ko-KR');
  const result = await fetchTmdb(url, client);
  if ('error' in result) return result.error;
  const movie = mapTmdbMovie(result.data);
  if (!movie || movie.externalId !== id) return json({ error: 'MOVIE_NOT_FOUND' }, 404);
  const { data: category, error: categoryError } = await client.from('categories').select('id')
    .eq('slug', 'movie').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
  if (categoryError || !category) {
    console.error('Movie category lookup failed', categoryError?.code ?? 'not_found');
    return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
  }
  const { data: inserted, error: insertError } = await client.from('items').insert({
    category_id: category.id, name: movie.title, normalized_name: normalizeItemName(movie.title),
    official_url: `https://www.themoviedb.org/movie/${movie.externalId}`,
    image_source_url: movie.posterUrl, external_source: TMDB_SOURCE, external_id: movie.externalId,
    original_name: movie.originalTitle, release_year: movie.releaseYear, status: 'active',
  }).select('id, category_id').maybeSingle();
  if (!insertError && inserted) return json({ itemId: inserted.id, categoryId: inserted.category_id, created: true });
  if (insertError?.code !== '23505') {
    console.error('Movie insert failed', insertError?.code ?? 'empty_result');
    return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  }
  const { data: existing, error: existingError } = await client.from('items').select('id, category_id, status')
    .eq('external_source', TMDB_SOURCE).eq('external_id', movie.externalId).maybeSingle();
  if (existingError || !existing) return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  if (!['active', 'discontinued'].includes(existing.status)) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
  return json({ itemId: existing.id, categoryId: existing.category_id, created: false });
}

// Same deployed function, same server-side token; no second site or client secret.
const handleDrama = createDramaHandler({ client: adminClient, fetchTmdb, readCache, writeCache, json });
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'BODY_INVALID' }, 400);
    body = value as Record<string, unknown>;
  } catch { return json({ error: 'BODY_INVALID' }, 400); }
  if (body.mediaType === 'tv') {
    try { return await handleDrama(body, req); }
    catch { return json({ error: 'CATALOG_UNAVAILABLE' }, 503); }
  }
  if (body.mediaType !== undefined && body.mediaType !== 'movie') return json({ error: 'MEDIA_TYPE_INVALID' }, 400);
  if (body.action === 'search') return searchMovies(body.query);
  if (body.action === 'import') return importMovie(body.externalId, req);
  return json({ error: 'ACTION_INVALID' }, 400);
});
