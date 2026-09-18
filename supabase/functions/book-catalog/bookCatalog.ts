import type { SupabaseClient } from '@supabase/supabase-js';

export const NLK_BOOK_SOURCE = 'nlk_isbn' as const;
const ISBN13 = /^(?:978|979)\d{10}$/;
const clean = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export type BookEntry = {
  source: typeof NLK_BOOK_SOURCE;
  externalId: string;
  title: string;
  authorName: string | null;
  publisherName: string | null;
  editionStatement: string | null;
  formatName: string | null;
  publishYear: number | null;
  isEbook: boolean | null;
  coverUrl: null;
  existingItemId: string | null;
};

export function normalizeIsbn13(value: unknown) {
  const digits = typeof value === 'string' ? value.replace(/[-\s]/g, '') : '';
  if (!ISBN13.test(digits)) return null;
  const sum = digits.slice(0, 12).split('').reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[12]) ? digits : null;
}

function publishYear(value: unknown) {
  const text = clean(value, 30);
  const match = text.match(/(1[4-9]\d{2}|20\d{2}|21\d{2}|2200)/);
  return match ? Number(match[1]) : null;
}

function ebook(value: unknown): boolean | null {
  const text = clean(value, 10).toUpperCase();
  return text === 'Y' ? true : text === 'N' ? false : null;
}

export function mapNlkBook(value: unknown): BookEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const isbn = normalizeIsbn13(row.EA_ISBN ?? row.ea_isbn ?? row.ISBN ?? row.isbn);
  const title = clean(row.TITLE ?? row.title, 100);
  if (!isbn || !title) return null;
  return {
    source: NLK_BOOK_SOURCE,
    externalId: isbn,
    title,
    authorName: clean(row.AUTHOR ?? row.author, 200) || null,
    publisherName: clean(row.PUBLISHER ?? row.publisher, 200) || null,
    editionStatement: clean(row.EDITION_STMT ?? row.edition_stmt, 120) || null,
    formatName: clean(row.FORM ?? row.form, 80) || null,
    publishYear: publishYear(row.PUBLISH_PREDATE ?? row.publish_predate),
    isEbook: ebook(row.EBOOK_YN ?? row.ebook_yn),
    // TITLE_URL exists in the provider response, but OnePick does not display or
    // persist it until per-image reuse rights can be verified.
    coverUrl: null,
    existingItemId: null,
  };
}

export function extractNlkRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const row = data as Record<string, unknown>;
  if (Array.isArray(row.docs)) return row.docs;
  if (row.docs && typeof row.docs === 'object') {
    const docs = row.docs as Record<string, unknown>;
    if (Array.isArray(docs.e)) return docs.e;
    if (Array.isArray(docs.item)) return docs.item;
  }
  if (Array.isArray(row.items)) return row.items;
  return [];
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function bookItemName(entry: Pick<BookEntry, 'title' | 'authorName'>) {
  if (!entry.authorName) return entry.title;
  const combined = `${entry.title} · ${entry.authorName}`;
  return combined.length <= 100 ? combined : `${entry.title.slice(0, 70)} · ${entry.authorName}`.slice(0, 100);
}

type Remote = { data: unknown; error?: never } | { error: Response; data?: never };
type Dependencies = {
  client: () => SupabaseClient | null;
  fetchNlk: (url: URL) => Promise<Remote>;
  readCache: (client: SupabaseClient, key: string, maxAgeMs: number) => Promise<unknown | null>;
  writeCache: (client: SupabaseClient, key: string, payload: unknown) => Promise<void>;
  json: (body: unknown, status?: number) => Response;
  apiKey: () => string | null;
};

