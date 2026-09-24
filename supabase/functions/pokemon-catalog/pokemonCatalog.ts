import type { SupabaseClient } from '@supabase/supabase-js';

export const POKEAPI_SOURCE = 'pokeapi_species' as const;
const EXTERNAL_ID = /^\d{1,6}$/;
const ARTWORK_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
const clean = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export type PokemonEntry = {
  source: typeof POKEAPI_SOURCE;
  externalId: string;
  name: string;
  englishName: string;
  dexNumber: number;
  imageUrl: string;
  existingItemId: string | null;
};

type IndexName = { name: string; language: string };
type IndexEntry = { id: number; slug: string; names: IndexName[] };

function formatSlug(value: string) {
  return value.split('-').filter(Boolean)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function normalizedSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ko-KR')
    .replace(/[\s._'’\-]+/g, '');
}

export function pokemonArtworkUrl(id: number | string) {
  const value = String(id).trim();
  return EXTERNAL_ID.test(value) ? `${ARTWORK_BASE}${Number(value)}.png` : null;
}

function editDistanceAtMostOne(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let differences = 0;
    for (let index = 0; index < a.length; index++) {
      if (a[index] !== b[index] && ++differences > 1) return false;
    }
    return differences <= 1;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++;
      longIndex++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex++;
  }
  return true;
}

function localizedNames(value: unknown): IndexName[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const languageRow = row.language;
    const language = languageRow && typeof languageRow === 'object'
      ? clean((languageRow as Record<string, unknown>).name, 10)
      : '';
    const name = clean(row.name, 100);
    return name && (language === 'ko' || language === 'en') ? [{ name, language }] : [];
  });
}

export function mapGraphqlSpecies(value: unknown): IndexEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0 ? row.id : 0;
  const slug = clean(row.name, 100);
  if (!id || !slug) return null;
  const names = localizedNames(row.pokemonspeciesnames);
  return { id, slug, names };
}

function displayNames(entry: IndexEntry) {
  const korean = entry.names.find((name) => name.language === 'ko')?.name;
  const english = entry.names.find((name) => name.language === 'en')?.name ?? formatSlug(entry.slug);
  return { korean: korean ?? english, english };
}

function searchRank(entry: IndexEntry, query: string) {
  const { korean, english } = displayNames(entry);
  const values = [korean, english, entry.slug].map(normalizedSearch);
  if (values.some((value) => value === query)) return 0;
  if (values.some((value) => value.startsWith(query))) return 1;
  if (values.some((value) => value.includes(query))) return 2;
  if (Array.from(query).length >= 3
    && values.some((value) => Array.from(value).length >= 3 && editDistanceAtMostOne(value, query))) return 3;
  return 99;
}

