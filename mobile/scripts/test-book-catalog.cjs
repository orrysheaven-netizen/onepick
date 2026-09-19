const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URL, Request, Response, AbortController, console,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

const {
  mapGoogleBookVolume,
  createBookCatalogHandler,
} = load('supabase/functions/book-catalog/bookCatalog.ts', { '@supabase/supabase-js': {} });

const raw = {
  id: 'h433zQEACAAJ',
  volumeInfo: {
    title: '아리랑',
    subtitle: '조정래 대하소설',
    authors: ['조정래'],
    publisher: '해냄출판사',
    publishedDate: '2020-01-01',
    printType: 'BOOK',
    industryIdentifiers: [
      { type: 'ISBN_10', identifier: '8965749433' },
      { type: 'ISBN_13', identifier: '9788965749431' },
    ],
    imageLinks: { thumbnail: 'http://books.google.com/books/content?id=h433zQEACAAJ' },
    canonicalVolumeLink: 'http://books.google.com/books?id=h433zQEACAAJ',
    language: 'ko',
  },
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function makeClient() {
  const categories = [
    { id: 'book', parent_id: 'reading', slug: 'book', status: 'open', is_visible: true, is_pickable: true },
    { id: 'reading', parent_id: null, slug: 'reading', status: 'open', is_visible: true, is_pickable: false },
  ];
  const items = [];
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
    rpc: async () => ({ data: false, error: null }),
    from(table) {
      const filters = [];
      let limit = Infinity;
      const source = () => table === 'categories' ? categories : items;
      const run = async (single = false) => {
        const rows = source().filter((row) => filters.every((fn) => fn(row))).slice(0, limit);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const q = {
        select: () => q,
        eq: (key, value) => { filters.push((row) => row[key] === value); return q; },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return q; },
        limit: (value) => { limit = value; return q; },
        maybeSingle: () => run(true),
        then: (resolve, reject) => run(false).then(resolve, reject),
      };
      return q;
    },
  };
}

async function main() {
  const mapped = mapGoogleBookVolume(raw);
  assert.equal(mapped.source, 'google_books_volume');
  assert.equal(mapped.externalId, 'h433zQEACAAJ');
  assert.equal(mapped.title, '아리랑');
  assert.equal(mapped.authorName, '조정래');
  assert.equal(mapped.publisherName, '해냄출판사');
  assert.equal(mapped.releaseYear, 2020);
  assert.equal(mapped.isbn, '9788965749431');
  assert.equal(mapped.language, 'ko');
  assert.match(mapped.coverUrl, /^https:\/\/books\.google\.com\//);
  assert.match(mapped.infoUrl, /^https:\/\/books\.google\.com\//);

  const client = makeClient();
  const upstream = [];
  const cache = new Map();
  const handler = createBookCatalogHandler({
    client: () => client,
    json,
    waitForProvider: async () => true,
    readCache: async (_client, key) => cache.get(key) ?? null,
    writeCache: async (_client, key, payload) => { cache.set(key, payload); },
    fetchGoogleBooks: async (url) => {
      upstream.push(url);
      return { data: { items: [raw] } };
    },
  });

  const searchResponse = await handler(
    { action: 'search', query: '아리랑' },
    new Request('https://edge.test'),
  );
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.equal(search.books.length, 1);
  assert.equal(search.books[0].externalId, 'h433zQEACAAJ');
  assert.equal(upstream[0].hostname, 'www.googleapis.com');
  assert.equal(upstream[0].pathname, '/books/v1/volumes');
  assert.equal(upstream[0].searchParams.get('q'), '아리랑');
  assert.equal(upstream[0].searchParams.get('printType'), 'books');
  assert.equal(upstream[0].searchParams.get('maxResults'), '20');

  const AppError = class extends Error {
    constructor(code) { super(code); this.code = code; }
  };
  const { SupabaseBookCatalogRepository } = load(
    'mobile/src/repositories/supabase/supabaseBookCatalogRepository.ts',
    { '@/errors/appError': { AppError } },
  );
  const calls = [];
  const repo = new SupabaseBookCatalogRepository({
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return options.body.action === 'search'
          ? { data: { books: [mapped] }, error: null }
          : {
              data: {
                itemId: 'c3333333-3333-4333-8333-333333333333',
                categoryId: 'd4444444-4444-4444-8444-444444444444',
                created: false,
              },
              error: null,
            };
      },
    },
  });

  const signal = new AbortController().signal;
  const repoSearch = await repo.search(' 아리랑 ', ' 조정래 ', signal);
  assert.equal(repoSearch[0].title, '아리랑');
  assert.equal(calls[0].name, 'book-catalog');
  assert.deepEqual(calls[0].options.body, { action: 'search', query: '아리랑 조정래' });
  assert.equal(calls[0].options.signal, signal);

  await repo.importBook('h433zQEACAAJ');
  assert.deepEqual(calls.at(-1).options.body, { action: 'import', externalId: 'h433zQEACAAJ' });
  await assert.rejects(() => repo.importBook('bad/id'), (error) => error.code === 'ITEM_NOT_FOUND');

  const { BookCatalogService } = load('mobile/src/services/bookCatalogService.ts');
  const serviceCalls = [];
  const service = new BookCatalogService({
    search: async (...args) => { serviceCalls.push(args); return [mapped]; },
    importBook: async (id) => { serviceCalls.push(['import', id]); return { created: true }; },
  });
  await service.search(' 아리랑 ', ' 조정래 ');
  assert.deepEqual(serviceCalls[0].slice(0, 2), ['아리랑', '조정래']);
  await service.importBook('abc-DEF_123');
  assert.deepEqual(serviceCalls.at(-1), ['import', 'abc-DEF_123']);

  const auth = load('mobile/src/lib/auth/authIntent.ts');
  const categoryId = 'd4444444-4444-4444-8444-444444444444';
  const intent = auth.getAuthIntent({
    action: 'choose_book',
    externalBookId: 'h433zQEACAAJ',
    categoryId,
  });
  assert.equal(intent.action, 'choose_book');
  assert.equal(intent.externalBookId, 'h433zQEACAAJ');
  assert.equal(auth.getPostAuthRoute(intent).pathname, '/pick/book');
  assert.equal(auth.getAuthIntent({
    action: 'choose_book',
    externalBookId: 'bad/id',
    categoryId,
  }).action, 'home');

  console.log('Book catalog passed: Google Books query contract, Korean title mapping, volume-ID import and auth return.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
