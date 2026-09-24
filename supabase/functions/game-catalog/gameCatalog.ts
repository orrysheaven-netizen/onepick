import type { SupabaseClient } from '@supabase/supabase-js';

export const IGDB_SOURCE = 'igdb_game' as const;
const EXTERNAL_ID = /^\d{1,12}$/;
const IMAGE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const clean = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export type GameEntry = {
  source: typeof IGDB_SOURCE;
  externalId: string;
  title: string;
  developerName: string | null;
  platformNames: string[];
  releaseYear: number | null;
  coverUrl: string | null;
  igdbUrl: string | null;
  gameType: string | null;
  existingItemId: string | null;
};

function releaseYear(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const year = new Date(value * 1000).getUTCFullYear();
  return year >= 1950 && year <= 2200 ? year : null;
}

function platformNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  const names = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const name = clean((entry as Record<string, unknown>).name, 80);
    return name ? [name] : [];
  });
  return Array.from(new Set(names)).slice(0, 20);
}

function developerName(value: unknown) {
  if (!Array.isArray(value)) return null;
  const companies = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const company = row.company;
    if (!company || typeof company !== 'object') return [];
    const name = clean((company as Record<string, unknown>).name, 200);
    if (!name) return [];
    return [{ name, developer: row.developer === true, publisher: row.publisher === true }];
  });
  return (companies.find((entry) => entry.developer) ?? companies.find((entry) => entry.publisher) ?? companies[0])?.name ?? null;
}

function igdbUrl(value: unknown) {
  const url = clean(value, 500);
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.igdb.com' && parsed.pathname.startsWith('/games/')
      ? parsed.toString()
      : null;
  } catch { return null; }
}

function gameType(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  return clean((value as Record<string, unknown>).type, 80) || null;
}

