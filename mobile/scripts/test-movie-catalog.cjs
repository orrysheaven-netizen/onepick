const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

async function main() {
  const catalog = load(path.join(__dirname, '../../supabase/functions/movie-catalog/movieCatalog.ts'));
  const interstellar = catalog.mapTmdbMovie({
    id: 157336,
    title: '  인터스텔라  ',
    original_title: 'Interstellar',
    release_date: '2014-11-05',
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    adult: false,
  });
  assert.equal(interstellar.externalId, '157336');
  assert.equal(interstellar.title, '인터스텔라');
  assert.equal(interstellar.releaseYear, 2014);
  assert.equal(interstellar.posterUrl, 'https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg');
  assert.equal(catalog.normalizeItemName(' 기생충  영화 '), '기생충영화');
  assert.equal(catalog.mapTmdbMovie({ id: 1, title: '성인 영화', adult: true }), null);
  assert.equal(catalog.mapTmdbMovie({ id: 2, title: '안전하지 않은 포스터', poster_path: 'https://bad.example/image.jpg' }).posterUrl, null);

  const mapper = load(path.join(__dirname, '../src/repositories/mappers/itemMapper.ts'));
  const mapped = mapper.mapItemRow({
    id: 'item', category_id: 'movie', brand_id: null, name: '인터스텔라', normalized_name: '인터스텔라',
    model_code: null, official_url: 'https://www.themoviedb.org/movie/157336', status: 'active',
    merged_into_item_id: null, created_by: null, created_at: 'now', updated_at: 'now', image_path: null,
    thumbnail_path: null, image_source_url: interstellar.posterUrl, external_source: 'tmdb', external_id: '157336',
    original_name: 'Interstellar', release_year: 2014,
  });
  assert.equal(mapped.thumbnailUrl, interstellar.posterUrl, 'Remote catalog image is the display fallback');
  assert.equal(mapped.externalSource, 'tmdb');
  assert.equal(mapped.externalId, '157336');
  assert.equal(mapped.releaseYear, 2014);

  const { MovieCatalogService } = load(path.join(__dirname, '../src/services/movieCatalogService.ts'));
  const searches = [];
  const service = new MovieCatalogService({
    search: async (query) => { searches.push(query); return [interstellar]; },
    importMovie: async (externalId) => ({ itemId: 'item', categoryId: 'movie', created: externalId === '157336' }),
  });
  assert.equal((await service.search(' ')).length, 0);
  assert.equal((await service.search('  인터   스텔라  '))[0].externalId, '157336');
  assert.equal(searches[0], '인터 스텔라');
  assert.equal((await service.importMovie('157336')).created, true);

  console.log('Movie catalog checks passed: TMDB mapping, image fallback, normalized search and selected-item import.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