export function searchSpeciesIndex(index: unknown, queryText: string): PokemonEntry[] {
  if (!Array.isArray(index)) return [];
  const entries = index.map(mapGraphqlSpecies).filter((entry): entry is IndexEntry => Boolean(entry));
  const numeric = queryText.trim().match(/^#?(\d{1,6})$/);
  if (numeric) {
    const id = Number(numeric[1]);
    const match = entries.find((entry) => entry.id === id);
    if (!match) return [];
    const names = displayNames(match);
    return [{
      source: POKEAPI_SOURCE,
      externalId: String(match.id),
      name: names.korean,
      englishName: names.english,
      dexNumber: match.id,
      imageUrl: pokemonArtworkUrl(match.id)!,
      existingItemId: null,
    }];
  }

  const query = normalizedSearch(queryText);
  if (!query) return [];
  return entries
    .map((entry) => ({ entry, rank: searchRank(entry, query) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank || a.entry.id - b.entry.id)
    .slice(0, 20)
    .map(({ entry }) => {
      const names = displayNames(entry);
      return {
        source: POKEAPI_SOURCE,
        externalId: String(entry.id),
        name: names.korean,
        englishName: names.english,
        dexNumber: entry.id,
        imageUrl: pokemonArtworkUrl(entry.id)!,
        existingItemId: null,
      };
    });
}

function detailNames(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0 ? row.id : 0;
  const slug = clean(row.name, 100);
  if (!id || !slug || !Array.isArray(row.names)) return null;
  const names = localizedNames(row.names);
  const indexEntry: IndexEntry = { id, slug, names };
  const display = displayNames(indexEntry);
  return { id, slug, ...display };
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

type Remote<T> = { data: T; error?: never } | { error: Response; data?: never };
type Dependencies = {
  client: () => SupabaseClient | null;
  loadIndex: (client: SupabaseClient) => Promise<Remote<unknown>>;
  loadSpecies: (client: SupabaseClient, id: string) => Promise<Remote<unknown>>;
  json: (body: unknown, status?: number) => Response;
};

async function catalogCategory(client: SupabaseClient) {
  const categoryResult = await client.from('categories').select('id,parent_id')
    .eq('slug', 'pokemon').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
  const category = categoryResult.data;
  if (categoryResult.error || !category) return null;
  const children = await client.from('categories').select('id').eq('parent_id', category.id).limit(1);
  if (children.error || children.data?.length) return null;
  if (category.parent_id) {
    const parent = await client.from('categories').select('id,parent_id')
      .eq('id', category.parent_id).eq('slug', 'character')
      .eq('status', 'open').eq('is_visible', true).eq('is_pickable', false).maybeSingle();
    if (parent.error || !parent.data || parent.data.parent_id) return null;
  }
  return category;
}

export function createPokemonCatalogHandler(deps: Dependencies) {
  const { client: makeClient, loadIndex, loadSpecies, json } = deps;
  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const query = clean(body.query, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (body.action === 'search' && (query.length < 1 || query.length > 100)) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !EXTERNAL_ID.test(id)) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
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
      const remote = await loadIndex(client);
      if (remote.error) return remote.error;
      const pokemon = searchSpeciesIndex(remote.data, query);
      if (!pokemon.length) return json({ pokemon: [] });
      const known = await client.from('items').select('id,external_id')
        .eq('category_id', category.id).eq('external_source', POKEAPI_SOURCE)
        .in('external_id', pokemon.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const ids = new Map((known.data ?? []).map((item) => [item.external_id, item.id]));
      return json({ pokemon: pokemon.map((entry) => ({ ...entry, existingItemId: ids.get(entry.externalId) ?? null })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status,image_source_url')
      .eq('external_source', POKEAPI_SOURCE).eq('external_id', id).maybeSingle();
    const eligible = (item: { category_id: string; status: string }) =>
      item.category_id === category.id && ['active', 'discontinued'].includes(item.status);
    const receipt = (item: { id: string; category_id: string; status: string }) =>
      eligible(item)
        ? json({ itemId: item.id, categoryId: item.category_id, created: false })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);

    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) {
      if (!eligible(existing.data)) return receipt(existing.data);
      const artwork = pokemonArtworkUrl(id);
      if (artwork && existing.data.image_source_url !== artwork) {
        const refreshed = await client.from('items').update({ image_source_url: artwork })
          .eq('id', existing.data.id);
        if (refreshed.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      }
      return receipt(existing.data);
    }

    const remote = await loadSpecies(client, id);
    if (remote.error) return remote.error;
    const species = detailNames(remote.data);
    if (!species || String(species.id) !== id) return json({ error: 'POKEMON_NOT_FOUND' }, 404);

    const inserted = await client.from('items').insert({
      category_id: category.id,
      name: species.korean,
      normalized_name: normalizeItemName([species.korean, species.english].join(' ')),
      official_url: null,
      image_source_url: pokemonArtworkUrl(id),
      external_source: POKEAPI_SOURCE,
      created_by: importUserId,
      external_id: id,
      original_name: species.english,
      release_year: null,
      creator_name: null,
      collection_name: null,
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