async function catalogCategory(client: SupabaseClient) {
  const categoryResult = await client.from('categories').select('id,parent_id')
    .eq('slug', 'book').eq('status', 'open').eq('is_visible', true).eq('is_pickable', true).maybeSingle();
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

function providerUrl(apiKey: string, params: Record<string, string>) {
  const url = new URL('https://www.nl.go.kr/seoji/SearchApi.do');
  url.searchParams.set('cert_key', apiKey);
  url.searchParams.set('result_style', 'json');
  url.searchParams.set('page_no', '1');
  url.searchParams.set('page_size', '20');
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url;
}

export function createBookCatalogHandler(deps: Dependencies) {
  const { client: makeClient, fetchNlk, readCache, writeCache, json, apiKey } = deps;
  return async (body: Record<string, unknown>, req: Request): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') return json({ error: 'ACTION_INVALID' }, 400);
    const title = clean(body.title, 1000);
    const author = clean(body.author, 1000);
    const id = normalizeIsbn13(body.externalId);
    if (body.action === 'search' && (title.length < 1 || title.length > 100 || author.length > 100
      || (title.length < 2 && author.length < 2))) return json({ error: 'QUERY_INVALID' }, 400);
    if (body.action === 'import' && !id) return json({ error: 'EXTERNAL_ID_INVALID' }, 400);

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    if (body.action === 'import') {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (!token) return json({ error: 'AUTH_REQUIRED' }, 401);
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return json({ error: 'AUTH_REQUIRED' }, 401);
      const suspended = await client.rpc('user_is_suspended', { p_user_id: data.user.id });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    }

    const category = await catalogCategory(client);
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);
    const key = apiKey();
    if (!key) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    if (body.action === 'search') {
      const cacheKey = `search:\n${title}\n${author}`;
      const cached = await readCache(client, cacheKey, 6 * 60 * 60_000);
      let rawRows = Array.isArray(cached) ? cached : null;
      if (!rawRows) {
        const remote = await fetchNlk(providerUrl(key, { title, author }));
        if (remote.error) return remote.error;
        rawRows = extractNlkRows(remote.data).slice(0, 40);
        await writeCache(client, cacheKey, rawRows);
      }
      const seen = new Set<string>();
      const books = rawRows.map(mapNlkBook).filter((entry): entry is BookEntry => {
        if (!entry || seen.has(entry.externalId)) return false;
        seen.add(entry.externalId); return true;
      }).slice(0, 20);
      if (!books.length) return json({ books: [] });
      const known = await client.from('items').select('id,external_id')
        .eq('category_id', category.id).eq('external_source', NLK_BOOK_SOURCE)
        .in('external_id', books.map((entry) => entry.externalId)).in('status', ['active', 'discontinued']);
      if (known.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      const ids = new Map((known.data ?? []).map((item) => [item.external_id, item.id]));
      return json({ books: books.map((entry) => ({ ...entry, existingItemId: ids.get(entry.externalId) ?? null })) });
    }

    const findExisting = () => client.from('items').select('id,category_id,status')
      .eq('external_source', NLK_BOOK_SOURCE).eq('external_id', id!).maybeSingle();
    const receipt = (item: { id: string; category_id: string; status: string }) =>
      item.category_id === category.id && ['active', 'discontinued'].includes(item.status)
        ? json({ itemId: item.id, categoryId: item.category_id, created: false })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) return receipt(existing.data);

    const cacheKey = `isbn:\n${id}`;
    const cached = await readCache(client, cacheKey, 24 * 60 * 60_000);
    let rawRows = Array.isArray(cached) ? cached : null;
    if (!rawRows) {
      const remote = await fetchNlk(providerUrl(key, { isbn: id! }));
      if (remote.error) return remote.error;
      rawRows = extractNlkRows(remote.data).slice(0, 20);
      await writeCache(client, cacheKey, rawRows);
    }
    const book = rawRows.map(mapNlkBook).find((entry) => entry?.externalId === id) ?? null;
    if (!book) return json({ error: 'BOOK_NOT_FOUND' }, 404);

    const itemName = bookItemName(book);
    const inserted = await client.from('items').insert({
      category_id: category.id,
      name: itemName,
      normalized_name: normalizeItemName(`${book.title} ${book.authorName ?? ''}`),
      official_url: null,
      image_source_url: null,
      external_source: NLK_BOOK_SOURCE,
      external_id: book.externalId,
      original_name: book.title,
      release_year: book.publishYear,
      creator_name: book.authorName,
      collection_name: book.publisherName,
      status: 'active',
    }).select('id,category_id').maybeSingle();
    if (!inserted.error && inserted.data) return json({ itemId: inserted.data.id, categoryId: inserted.data.category_id, created: true });
    if (inserted.error?.code !== '23505') return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    const winner = await findExisting();
    return !winner.error && winner.data ? receipt(winner.data) : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