export function coverUrl(imageId: unknown) {
  const id = clean(imageId, 120);
  return IMAGE_ID.test(id)
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`
    : null;
}

export function mapIgdbGame(value: unknown): GameEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0 ? String(row.id) : '';
  const title = clean(row.name, 100);
  if (!EXTERNAL_ID.test(id) || !title || row.version_parent != null) return null;
  const cover = row.cover && typeof row.cover === 'object'
    ? coverUrl((row.cover as Record<string, unknown>).image_id)
    : null;
  return {
    source: IGDB_SOURCE,
    externalId: id,
    title,
    developerName: developerName(row.involved_companies),
    platformNames: platformNames(row.platforms),
    releaseYear: releaseYear(row.first_release_date),
    coverUrl: cover,
    igdbUrl: igdbUrl(row.url),
    gameType: gameType(row.game_type),
    existingItemId: null,
  };
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function quoteApicalypse(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const GAME_FIELDS = [
  'id','name','slug','url','first_release_date','version_parent','parent_game',
  'game_type.type','platforms.name','cover.image_id',
  'involved_companies.developer','involved_companies.publisher','involved_companies.company.name',
].join(',');

export function buildGameSearchQuery(query: string) {
  return `search "${quoteApicalypse(query)}"; fields ${GAME_FIELDS}; where version_parent = null; limit 20;`;
}

export function buildGameDetailQuery(id: string) {
  return `fields ${GAME_FIELDS}; where id = ${id}; limit 1;`;
}

type Remote = { data: unknown; error?: never } | { error: Response; data?: never };
type Dependencies = {
  client: () => SupabaseClient | null;
  fetchIgdb: (query: string, client: SupabaseClient) => Promise<Remote>;
  readCache: (client: SupabaseClient, key: string, maxAgeMs: number) => Promise<unknown | null>;
  writeCache: (client: SupabaseClient, key: string, payload: unknown) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
};

async function catalogCategory(client: SupabaseClient) {
  const categoryResult = await client.from('categories').select('id,parent_id')
    .eq('slug', 'game').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
  const category = categoryResult.data;
  if (categoryResult.error || !category) return null;
  const children = await client.from('categories').select('id').eq('parent_id', category.id).limit(1);
  if (children.error || children.data?.length) return null;
  if (category.parent_id) {
    const parent = await client.from('categories').select('id,parent_id')
      .eq('id', category.parent_id).eq('status', 'open').eq('is_visible', true).eq('is_pickable', false).maybeSingle();
    if (parent.error || !parent.data || parent.data.parent_id) return null;
  }
  return category;
}

export function createGameCatalogHandler(deps: Dependencies) {
  const { client: makeClient, fetchIgdb, readCache, writeCache, json } = deps;
  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const query = clean(body.query, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (body.action === 'search' && (query.length < 2 || query.length > 100)) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !EXTERNAL_ID.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);
    let importUserId: string | null = null;

    if (body.action === 'import') {
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

    const category = await catalogCategory(client);
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);

    if (body.action === 'search') {
      const cacheKey = `search:\n${query}`;
      const cached = await readCache(client, cacheKey, 6 * 60 * 60_000);
      let games = Array.isArray(cached)
        ? cached.map(mapIgdbGame).filter((entry): entry is GameEntry => Boolean(entry))
        : [];
      if (!games.length) {
        const remote = await fetchIgdb(buildGameSearchQuery(query), client);
        if (remote.error) return remote.error;
        const source = Array.isArray(remote.data) ? remote.data : [];
        const seen = new Set<string>();
        games = source.map(mapIgdbGame).filter((entry): entry is GameEntry => {
          if (!entry || seen.has(entry.externalId)) return false;
          seen.add(entry.externalId);
          return true;
        }).slice(0, 20);
        await writeCache(client, cacheKey, source.slice(0, 40));
      }
      if (!games.length) return json({ games: [] });
      const known = await client.from('items').select('id,external_id')
        .eq('category_id', category.id).eq('external_source', IGDB_SOURCE)
        .in('external_id', games.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const ids = new Map((known.data ?? []).map((item) => [item.external_id, item.id]));
      return json({ games: games.map((entry) => ({ ...entry, existingItemId: ids.get(entry.externalId) ?? null })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status')
      .eq('external_source', IGDB_SOURCE).eq('external_id', id).maybeSingle();
    const receipt = (item: { id: string; category_id: string; status: string }) =>
      item.category_id === category.id && ['active', 'discontinued'].includes(item.status)
        ? json({ itemId: item.id, categoryId: item.category_id, created: false })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);

    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) return receipt(existing.data);

    const cacheKey = `game:\n${id}`;
    const cached = await readCache(client, cacheKey, 24 * 60 * 60_000);
    let raw = cached && typeof cached === 'object' && !Array.isArray(cached)
      ? cached as Record<string, unknown>
      : null;
    if (!raw) {
      const remote = await fetchIgdb(buildGameDetailQuery(id), client);
      if (remote.error) return remote.error;
      const source = Array.isArray(remote.data) ? remote.data : [];
      raw = source[0] && typeof source[0] === 'object' ? source[0] as Record<string, unknown> : null;
      if (raw) await writeCache(client, cacheKey, raw);
    }
    const game = mapIgdbGame(raw);
    if (!game || game.externalId !== id) return json({ error: 'GAME_NOT_FOUND' }, 404);

    const platforms = game.platformNames.join(' · ').slice(0, 300) || null;
    const inserted = await client.from('items').insert({
      category_id: category.id,
      name: game.title,
      normalized_name: normalizeItemName([game.title, game.developerName, platforms].filter(Boolean).join(' ')),
      official_url: game.igdbUrl,
      image_source_url: game.coverUrl,
      external_source: IGDB_SOURCE,
      created_by: importUserId,
      external_id: id,
      original_name: game.title,
      release_year: game.releaseYear,
      creator_name: game.developerName,
      collection_name: platforms,
      status: 'active',
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) {
      return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    }
    if (inserted.error?.code === 'P0001' && inserted.error.message?.includes('RATE_LIMITED')) {
      return json({ error: 'RATE_LIMITED' }, 429);
    }
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    const winner = await findExisting();
    return !winner.error && winner.data ? receipt(winner.data) : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
