import type { SupabaseClient } from '@supabase/supabase-js';

export const GOOGLE_BOOKS_SOURCE = 'google_books_volume' as const;
const VOLUME_ID = /^[A-Za-z0-9_-]{1,100}$/;

const clean = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : '';

export type BookEntry = {
  source: typeof GOOGLE_BOOKS_SOURCE;
  externalId: string;
  title: string;
  subtitle: string | null;
  authorName: string | null;
  publisherName: string | null;
  releaseYear: number | null;
  isbn: string | null;
  coverUrl: string | null;
  infoUrl: string | null;
  language: string | null;
  existingItemId: string | null;
};

function releaseYear(value: unknown) {
  const date = clean(value, 30);
  const match = /^(\d{4})/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1888 && year <= 2200 ? year : null;
}

function authorName(value: unknown) {
  if (!Array.isArray(value)) return null;
  const authors = value
    .map((author) => clean(author, 120))
    .filter(Boolean);
  if (!authors.length) return null;
  return authors.join(' · ').slice(0, 300);
}

function isbn(value: unknown) {
  if (!Array.isArray(value)) return null;
  const rows = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const type = clean(row.type, 20);
    const identifier = clean(row.identifier, 40);
    return identifier ? [{ type, identifier }] : [];
  });
  return (
    rows.find((row) => row.type === 'ISBN_13')
    ?? rows.find((row) => row.type === 'ISBN_10')
    ?? rows[0]
  )?.identifier ?? null;
}

