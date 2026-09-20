const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, imports = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, URL, Response, AbortController,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}

class AppError extends Error {
  constructor(code, message = code, cause) { super(message); this.code = code; this.cause = cause; }
}

async function main() {
  const calls = [];
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const entry = {
    source: 'google_books_volume',
    externalId: 'abc_DEF-123',
    title: '아리랑',
    subtitle: '조정래 대하소설',
    authorName: '조정래',
    publisherName: '해냄',
    releaseYear: 2001,
    isbn: '9788965749219',
    coverUrl: 'https://books.googleusercontent.com/books/content?id=abc_DEF-123',
    infoUrl: 'https://books.google.com/books?id=abc_DEF-123',
    language: 'ko',
    existingItemId: null,
  };
  const client = {
    functions: {
      invoke: async (slug, options) => {
        calls.push([slug, options]);
        return options.body.action === 'search'
          ? { data: { books: [entry] }, error: null }
          : { data: { itemId: ids[0], categoryId: ids[1], created: true }, error: null };
      },
    },
  };
  const { SupabaseBookCatalogRepository } = loadSource('repositories/supabase/supabaseBookCatalogRepository.ts', {
    '@/errors/appError': { AppError },
  });
  const repository = new SupabaseBookCatalogRepository(client);
  const controller = new AbortController();
  const found = await repository.search('아리랑', '조정래', controller.signal);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, '아리랑');
  assert.equal(calls[0][0], 'book-catalog');
  assert.equal(calls[0][1].body.action, 'search');
  assert.equal(calls[0][1].body.query, '아리랑');
  assert.equal(calls[0][1].body.author, '조정래');
  assert.equal(calls[0][1].signal, controller.signal);

  const imported = await repository.importBook('abc_DEF-123');
  assert.equal(imported.itemId, ids[0]);
  assert.equal(imported.categoryId, ids[1]);
  assert.equal(imported.created, true);
  assert.equal(calls[1][1].body.action, 'import');

  const { BookCatalogService } = loadSource('services/bookCatalogService.ts');
  let serviceQuery, serviceAuthor;
  const service = new BookCatalogService({
    search: async (query, author) => { serviceQuery = query; serviceAuthor = author; return [entry]; },
    importBook: async () => imported,
  });
  assert.equal((await service.search('  아리랑  ', '  조정래  '))[0].title, '아리랑');
  assert.equal(serviceQuery, '아리랑');
  assert.equal(serviceAuthor, '조정래');
  await service.search('아리랑', '   ');
  assert.equal(serviceAuthor, undefined, 'Blank author is omitted from the request');
  assert.equal((await service.search('가')).length, 0, 'one-character titles never hit Google Books');
  assert.equal((await service.search(' '.repeat(4))).length, 0);

  const itemSearch = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'item-search.tsx'), 'utf8');
  const explore = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(tabs)', 'explore.tsx'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(tabs)', 'index.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'pick', 'book.tsx'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'book-catalog', 'bookCatalog.ts'), 'utf8');
  assert.match(itemSearch, /onSearchBook/);
  assert.match(itemSearch, /도서 DB에서 검색/);
  assert.match(explore, /pathname: '\/pick\/book'/);
  assert.match(home, /pathname: '\/pick\/book'/);
  assert.match(screen, /Google Books/);
  assert.match(screen, /책 제목/);
  assert.match(screen, /작가 이름/);
  assert.match(screen, /예: 아리랑/);
  assert.match(screen, /예: 조정래/);
  assert.match(server, /intitle:/);
  assert.match(server, /inauthor:/);
  assert.match(server, /author:/);

  console.log('Book catalog checks passed: title+author transport, service normalization, fielded Google Books query, Home/Explore continuation and book route.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
