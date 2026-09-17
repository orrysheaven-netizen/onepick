import { createClient } from '@supabase/supabase-js';

import { mapTmdbMovie, normalizeItemName, TMDB_SOURCE, type MovieCatalogEntry } from './movieCatalog.ts';

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

function tmdbHeaders() {
  const token = Deno.env.get('TMDB_READ_ACCESS_TOKEN')?.trim();
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function fetchTmdb(url: URL) {
  const headers = tmdbHeaders();
  if (!headers) return { error: json({ error: 'CATALOG_NOT_CONFIGURED' }, 503) } as const;

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
  if (searchText.length < 2 || searchText.length > 60) {
    return json({ error: 'QUERY_INVALID' }, 400);
  }

  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', searchText);
  url.searchParams.set('language', 'ko-KR');
  url.searchParams.set('region', 'KR');
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('page', '1');

  const result = await fetchTmdb(url);
  if ('error' in result) return result.error;

  const sourceMovies = Array.isArray(result.data.results) ? result.data.results : [];
  const movies = sourceMovies
    .map((movie) => mapTmdbMovie(movie as Parameters<typeof mapTmdbMovie>[0]))
    .filter((movie): movie is MovieCatalogEntry => Boolean(movie))
    .slice(0, 20);

  const client = adminClient();
  if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
  if (!movies.length) return json({ movies: [] });

  const { data, error } = await client
    .from('items')
    .select('id, external_id')
    .eq('external_source', TMDB_SOURCE)
    .in('external_id', movies.map((movie) => movie.externalId))
    .in('status', ['active', 'discontinued']);
  if (error) {
    console.error('Existing movie lookup failed', error.code);
    return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  }

  const existing = new Map((data ?? []).map((item) => [item.external_id, item.id]));
  return json({
    movies: movies.map((movie) => ({ ...movie, existingItemId: existing.get(movie.externalId) ?? null })),
  });
}

async function importMovie(externalId: unknown) {
  const id = typeof externalId === 'string' ? externalId.trim() : '';
  if (!/^\d{1,12}$/.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

  const url = new URL(`https://api.themoviedb.org/3/movie/${id}`);
  url.searchParams.set('language', 'ko-KR');
  const result = await fetchTmdb(url);
  if ('error' in result) return result.error;

  const movie = mapTmdbMovie(result.data);
  if (!movie || movie.externalId !== id) return json({ error: 'MOVIE_NOT_FOUND' }, 404);

  const client = adminClient();
  if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

  const { data: category, error: categoryError } = await client
    .from('categories')
    .select('id')
    .eq('slug', 'movie')
    .eq('status', 'open')
    .eq('is_visible', true)
    .eq('is_pickable', true)
    .maybeSingle();
  if (categoryError || !category) {
    console.error('Movie category lookup failed', categoryError?.code ?? 'not_found');
    return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
  }

  const { data: inserted, error: insertError } = await client
    .from('items')
    .insert({
      category_id: category.id,
      name: movie.title,
      normalized_name: normalizeItemName(movie.title),
      official_url: `https://www.themoviedb.org/movie/${movie.externalId}`,
      image_source_url: movie.posterUrl,
      external_source: TMDB_SOURCE,
      external_id: movie.externalId,
      original_name: movie.originalTitle,
      release_year: movie.releaseYear,
      status: 'active',
    })
    .select('id, category_id')
    .maybeSingle();

  if (!insertError && inserted) {
    return json({ itemId: inserted.id, categoryId: inserted.category_id, created: true });
  }
  if (insertError?.code !== '23505') {
    console.error('Movie insert failed', insertError?.code ?? 'empty_result');
    return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  }

  const { data: existing, error: existingError } = await client
    .from('items')
    .select('id, category_id, status')
    .eq('external_source', TMDB_SOURCE)
    .eq('external_id', movie.externalId)
    .maybeSingle();
  if (existingError || !existing) return json({ error: 'CATALOG_UNAVAILABLE' }, 500);
  if (!['active', 'discontinued'].includes(existing.status)) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
  return json({ itemId: existing.id, categoryId: existing.category_id, created: false });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BODY_INVALID' }, 400);
  }

  if (body.action === 'search') return searchMovies(body.query);
  if (body.action === 'import') return importMovie(body.externalId);
  return json({ error: 'ACTION_INVALID' }, 400);
});