function googleUrl(value: unknown) {
  const raw = clean(value, 2048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'books.google.com' || host.startsWith('books.google.'))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function coverUrl(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const candidate = ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail']
    .map((key) => clean(row[key], 2048))
    .find(Boolean);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'books.google.com'
      || host.startsWith('books.google.')
      || host === 'books.googleusercontent.com'
      || host.endsWith('.googleusercontent.com')
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function mapGoogleBookVolume(value: unknown): BookEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clean(row.id, 100);
  const volumeInfo = row.volumeInfo;
  if (!VOLUME_ID.test(id) || !volumeInfo || typeof volumeInfo !== 'object') return null;

  const info = volumeInfo as Record<string, unknown>;
  const title = clean(info.title, 100);
  if (!title) return null;

  const printType = clean(info.printType, 20).toUpperCase();
  if (printType && printType !== 'BOOK') return null;

  return {
    source: GOOGLE_BOOKS_SOURCE,
    externalId: id,
    title,
    subtitle: clean(info.subtitle, 160) || null,
    authorName: authorName(info.authors),
    publisherName: clean(info.publisher, 300) || null,
    releaseYear: releaseYear(info.publishedDate),
    isbn: isbn(info.industryIdentifiers),
    coverUrl: coverUrl(info.imageLinks),
    infoUrl: googleUrl(info.canonicalVolumeLink) ?? googleUrl(info.infoLink),
    language: clean(info.language, 12) || null,
    existingItemId: null,
  };
}

export function normalizeItemName(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

type Remote =
  | { data: Record<string, unknown>; error?: never }
  | { error: Response; data?: never };

type Dependencies = {
  client: () => SupabaseClient | null;
  fetchGoogleBooks: (url: URL, client: SupabaseClient) => Promise<Remote>;
  readCache: (
    client: SupabaseClient,
    key: string,
    maxAgeMs: number,
  ) => Promise<unknown | null>;
  writeCache: (
    client: SupabaseClient,
    key: string,
    payload: unknown,
  ) => Promise<void>;
  waitForProvider: (client: SupabaseClient) => Promise<boolean>;
  json: (body: unknown, status?: number) => Response;
};

async function catalogCategory(client: SupabaseClient) {
  const categoryResult = await client
    .from('categories')
    .select('id,parent_id')
    .eq('slug', 'book')
    .eq('status', 'open')
    .eq('is_visible', true)
    .eq('is_pickable', true)
    .maybeSingle();

  const category = categoryResult.data;
  if (categoryResult.error || !category) return null;

  const children = await client
    .from('categories')
    .select('id')
    .eq('parent_id', category.id)
    .limit(1);
  if (children.error || children.data?.length) return null;

  if (category.parent_id) {
    const parent = await client
      .from('categories')
      .select('id,parent_id')
      .eq('id', category.parent_id)
      .eq('status', 'open')
      .eq('is_visible', true)
      .eq('is_pickable', false)
      .maybeSingle();

    if (parent.error || !parent.data || parent.data.parent_id) return null;
  }

  return category;
}

export function createBookCatalogHandler(deps: Dependencies) {
  const {
    client: makeClient,
    fetchGoogleBooks,
    readCache,
    writeCache,
    waitForProvider,
    json,
  } = deps;

  return async (
    body: Record<string, unknown>,
    req: Request,
  ): Promise<Response> => {
    if (body.action !== 'search' && body.action !== 'import') {
      return json({ error: 'ACTION_INVALID' }, 400);
    }

    const query = clean(body.query, 1000);
    const author = clean(body.author, 1000);
    const id = typeof body.externalId === 'string' ? body.externalId.trim() : '';

    if (
      body.action === 'search'
      && (query.length < 2 || query.length > 100 || author.length > 100)
    ) {
      return json({ error: 'QUERY_INVALID' }, 400);
    }

    if (body.action === 'import' && !VOLUME_ID.test(id)) {
      return json({ error: 'EXTERNAL_ID_INVALID' }, 400);
    }

    const client = makeClient();
    if (!client) return json({ error: 'CATALOG_NOT_CONFIGURED' }, 503);

    if (body.action === 'import') {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';

      if (!token) return json({ error: 'AUTH_REQUIRED' }, 401);

      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return json({ error: 'AUTH_REQUIRED' }, 401);

      const suspended = await client.rpc('user_is_suspended', {
        p_user_id: data.user.id,
      });
      if (suspended.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      if (suspended.data === true) {
        return json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);
      }
    }

    const category = await catalogCategory(client);
    if (!category) return json({ error: 'CATEGORY_NOT_FOUND' }, 503);

    if (body.action === 'search') {
      const cacheKey = `search:\n${query}\nauthor:\n${author}`;
      const cached = await readCache(client, cacheKey, 6 * 60 * 60_000);

      let books = Array.isArray(cached)
        ? cached
            .map(mapGoogleBookVolume)
            .filter((entry): entry is BookEntry => Boolean(entry))
        : [];

      if (!books.length) {
        if (!await waitForProvider(client)) {
          return json({ error: 'RATE_LIMITED' }, 429);
        }

        const url = new URL('https://www.googleapis.com/books/v1/volumes');
        const searchTerms = [`intitle:${query}`, author ? `inauthor:${author}` : null]
          .filter((value): value is string => Boolean(value))
          .join(' ');
        url.searchParams.set('q', searchTerms);
        url.searchParams.set('printType', 'books');
        url.searchParams.set('orderBy', 'relevance');
        url.searchParams.set('projection', 'full');
        url.searchParams.set('maxResults', '20');

        const remote = await fetchGoogleBooks(url, client);
        if (remote.error) return remote.error;

        const source = Array.isArray(remote.data.items) ? remote.data.items : [];
        const seen = new Set<string>();

        books = source
          .map(mapGoogleBookVolume)
          .filter((entry): entry is BookEntry => {
            if (!entry || seen.has(entry.externalId)) return false;
            seen.add(entry.externalId);
            return true;
          })
          .slice(0, 20);

        await writeCache(client, cacheKey, source.slice(0, 40));
      }

      if (!books.length) return json({ books: [] });

      const externalIds = books.map((entry) => entry.externalId);
      const isbns = Array.from(
        new Set(books.map((entry) => entry.isbn).filter((value): value is string => Boolean(value))),
      );

      const knownByExternal = await client
        .from('items')
        .select('id,external_id')
        .eq('category_id', category.id)
        .eq('external_source', GOOGLE_BOOKS_SOURCE)
        .in('external_id', externalIds)
        .in('status', ['active', 'discontinued']);

      if (knownByExternal.error) {
        return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      }

      const knownByIsbn = isbns.length
        ? await client
            .from('items')
            .select('id,model_code')
            .eq('category_id', category.id)
            .in('model_code', isbns)
            .in('status', ['active', 'discontinued'])
        : { data: [], error: null };

      if (knownByIsbn.error) {
        return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
      }

      const idsByExternal = new Map(
        (knownByExternal.data ?? []).map((item) => [item.external_id, item.id]),
      );
      const idsByIsbn = new Map(
        (knownByIsbn.data ?? []).map((item) => [item.model_code, item.id]),
      );

      return json({
        books: books.map((entry) => ({
          ...entry,
          existingItemId:
            idsByExternal.get(entry.externalId)
            ?? (entry.isbn ? idsByIsbn.get(entry.isbn) : null)
            ?? null,
        })),
      });
    }

    const findExisting = () =>
      client
        .from('items')
        .select('id,category_id,status')
        .eq('external_source', GOOGLE_BOOKS_SOURCE)
        .eq('external_id', id)
        .maybeSingle();

    const findExistingByIsbn = (isbn: string | null) =>
      isbn
        ? client
            .from('items')
            .select('id,category_id,status')
            .eq('category_id', category.id)
            .eq('model_code', isbn)
            .in('status', ['active', 'discontinued'])
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

    const receipt = (item: {
      id: string;
      category_id: string;
      status: string;
    }) =>
      item.category_id === category.id
        && ['active', 'discontinued'].includes(item.status)
        ? json({
            itemId: item.id,
            categoryId: item.category_id,
            created: false,
          })
        : json({ error: 'ITEM_NOT_ELIGIBLE' }, 409);

    const existing = await findExisting();
    if (existing.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (existing.data) return receipt(existing.data);

    const cacheKey = `volume:\n${id}`;
    const cached = await readCache(client, cacheKey, 24 * 60 * 60_000);

    let raw =
      cached && typeof cached === 'object' && !Array.isArray(cached)
        ? cached as Record<string, unknown>
        : null;

    if (!raw) {
      if (!await waitForProvider(client)) {
        return json({ error: 'RATE_LIMITED' }, 429);
      }

      const url = new URL(
        `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}`,
      );
      url.searchParams.set('projection', 'full');

      const remote = await fetchGoogleBooks(url, client);
      if (remote.error) return remote.error;

      raw = remote.data;
      await writeCache(client, cacheKey, raw);
    }

    const book = mapGoogleBookVolume(raw);
    if (!book || book.externalId !== id) {
      return json({ error: 'BOOK_NOT_FOUND' }, 404);
    }

    const isbnMatch = await findExistingByIsbn(book.isbn);
    if (isbnMatch.error) return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    if (isbnMatch.data) return receipt(isbnMatch.data);

    const inserted = await client
      .from('items')
      .insert({
        category_id: category.id,
        name: book.title,
        normalized_name: normalizeItemName(
          [
            book.title,
            book.subtitle,
            book.authorName,
            book.publisherName,
            book.isbn,
          ]
            .filter(Boolean)
            .join(' '),
        ),
        model_code: book.isbn,
        official_url: book.infoUrl,
        image_source_url: book.coverUrl,
        external_source: GOOGLE_BOOKS_SOURCE,
        external_id: id,
        original_name: book.title,
        release_year: book.releaseYear,
        creator_name: book.authorName,
        collection_name: book.publisherName,
        status: 'active',
      })
      .select('id,category_id')
      .maybeSingle();

    if (!inserted.error && inserted.data) {
      return json({
        itemId: inserted.data.id,
        categoryId: inserted.data.category_id,
        created: true,
      });
    }

    if (inserted.error?.code !== '23505') {
      console.error('Google Books item insert failed', inserted.error?.code);
      return json({ error: 'CATALOG_UNAVAILABLE' }, 503);
    }

    const winner = await findExisting();
    return !winner.error && winner.data
      ? receipt(winner.data)
      : json({ error: 'CATALOG_UNAVAILABLE' }, 503);
  };
}
